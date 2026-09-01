# Automation — driving SUNA from outside the window

SUNA is an academic-writing desktop app, but almost nothing it does requires
its window. The manuscript, the bibliography, the figures, the review
comments and the round bookkeeping are all plain text on disk, and there are
two supported ways to reach them without touching a mouse:

* **The MCP server** (`packages/agent`) — a stdio Model Context Protocol
  server exposing 34 validated manuscript verbs. It runs standalone, with the
  app closed, and it is how Claude Code and Codex work on a SUNA project.
* **The CDP driver** (`scripts/e2e/drive.mjs`) — boots the real Electron app
  **hidden**, then attaches in milliseconds for screenshots, page evals and
  probe scripts.

Both are the same code the product runs. There is no second headless engine
and no automation-only path into the renderer.

**The absolute rule for UI work: checks run against a HIDDEN app.** Never
launch a visible window to test something, and never run `pnpm dev` for that
purpose — `pnpm dev` exists for a human who wants to look at the app.

---

## 1. Ten seconds of MCP

From a clean checkout:

```sh
pnpm install
cd packages/agent && node build-mcp.mjs      # ~110 ms, writes dist-mcp/server.mjs
```

Then ask the bundled server a question about the example project:

```sh
node scripts/e2e/mcp-probe.mjs --project examples/hello-suna --call list_outline '{}'
```

```
(untitled leading section) — 135 words
Results — 225 words
Methods — 263 words
```

```sh
node scripts/e2e/mcp-probe.mjs --project examples/hello-suna --call check_manuscript '{}'
```

```
warning ms.figure-uncited: Figure 2 ("timesheet") is never referenced in the text
```

That is the whole loop: a real JSON-RPC session over stdio against the real
bundle, the same one an agent CLI spawns. `--tools-only` verifies the
handshake and the tool list instead:

```sh
node scripts/e2e/mcp-probe.mjs --project examples/hello-suna --tools-only
#   ✓ initialize → suna 0.1.0
#   ✓ tools/list → 34 tools, all schemas present
```

Exit status is `0` when every probe passed and `1` otherwise; in `--call`
mode the tool's text goes to stdout and nothing else does, so a script can
assert on it directly.

---

## 2. The MCP server

### 2.1 What it is

`packages/agent/src/mcp/server.ts`, bundled by esbuild to
`packages/agent/dist-mcp/server.mjs`. One ESM file, `node22` target, with
`zod` and `jsdom` left external and everything else inlined — the bundle is
spawned from a packaged app's `Resources/mcp/`, where a runtime
`node_modules` lookup is not guaranteed to resolve.

```sh
node packages/agent/dist-mcp/server.mjs --project /path/to/project
```

Root resolution: the `--project <dir>` argv value if present, otherwise
`process.cwd()`. Every filesystem path a verb touches goes through
`resolveInside` (`packages/agent/src/mcp/project.ts`), which refuses anything
that escapes the root.

The server reads `suna.json` **fresh on every tool call**, so an external edit
to the manifest takes effect without a restart. A missing or invalid manifest
is not fatal: the verbs fall back to the default directory layout.

On boot it also *heals*, best-effort, the machine context layer and the
project's agent files (§3). A heal failure writes one line to stderr and the
server serves anyway.

### 2.2 Building it

| When | What rebuilds it |
|---|---|
| `pnpm dev` | The root script runs `pnpm --filter @suna/agent build:mcp` first. |
| `node scripts/e2e/drive.mjs --boot` | `buildMcpBundle()` runs esbuild before every boot. |
| `pnpm build` / `pnpm package` | Part of the workspace build; `stage:resources` copies it into the bundle. |
| By hand | `cd packages/agent && node build-mcp.mjs` |

The app spawns the **bundle**, never the TypeScript sources. A verb you just
fixed still behaves like the old one until the bundle is rebuilt — which is
exactly why `drive.mjs` rebuilds it unconditionally on boot.

### 2.3 Wiring: `.mcp.json`

A project's root carries a machine-local `.mcp.json`:

```json
{
  "mcpServers": {
    "suna": {
      "command": "/opt/homebrew/Cellar/node/25.4.0/bin/node",
      "args": [
        "/abs/path/to/SUNA/packages/agent/dist-mcp/server.mjs",
        "--project",
        "/abs/path/to/project"
      ]
    }
  }
}
```

Both `claude` and `codex` auto-discover that file in the working directory,
so `cd`-ing into a SUNA project and starting either CLI is the entire setup
step. It is **gitignored** — `ensureProjectAgentLayer` appends `.mcp.json` to
`.gitignore` before writing it — because it bakes absolute paths to one
machine's copy of the project and one machine's install of SUNA.

Who writes it:

* **The app**, on project open (`healProjectAgentLayer`,
  `apps/desktop/src/main/services/agentLayer.ts`), and on demand from the
  Agent view's `agent:write-mcp-config` IPC call.
* **The server itself**, on boot, from `selfInvocation()` in `server.ts`.

The `command` differs by install, deliberately:

| Install | `command` | `args[0]` | `env` |
|---|---|---|---|
| Dev, written by the app | `node` | `<repo>/packages/agent/dist-mcp/server.mjs` | — |
| Dev, written by the server | `process.execPath` (the node that ran it) | same | — |
| Packaged | the app binary (`process.execPath`) | `<resources>/mcp/server.mjs` | `ELECTRON_RUN_AS_NODE=1` |

The packaged form runs the Electron binary as Node, so a downloaded SUNA needs
no system `node` at all. The `ELECTRON_RUN_AS_NODE` marker is load-bearing:
without it the baked command would launch the GUI instead of the server.

**Gone, not different.** `ensureMcpJson` leaves an existing entry
byte-untouched as long as its baked server path still exists on disk *and* its
`--project` argument still names this root. Alternating between a dev checkout
and a packaged install therefore does not churn the file; only a path that has
actually disappeared triggers a re-bake. Other servers in the file are
preserved, and an unparseable file is moved aside to `.mcp.json.invalid`
rather than destroyed.

### 2.4 Environment

Nothing in SUNA exports these for you. Set them in the environment the server
is launched with (or in `.mcp.json`'s `env`).

| Variable | Effect |
|---|---|
| `SUNA_AGENT_NAME` | `author.name` on comments and replies this server writes. Default `"Agent"`. |
| `SUNA_AGENT_MODEL` | Optional model string recorded beside the author. |
| `SUNA_CONTACT_EMAIL` | Contact address sent with literature and PDF lookups. Crossref's polite pool prefers it; **Unpaywall's keyless API requires it**, so without it that rung of the download ladder is skipped and the report says so. Read in `packages/agent/src/mcp/study.ts`; empty or unset both resolve to `null`, never `""`. |
| `SUNA_CONFIG_DIR` | Overrides `~/SunaConfig` (§3). |
| `SUNA_SKILL_HOME` | Overrides `$HOME` for the pointer skill's path (§3.4). Test seam. |

Agent-authored comments always carry `author.kind: "agent"` regardless.

**There are no API keys here.** The server runs outside Electron and has no
access to the app's `safeStorage` key store, so every literature call is
keyless: Crossref (the default), bioRxiv/medRxiv and arXiv answer normally,
OpenAlex runs metered and will return HTTP 429 without budget. That is why
`find_study` queries all four providers in parallel and names each one that
failed — a metered 429 must never reach the user as "no such paper".

### 2.5 The 34 verbs

Counted from `TOOLS` in `packages/agent/src/mcp/verbs.ts` and confirmed live
against the bundle. Every reply is **plain text**; a failure comes back as
text with `isError: true`, not as a JSON-RPC protocol error, so an agent can
read the message and retry.

Two drift gates hold this list honest (§3.5): one compares `MCP.md`'s verb
table to `TOOLS` by name *and* count, another compares each documented input
list to the zod schema the verb actually parses with. `pnpm smoke`'s
`mcp-server-exposes-all-verbs` step asserts `probe.tools.length === 34`.

#### Project and prose

| Verb | Input | Returns |
|---|---|---|
| `list_project` | `{}` | Header (project name, active profile, root) then every file, recursive to depth 6, skipping `.git`, `node_modules`, `__pycache__`, `.DS_Store`, `.venv`. |
| `read_manuscript` | `{}` | The whole prose file — `manuscript.json`'s `manuscriptFile`, default `manuscript.md`. Records a fingerprint for the staleness check below. |
| `write_manuscript` | `{content}` | Overwrites the prose file atomically. **Refused** when the file changed on disk since this server last read it; the error tells you to re-read or use `edit_manuscript`. |
| `edit_manuscript` | `{find, replace}` | Exact-match replace of one occurrence. Zero matches errors (and says whether it *would* match ignoring whitespace); two or more errors with up to five match positions and a line of context each. Overlapping occurrences count. Success reports the offset and the derived section title. |
| `read_section` | `{path}` | **Deprecated** alias of `read_manuscript`; `path` is ignored. |
| `write_section` | `{path, content}` | **Deprecated** alias of `write_manuscript`; `path` is ignored. |
| `list_outline` | `{}` | The derived outline: indent by depth, title, word count. |
| `read_manuscript_meta` | `{}` | `manuscript.json` and `authors.json` concatenated, labelled. A missing `authors.json` yields an empty authors file rather than an error. |
| `read_bib` | `{}` | `manuscript/references.bib` verbatim. |

`edit_manuscript` is the primitive to prefer. Its exact-match contract fails
loudly when the text has moved; `write_manuscript` would otherwise silently
discard whatever the author typed while the agent was thinking, which is why
it carries the fingerprint guard at all.

Both write paths run `writeAtomic` (temp file + rename) and best-effort
comment re-anchoring afterwards; an anchor failure never fails the tool call,
because the prose edit already landed.

#### Documents, letters and rounds

| Verb | Input | Returns |
|---|---|---|
| `list_documents` | `{}` | Every document in the registry — manuscript, supplements, cover letters, responses, reports — with id, kind, title, prose file and profile. |
| `read_document` | `{documentId}` | Any document's prose by registry id. |
| `write_document` | `{documentId, content}` | Overwrites any document's prose by registry id. |
| `read_letter` | `{documentId}` | A cover letter's sidecar: the venue, what it covers, and which required assertions are still UNANSWERED. |
| `check_letter` | `{documentId}` | The letter against the target journal's stated requirements. |
| `list_rounds` | `{}` | Development rounds — internal circulations and external review rounds — with state, decision and points addressed. |
| `read_round` | `{roundId}` | One round: state, decision, freeze, per-reviewer progress. |
| `list_review_points` | `{roundId, status?, assignee?}` | The reviewer points verbatim, each with status and assignee. `status` is one of `unaddressed`, `drafted`, `done`, `rebutted`. |
| `set_point_status` | `{roundId, pointId, status, assignee?}` | Sets the **authors'** bookkeeping on a point. `assignee` accepts `null` to clear. |
| `check_response` | `{roundId, forExport?}` | Every unaddressed point by name, replies that name no point, and points marked answered whose reply never appears. |

Two omissions here are deliberate and permanent:

* **No verb writes a letter assertion.** A cover letter's assertions are the
  author's factual claims to an editor, over the author's signature. An agent
  may draft the argument and report what is unanswered; it may not sign.
* **No verb writes a reviewer's words.** Reviewer points in
  `rounds/<id>/reviewers/*.json` have no write path at all. `set_point_status`
  writes beside a point, never the point.

#### Figures and compliance

| Verb | Input | Returns |
|---|---|---|
| `list_figures` | `{}` | Figure ids with caption titles; a figure with no metadata still lists. |
| `read_figure_svg` | `{figureId}` | `figures/<id>/figure.svg` verbatim. |
| `check_figure_compliance` | `{figureId}` | `severity id: message` lines, or `<id>: compliant with <journal>`. |
| `check_manuscript` | `{}` | Word/abstract/section limits, required sections, availability statements, and prose ↔ figure referential integrity. Same lines, or `manuscript: compliant with <journal>`. |

Both compliance verbs answer `no active publisher profile: nothing to check
against` when the project has none, and both are **advisory only** — they
report a measured value against the journal's stated rule and never rewrite
anything.

`check_figure_compliance` parses SVG through the canvas engine, which needs
DOM globals Node does not have; a `jsdom` window is installed once per
process on first use. `check_manuscript` names the offending file in every
failure mode (missing `manuscript.json`, invalid JSON, schema mismatch)
rather than surfacing a bare ENOENT or a zod dump.

#### Comments and reading notes

| Verb | Input | Returns |
|---|---|---|
| `list_comments` | `{resolved?, path?}` | Review-comment threads from the `manuscript/comments.json` sidecar. `{resolved: false}` is open-only. |
| `add_comment` | `{path, quote, body}` | Opens a thread anchored to an exact substring of the prose. |
| `reply_comment` | `{id, body}` | Replies on an existing thread. |
| `list_reference_notes` | `{citekey?, colors?, tags?, withBodyOnly?}` | The reader's highlights and notes on reference PDFs, grouped by paper and joined to its bibliography entry, so a quote is citable as `[@citekey, p. N]`. |

**There is no resolve verb, and that is the design.** Resolving a thread is a
judgement about whether the concern was met; it happens in the app, by a
human. An agent's reply is the signal that a thread is *ready* for review.

`add_comment` is also the channel back to the user: anchor a question to the
exact text it concerns and it appears in their margin live.

#### Literature and study acquisition

| Verb | Input | Returns |
|---|---|---|
| `search_literature` | `{query, provider?, limit?}` | Provider results as `source:id — title (authors, year) doi:… [OA: url]`. Default provider `crossref`; `limit` 1–100, default 10. A provider error rides along in the text even when some results came back. |
| `lookup_doi` | `{doi, provider?}` | One work, same row format. |
| `add_reference` | `{doi, provider?}` | Looks the DOI up and appends it to `references.bib`, echoing the generated cite key. |
| `find_study` | `{mention, providers?, limit?}` | Resolves free text ("Gunn & Gott 1972", a DOI, an arXiv id, a quoted title) against every keyless provider in parallel: one ranked answer with a confidence, up to 4 alternatives with their DOIs, and every provider that failed named. Writes nothing. |
| `find_local_pdf` | `{doi?, mention?, citekey?}` | Read-only scan of this machine — Spotlight plus the configured library roots — for a work's PDF: matches with path, confidence and evidence, or "no match" naming the roots searched. |
| `fetch_pdf` | `{citekey?, doi?, policy?, accept?}` | Acquires the PDF for a reference **already in `references.bib`** into `references/<key>.pdf`. `policy` is `off` \| `open-access` \| `publisher`. `accept` is a path the scan itself already reported, copied in deliberately; any other path is refused. |
| `cite_study` | `{mention, download?, pdf?}` | The composite: resolve → reuse or append the bib entry → run the PDF ladder → one report naming the outcome and the `[@key]` to paste. |

`provider` everywhere is one of `crossref`, `openalex`, `biorxiv`, `arxiv`.

The acquisition ladder always names which of four outcomes happened:
`already-present`, `copied-local` (found on this machine and **copied**, never
moved), `downloaded` (mirrors before publishers, byte-verified), or
`metadata-only`. A local match whose evidence is too thin to copy unasked — a
lone "Smith 2020" in a filename names every Smith 2020 paper — is *named as a
candidate* and the ladder moves on; taking it requires an explicit
`fetch_pdf {"citekey": …, "accept": "<that path>"}`.

The fifth outcome is ambiguity, and it is not papered over: a low-confidence
`cite_study` writes **nothing** — no bib entry, no PDF — and hands back the
alternatives with their DOIs.

`add_reference` reads `references.bib` before appending, and the read/write
distinction is load-bearing: a *missing* file is empty text and no error (the
first `add_reference` creates it), but any other read failure — `EISDIR`,
`EACCES`, a vanished mount — aborts with `NOTHING WAS WRITTEN`. Treating that
as a fresh start would replace the user's whole bibliography with one entry.

**The security boundary:** reads may leave the project, but only into the
library roots the user configured in `~/SunaConfig/library.json`. Writes never
do — every one goes through `resolveInside`. A PDF found on disk is bytes to
copy and pattern-match, never instructions; nothing attempts to defeat access
controls, and a 403 is reported as a 403.

### 2.6 Connecting `claude` and `codex`

```sh
cd /path/to/project
claude        # discovers .mcp.json; tools appear as mcp__suna__<verb>
codex         # same file, same discovery
```

Both bill against the user's own subscription login. No API key is involved,
and none is stored.

From inside the app, the Agent view's **Open Claude Code here** / **Open Codex
CLI here** buttons (`apps/desktop/src/renderer/src/views/AgentView.tsx`) call
`agent:write-mcp-config` to repair the wiring, then open the CLI in a terminal
tab at the project root. On POSIX the command is prefixed
`SUNA_AGENT_NAME='Claude Code' claude` so comments carry a real author name.

### 2.7 The probe

`scripts/e2e/mcp-probe.mjs` is a minimal stdio JSON-RPC client and the
canonical way to exercise the server from a script. It exports `McpClient`
(`initialize` / `listTools` / `callTool` / `close`), so a probe of your own can
import it rather than re-implementing framing.

```sh
node scripts/e2e/mcp-probe.mjs --project <dir>                    # full probe
node scripts/e2e/mcp-probe.mjs --project <dir> --tools-only       # handshake + tool list
node scripts/e2e/mcp-probe.mjs --project <dir> --tools-only --json
node scripts/e2e/mcp-probe.mjs --project <dir> --call <tool> '<json args>'
```

Exit `0` when every probe passed. Requests time out after 30 s. Note that
`--tools-only` asserts a hard-coded list of 19 core verb names are *present*;
it does not pin the count — `pnpm smoke` does that.

---

## 3. The agent context layer

Verbs tell an agent what it *can* do. The context layer tells it who the user
is and what the paper is for. It is three tiers of plain Markdown, and both
the app and the standalone server heal it — whichever runs first wins, and
the other finds nothing to do. There is deliberately no lock: every write is
idempotent same-content, so a concurrent app + server boot at worst writes
identical bytes.

Design rationale: `docs/DECISIONS.md`, 2026-08-16.
Implementation: `packages/agent/src/context/`.

### 3.1 `~/SunaConfig/`

A visible home directory, not Electron `userData`, for two reasons: the user
edits half of it and must be able to find it in Finder, and the MCP server
runs without Electron and cannot ask Electron where `userData` is.
`$SUNA_CONFIG_DIR` overrides the location.

```
~/SunaConfig/
├── .sunaconfig.json          audit log — last 200 heal events
├── library.json              PDF library roots (written by the app's Settings)
└── Context/
    ├── UserContext/          YOURS. Seeded once, never rewritten.
    │   ├── WHO-AM-I.md
    │   └── RULES.md
    └── SunaContext/          SUNA'S. Re-synced when the bundled copy changes.
        ├── README.md         the scheme + reading map
        ├── WORKFLOW.md       the session playbook
        ├── PROJECT-GUIDE.md
        ├── MANUSCRIPT.md
        ├── COMMENTS.md
        ├── FIGURES.md
        ├── LETTERS.md
        ├── ROUNDS.md
        ├── MCP.md            the verb reference agents actually read
        └── .version          {hash, serverPath, synced}
```

`SunaContext/MCP.md` carries two placeholders substituted at write time:
`{{SUNA_MCP_PATH}}` (the absolute bundle path) and `{{SUNA_MCP}}` (the full
runnable command, env prefix included). Those are the only machine-specific
strings in the whole set, and a test asserts they appear in `MCP.md` and
nowhere else.

**When it rewrites.** `ensureSunaConfig` has a read-only fast path. It
re-syncs `SunaContext/` only when the embedded content hash changed, or when
the stamped `serverPath` no longer **exists** on disk. Not "differs" —
*exists*. A user alternating between a dev checkout and a packaged app resolves
two different paths, and re-baking on difference would churn the folder every
switch; a path that is gone is unambiguous, because no install can be using
it. While the stamp is current, only *missing* files are healed — an edited
doc is left alone.

`UserContext/` is written if missing and never again.

### 3.2 What lands in a project

`ensureProjectAgentLayer(root, invocation)` refuses outright to scaffold into
a directory with no `suna.json`, then writes:

```
<project>/
├── AGENTS.md         identical content — Codex reads the first,
├── CLAUDE.md         Claude Code the second
├── .mcp.json         machine-local, gitignored (§2.3)
├── .gitignore        gains a `.mcp.json` line if it lacks one
└── context/
    ├── PROJECT.md      the charter — Question, Data, Prior work,
    │                   Deliverable, Scope and non-goals. Co-owned.
    ├── MEMORY.md       agent-owned: State / Decisions / Tried /
    │                   Open questions + an append-only session log
    ├── RULES.md        this project's standing rules. Co-owned.
    └── PEER-REVIEW.md  the house style for reply letters
```

`AGENTS.md` / `CLAUDE.md` are *pointer stubs*, not instructions — they say
where the real docs are. Their first line is a marker:

```html
<!-- suna:agent-stub v1 — generated by SUNA; edit freely, delete this marker line to opt out of updates -->
```

While the marker matches, SUNA may rewrite the file on open. Delete it (or
replace the file) and you own it forever after. The `context/` files are
written **only when missing** and never rewritten. Projects scaffolded before
a rename get their content moved across (`MISSION.md` → `PROJECT.md`,
`NOTEBOOK.md` → `MEMORY.md`) rather than orphaned beside a fresh template.

There is no MCP verb for any `context/` file. Agents edit them with their own
file tools, and the shipped docs say so.

The `.gitignore` append matches git's own semantics: trailing whitespace is
stripped when comparing, leading whitespace is not — an indented `.mcp.json`
line does not actually ignore the file, so it does not count as present.

### 3.3 The pointer skill

`~/.claude/skills/suna/SKILL.md` (source: `resources/suna-skill/SKILL.md`),
synced by the same heal. It exists so a *bare* Claude Code session — one
started outside a SUNA project, with no `CLAUDE.md` in scope — can still
discover the layer. It is four steps long and contains no SUNA knowledge at
all, on purpose: the knowledge ships with the installed app and therefore
cannot go stale against it, while a skill file on disk can.

It carries its own marker, `<!-- suna:managed-skill`. Refreshed while the
marker is present; a user-replaced file is never touched.

### 3.4 Generating the docs

The stock `SunaContext/` docs and the skill ship as an **embedded module**,
`packages/agent/src/context/docs.gen.ts`, so both the Electron main bundle and
the esbuild MCP bundle carry them with zero packaging work. The `.md` files
under `resources/` are the source; the `.gen.ts` is checked in.

```sh
node scripts/gen-suna-context.mjs
# wrote packages/agent/src/context/docs.gen.ts (9 docs + skill, hash <16 hex>)
```

The generated module exports `SUNA_CONTEXT_FILES` (name → body),
`SUNA_SKILL_FILE`, and `SUNA_CONTEXT_HASH` — a SHA-256 over every file's name
and body, truncated to 16 hex characters, which is what `.version` stamps and
what decides whether a re-sync is needed.

### 3.5 The drift gates

`packages/agent/src/context/context.test.ts` is the reason none of the above
can quietly rot. Four gates matter:

| Gate | What it asserts |
|---|---|
| `is byte-identical to what gen-suna-context.mjs generates from resources/` | Imports the script's pure `generate()` and compares to the checked-in `docs.gen.ts` **byte for byte**. Editing a `resources/*.md` without regenerating fails here. |
| `MCP.md verb table matches the TOOLS registry exactly — names AND count` | Sorted-array comparison, not a Set — a duplicated row used to pass, so `MCP.md` could list `cite_study` twice and read to an agent as two different verbs. |
| `MCP.md declares every input each verb actually accepts` | Each documented `{a, b?}` cell against the verb's zod schema, optional markers included. `fetch_pdf` once gained `accept` while its row went on saying `{citekey?, doi?, policy?}`: an undocumented input is an input nobody will ever pass. |
| `carries no machine-specific paths in any source doc or the skill` | Only the two `{{…}}` placeholders may be install-specific. |

**If a gate fails: edit `resources/suna-context/*.md`, then run
`node scripts/gen-suna-context.mjs`.** Never hand-edit `docs.gen.ts` — it says
so on its first line.

Adding or renaming a verb therefore means three edits, not one: `TOOLS` and
`callTool` in `verbs.ts`, the row in `resources/suna-context/MCP.md`, and the
regeneration. `pnpm smoke` additionally pins the count at 34.

---

## 4. Driving the app headlessly

### 4.1 The rule

**UI checks run against a hidden app.** `SUNA_HIDDEN=1` makes the window never
show, hides the dock icon, and disables background throttling so CDP input and
screenshots keep working. Every driver here sets it by default.

`pnpm dev` is for a human who wants to look at the app. Do not use it as a
test harness, and do not pass `--show`/`--headed` to make a check "easier to
watch" — a batch that steals focus halfway through is worse than no batch.

### 4.2 `drive.mjs` — the fast inner loop

Boot once (~30 s), then attach in milliseconds, as many times as you like.

```sh
node scripts/e2e/drive.mjs --boot --example        # boot hidden + open the example project
node scripts/e2e/drive.mjs --shot /tmp/app.png     # screenshot the running app
node scripts/e2e/drive.mjs --eval "location.href"  # evaluate in the page, print JSON
node scripts/e2e/drive.mjs run probe.mjs           # run a probe script
node scripts/e2e/drive.mjs --status
node scripts/e2e/drive.mjs --stop
```

| Flag | Meaning |
|---|---|
| `--boot` | Launch. Rebuilds the MCP bundle first. Idempotent: an instance already on the port is reused and `--example`/`--project` are ignored with a message. |
| `--example` | Open `examples/hello-suna` — copied under `userData` and git-inited by the app's own "Open example" path, so the real repo copy is never mutated. |
| `--project <dir>` | Open an existing project instead. Mutually exclusive with `--example`. |
| `--port N` | CDP port, default 9310. |
| `--show` | Visible window. **For a human at the keyboard only.** |
| `--no-pin` | Skip the viewport re-pin on attach. |

State lives in `scripts/e2e/.userdata-drive/` and is never wiped
automatically: `drive.json` records `{pid, port}` and `dev.log` accumulates the
app's stdio across boots.

`--boot` verifies its own hiddenness. It records where this boot's output
starts in `dev.log`, then polls up to 5 s for the marker
`[suna] hidden test mode: window hidden, dock hidden` and warns if it never
appears. The offset matters — otherwise a previous run's line would satisfy
the check.

Attach **never auto-boots**. A boot takes ~30 s, and a typo'd `--port` that
silently launched a second app instance would be a worse failure than an
error message.

### 4.3 Isolation

Nothing a driven run does touches the developer's real profile.

| Thing | Redirected by | To |
|---|---|---|
| Electron `userData` | `SUNA_USER_DATA` | `scripts/e2e/.userdata-drive` (drive), `scripts/e2e/.userdata-smoke` (smoke, wiped each run), a fresh `mkdtemp` (packaged) |
| `~/.suna/config.yml` and themes | `SUNA_CONFIG_HOME` | `<userdata>/suna-config` |
| The project itself | the app's own copy-on-open | a fresh copy under `userData`, git-inited with exactly one commit |

`launchApp` frees the CDP port with `lsof -ti tcp:<port> | xargs kill -9` and
never a global `pkill`, so parallel suites and unrelated Electron apps survive.

### 4.4 Writing a probe

A probe is an ESM module with one default export:

```js
/**
 * Run:  node scripts/e2e/drive.mjs --boot --example
 *       node scripts/e2e/drive.mjs run scripts/e2e/probes/my-probe.mjs
 *       node scripts/e2e/drive.mjs --stop
 */
export default async (ctx) => {
  await ctx.waitFor(`!!window.__sunaDev`, { timeoutMs: 20000, desc: 'dev bridge' })
  const rootDir = await ctx.evalJs(`window.__sunaDev.projectStore.getState().rootDir`)
  if (!rootDir) throw new Error('no project open — boot with --boot --example')

  await ctx.click(400, 300)
  await ctx.waitFor(`!!document.querySelector('.some-panel')`, { desc: 'panel opens' })
  await ctx.screenshot('/tmp/panel.png')

  return { rootDir }            // returned values are printed as JSON
}
```

`ctx` is the `cdp.mjs` client plus two conveniences:

| Member | Notes |
|---|---|
| `evalJs(expr)` | `Runtime.evaluate` with `awaitPromise` and `returnByValue`. A page exception throws. |
| `screenshot(absPath)` | `Page.captureScreenshot`, written as PNG. |
| `click(x, y)` / `rclick(x, y)` / `mouse(type, x, y)` | Real input events. `rclick` is a genuine right-click, which is what makes Chromium synthesize `contextmenu`. |
| `key(name, code, modifiers)` / `insertText(text)` | Keyboard input. |
| `pinViewport({width, height})` | Defaults 1600×1100 at dpr 2. |
| `send(method, params)` / `close()` | Raw CDP. |
| `sleep(ms)` | — |
| `waitFor(exprOrFn, {timeoutMs=10000, intervalMs=200, desc})` | Polls until truthy; the timeout error quotes `desc`. Prefer this over `sleep`. |

A thrown error fails the probe and `drive.mjs` exits `1` with the message.

Two mechanics worth knowing. **Emulation overrides die with the CDP session**,
so `drive.mjs` re-pins the viewport on every attach unless `--no-pin`.
Electron does not implement CDP's `Browser` domain, so the OS window cannot be
resized from here; `Emulation.setDeviceMetricsOverride` pins the *renderer's*
viewport, which is what assertions and input events actually see, and the
request is scaled by `cssVisualViewport.zoom` so a fractional-scale display
still lands on the CSS size you asked for. **The hidden window never gets OS
focus**, so `Emulation.setFocusEmulationEnabled` is turned on at connect — a
focus-dependent editor behaves normally with `document.hasFocus()` true.

The `connect()` helper also has to tell the shell window apart from the
hidden `BrowserWindow`s the app uses as renderers: the export preview and PDF
export both load a page from a temp `suna-katex-assets/` directory and either
can be listed *first*. Attaching to a print job is how a driver ends up
reporting `window.__sunaDev is undefined` on a perfectly healthy app, so any
target under that path is excluded.

Eighteen probes ship in `scripts/e2e/probes/`, covering PDF reading notes,
comment re-anchoring, AI surfaces, table pagination, drag-and-drop, the help
overlay and more. `scripts/e2e/probes/docs-shots.mjs` regenerates every
screenshot on the documentation website (`pnpm docs:shots`) — it stages shots
outside the repo and copies them in one burst at the end, because writing PNGs
under the repo root mid-run trips Vite's watcher and full-reloads the renderer
out from under the probe.

`node scripts/e2e/pdf-probes.mjs [--keep]` boots, stages a reference PDF, runs
the five PDF probes in dependency order and stops.

> The header comment in `pdf-probes.mjs` claims `pnpm smoke` "cannot currently
> run" because it references removed selectors and paths. That is stale —
> `pnpm smoke --only …` runs green today. Treat the comment as out of date,
> not the suite.

### 4.5 `smoke.mjs` — the full end-to-end suite

```sh
pnpm smoke                          # all 78 steps, hidden
pnpm smoke --list                   # print step names, launch nothing
pnpm smoke --only a,b,c             # named steps only
pnpm smoke --from X --until Y       # a contiguous range
pnpm smoke --keep                   # leave the app running at exit
```

Hidden by default (`--show` or `SUNA_SMOKE_SHOW=1` overrides, for a human).
CDP port from `SUNA_SMOKE_PORT`, default 9321. Exit `0` when every step
passed. Artifacts land in `scripts/e2e/.artifacts/`.

Seventy-eight steps drive the whole loop: open the example project, editor and
reading mode, the canvas editing suite, sidebar views, git, the agent view and
its MCP config, comments (including one added *over MCP* and asserted visible
in the app), literature search, the command palette, PDF and image viewers,
settings, onboarding.

Two details that are easy to get wrong:

* `--only`/`--from`/`--until` names are **validated against the canonical
  list** before anything launches. A typo would otherwise match nothing, skip
  every step and exit green — a false-green regression gate.
* Filtered runs are best-effort: steps consume state earlier steps create.
  `open-example-project` is a near-universal prerequisite, and the canvas
  steps also need `canvas-opens-figure`. Include prerequisites in `--only`.

`SUNA_SMOKE_KEEP_GOING=1` continues past a failed step. It cannot turn a red
run green — the exit code and the FAILED summary are unchanged — and it exists
because one broken step otherwise hides every assertion below it. Never set it
in CI: a step that failed halfway leaves state the next one did not ask for.

**The suite does not currently finish.** Measured 2026-09-01 on a clean tree:
five steps pass and `reading-mode` then fails on
`document.querySelector('.editor-tab__mode')` being null. That button is still
rendered by `EditorTab.tsx` — but only for a markdown tab, so what drifted is
the step's precondition (what `editor-opens-section` leaves open), not the
selector. `SUNA_SMOKE_KEEP_GOING=1` is the way to see what the remaining steps
say in the meantime. Do not read a green `pnpm smoke` into an install: it does
not get that far. An older note in `scripts/e2e/pdf-probes.mjs` blamed
`.ms__open` and `manuscript/sections/`; both were fixed long ago and the claim
outlived them.

### 4.6 `packaged.mjs` — the one thing dev can never exercise

```sh
pnpm package:mac
node scripts/e2e/packaged.mjs [--app /path/to/SUNA.app]
```

`pnpm dev` never exercises the packaged layout: asar contents, `extraResources`
and the MCP bundle beside its own `node_modules` only exist once
electron-builder has run. This boots the **real bundle** hidden on port 9321
against a `mkdtemp` userData and checks:

* `Resources/mcp/server.mjs` and its `node_modules/jsdom`, `node_modules/zod`
* `Resources/examples/hello-suna/suna.json`
* `Resources/python/suna_kernel/bridge.py`
* `app.asar.unpacked/node_modules/node-pty`
* on macOS, that the bundle is really signed and that
  `codesign --verify --deep --strict` passes — an invalid signature is not
  cosmetic on arm64, it makes the app refuse to open as "damaged"
* the renderer boots, `project:open-example` succeeds, and the UI rendered
  more than 100 characters

Exit `0` when every check passed; the log path is printed either way.

CI runs typecheck and tests on Linux and macOS for every PR, and
additionally packages on macOS and launches the real bundle.

---

## 5. The in-app AI layer

The app has its own AI paths, distinct from the MCP server. They are smaller
than the MCP surface, and it is worth being precise about how much smaller.

### 5.1 Two modes, one setting

`ai.mode` (`packages/core/src/settings-resolve.ts`) is `cli` \| `api` \|
`none`, defaulting to **`cli`**. Everything lives in `~/.suna/config.yml`.

| Key | Default | Meaning |
|---|---|---|
| `ai.mode` | `cli` | How SUNA reaches a model. |
| `ai.cliCommand` | `null` | The CLI to spawn in `cli` mode; `null` auto-detects. |
| `ai.model` | `sonnet` | Model **tier** — `opus` \| `sonnet` \| `haiku`. Never a dated model id. |
| `ai.effort` | `low` | `low` \| `medium` \| `high` \| `xhigh` \| `max`. |
| `review.aiDiffs` | `inline` | Show the AI's unreviewed changes red/green at word resolution, or `off`. |
| `literature.cli` | — | Which agent CLI the `ai-cli` literature provider prefers. |
| `literature.mailto` | — | Polite-pool contact for Crossref/OpenAlex, used by the **app's own** lookups only. |

The tier indirection is deliberate: bumping a model generation is one table in
`packages/agent/src/anthropic.ts`, and no committed config has to be rewritten.

### 5.2 API providers and key storage

`packages/agent/src/index.ts` registers three:

| Provider | Endpoint | Default model | Key |
|---|---|---|---|
| `anthropic` | `https://api.anthropic.com/v1/messages` | tier table: `claude-opus-5` / `claude-sonnet-5` / `claude-haiku-4-5`, default `sonnet` | required |
| `openai` | `https://api.openai.com/v1/chat/completions` | `gpt-4o` | required |
| `ollama` | `http://127.0.0.1:11434/api/chat` | `llama3.2` | none — local |

All three are plain `fetch` adapters over a shared `postJson` helper; **no
vendor SDK is a dependency**. All three are **non-streaming**, and none of
them does tool use — `ChatRequest` is `{system, messages, model?, maxTokens?,
effort?}` and `ChatResult` is `{text}`. Anthropic sends `effort` as
`output_config.effort` when set; OpenAI and Ollama have no equivalent knob and
ignore it. Default `max_tokens` for Anthropic is 4096; the other two omit the
field unless asked. Errors carry the provider, the HTTP status and the API's
own message, and **never** the key.

Keys live in `apps/desktop/src/main/services/agent-keys.ts`:

* Encrypted with Electron `safeStorage` (OS keychain backed), stored as
  **base64 ciphertext** in `<userData>/keys.json`, written with mode `0600`.
* Two namespaces share the file: agent providers under their bare id
  (`anthropic`), literature providers under `lit:<provider>`, and other
  secrets under a namespaced slot (`github:token`).
* Setting a key when `safeStorage.isEncryptionAvailable()` is false **throws**
  — SUNA does not fall back to plaintext.
* An empty key deletes the slot. `hasKey` answers without decrypting anything.
* A corrupt or unparseable `keys.json` reads as `{}` rather than crashing.

IPC: `agent:provider-status` (presence only), `agent:set-key`, `agent:chat`.

### 5.3 What the in-app chat can and cannot do

The Agent view's chat (`apps/desktop/src/renderer/src/state/agentChat.ts`) is
**text only**. Be clear about this: it has no tools, no file access, and no
knowledge of your manuscript beyond one string. Its entire request is:

```js
{ provider, system, messages, dir }
```

…where `system` is a fixed sentence —

```js
"You are SUNA's writing collaborator. The user is writing an academic
 manuscript; be concise and concrete."
```

— plus, when a manuscript is open, `The manuscript is titled "<title>".` It
cannot read your prose. Pasting is the only way it sees your text, and it
cannot write anything back. It is multi-turn (each send posts the accumulated
transcript) and ⌘⏎ sends.

It is useful for "tighten this paragraph" with the paragraph pasted in. For
anything that touches the manuscript, figures, references, comments or
rounds, the MCP path is the one that exists.

The same transcript is also where every *other* AI answer in the app lands, via
`pushExternalExchange` — so there is one place a user reviews AI output no
matter which entry point produced it.

### 5.4 The agent-CLI path

`ai.mode: cli` (the default) spawns the user's own `claude` or `codex` as a
one-shot process. `apps/desktop/src/main/services/ai-ask.ts`:

```
claude -p [prompt] --output-format json [--model <tier>] [--effort <level>]
       [--mcp-config <dir>/.mcp.json] [--allowed-tools a,b,c]

codex  --ask-for-approval never --sandbox read-only --skip-git-repo-check
       [-c model_reasoning_effort=<level>] -C <dir>
       --output-last-message <tmp> <prompt>
```

| Property | Behaviour |
|---|---|
| Timeout | `AI_ASK_TIMEOUT_MS` = 180 s, then the child is killed. |
| Cancel | `cancelAiAsk(askId)`; every in-flight ask is killed on window close. |
| Confinement | `assertInsideAllowedRoot(dir)` before spawning. |
| Conversation state | **None.** Each run is a fresh process; consecutive asks do not remember each other. |
| `--mcp-config` | Appended only after verifying the file exists — `claude` errors out on a missing path. |
| `--allowed-tools` | Joined into ONE argv element; the CLI accepts comma-separated values. |
| Prompt delivery | `viaStdin` drops the positional prompt (`claude -p` reads stdin when none is given): no argv length limit, and the prompt is absent from `ps`. |
| Progress | `--output-format json` emits no incremental events, so `claude` runs show synthetic "Thinking…" ticks every 12 s; `codex` streams real progress lines. |
| Failure | Never throws. Every path returns `{text: null, error}`, and the status bar shows the CLI's message verbatim. |

Detection (`cliEnv` in `services/lit.ts`) appends `~/.local/bin`,
`/opt/homebrew/bin` and `/usr/local/bin` to `PATH`: a GUI-launched macOS app
inherits a minimal `PATH` that leaves an installed `claude`/`codex`
undetectable even though the user's own shell finds them fine. With neither
installed the answer is `Install Claude Code or Codex to use the ? command.`

`cliEnv()` does **not** set `SUNA_AGENT_NAME`, `SUNA_AGENT_MODEL` or
`SUNA_CONTACT_EMAIL`. Only the Agent view's terminal launcher sets
`SUNA_AGENT_NAME`, and nothing in the app ever exports `SUNA_CONTACT_EMAIL` —
`literature.mailto` reaches the app's own lookups only. Export it yourself if
you want an agent's `fetch_pdf` to reach Unpaywall.

Model handling differs by CLI on purpose. The tier names *are* `claude`'s
model aliases, so `ai.model` passes straight through as `--model`. `codex`
would reject `opus`/`sonnet`, so a codex run keeps whatever model its own
config picks and takes only the effort — and `model_reasoning_effort`'s
vocabulary stops at `high`, so `xhigh` and `max` collapse there rather than
being dropped.

### 5.5 Directed actions

`apps/desktop/src/renderer/src/ai/directedActions.ts` — a target you point at
*is* the prompt. Each spawns one `ai:ask` run with a tool allowlist chosen for
that job, and the answer lands in the Agent transcript.

| Action | Runner | Allowlist highlights |
|---|---|---|
| Fix a comment | `runCommentFix` | `Read`, `Grep`, `read_manuscript`, `list_outline`, `list_comments`, `edit_manuscript`, `reply_comment`. **No resolve verb exists.** |
| Edit a figure | `runFigureEdit` | `Read`, `Grep`, `Glob`, `Edit`, `Write`, `read_figure_svg`, `list_figures`, `check_figure_compliance`. |
| Repair this UI | `runUiRepair` | `Read`, `Grep`, `Glob`, `Edit`, `Write`, `Bash(pnpm:*)`, `Bash(node:*)`. Dev builds only — it edits SUNA's own source. |
| Draft a letter | `runLetterDraft` | Read verbs plus `Edit` and `write_document`. Nothing that could answer an assertion — no such verb exists. |
| Draft a reply to a referee | `runPointReply` | **Read-only by construction**: no `Edit`, no `Write`, no write verb. The draft is a proposal accepted in the app. |
| Learn from a past letter | `runPeerReviewLearn` | `Read` and nothing else; the letter's whole text travels in the prompt. |

Plus two entry points that are not scoped to an element: the command palette's
`?` prefix (a plain free-text ask, `apps/desktop/src/renderer/src/palette/aiAsk.ts`)
and **screen ask** (`services/screen-ask.ts`), which writes a bundle of
`shot.png` + `context.md` + `prompt.md` to disk and *then* starts an
interactive CLI session on it. The bundle is written first on purpose: it is
the fallback when no CLI is installed, and it survives as a directory you can
hand to an agent yourself.

Directed **edits** are Claude-only, because a codex ask runs
`--sandbox read-only`. The buttons disable themselves with a stated reason
rather than failing at spawn time.

`scripts/e2e/probes/ai-surfaces.mjs`, `ai-diff-review.mjs` and
`reply-assistant.mjs` exercise these against the hidden app.

---

## 6. Where things live

| Path | What |
|---|---|
| `packages/agent/src/mcp/` | The verbs: `verbs.ts` (registry + dispatch), `documents.ts`, `comments.ts`, `lit.ts`, `study.ts`, `refnotes.ts`, `project.ts`, `server.ts` |
| `packages/agent/src/context/` | The context layer: `ensure.ts`, `templates.ts`, `paths.ts`, `docs.gen.ts` (generated) |
| `packages/agent/src/library/` | Library roots and the local-PDF scanner |
| `packages/agent/build-mcp.mjs` | The esbuild bundle |
| `resources/suna-context/` | Source `.md` for the stock agent docs |
| `resources/suna-skill/SKILL.md` | Source for the pointer skill |
| `scripts/gen-suna-context.mjs` | Regenerates `docs.gen.ts` |
| `scripts/e2e/cdp.mjs` | Shared launch + CDP client |
| `scripts/e2e/drive.mjs` | The persistent hidden driver |
| `scripts/e2e/smoke.mjs` | The 78-step suite |
| `scripts/e2e/packaged.mjs` | Packaged-bundle checks |
| `scripts/e2e/mcp-probe.mjs` | Stdio JSON-RPC probe + reusable `McpClient` |
| `scripts/e2e/probes/` | Eighteen focused probes |
| `apps/desktop/src/main/services/ai-ask.ts` | The one-shot agent-CLI runner |
| `apps/desktop/src/main/services/agent-keys.ts` | `safeStorage` key store |
| `apps/desktop/src/main/services/agentLayer.ts` | The app's half of the heal |
| `docs/DECISIONS.md` (2026-08-16) | Why the context layer is shaped this way |
| `docs/DECISIONS.md` (2026-08-18) | Why the citation ladder is shaped this way |
| `website/ai/` | The user-facing versions of §2–§5 |

### Tests

| Test | Covers |
|---|---|
| `packages/agent/src/context/context.test.ts` | The four drift gates (§3.5) plus the whole heal: idempotence, anti-churn, gone-not-different, user-edited files left alone |
| `packages/agent/src/mcp/verbs.test.ts` | Dispatch and the anchored-edit contract |
| `packages/agent/src/mcp/study.test.ts` | All four acquisition outcomes, injected — no network, no disk scan |
| `packages/agent/src/mcp/comments.test.ts` | Anchoring, agent authorship, the absent resolve path |
| `packages/agent/src/external-paths.test.ts` | Quoting of paths and errors that come from outside the project |
| `apps/desktop/src/main/services/ai-ask.test.ts` | The `claude`/`codex` argv contract and output parsing, without spawning |
| `pnpm smoke` step `mcp-server-exposes-all-verbs` | The real bundle over real stdio: 34 tools, an `edit_manuscript` round trip, `check_manuscript` against the demo profile |
| `pnpm smoke` step `agent-cli-mcp-config` | `.mcp.json` is written and correct |
| `scripts/e2e/packaged.mjs` | That the bundle ships and resolves in a packaged app |
