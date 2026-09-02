# SUNA — Architecture Contract

> An Electron academic-writing platform: a workspace for human–AI co-writing of research
> papers, with live Markdown rendering, an SVG figure canvas, publisher-aware compliance
> checking, reference management, peer-review bookkeeping and git built in.
> macOS · Linux.

This file is the **contract**. It states what the system *is*, not what it will be. Changing
something this file names requires editing this file in the same commit. **Section numbers are
cited from code comments and tests — do not renumber.**

This file states the *rules*. `docs/DECISIONS.md` holds the dated reasoning that produced them,
`docs/CONFIGURATION.md` and `docs/GITHUB-OAUTH.md` hold two references this file deliberately does
not carry, and `docs/RELEASING.md` / `docs/PACKAGING.md` hold the release mechanics; where any of
them disagrees with this file, this file and the code win. `docs/` is flat: there are no design
notes any more, and everything a deleted one carried that was still true was folded into this file
or into `DECISIONS.md` before it went.

Two words are used precisely throughout:

* **Guarantee** — enforced by code, and there is a test that fails if it stops being true.
* **Current behaviour** — true today, verified by reading the source, but nothing pins it.

Anything neither of those is marked *aspirational* or *not implemented*, and §20 collects every
place where the code and the older design documents disagree. A contract that overstates is
worse than none.

---

## 1. Stack decisions (settled)

| Concern | Decision | Why |
|---|---|---|
| Shell | **Electron** via electron-vite, TypeScript 7 strict, pnpm 10 workspace | One Chromium gives the SVG canvas real hit-testing, text layout and print fidelity for free (DECISIONS 2026-08-13), and gives the exporter a page renderer (§13). |
| UI | **React 19** + **dockview-core v8** + **zustand** | dockview ships no React binding; the adapter is ours (§17.1). No React context anywhere in the renderer — stores only. |
| Editor | **CodeMirror 6** | Live preview is CodeMirror *decorations over the source*, not a second rendered pane (§17.3). |
| Markdown | **unified/remark** (`remark-parse` + `remark-gfm` + `remark-math`), parse only | SciMark's extensions are post-order AST rewrites, not micromark extensions (§7). |
| Math | **KaTeX** in every renderer — editor, HTML export, PDF export | One math renderer, so preview and print cannot diverge. |
| Canvas | **The SVG DOM itself.** `DOMParser` in, `XMLSerializer` out | Journals consume the SVG, matplotlib produces it, git diffs it. Every alternative editor keeps a proprietary scene graph with SVG as an exchange format; that inverts the requirement (DECISIONS 2026-08-13, §10). |
| PDF / DOCX | **Chromium `printToPDF`** and the **`docx`** npm package, both in the main process | No LaTeX, no Tectonic, no external binary (§13). |
| Bibliography | `@retorquere/bibtex-parser` + **hand-written** citation and reference rendering | No CSL, no citeproc anywhere in the repo (§9). |
| Validation | **zod 4**, in `@suna/core`, on both edges of every IPC channel | §5.2. |
| Config | **One user-owned file**, `~/.suna/config.yml`, plus `~/.suna/themes/*.yml` | §6. |
| Git | **system `git`**, driven from the main process | No libgit2, no isomorphic-git. |
| Python | the **user's own interpreter**; a Jupyter kernel bridge ships with the app | §16. |
| Agent | a **stdio MCP server** over the project's files, plus **agent CLIs** the app spawns | §15. |
| Tests | `vitest` per package (249 test files) + a CDP-driven **hidden-window** smoke suite | §18. |

**Non-goals.** A journal page facsimile (DECISIONS 2026-08-13: profiles encode *author guidelines*, never a
publisher's typeset design). A binary or proprietary document format. A native chart-authoring
engine on the canvas — figures come from matplotlib or are imported, and the canvas adjusts,
annotates and checks them. Multiplayer/CRDT collaboration. A sandbox for user code (§16.2).

---

## 2. Repository layout

```
SUNA/
├── apps/desktop/            @suna/desktop — Electron main / preload / renderer
│   └── src/{main,preload,renderer}
├── packages/
│   ├── core/               @suna/core       schemas, IPC contract, settings, themes  (pure)
│   ├── markdown/           @suna/markdown   SciMark parse + HTML render               (pure)
│   ├── formatter/          @suna/formatter  profile loader + compliance checkers      (pure)
│   ├── canvas/             @suna/canvas     SVG-DOM document, command bus, interaction
│   ├── bib/                @suna/bib        BibTeX, citations, providers, PDF ladder  (pure)
│   ├── agent/              @suna/agent      MCP server, providers, context layer, library
│   ├── notebook/           @suna/notebook   nbformat v4 reader/writer                 (pure)
│   └── provenance/         @suna/provenance EMPTY — one file, `export {}`  (§11.3)
├── python/
│   ├── suna_mpl/           matplotlib companion (staged into the bundle — §16.1)
│   └── suna_kernel/        bridge.py — the notebook kernel bridge (shipped — §16.2)
├── resources/
│   ├── profiles/*.json     the ten bundled publisher profiles (§12)
│   │   └── sources/        the guideline research they were read off — NOT shipped
│   ├── suna-context/       the agent context docs written into ~/SunaConfig (§15.4)
│   └── suna-skill/         SKILL.md installed into ~/.claude/skills/suna/
├── examples/hello-suna/    the starter project, shipped inside the app bundle
├── scripts/{e2e,packaging} smoke suite, drive.mjs, stage-resources.mjs
├── website/                the VitePress documentation site
└── docs/                   flat: this file, DECISIONS, ROADMAP, AUTOMATION, TESTING,
                            RELEASING, PACKAGING, CONFIGURATION, GITHUB-OAUTH
```

**Package graph, no cycles.** `core` depends on nothing but zod and yaml. `markdown`, `bib`,
`canvas`, `notebook` depend on `core` at most. `formatter` depends on `core` + `markdown` +
`canvas`. `agent` depends on `core` + `bib` + `formatter` + `markdown`. `apps/desktop` depends
on all of them except `provenance`, which nothing imports.

Rules:

1. **`@suna/core` may never import a node builtin.** The renderer imports it. `documents.ts`
   hand-rolls a path join for exactly this reason. Guarantee (a `node:` import fails the
   renderer build).
2. **`@suna/bib` and `@suna/agent` must run outside Electron.** The MCP server (§15.2) is a
   standalone node process; anything it reaches must not assume `app`, `safeStorage` or a
   `userData` directory.
3. Everything under `packages/` is pure TypeScript with no DOM assumption except `@suna/canvas`,
   which reaches ambient `DOMParser`/`XMLSerializer` through exactly one adapter (§10.1).

---

## 3. Format doctrine

**JSON, Markdown, BibTeX, SVG are the only sources of truth. PDF and DOCX are produced at export
time and read back never.**

1. Every file SUNA writes into a project is plain text a human can open in another editor and git
   can diff line by line.
2. There is **no SUNA file format**. Removing SUNA from a project leaves a working directory of
   Markdown, JSON, BibTeX and SVG.
3. **Nothing derived is stored.** Figure, table, equation, reference and affiliation numbers are
   computed at format time from document order and the active profile (§8). Section structure is
   derived from Markdown headings. Reference lists are derived from the keys actually cited.
   Diff hunks are derived from a stored pre-image, never stored as markers in the prose.
4. `output/` is derived and is git-ignored. Nothing reads from it.
5. Machine-local files are named and git-ignored on project creation: `.suna/`, `.mcp.json`,
   `*.private.json`, `.venv/`. The `.gitignore` is written **before any scaffold**, because the
   window between writing a confidential sidecar and ignoring it is small and the consequence is
   permanent.

Rule 3 is the one with teeth, and §20 records the one place it is currently duplicated rather
than shared.

### 3.1 The doctrine

Thirteen rules recur across every subsystem. They are collected here because each was arrived at
independently more than once, and because most of them exist because something specific went
wrong. Later sections cite these by number as **D1**…**D13**.

**D1 — Numbering is derived at format time, never stored.** §8. Field evidence: a real response
letter's hand-maintained counter reached RE83 with RE58 simply missing and nobody noticed; between
a Word draft and the submitted grant, "Figure 3" became "Figure 2" and a cross-reference to
"Figure 2" came to point at Figure 5.

**D2 — Refuse rather than guess; report ambiguity as ambiguity.** A low-confidence study match
writes nothing (§15.5); an unmeasurable page count renders as `—` with a reason, never a number;
an unverifiable fact says *not verified*, never *passes*. The rationale is that **a wrong answer
is invisible** — a mis-attributed citation looks exactly as correct as a right one, propagates
through the reference list, and is corrected by a published erratum. The cost of not guessing is
one question to the user.

**D3 — Flag, never rewrite. Advisory, never blocking.** DECISIONS 2026-08-13. The one deliberate exception is
an unanswered cover-letter assertion, which blocks export, because it is an affidavit (§14.3).

**D4 — No invented threshold.** Where a journal states no number, SUNA states no number. Nature's
"avoid repeating the abstract" has no stated threshold, so it surfaces as a *measurement* and not
as a diagnostic — `DiagnosticSeverity` is `error | warning` and there is no severity meaning
"here is a number, you decide". Estimating page counts from word counts was rejected for the same
reason.

**D5 — Nothing is written until confirmed, and nothing is written on open.** The project wizard
writes only on the final step; DOCX import writes only after a review screen; opening a project
that needs no migration writes nothing.

**D6 — Read fresh, validate, write atomically.** Every write to a source of truth re-reads the
file from disk, applies its change to that fresh object, validates, and writes temp+rename —
because an agent may have edited it since. Never write a stale in-memory copy.

**D7 — Detached, never deleted.** A comment whose quote vanished, a reading note that no longer
locates, a reviewer point with no anchor, an overlay op whose target is gone: each is *marked* and
kept. No subsystem may decide to drop user data because it stopped resolving.

**D8 — Sidecar, never inline markers.** Comments, AI-diff baselines, reading notes and captions
live beside the prose. The manuscript file never contains a marker: exports, compliance checks,
word counts and git see clean prose at every instant.

**D9 — Copy, never move.** Anything the user owns and SUNA did not create — a PDF in their
library, a figure they attach — is copied. Their original stays where it was.

**D10 — One implementation, two hosts.** `anchor.ts`, `wordDiff`, `pdftext`, the auto-copy gate,
the paged renderer. Every time this rule was violated the two sides silently disagreed: the
References view asked `confidence !== 'low'` while the MCP verb asked `isAutoCopyable`, so the same
feature answered the same question two ways depending on which button the user pressed. §8 records
the one place the rule is currently broken on purpose.

**D11 — The file is the truth; never a parallel model.** The SVG DOM is the figure (§10); the
`.ipynb` is the notebook (§16.3); the Markdown is the manuscript. This is why a CRDT was rejected
for collaboration (§22) and why an overlay-based scene graph was rejected for the canvas.

**D12 — Escape everything that came from outside before it reaches an agent's context.** File
names, URLs and errno strings are quoted through `quoteExternalPath` / `describeExternalError`.
This rule is enforced by a **source-reading test**, not by review, and the reason is measured: five
review passes over one finished, green feature each found unescaped sites — 6, then 5, then 2,
then 6, then 4. Twenty-three sites in five passes is not a converging sequence. The gate's three
known blind spots are written down rather than implied away, because a gate that claims total
coverage invites exactly the false confidence it is there to remove.

**D13 — Measure in the running app; distrust static reasoning.** A static read of Electron's
default menu predicted it carried a Help role that would swallow `⌘⇧/`; a runtime check showed
Electron 43's default menu has no Help submenu at all. A draft ADR asserted that a paper
highlighted in Preview "opens blank"; it does not. A prior design was built around the belief that
pdf.js cannot delete an existing annotation; it can — the staging key simply needs the
`pdfjs_internal_editor_` prefix. **Trust the measurement, and re-run it before moving the thing it
settled.**

---

## 4. The project on disk

A SUNA project is any directory containing `suna.json`. The app opens one at a time.

```
my-paper/
  suna.json                    manifest — watched for external edits
  .gitignore  .mcp.json  AGENTS.md  CLAUDE.md
  context/                     PROJECT.md  MEMORY.md  RULES.md  PEER-REVIEW.md
  manuscript/                  every editable document lives here
    manuscript.md              ALL prose; Markdown headings ARE the sections
    manuscript.json            journal-agnostic metadata
    authors.json               authors + affiliations
    references.bib             the bibliography
    comments.json              review threads (sidecar, project-wide)
    revisions.json             AI-diff baselines (sidecar, project-wide)
    supplementary.md           + supplementary.doc.json
    letters/<id>.md  <id>.json  <id>.private.json     (the .private one is git-ignored)
    archive/index.json  archive/v<stage>.<minor>/<area>/…    read-only version log
  figures/<id>/
    figure.svg                 the source of truth; always valid SVG on disk
    figure.json                caption, panels, width preset, provenance block
    figure.svg.suna.json       suna_mpl's axes sidecar, when the figure came from code
    source/plot.py             the generating script, when there is one
  references/notes/<citekey>.json     reading notes and PDF highlights
  rounds/index.json
  rounds/<id>/round.json  reviewers/<n>.json  frozen/…  editor-letter.txt
  code/  data/  analysis/  results/  output/
  .suna/trash/  .suna/screen-asks/    machine-local, git-ignored
```

### 4.1 `suna.json`

`SunaProjectManifestSchema` (`packages/core/src/project.ts`). `schemaVersion` is
`z.literal(1)` and **stays 1**: every block added since has been additive-optional, and the
doctrine is stated in the source — a project written by an older build must open unchanged.

| Field | Meaning |
|---|---|
| `name`, `createdAt` | display name; ISO timestamp |
| `activeProfileId` | the journal profile the project is currently written against (§12) |
| `directories` | `Record<ProjectDirKey, string>` over exactly `manuscript figures code data analysis results output` |
| `documents?` | the document registry (DECISIONS 2026-08-19). Absent ⇒ `resolveDocuments()` synthesizes a one-manuscript registry, which is what makes the registry a **zero-file migration** |
| `approvals?` | recorded human approvals gating one AI capability (reviewer-reply drafting) |
| `settings?` | **deprecated and no longer read.** Kept in the schema only so manifests written while it existed still validate |

**`rounds/` and `references/` are deliberately not directory keys.** Widening the exhaustive
`ProjectDirKey` record would invalidate every manifest on disk; both are fixed names resolved in
`apps/desktop/src/main/services/paths.ts`.

**All project path resolution goes through `paths.ts`.** No service builds a project path by
string concatenation.

### 4.2 The document registry

`DOCUMENT_KIND_IDS = manuscript | supplement | cover-letter | response | report | package |
component`. A `DocumentEntry` is `{id, kind, file, meta, title, profile, roundId, archived}`;
`file` and `meta` are **manuscript-dir-relative** and may nest (`letters/cover.md`).

* `file` is `null` on `manuscript` — its filename lives in `manuscript.json:manuscriptFile`, so
  the registry cannot drift from it. Guarantee.
* `DOCUMENT_KIND_FILES` is the single source of truth for kind → filename.
* A `superRefine` enforces the registry split: `manuscript/supplement/cover-letter/response/
  report` resolve their profile through the **journal** registry (falling back to
  `activeProfileId`); `package`/`component` take a **sponsor** profile and must never fall back
  to a journal id.
* **`package` and `component` are schema-only.** No sponsor profile data ships, no
  `PackageDocument` type exists, nothing emits the `package` diagnostic surface. DECISIONS 2026-08-19 is
  unimplemented (§20).

### 4.3 `manuscript/` — one prose file

`manuscript/` is flat. The old `body` array of `sections/NN-name.md` pointers is gone; a project
carrying it is migrated on open, and the migration deletes `sections/` **only after** the new
files are written and validated, leaving the project untouched if anything fails.

`ManuscriptSchema` carries title, article type, DOI, abstract, `manuscriptFile`, the ordered
`figures[]` and `tables[]` manifests, availability statements and back matter. Its header states
the rule this file exists to enforce: *numbering is never stored.*

`comments.json` and `revisions.json` are **project-wide sidecars, not owned by a document kind**.

### 4.4 `figures/<id>/`

`figure.json` is `{id, caption, namespace, widthPreset, panels, provenance|null}`. `namespace` is
`main | extended-data | box`; a panel letter matches `/^[a-z]$/`. `provenance: null` means the
figure was drawn from scratch.

`figure.svg` is the document. It is written by the canvas as baked bytes; the app never rewrites
it on open, never runs svgo over it, and never normalizes it (§10).

### 4.5 `rounds/` — the ledger

**`manuscript/` is prose you edit; `rounds/` is the ledger.** Nothing under `rounds/` is a file a
human opens and types into.

The sharpest consequence is the reviewer point. A reviewer's words live in
`rounds/<id>/reviewers/*.json` and nowhere else, which makes immutability **structural** rather
than a rule someone has to remember: editing a reviewer's words requires deliberate JSON surgery
instead of a keystroke. `ReviewPointRecord.verbatim` is a contiguous slice of the retained
`sourceText`, and `reportIsFaithful()` asserts `verbatim === sourceText.slice(from, to)` before
an import commits. The only editing operations are **split** and **merge**, which re-derive from
the retained source and cannot introduce a character the reviewer did not write. Guarantee.

The author's half lives beside the point, never inside it: `PointState {pointId, status,
assignee, reply, links}` with `status ∈ unaddressed | drafted | done | rebutted`. **`rebutted` is
a first-class outcome, not a failure state** — every real response letter contains several, and a
tool that models only compliance quietly pressures authors into conceding points they should
defend.

A **freeze** is both an annotated git tag and a text snapshot, with per-file sha256. The snapshot
exists because a returned `.docx` has to be anchored against exactly what the co-author saw, and
`git show` cannot answer that when the tree was dirty at freeze time — which it routinely is;
`Freeze.dirty` records that it was.

### 4.6 Versions

A round is a ledger entry about a circulation; a **version is a copy**. Logging freezes the
manuscript *and the work behind it* into `manuscript/archive/v<stage>.<minor>/<area>/` and leaves
it there read-only. `VERSION_AREAS = manuscript, code, analysis, figures`; `data/`, `results/` and
`output/` are deliberately excluded. `0.x` internal, `1.x` the first submission, `2.x` after the
first round of corrections. The working copy under `manuscript/` is always the *next* number.

---

## 5. Process model, IPC, and confinement

### 5.1 Processes and windows

```
┌───────────────────────── Electron main ─────────────────────────┐
│  owns: the filesystem, git, child processes, network for AI and │
│  literature, the OS keychain, all watchers, all export writers  │
│  BrowserWindow: sandbox:false · contextIsolation:true           │
│                 nodeIntegration:false                           │
│  dev  → loadURL(ELECTRON_RENDERER_URL)                          │
│  prod → loadFile(../renderer/index.html)                        │
│  + one HIDDEN BrowserWindow, kept alive between renders, that   │
│    is the export printer (export-preview.ts)                    │
│  + the privileged scheme notebook outputs render inside         │
│    (output-frame.ts, registered BEFORE app-ready)               │
└─────────────────────────┬───────────────────────────────────────┘
                          │ contextBridge → window.suna
┌─────────────────────────▼───────────────────────────────────────┐
│  Renderer — React chrome, CodeMirror, @suna/canvas, zustand     │
│  holds: text buffers, the canvas SVG document, UI state         │
│  holds: no fs access, no node builtins, no secrets              │
└─────────────────────────────────────────────────────────────────┘
       spawned by main, never by the renderer:
       git · claude/codex CLI · python (kernel, env probe, uv) · node-pty
```

Rules:

1. **The renderer has no filesystem.** Every read and write is a channel main answers. The
   renderer never sees an API key: `agent-keys.ts` seals them with Electron `safeStorage` into
   `userData/keys.json` at mode `0o600`, and only main decrypts.
2. **External links never open in the shell.** `setWindowOpenHandler` denies every window open
   and hands the URL to `shell.openExternal`.
3. **The export preview window dies with the window it serves.** Electron counts it in
   `getAllWindows()`, so a survivor would keep `window-all-closed` from firing.
4. **Test seams are environment variables and are dev-only in spirit:** `SUNA_HIDDEN=1` (never
   show the window, hide the dock icon, and disable `backgroundThrottling` so the hidden
   renderer keeps painting for CDP), `SUNA_USER_DATA` (isolated `userData`), `SUNA_DEBUG_PORT`
   (opt-in CDP), `SUNA_CONFIG_HOME` (relocate `~/.suna`). **UI checks run against a hidden app;
   nothing in the test path may require a visible window.**
5. On quit and on `window-all-closed`, main tears down every child it owns: terminals, kernels,
   in-flight AI CLI runs, literature searches, the preview window, the config watcher.
6. **Config is read before the first window is created**, so the first paint is already in the
   user's theme (§6.1).

**CSP** is one `<meta http-equiv>` in `src/renderer/index.html`; there is no `session.webRequest`
header injection anywhere:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://avatars.githubusercontent.com;
font-src 'self' data:; frame-src suna-output:
```

**Exactly one custom scheme, `suna-output:`**, registered at module top level *before*
`app.whenReady()` because Electron ignores a privileged scheme registered later. It exists because
`script-src 'self'` is inherited by `srcdoc` and `blob:` iframes but *not* by a document fetched
over a real scheme — so notebook output HTML renders inside it, with no preload and no
`window.suna`, receiving HTML by `postMessage` and returning only a height. It serves one
in-memory string and 404s everything else; nothing is cached or written to disk. **`frame-src
suna-output:` in the CSP and `OUTPUT_FRAME_SCHEME` must stay in sync.**

**Not present:** `requestSingleInstanceLock`, a custom application menu, `globalShortcut`,
window-bounds persistence, and any `autoUpdater`. Updates exist only as an
`electron-builder.yml` publish target.

### 5.2 The IPC contract

`packages/core/src/ipc.ts` is the contract, and it is the only place channel names exist.

* **`CHANNELS`** — 153 request/response channels, each `{request: ZodType, response: ZodType}`.
  `ChannelName`, `RequestOf<C>`, `ResponseOf<C>` are derived from it.
* **`EVENT_CHANNELS`** — main → renderer pushes. Global: `config:changed`,
  `project:manifest-changed`, `project:tree-changed`, `git:changed`, `env:changed`.
  Id-parameterized: `term:data:<id>`, `term:exit:<id>`, `kernel:event:<id>`,
  `lit:progress|done:<id>`, `ai:progress|done:<id>`.

Both edges are validated. `apps/desktop/src/main/ipc.ts`'s `handle<C>()` wrapper parses the
request *and* the response; a handler that returns the wrong shape rejects the invoke rather
than shipping it. The preload exposes one generic entry point:

```ts
invoke: <C extends ChannelName>(channel: C, request: RequestOf<C>): Promise<ResponseOf<C>>
```

plus one hand-written subscription helper per event family. There is no renderer-side wrapper
module — stores call `window.suna.invoke` directly, and the types make that safe.

**The push channels are validated by hand, not by zod, and that is deliberate.** zod compiles its
parsers with `new Function`; the preload context disallows code generation from strings, so
`safeParse` throws `EvalError` rather than returning a result — and because a throwing
`ipcRenderer` listener is swallowed, it would fail **silently**, on the very first push, with
nothing anywhere saying why. Every subscription in `preload/index.ts` therefore shape-checks its
payload by hand, checking only the shape the renderer relies on; the values were already
validated in main, which is where the schema can actually run. The consequence is stated once:
**a malformed push event is dropped silently.**

Channel groups, for orientation: `project:*` `documents:*` `fs:*` `trash:*` `shell:*` `dialog:*`
| `git:*` (33) `github:*` | `letter:*` `round:*` `review:*` `version:*` `compare:*` `revisions:*`
`comments:*` | `figure:*` `export:*` `*:preview` | `agent:*` `ai:*` `lit:*` `library:*` |
`term:*` `kernel:*` `env:*` | `config:*` `settings:*` `manuscript:update` `refnotes:*` `docx:*`
`app:*`.

### 5.3 Filesystem confinement

`apps/desktop/src/main/services/roots.ts` holds a `Set<string>` of resolved absolute directories,
filled by `allowRoot(dir)` when the user opens or creates a project.
`assertInsideAllowedRoot(path)` resolves the candidate and admits it only when it equals a root
or begins with `root + sep`. `rootForPath` answers *which* root, longest match wins, so a project
nested inside another gets its own answer (the `.suna/` trash needs this).

Two asymmetries are load-bearing and are policy, not accident:

* **Reads may leave the project; writes never do.** The literature/library scan (§15.5) searches
  the machine — inside the user's own configured roots only — while every write it can perform
  lands in `references/` inside the project.
* **Destructive operations refuse rather than clobber.** `fs.rename` silently overwrites on
  POSIX, so rename and move stat the destination first and refuse an existing sibling. The one
  carve-out is a case-only rename (`notes.md` → `Notes.md`), which stats the source itself on a
  case-insensitive volume and would otherwise block the rename users make most often.
* **Nothing is ever hard-unlinked.** Deletes go to `.suna/trash/` (≤ 2 MB) or the OS trash, and
  expire by the `expiresAt` stamped at delete time rather than a re-derived age.
* **DOCX import may never overwrite an existing SUNA project.** That check is unconditional;
  `force` only ever relaxes "the folder has other stuff in it".
* **`shell:open-path` refuses to launch anything executable** — `.app .command .pkg .dmg .scpt
  .workflow .term`, and any file carrying the user-execute bit. The reason is concrete rather than
  theoretical: an agent can write files into the project, and *"open with the OS" must never
  become "run whatever the agent just wrote."* Directories are allowed, and are tested *after* the
  extension check. A test run must never call `shell:reveal` or `shell:open-path` for real — that
  would open Finder windows on a developer's screen, which is what the hidden-driver work exists
  to prevent; probes stop at the IPC boundary.
* **Containment is a `root + sep` comparison, never a bare `startsWith`.** A bare prefix test calls
  `/a/data2` a descendant of `/a/data`. `roots.ts` and `fs.ts` both use the separator boundary; a
  new call site must too.
* **No `EXDEV` copy-and-unlink fallback for moves.** A project lives in one tree; a cross-device
  rename failure is reported verbatim rather than silently doing something else.
* Ceilings: `MAX_READ_BINARY_BYTES = 200 MB` (checked by `stat` before the read, because a PDF
  crosses IPC as base64 at ≈4/3 its size), tree walks at depth 10,
  `IGNORED_NAMES = .git .suna node_modules .DS_Store __pycache__`.
* Every child process is `execFile`/`spawn` with an **argv array — no shell anywhere**; a git
  remote URL beginning `-` or containing whitespace is additionally refused.

**Where confinement is not enforced, stated plainly.** Confinement is per-*service*, not per-
channel: `main/ipc.ts` contains zero calls to `assertInsideAllowedRoot` and passes the
renderer-supplied `dir` straight through. Thirty-four service files do call it. Eleven do not —
`round-new`, `version-log`, `letter-new`, `supplement-new`, `compare`, `letter-check`,
`migrate-manuscript`, `paths`, `print-html`, `starter-scaffold`, `envs` — serving the `round:*`,
`version:*`, `letter:*`, `supplement:new`, `compare:*`, `project:migrate` and `env:*` channels.
They join *fixed* subpath names onto `dir`, so none is an arbitrary-path primitive, but none
checks the root either.

Sharper, and worth fixing: **entity ids are validated by the entity schema and not at the channel
edge.** `rounds.ts` requires `/^[a-z0-9][a-z0-9-]*$/` and `documents.ts` requires
`/^[a-z][a-z0-9-]*$/`, but the IPC contract declares `roundId: z.string().min(1)` and joins it
into a path. `versionId` is the counter-example done right: the channel constrains it with
`VERSION_ID_RE`. **The rule this file sets: an id that will be joined into a path is constrained
at the channel edge.**

The allow-list is widened at exactly eight call sites: project create/open/scaffold, the example
copy under `userData` and its archive, the imported-project directory, and two dev-only capture
paths whose root is derived by main and never taken from the renderer.

### 5.4 Child processes

| Child | Located how | Missing ⇒ |
|---|---|---|
| `git` | system PATH | the git view reports it, the app runs |
| `claude` / `codex` | `resolveCli()` in `lit.ts`, with an explicit PATH repair | AI actions report "no CLI"; nothing else changes |
| python (kernel, env probe) | the env picker's selected interpreter, else `python3` / `python` | a `fatal` event naming the remedy |
| `uv` | PATH probe; used only to create a `.venv` | the onboarding step offers Skip |
| `node-pty` | in-process native module (allow-listed for postinstall) | the terminal panel is unavailable |

**PATH repair is a real requirement, not defensive coding.** A GUI-launched macOS app inherits a
minimal PATH with no `~/.local/bin` and no `/opt/homebrew/bin`, which leaves an installed
`claude` or `codex` undetectable even though a Terminal-launched shell finds them fine —
measured during this build: `claude` at `~/.local/bin/claude`, `codex` at
`/opt/homebrew/bin/codex`, neither on Electron's default inherited PATH.

**Git credentials have an ordering trap that is fixed once, in one place.** Credential helpers
are consulted *before* `GIT_ASKPASS`, so on any machine that has ever authenticated github.com
over HTTPS — which is most of them, `osxkeychain` being on by default — the helper answers and a
freshly obtained token is never used. An **empty** `credential.helper` *resets* the helper list
rather than adding to it, so the invocation consults ours and nothing else; it is passed through
`GIT_CONFIG_*` (git 2.31+) to keep it out of the argument list, and the terminal prompt path is
forced off so the only answer git can get is ours.

### 5.5 Watchers, and who owns the truth

Main watches three things and pushes a single message for each: `suna.json`
(`project:manifest-changed`), the project tree excluding `.git` (`project:tree-changed`),
`.git` itself (`git:changed`), plus `~/.suna` (`config:changed`). Two rules govern all of them:

1. **Watch the directory, never the file.** An editor that saves by writing a temp file and
   renaming over the original — which is what SUNA's own atomic write does, and vim's, and VS
   Code's — breaks a watch bound to an inode.
2. **The push says only "something changed", never which path.** The renderer's response is
   always the same (re-read), and a recursive watch on macOS coalesces events in ways that make a
   precise path unreliable.
3. Watchers are `persistent: true` deliberately: an unref'd fs watcher does not reliably fire in
   Electron's main process, whose loop is driven by Chromium's message pump rather than by libuv
   alone. Both handles close on `will-quit`.

**Disk is the baseline; the buffer is authoritative in flight; reconciliation is a three-way
merge, never a clobber.** On every `project:tree-changed`, each open session re-reads its file
and resolves:

| Situation | Resolution |
|---|---|
| disk equals the last-read text | no-op (this also swallows the echo of our own save) |
| buffer clean | **disk wins silently**, applied as a multi-span `ChangeSet` so selection, scroll anchor and comment marks map through |
| buffer dirty, changes disjoint | `merge3(base = last-read, ours = buffer, theirs = disk)` — an agent's edits land silently |
| buffer dirty, changes overlap | **ours stays**, the session is marked *diverged*, a banner says "Yours is showing", and **autosave is hard-blocked** while diverged |

Four properties of that table are load-bearing:

* **The disk-wins case must be a multi-span change set, not one span.** A single-span minimal diff
  covering an agent's edits in §2 and §7 deletes and reinserts everything between: every comment
  anchor inside collapses, the cursor jumps, and undo bloats. This was the live behaviour for any
  multi-place agent edit before it was fixed, and the probe that guards it was verified
  adversarially — reverted to the single-span diff, the comment highlight on an untouched middle
  paragraph vanishes.
* **Changes apply at word grain; conflicts are decided at paragraph grain.** Word-grain conflict
  detection was caught inventing prose: a human rewriting `outside-in` to `inside-out` and an
  agent rewriting it to `from the outside in` share no word token, so a word-grain merge accepted
  both and produced **`from the inside out`** — text neither party wrote, which nobody catches by
  reviewing their own diff. Paragraphs are the right unit because Markdown already defines them
  and they are unambiguous to compute; sentences fracture on `6563.3`, `[@key]` and inline math.
* **Ours always wins a conflict** — the human's text is live and possibly mid-thought.
  *Take theirs* re-runs the merge from the ancestor against the **current** buffer, so typing done
  after the banner appeared survives.
* **`edit_manuscript` stays the documented default for agents.** Its exact-match contract is what
  makes concurrent editing survivable at all (§15.3).

`flushDirtySessions()` — run before an agent starts — **skips diverged sessions**, because saving
one would answer the banner on the author's behalf.

Measured: `wordDiff` diffs a one-word edit in a 1 MB document in ~5 ms, and two unrelated
3,000-line documents in ~19 ms; the tokenizer is gated by 10,000 randomized round-trip pairs.

### 5.6 AI-diff review

`manuscript/revisions.json` stores the **whole pre-image**, not hunks. Hunks are recomputed from
it at render time — the same discipline as D1 — which means they stay correct after the user edits
around them and there is **no hunk-migration logic anywhere**. The manuscript file never contains
diff markers (D8), so exports, compliance checks, word counts and git see clean prose at every
instant. Deletion widgets are `contenteditable=false` and are not selectable into a copy; anything
reading the document for export, word count or compliance reads **the buffer, never the DOM** — a
leaked deletion widget in an export is a correctness bug in a submitted paper.

Accept and reject are deliberately asymmetric, and that asymmetry is the good part: **reject**
edits the prose back as an ordinary undoable edit; **accept** only advances the baseline and
cannot alter the file at all. Either way the hunk stops existing because base and document then
agree — no hunk bookkeeping. Turning the paint off hides the display but **does not stop capture**,
so turning it back on shows everything accumulated meanwhile; the review bar hides with it,
because an Accept-all for invisible changes would be a trap. Attribution has no owner bookkeeping:
text the user types inside an AI insertion simply stops matching and stops being highlighted. It
will occasionally under-report, **which is the right direction to fail.**

Two baselines exist and never compete: `revisions.json` answers *what has the agent changed since
I last looked*, and a round's freeze answers *what has changed since we submitted* (§4.5).

---

## 6. Machine-level configuration

### 6.1 `~/.suna/config.yml` — one file, one level

```
~/.suna/config.yml       every setting, seeded with every key present and commented out
~/.suna/themes/*.yml     one colour theme per file; the filename is the id
```

`SUNA_CONFIG_HOME` relocates the directory. It is deliberately **not** `SUNA_CONFIG_DIR`, which
names something else entirely (§6.3).

**There is one level.** A key the file sets wins; a key it does not set takes the shipped
default. There is no project override and no second global store — *an rc file that some other
store can silently outrank is the failure mode this design exists to avoid*, and it is why the
Settings GUI writes into this same file rather than beside it. `suna.json:settings` is the
historical project level, and it is dead (§4.1).

`SETTING_KEYS` in `packages/core/src/settings-resolve.ts` is the registry: for each of ~36 keys,
its **YAML path**, its zod schema, its default, and the one-line documentation the seeded file
carries. `SETTINGS_DEFAULTS` is derived from it, and `defaultConfigYaml()` generates the seeded
file from it, so the file on disk cannot drift from the real surface. **Adding a setting is one
entry in `SETTING_KEYS`.**

Key names are dot-paths that equal their YAML path, with one exception the registry makes
explicit: `editor.editorTheme` lives at `editor: theme:`.

Blocks: `editor: ui: figures: export: preview: python: literature: terminal: references: ai:
review: response: trash:`.

Behaviour that is contract, not implementation detail:

* **A bad value never takes the app down.** It falls back to the shipped default and appears as a
  diagnostic naming the key and what was wrong. Nothing in the parse path throws; a syntactically
  broken file yields zero values plus one diagnostic.
* **`null` at a key reads exactly like an absent key** — the shipped default. That is how the
  GUI's *Reset to default* leaves a clean file.
* **The GUI edits the file in place, preserving comments, key order and blank lines**, through
  the YAML *document* API. A file whose YAML is currently broken is returned **unchanged** with
  `written: false`: silently rewriting a file the user is mid-edit in would lose their work.
* The file is watched, so a save in any editor applies live — no restart, no round trip. The push
  carries the whole reloaded config, including the generated stylesheet.
* Main reads the config **before the window exists**, so the first paint is already in the user's
  theme rather than flashing the default and correcting itself.

### 6.2 Themes

A theme is a YAML file naming colours in three layers, each with its own CSS prefix:

| Layer | Prefix | Tokens |
|---|---|---|
| `chrome:` | `--s-*` | 30 — window frame, panels, ink, accent, ok/warn/err, borders, diff/role colours, 8 commit-graph lanes |
| `editor:` | `--ed-*` | 8 — the writing surface; every key falls back to its chrome counterpart |
| `syntax:` | `--ed-syn-*` | 8 — tokens inside the editor |

`extends:` inherits; resolution is (1) start from the parent or the `base:` root, (2) apply what
this theme declares, (3) **re-derive** any editor/syntax token this theme did not state *only
when the chrome colour it comes from was changed here*. Step 3 is what lets four chrome colours
produce a coherent editor while a theme that only re-tints its chrome keeps its parent's
deliberate editor tuning.

Invariants:

1. **Colours originate in the theme registry, not in a stylesheet.** The six built-ins ship as
   *data* in `BUILTIN_THEME_DEFINITIONS` and go through the same resolver and reach the DOM by
   the same route as `~/.suna/themes/nord.yml`. There is no privileged path.
   `styles/tokens.css` carries metrics and font stacks only.
2. **A theme may name the declared keys and no others.** An unknown key is a validation error
   naming what it should have been.
3. **Metrics are not part of a theme.** Bar heights, corner radius, type scale and font stacks
   are the `ui:` block, shared by every theme: switching gruvbox → suna-light must not move your
   status bar.
4. A theme id is a lowercase slug and cannot shadow a built-in. An `extends:` that does not
   resolve degrades to the base root — renaming a file should cost you an inheritance, not every
   colour in your UI.
5. The whole sheet is emitted once by `themesCss()` and injected as a single `<style
   id="suna-themes">` **prepended** to `<head>`, so component sheets can deliberately override.

Rule 1 holds substantially but **not completely** — §20.4 lists the current violations, which are
real and should be closed rather than blessed.

### 6.3 The second machine directory — `~/SunaConfig`

There is a **second** machine-level directory, and this file names it rather than pretending
otherwise:

```
~/SunaConfig/                        ($SUNA_CONFIG_DIR relocates it)
  Context/UserContext/               WHO-AM-I.md, RULES.md — seeded once, never rewritten
  Context/SunaContext/               the stock agent docs; REPLACED on every update
  library.json                       the user's PDF library roots and download policy
```

It is separate from `~/.suna` on purpose: it is a *visible* home directory because
`UserContext/` is user-edited and must be findable in Finder, and because **the MCP server runs
standalone, without Electron, and has no `userData`** — the Settings pane and the standalone
server must read the same roots.

This does not contradict §6.1: *settings and themes* live in exactly one file. `~/SunaConfig`
holds no settings — it holds agent-facing prose and one library-roots file.

---

## 7. SciMark — the manuscript dialect

`@suna/markdown` parses and renders; it computes nothing.

**Base**: CommonMark + GFM tables + `$…$` / `$$…$$` math, via
`unified().use(remarkParse).use(remarkGfm).use(remarkMath)` — **`.parse()` only**. No
transformer plugins run. Every SciMark extension is a post-order AST rewrite with
`unist-util-visit`, in a fixed order: raw-LaTeX → figure/table embeds → image attributes →
inline tokens.

The dialect, exactly:

| Syntax | Node | Notes |
|---|---|---|
| `[@key]`, `[@a; @b]` | `CitationNode {keys, narrative:false}` | |
| `@key` | `CitationNode {narrative:true}` | recognized only at string start or after `[\s([{]` |
| `@fig:x` `@tbl:x` `@eq:x` `@sec:x`, optional `{a}` | `CrossRefNode {kind, id, suffix?}` | the suffix is a panel locator |
| `![[fig:id]]` / `![[tbl:id]]` | `FigureEmbedNode` / `TableEmbedNode` | whole-paragraph only |
| `$$ {#eq:label}` … `$$` | label on the opening fence | recognized in the **renderer**, not the parser |
| ` ```{=latex} ` | `RawLatexNode` | |
| `![alt](f.png){width=50%}` | `image.data.width` | one key, one value, no spaces, no quotes — deliberately the whole grammar, because anything wider turns the source into a styling dialect |

**Not in the dialect**: callouts/admonitions, YAML front matter, and citation locators —
`[@key, p. 5]` does not parse and stays literal text.

Rendering (`renderHtml`) is a hand-written mdast→string emitter with KaTeX
(`throwOnError: false`). Citations, cross-references, figures, tables and images resolve through
**caller-supplied callbacks**; an unresolved one emits a placeholder carrying the key or id and
**never a number**.

Invariants:

1. **Nothing in this package throws.** Guarantee.
2. `renderNode`'s `default: const exhaustive: never` makes a new node type a *compile* error.
3. Positions are deep-copied onto every synthesized node, so `source.slice(start, end)` stays
   exact — this is what lets comment anchors and the outline address the same text.
4. `{width=…}` always becomes `max-width: min(V, 100%)`, never a definite width. Measured: a
   definite `width:100%` renders 660×400 against a natural 0.357 aspect ratio because
   `object-fit` defaults to `fill`. **`{width=…}` can only ever make an image smaller, in all
   three renderers.**

Known gaps: `rawLatex` renders as an HTML comment (there is no LaTeX target — §13);
`footnoteDefinition` renders as `''`, so footnote bodies are **silently lost**; `@sec:` has no
anchor producer; raw `html` nodes and resolver output are injected unsanitized (acceptable only
because every input is the user's own project).

---

## 8. Derived numbering

**Figures, tables, equations, references, affiliation markers and author markers are never
stored.** They are derived, and the derivation is stated here so the two implementations that
exist can be checked against it.

* **Figures** — ordered by *first embed appearance* in `manuscript.md`; a figure in
  `manuscript.json` that is never embedded takes manifest order after the embedded ones. Rendered
  as `${figureLabel} ${n}` where the label word (`Figure` / `Fig.`) comes from the profile.
  Supplement figures number `Figure S<n>` in their own sequence.
* **Tables** — the same rule, its own sequence.
* **Equations** — one counter over *every* display-math node in document order; only labelled
  ones enter the map. An unlabelled equation still consumes a number, because the printed
  document numbers it.
* **References** — `assignNumbers()` numbers by first citation cluster in document order;
  the printed list is then ordered `appearance` or `alphabetical` per the profile.
* **Sections** — derived from Markdown headings by `outlineFromMarkdown`, which ignores `#`
  inside fenced code and treats text before the first heading as an untitled leading section.
* **Affiliation markers** — derived from `authors.json` array order.

**Write `@fig:x`, never a literal "Figure 3".** This is stated in the shipped agent docs and is
the reason cross-references exist.

**Contract hazard, named rather than hidden.** This pipeline is implemented **twice**: once in
`apps/desktop/src/renderer/src/manuscript/citations.ts` for the live document, once in
`apps/desktop/src/main/services/export-content.ts` for export. They are duplicated because
`tsconfig.node.json` scopes main to `src/main`/`src/preload`, so main cannot import renderer
sources without blurring the build boundary. The source says it in as many words: *keep any
future fix to the citation/label/reference pipeline in sync across both copies.* This is the
single largest structural risk in the codebase, and closing it (a shared pure package) is the
obvious next architectural move.

---

## 9. Bibliography

`references.bib` is the source of truth. `@suna/bib` has two dependencies and no `node:*`
import, because it must load into the Electron main process *and* the standalone MCP server.

**Parsing** runs `@retorquere/bibtex-parser` twice — cooked for the model, `raw: true` for
`BibEntry.raw` — matched by index with a key fallback. It never throws; malformed entries become
`ParseIssue`s. All strings are NFC-normalized, `journaltitle` folds to `journal`, DOIs are
stripped of resolver prefixes.

**Serialization** is deterministic: a fixed `FIELD_ORDER` then alphabetical, every value braced,
braces escaped only when unbalanced. The guarantee is **model-level idempotence from generation
one**, not byte-identity with an arbitrary input file. `bib-write.ts` is a pure text transform
that appends and cuts spans and **never re-serializes an entry it did not touch**, so
unparseable text in the file survives byte-identically.

**Cite keys** are `asciiFold(family) + year + firstNonStopword`, with `anon`/`nd`/`untitled`
fallbacks and `a`…`z`, `27`, `28`… for collisions.

**Citation rendering** has three modes — `numeric-superscript`, `author-year`,
`parenthetical-numeric` — with range collapsing driven by the profile. Reference entries are
rendered by one hand-written Nature-like pattern with four variants (article, chapter, preprint,
software). **There is no CSL anywhere in the repo**, and no APA/Vancouver/IEEE switch. That is a
deliberate scope decision (DECISIONS 2026-08-13), not an omission to be quietly widened.

**Deduplication is DOI → arXiv id → folded title, in that order, and stops there.** There is
deliberately no author+year fallback: two papers by the same group in the same year are
ordinary, and a false "already there" would silently swallow the citation the user asked for.
When in doubt it returns null and the caller appends — *a duplicate is visible and fixable, a
dropped citation is neither.* Fuzzy matching returns `chosen: null` plus the alternatives when
the top-two ratio exceeds 0.9, rather than guessing.

**Providers**: Crossref (keyless, polite `mailto`), OpenAlex, bioRxiv/medRxiv (through Crossref
member 54368), arXiv (Atom, parsed by regex, no XML dependency). Bare `fetch` with
`AbortController` and an 8 s timeout; **no retry and no rate limiting**. The contact address is
supplied by **main**, never by the renderer: Unpaywall's keyless API requires one, and a renderer
must not be able to put an arbitrary address on the app's outgoing requests.

**Provider choice is a measurement, not a preference.** Probed 2026-08-14 and re-confirmed since:
**Crossref works keyless** with a polite `mailto`; **OpenAlex meters** and answers HTTP 429
*"Insufficient budget… $0 remaining"*; **NASA ADS** answers 401 and **Semantic Scholar** 429
without a key; **arXiv** returned empty from this network and is treated as best-effort. Crossref
is the default *because* OpenAlex is metered — that is the whole reason.

**PDF acquisition** is a seven-rung ladder, mirrors before publishers, with a 60 s total budget,
20 s per hop, 3 manual redirects, a 50 MB streaming cap, and an SSRF perimeter that refuses
RFC1918, link-local, loopback and `*.local` **at every hop** — without which the failure messages
report an internal endpoint's status back to the agent, which is a port scanner. Its shape is
measured, not assumed:

* **Mirrors before publishers, because publishers refuse scripts.** Reading only OpenAlex's
  `best_oa_location` got **4 of 10** test DOIs; walking *every* location got **8 of 10** — because
  that field names the *publisher* for most works, and the publisher is the host most likely to
  say no. MDPI answered 403 while the arXiv mirror served 377 KB; eLife and Cell reported
  `pdf_url: null` at every location while the PMC landing page yielded a PDF; nature.com bounced
  a `fetch` through an identity provider. PMC ids are fetched through **europepmc.org**, because
  ncbi.nlm.nih.gov serves HTML to a script at the equivalent path.
* **One clock for the whole call, not one per URL.** Six candidates × two requests × four hops ×
  20 s is **twelve minutes** of a wedged call, which a server answering every hop at 19 s buys
  outright. The 20 s hop timeout is a sub-limit of the 60 s budget, never a multiplier.
* **Failure is classified from the HTTP status, never from the prose of an error** — a substring
  search for "403" silently reclassifies the day someone rewords a sentence.
* **The read boundary is checked against what `open` will reach, not against the name.** `resolve`
  folds `.` and `..` but never touches a symlink, so `~/Papers/Gunn_1972.pdf` → `~/.ssh/id_rsa`
  passed under its own name and was then opened at its target. Only regular files are opened:
  `open()` on a FIFO blocks until a writer appears.
* **Never attempt paywall circumvention.** No Sci-Hub, no institutional proxies, no credential
  replay. **A 403 is reported as a 403.** Shipping a bypass would make the app a liability to the
  people it is for.

Two measured bugs are pinned by that code: a DOI with a SICI-style `#` suffix, un-escaped by
`encodeURI`, resolved to *a different work* whose PDF would have been saved under this reference's
key; and byte-level evidence works without a PDF parser because publisher PDFs carry XMP metadata
as **uncompressed** XML — a raw ASCII search of the first 256 KB finds the DOI.

**A `medium` local match is not enough to copy unasked.** The rule was written once too
generously and tightened: a lone `filename-author-year` hit *is* a `medium` on its own, and a bare
"Smith 2020" names every paper Smith wrote in 2020. Auto-copy requires `high`, or `medium`
corroborated by a second distinct evidence id — and the byte-read budget must reach candidates
whose *names* scored nothing at all, because Zotero files everything as
`storage/<8 chars>/Full Text PDF.pdf`, which matches no filename rule.

---

## 10. The canvas

### 10.1 The document model **is** the SVG DOM

`CanvasDocument` (`packages/canvas/src/document.ts`) is a facade over a parsed `Document`:
`{dom, root, adapter, mintLog}` plus a lazily built id index that is a *cache*, invalidated after
every mutation. There is no node wrapper type, no `SceneNode`, no parallel model. **Verified: no
parallel scene graph exists anywhere in the package or the renderer.**

Parsing and serialization touch exactly one seam, `DomAdapter {parse, serialize}` —
ambient `DOMParser`/`XMLSerializer`, which is Chromium in the app and jsdom under vitest.

**Round-trip invariant (guarantee, CI-enforced):** `serialize(parse(svg))` is **byte-identical**
for an untouched file — comments, PIs, DOCTYPE, CDATA, entities, namespaced attributes,
self-closing forms, attribute order and pretty-printing all preserved. Three mechanisms make it
true, and each exists because the standards-mandated behaviour broke it:

1. **XML attribute-value normalization** turns literal newlines and tabs inside attribute values
   into spaces at parse time, irreversibly — and matplotlib writes multi-line path `d`
   attributes. The adapter pre-encodes literal attribute whitespace as character references
   before parsing and decodes the serializer's `&#xA;` escapes back on output, touching only
   quoted attribute values inside element tags. *Accepted limitation, stated: a file that spells
   attribute whitespace as an explicit `&#10;` round-trips to the literal character instead.
   Matplotlib never does this.*
2. **Chromium's `XMLSerializer` reorders `xmlns` declarations ahead of other attributes**, which
   would break byte-identity for unedited documents. The source's root start tag is replayed
   verbatim.
3. The prologue (XML declaration, DOCTYPE, leading comments/PIs) and epilogue are split off and
   re-spliced around the serialized root.

**Never normalize the file.** Import *flags* problems — duplicate ids, missing viewBox, script
or `foreignObject` content — and never fixes them.

### 10.2 The command bus

The vocabulary lives in `@suna/core` (`canvas-commands.ts`), as zod schemas, because it is shared
between the editor, the properties panel and — by design, though not yet in fact (§10.4) — the
agent tool layer. Fifteen kinds, exhaustive:

`set-attrs` · `set-style` · `set-text` · `translate` · `transform` · `reorder` · `reparent` ·
`group` · `ungroup` · `insert` · `remove` · `align` · `distribute` · `set-artboard` · `batch`

```ts
dispatch(doc: CanvasDocument, command: CanvasCommand): CommandResult
// { ok: true, inverse: CanvasCommand, affected: string[] }
// { ok: false, error: { code: 'target-not-found' | 'invalid-svg'
//                             | 'text-on-non-text' | 'invalid-command' }, affected: [] }
```

Targets are element ids, `'#root'` (reserved so `set-artboard`'s inverse needs no minted id), or
a chainable structural address `#<id>>nth:<k>`. Selection is **not** engine state: it is a
`string[]` the host owns.

Rules, all guarantees, all with tests:

1. **Undo is inverse commands, never snapshots.** `CommandHistory` is a bounded stack
   (limit 200) of `{command, inverse, label}`; an open transaction coalesces into one `batch`.
   `undo()` dispatches the inverse; on failure the entry is pushed back, so the stacks never
   desync.
2. **Every success carries a byte-exact inverse.** The fuzz suite applies 34 commands, undoes
   all, redoes all, undoes all — byte-identical at every step.
3. **A failing command mutates nothing.** Resolve → validate → *then* mint: target resolution has
   no side effects, and id minting is the commit point.
4. **A failed `batch` leaves the document byte-identical**: applied inverses replay newest-first,
   then every id minted during the batch is stripped via `mintLog`.
5. **The one designed residue is a minted id.** Undo restores everything except an id minted onto
   a previously unidentified element — because that id is the stability anchor a later inverse
   would need. Explicitly tested.
6. **Deleting an `id` attribute is refused** (except on root); renaming is allowed, and the
   inverse targets the new id.
7. **Attribute order is preserved.** An identity `transform` is only *removed* when the attribute
   is absent or last; mid-list it is updated in place, because removal plus re-add-at-end would
   shift attribute order and break byte-exact undo.
8. **A transform inverse restores the prior attribute string verbatim.** Numeric re-composition
   cannot reproduce matplotlib's `rotate()`/`translate()` spellings byte-for-byte, and
   floating-point round-trips are not exact — the captured string is.
9. An element's **leading whitespace run belongs to it** and moves, is captured, and is restored
   with it, so pretty-printing survives group/ungroup/reorder/reparent/remove.
10. Namespace hygiene: subtree serialization temporarily declares the prefixes it needs, so
    `xlink:href` never becomes `ns1:href`, and redundant declarations are stripped on reinsert.

**Known gap, explicit and not a TODO:** geometry is derived from attributes only
(`rect/image/use/foreignObject/circle/ellipse/line/polyline/polygon/path`). `align` and
`distribute` on a `<g>` or `<text>` fail with a message saying layout-dependent alignment is
deferred, because they need real `getBBox()` layout.

### 10.3 Interaction, and how the canvas is hosted

Interaction is framework-free and lives in the package (`interact/`): a `ToolController` FSM,
snapping (6 screen-px threshold, 200 candidate cap), nudge/z-order/duplicate command factories,
and shape factories. **World-space coordinates in; engine commands plus ephemeral state out —
never DOM mutations.** `ToolId ∈ select | rect | ellipse | line | arrow | text`.

The renderer host adds the one thing that cannot be in the package:

> **The engine's `CanvasDocument` stays off-DOM and pristine — it is the single source of truth
> and the only thing serialized to disk. What the user sees is a mirror clone, re-synced after
> every engine mutation; gesture previews touch only the mirror.**

**Three coordinate spaces, converted only through `DOMMatrix`:** *screen* (CSS px, owned by
pointer events), *world* (SVG user units of the root viewBox, where **all** hit testing, snapping
and gesture math happens), and *local* (an element's own user space, where attribute writes land).
`screenToWorld = root.getScreenCTM()!.inverse()`; `worldToLocal(el) = el.getCTM()!.inverse() ×
rootCTM`, computed per interaction and cached per frame. Gestures compile to commands **only at
commit time** — during a drag the preview moves the mirror, and pointer-up emits one
`translate`/`transform`; Escape aborts by restoring pre-state. Commands never encode view state:
zoom and selection are ephemeral UI stores.

Physical units: `mmPerUser = artboard.widthMm / viewBox.width`, with `1 pt = 0.3528 mm` and a
unitless length read as px at 96 dpi. `set-artboard` rewrites `width`/`height` only and **never
rescales content** — rescaling is a separate explicit `transform` on a wrapping group.

The canvas tab's own surfaces — tool rail, properties panel, layers panel, rulers, text-edit
overlay, palette/align/export sections — are React around the mounted SVG, and **every one of
them compiles to the existing fifteen commands; none of them is a new mutation primitive.** New
elements insert with `suna-e<n>` ids and style defaults taken from the active profile's figure
rules (stroke width inside min/max, palette order, text at a compliant pt), so a shape drawn by
hand starts compliant rather than being flagged a moment later.

### 10.4 What the canvas command bus is *not* — today

`CanvasCommand` is serializable and zod-validated *in anticipation* of agent drivability, and the
design documents describe human gestures and agent calls as equal clients of one bus. **Today,
only human gestures dispatch commands.** There is no `canvas_dispatch` MCP verb, no
`canvas_query`, no `canvas_screenshot`. The agent's figure surface is deliberately read-only
(`read_figure_svg`, `check_figure_compliance`), and the shipped agent docs say so: *never
hand-edit `figures/*/figure.svg` — editing it bypasses undo, id-minting and provenance.*

The actual figure↔code loop today is: the canvas tab hands an external AI CLI a read/edit tool set
scoped to the figure's `source/plot.py`, the script is edited and re-run, and the tab reloads
`figure.svg` from disk — refusing to reload while the user has unsaved local edits.

---

## 11. Figures and provenance

### 11.1 What exists

`suna_mpl` (§16.1) assigns semantic, deterministic `gid`s that matplotlib writes into the SVG as
`id`s — `ax0`, `ax0.title`, `ax0.line.<label>`, `legend` — and writes a sidecar
`figure.svg.suna.json` with per-axes data↔SVG-unit anchors and a sha256 of the SVG.

`figure.json:provenance` is `{generator: {script, entry?, interpreter?}, baseSvgHash?, overlay:
OverlayOp[]}`, validated by zod, and `null` for a hand-drawn figure.

### 11.2 What is guaranteed

* Stable ids from the generator survive every canvas edit (§10.2 rule 6).
* `figure.svg` on disk is always valid, complete SVG — never a diff, never a patch.
* The canvas never rewrites a figure it did not edit.

### 11.3 What is **not** implemented

The overlay/regenerate/absorb loop specified in the design record (§11.4) does not exist:

* `packages/provenance` is a placeholder — one file containing `export {}`, one commit, zero
  importers.
* **No code writes an `OverlayOp`.** Both figure writers emit `overlay: []` or
  `provenance: null`. The schema is consumed only as an editor linting schema.
* There is **no replay function** that applies an overlay onto a regenerated base.
* There is **no `absorb_overlay` tool** among the 34 MCP verbs.
* **No TypeScript reads `figure.svg.suna.json`.** Python writes it; nothing consumes it yet.

Provenance today is a static record of *which script produced this figure*, and nothing more.
Stating that plainly is the point of this section.

### 11.4 If the loop is built, these are its rules

Recovered from the design record, because they are the part worth keeping:

1. **`figure.svg` is always `base ⊕ overlay`, baked** — a complete valid SVG, never a patch.
2. **The overlay records intent, not effect.** `translate legend by (4, −2)`, not `transform
   attribute changed to matrix(…)`. That is precisely what makes absorbing an edit back into
   `plot.py` possible; DOM diffing gives effect only, and is the fallback for an *external* edit
   where intent is unavailable.
3. **The overlay is the replayable subset of the command vocabulary, keyed by target id.**
   Interaction-only notions — selection, batch labels — never reach it.
4. **`replay(base, overlay)` is a pure function.** Regenerating twice from the same data yields
   byte-identical `figure.svg`. This is why `suna_mpl` pins `svg.hashsalt` and strips dates
   (§16.1): without byte-stable regeneration, "a reviewable diff" is not a thing that exists.
5. **An op whose target vanished moves to `orphans` and is surfaced** — D7. Never silently dropped.
6. **Absorption is verified mechanically, not trusted.** An op is removed from the overlay only
   when the *fresh base already contains its effect*, checked as an attribute diff. Ops that still
   change pixels stay, and the agent reports which and why.
7. **The overlay is subordinate to the code. There are no merge prompts**, and no edit is ever
   auto-applied to a script — the human reviews a diff.

The mechanical detail, recorded here because it is the part that would otherwise have to be
re-derived. The replayable subset is `set-style` · `set-attrs` · `set-text` · `translate` ·
`scale` · `reorder` · `delete` · `insert`; the recorder folds each dispatched command into the
overlay by coalescing on `(target, kind)` — last `set-style` per property wins, `translate` deltas
sum, a `delete` clears prior ops on that target, ops on an `insert`-created element keep their full
subtree inline, and order is preserved otherwise. `provenance` gains an `orphans: OverlayOp[]`
member beside `overlay` for rule 5's evictions, surfaced as a badge on the figure panel rather
than a log line. Regeneration runs the generator with `SUNA_FIGURE_OUT=<tmp>/base.svg` (which
`suna_mpl`'s `save_svg` honours); a script that writes nothing there is *detected and reported*,
not guessed at, and an unchanged base hash stops the pass before replay. Absorption reads the
semantic gid map to find the call site — `ax0.title` → the `set_title(...)` call, `ax0.line.<label>`
→ the plot call with that `label=` — and translates what it can (`set-style {font-size}` →
`fontsize=`, `translate` on a legend → `loc=`/`bbox_to_anchor=`, an axis-limit `set-attrs` →
`set_xlim`), leaving unmappable ops in the overlay.

Three drift cases, and each has one answer. A **hand-edited script** simply replays on the next
regenerate, orphans and all. **`figure.svg` edited outside SUNA** is caught on open by a hash
mismatch against `base ⊕ overlay` and marks provenance *stale*, offering exactly three choices —
adopt (fold the external diff in by DOM diffing, the one place effect-level diffing is legitimate
because intent is unavailable), detach (drop provenance), or discard. **Deleting `source/`**
detaches provenance with a warning. None of these is a merge prompt.

---

## 12. Publisher profiles and the compliance model

A **publisher profile** is a declarative JSON document encoding what a journal's *author
guidelines* say — never its typeset page design (DECISIONS 2026-08-13). Ten ship, in
`resources/profiles/<id>.json`, bundled at build time:

`suna` (the house style, first, and the only one not derived from a journal's guidelines),
`science`, `nature`, `neuron`, `pnas`, `brain-stimulation`, `sleep`, `sleep-advances`, `jne`,
`jneurosci`.

`PublisherProfileSchema` is `schemaVersion: 3`, with four sections — `citations`, `figures`,
`manuscript`, `letters` — plus `documentStyle`, `notes`, and `lastVerified`.

Two properties of the format are the whole design:

1. **`null` means "the journal does not state this", and it suppresses the check entirely.** It
   does not mean "no limit" and it never falls back to another journal's number.
2. **Every section carries `sources[]` and `provenance[]`**, each provenance entry being
   `{claim, quote, source, basis}`. A profile field is only written when a guidelines page
   actually says it, and the diagnostic that fires can show why. `notes[]` records the
   contradictions found while reading — Nature's own formatting guide and final-submission page
   disagree about figure widths, and the profile says so rather than picking silently.

`loadProfile` resolves an `extends` chain deepest-parent-first with a deep merge (objects merge
child-wins; **arrays, scalars and `null` replace wholesale**), throws on cycles and unknown
parents, then validates the *merged* document. No shipped profile currently uses `extends`.

**The sourcing rule, and it is hard: if a journal's guidelines cannot be found, that journal is
not shipped.** No inferred profile. No "close enough" sibling journal's rules. Anything the
journal does not state is `null` — never guessed. Two shipped profiles are marked here because
they do not fully meet it and must be re-verified before their limits are trusted:
`brain-stimulation` is a skeleton (ScienceDirect, Elsevier and the journal site all answered
HTTP 403), and `sleep-advances` carries a placeholder flagged `inferred` rather than SLEEP's
rules, which would have violated the no-sibling-inference rule outright.

**A recorded off-by-one that will bite the next profile author.**
`authorTruncation.truncateWhenMoreThan` means *the largest author count still printed in full*. A
journal that truncates *at* N authors is therefore encoded as `N − 1`. SLEEP shipped as `7` and
printed all seven names on a seven-author reference; it is now `6`, with a boundary test. **Read
any new profile against this.**

### 12.1 The compliance model: flag, never restyle

> Profile-driven checks **flag** violations of a journal's stated guidelines. They never rewrite
> content.

Two severities (`error`, `warning`); six declared surfaces (`figure`, `manuscript`, `export`,
`letter`, `response`, `package`) of which `export` and `package` are currently emitted by
nothing. A diagnostic is `{id, severity, surface, message, target?}` and the message states the
**measured value against the journal's stated rule**.

The 26 implemented rule ids — this list is the contract; adding one is an edit here:

| Surface | Ids |
|---|---|
| figure | `fig.min-font` `fig.max-font` `fig.line-weight` `fig.artboard-width` `fig.raster-dpi` `fig.color-sole-delimiter` `fig.palette` |
| manuscript | `ms.abstract-words` `ms.word-limit` `ms.title-chars` `ms.section-missing` `ms.availability-data` `ms.availability-code` `ms.display-items` `ms.max-references` `ms.figure-ref-unknown` `ms.figure-uncited` |
| letter | `letter.requirement-unverified` `letter.summary-over-limit` `letter.journal-name-mismatch` `letter.data-location-unspecified` `letter.corresponding-contact-missing` |
| response | `response.point-unaddressed` `response.reply-missing` `response.reply-orphaned` `response.verbatim-altered` |

Two of these exist because of a specific measured failure, and both belong in the contract:

* **`letter.requirement-unverified` is a warning the author clears by reading, not an assertion
  the checker makes.** Reading "we declare no competing interests" out of free text with a
  heuristic would mean SUNA deciding whether someone declared a competing interest.
* **`response.*` exists because a real response letter numbered its replies by hand up to RE83
  and was missing RE58 entirely. Nobody noticed, because a hand-maintained counter has no way to
  notice.** Labels are derived, never stored; quotes are never pasted.

Errors surface in the export dialog's preflight; **nothing is blocked and nothing is autofixed.**

**The specified remainder, kept because the specification is the expensive part.** A design pass
sourced 54 rules across four surfaces against real guidelines; 13 of them ship under the ids
above (`fig.artboard-width` = FIG-001, `fig.min-font` = FIG-003, `fig.max-font` = FIG-004,
`fig.line-weight` = FIG-006, `fig.palette` = FIG-008, `fig.color-sole-delimiter` = FIG-010,
`fig.raster-dpi` = FIG-012, `ms.title-chars` = MAN-001, `ms.abstract-words` = MAN-003,
`ms.word-limit` = MAN-005, `ms.display-items` = MAN-007, `ms.section-missing` /
`ms.availability-*` = MAN-009, and `ms.max-references` = CIT-001). The `letter.*` and
`response.*` surfaces are later work and were never in that set. The **41 that are not built** are
listed below with the profile field each would read, because rebuilding the sourcing is the cost,
not writing the checker. This is an inventory, not a plan — §20.8 records the gap and ROADMAP
decides whether it closes.

*Bibliography (no `CIT-*` surface exists at all).* CIT-002 Methods-scope reference allocation
exceeded (`citations.maxReferences[type]` scope `methods`) · CIT-003 citation inside the abstract
(`citationsAllowedInAbstract = false`) · CIT-004 disallowed citation target — in-press,
personal communication, in-preparation, a grant as a numbered reference
(`disallowedCitationTargets`) · CIT-005 literal "et al." in author *data* where full lists are
mandatory (`refListAuthors.etAlAllowed = false`) · CIT-006 author list not truncated per policy on
a user-overridden entry (`refListAuthors`) · CIT-007 missing DOI where required
(`doi.requiredFor`) · CIT-008 DOI format mismatch (`doi.format`) · CIT-009 journal name not
abbreviated per policy (`journalAbbreviation.policy`) · CIT-010 entry missing a template-required
field, or carrying a forbidden one (`entryTemplates.*`) · CIT-011 one work under two numbers or
two works under one (`numbering.onePerNumber`) · CIT-012 reference-list order mismatch after a
manual edit (`sortOrder`) · CIT-013 preprint cited although the library holds the published
version (`disallowedCitationTargets`) · CIT-014 self-citation share over cap
(`maxSelfCitationPercent`).

*Figures.* FIG-002 height over the caption-tier maximum (`maxHeightMm` + caption word count) ·
FIG-005 font family off-policy (`fontFamilies`) · FIG-007 stroke above maximum weight
(`lineWeightPt.max`) · FIG-009 red and green as a contrasting pair (`palette.redGreenCombination`)
· FIG-011 colour-mode mismatch for the export target (`palette.colorMode`) · FIG-013 asset in a
disallowed format (`formats.vector.notAccepted`) · FIG-014 file over the size cap
(`formats.maxFileSizeMb`) · FIG-015 outlined text where live text is required
(`formats.textMustRemainEditable`) · FIG-016 panel-label case/weight/size/wrapper mismatch
(`panelLabel.*`) · FIG-017 panel count over the per-figure cap (`maxPanelsPerFigure`) · FIG-018
missing required plot elements — borders, fiducial marks, axis units, scale bar, leading zeros
(`requiredElements`) · FIG-019 caption over the word limit (`captionWordLimit`).

*Manuscript.* MAN-002 running head over limit (`runningHeadLimitChars` — the field is sourced
journal data even though SUNA dropped `shortTitle`) · MAN-004 abstract structured where a single
unstructured paragraph is required (`abstractStructured = false`) · MAN-006 below a stated minimum
length (`wordLimit.min`) · MAN-008 Extended Data count over cap (`maxExtendedDataItems`) · MAN-010
section order violates the stated sequence (ordered `requiredSections`) · MAN-011 forbidden
feature present — footnotes, shaded table cells, an image used as a table or equation
(`forbiddenFeatures`) · MAN-012 keyword count outside range or off the controlled list
(`keywords`) · MAN-013 spelling variant off-language (`submissionFormat.language`) · MAN-014
abbreviations in the abstract (`forbiddenFeatures`) · MAN-015 estimated typeset length over a page
limit (`articleTypes[].pageLimit`).

*Export preflight (the `export` surface is declared and emitted by nothing).* EXP-001 output
format not accepted at this submission stage (`fileTypes.initial/final`) · EXP-002 line numbers
disabled where required · EXP-003 line numbers enabled where they must be off · EXP-004 spacing
differs from the stated requirement (`submissionFormat.spacing`) · EXP-005 LaTeX class/template
mismatch — **dead on arrival, since there is no LaTeX path (§20.1)** · EXP-006 profile staleness,
`lastVerified` older than twelve months, prompting re-verification against the recorded source
URLs.

Two policies from that pass are worth keeping whatever gets built. **Severity is derived, not
assigned**: an unhedged stated limit is an error, and a hedged one — or a value sourced from an
umbrella/flagship page rather than the journal's own — is a warning. And **every diagnostic must
be able to show its own provenance**: the governing field's `note` and source URL, on demand,
which the shipped `provenance[]` already carries.

---

## 13. Export

There is no LaTeX. `export-pdf.ts` says it in as many words: *no LaTeX, no Tectonic, no external
binary.* Tectonic appears nowhere in shipping code except in that negation, and there is no
`.tex` export target at all.

**One content model, three renderers.** `export-content.ts` resolves `manuscript.md` +
`manuscript.json` + `authors.json` + `references.bib` through the active profile into a single
model — parsed SciMark ASTs per section, the derived label map (§8), ordered references, numbered
affiliations. Then:

| Target | Path |
|---|---|
| **DOCX** | `export-docx.ts` walks the AST into the `docx` npm package: real Word lists via `numbering.xml`, figure/table bookmarks with internal-hyperlink cross-references, back matter in a fixed order, LaTeX→OMML math for a strict subset |
| **HTML** | `export-html.ts` renders the same ASTs with `@suna/markdown` |
| **PDF** | `export-pdf.ts` prints the HTML through a **hidden `BrowserWindow`'s `printToPDF`** |

**Style: the SUNA house style is the always-on base for every profile.** `SUNA_DEFAULT_STYLE`
holds ground-truth values taken from real submitted manuscripts (US Letter, 0.5 in margins, Times
New Roman 11 pt at 1.15, superscript-affiliation title block, `[n]` citations, 0.5 in-hanging
10 pt references); `resolveDocumentStyle(profile)` deep-merges a profile's **partial**
`documentStyle` over it. A journal states only the deltas its guidelines actually state —
`figureLabel`, `figurePlacement`, `tablePlacement`, `referencesStartNewPage` — because guidelines
almost never state page geometry or point sizes for a *submitted* manuscript, and *inventing
per-journal typography would be exactly the kind of guess this codebase refuses to make.*
`documentStyle` is under the same source discipline as every other profile field: **no delta
without a guideline statement behind it.**

Chromium print facts that are contract because they shape the output:

* `printToPDF` **re-lays out the document at the requested page size**, so the window's own size
  never reaches the PDF — but it *does* reach everything measured from the live DOM before the
  print, which is why the print viewport is sized explicitly.
* **Chromium never paints page margins.** `printBackground` and the root element's background
  both stop at the content box, so a themed export moves the horizontal margins into the body and
  fills the top/bottom bands with header/footer templates, which are the only things Chromium
  will draw there.
* **Page numbers are a real Chromium feature; line numbers are not.** Line numbers are
  approximated by measuring each body paragraph's wrapped visual lines with
  `Range.getClientRects()` and writing numbers into a fixed gutter *before* pagination. This
  tracks real rendered line breaks; it is not a typesetting-grade continuous gutter, and this
  file says so rather than implying otherwise.
* **Oversized blocks are flagged, not restyled** (DECISIONS 2026-08-13 again): a table or figure taller than a
  page is measured, reported through the IPC contract as `OversizedBlock`, and surfaced in the
  preview and the export toast. Tables repeat their header row and never split a row.

**Pages mode is a read-only proof of the exported document.** The manuscript tab cycles
source → reading → pages. Pages mode renders nothing of its own: it calls the same
`export:preview` channel the export dialog calls, which runs the same builders `export:pdf` runs.
**The page breaks are not approximated, inferred or measured — they are the export's, because the
thing on screen is the export.** You cannot type in it. An editable in-place variant was designed
first and dropped: it needed a page-frame stylesheet, CodeMirror break widgets and
PDF-text-to-source-offset matching to hold a weaker contract than this one.

Version tabs deliberately have no pages mode: a version tab renders an *archived*
`manuscript.md` while `export:preview` builds from the live project directory, so it would show
the current manuscript while claiming to show an archived one. Plain `.md` tabs keep only
source and reading: a loose Markdown file has no page geometry to show, and **inventing one would
be a lie.** Entering pages mode takes the editor **out of the tab entirely rather than disabling
it** — a disabled CodeMirror still shows a caret, still takes focus, and still invites typing that
silently does nothing.

**Everything ships in-package.** An earlier design detected an external `docx-tools` CLI as an
accelerator and it was removed, its logic ported instead. The rule behind that: *a fresh install
unable to export is worse than a slower path.* No LaTeX distribution, no pandoc, no LibreOffice,
no external binary of any kind sits between a user and a `.docx`.

Two hazards recorded so the next person does not rediscover them:

* **The DOCX writer reuses the PDF's oversize measurement rather than taking its own.** It cannot
  measure inside Word, but both writers resolve the same `ResolvedDocumentStyle`, so the printable
  box is identical. *This looks like a shortcut and is not one.*
* **A unit trap.** The manuscript printer passes `printToPDF` a page size in **inches**; the
  single-figure printer passes **microns**, and that call is inert only because it also sets
  `preferCSSPageSize: true` so the CSS `@page` rule wins. Anyone copying the figure printer as a
  model for a new component printer gets a silently wrong page size.

**The PDF bytes are asserted, and only a driven run can assert them.** `printToPDF` has no
offline mode, so no vitest file can ever produce a `.pdf` — the unit gates stop at the HTML, by
necessity rather than by neglect. `scripts/e2e/probes/pdf-export-bytes.mjs` closes the rest: it
exports the example manuscript from the hidden driven app under **two profiles** and reads both
back with pdf.js — header and trailer, page count, US Letter geometry on every page, manuscript
strings in the text layer, and a painted image XObject. The two-profile part is the point:
`sleep`'s `figurePlacement: 'captions-list'` must yield **zero** painted images where the house
style yields some, which is what catches a profile's page setup silently not reaching the printer.
`docs/TESTING.md` has the full assertion table and the run command.

**Known defect, unfixed and pre-existing:** the line-number script de-duplicates wrapped lines by
exact rounded `top`, so an inline `<sup>` or a KaTeX span whose rect sits a pixel off counts as an
extra line, visible as overlapping numbers in the gutter.

---

## 14. Review — comments, rounds, letters

### 14.1 Comments

**Comments are never inline prose markers.** The manuscript text stays clean and diffable;
threads live in `manuscript/comments.json` and anchor to prose by a W3C-style text-quote
selector, `{quote, prefix, suffix}` with 32 characters of context each side.

`packages/core/src/anchor.ts` is the **single** locate implementation, shared by the renderer's
comment UI and the MCP comment verbs, *so that a comment created by an agent over raw file text
and one created by a human over live editor text resolve to the same span*. Its strategy, in
order:

1. exact quote appearing exactly once → that span, regardless of context drift (an edit elsewhere
   must never detach a still-unique quote);
2. multiple occurrences → disambiguate by stored prefix/suffix;
3. no verbatim occurrence → whitespace-normalized fuzzy match (handles rewrapped paragraphs);
4. nothing → `null`. **The caller marks the comment `detached` and keeps it. This module never
   decides to drop anything.** Guarantee.

**Resolving a thread is human-only.** There is no MCP verb that resolves a comment, and that
absence is the mechanism, not a policy note: an agent may reply, and an open thread remains a
decision the author still owes.

### 14.2 Response letters

A reply is a plain string carrying two marks — `::quote … ::` around a manuscript excerpt,
`+++ … +++` around the part of it that is new. Three voices, read off two real response documents
that agree exactly: the reviewer's comment (black), our reply (`#0432FF`, prefixed `RE:`),
manuscript text quoted unchanged (black italic) and manuscript text that is new (`#EE0000`
italic). Light themes resolve to exactly those values, so the workspace is a preview of the file;
dark themes carry the same three *roles* at a legible lightness instead.

**Forgiving by construction**: an unclosed `::quote` runs to the end, an unpaired `+++` stays
literal text, nothing throws, nothing rewrites the author's text. A half-typed reply is the
normal state of a reply.

The exported response document is **derived** from these replies, which means what the author
writes in the round workspace *is* the letter.

**Completeness checks name items, never counts.** "Reviewer 2, point 3 is unaddressed", not "3
problems" — a count tells an author that something is wrong and nothing about where, which is
exactly the failure mode that let a real response letter reach RE83 with RE58 missing and nobody
notice. The same rule shapes the three places completeness is shown: per-reviewer progress dots in
the points pane, a status line reading `Round 2 — 12 of 19 points addressed`, and the export
gate. **That gate stops the export once**, naming each unaddressed point by reviewer and number;
`acknowledgeUnaddressed` is the author saying they have seen the list and want the file anyway,
because a draft for a co-author is a legitimate thing to export. It is not a block, and it never
writes a reply on the author's behalf. Relatedly, every automatically inferred value in these
flows shows its reasoning inline — a detected segmentation, a claimed author, a matched anchor is
presented with *why*, never as a bare result.

### 14.3 Cover letters

A letter's `assertions[]` records the author's factual claims to an editor — not under
consideration elsewhere, no competing interests, a named colleague has read the draft — made over
the author's signature.

**There is no verb, in any surface, that writes an assertion.** An agent may draft the argument
and may read which assertions are still unanswered; filling one in is the author's job. This is
enforced by the absence of a write path, not by a prompt.

`letters/<id>.private.json` holds anything confidential to the editor (excluded reviewers, and
so on) and is git-ignored by a line written before the file can exist (§3 rule 5).

### 14.4 Reading notes and PDF annotations

A reading note is a per-paper JSON sidecar at `references/notes/<citekey>.json`, anchored with the
**same** `{quote, prefix, suffix}` selector as a manuscript comment (D10). The PDF page stays the
reading surface: **the page index and every highlight rectangle are derived at paint time, never
stored** — the stored page index is a search *hint* with a verification procedure attached, which
is why it does not violate D1 (that rule governs numbering derived from the manuscript; a PDF page
is a fact about an external artifact).

Highlights are **real `/Highlight` annotations written into the PDF in place**, incrementally.

Invariants:

1. **SUNA never appends prose to a Markdown file it does not own the buffer of.** There is no
   append channel: `fs:write-text` is whole-file, while an open session writes its whole buffer on
   the next autosave tick, so an appended quote would be destroyed a second later. A quote reaches
   the manuscript through a CodeMirror transaction, or not at all. *This rule outlived the code
   that first enforced it; it is restated here because it is easy to reintroduce.*
2. **An annotation no note claims is never touched.** It belongs to Preview, Zotero or the
   publisher. A deletion is only ever performed for a region the caller names.
3. **The incoming bytes must begin with the file on disk right now**, checked in main. Truncation
   back to a pristine baseline is refused when the hash does not match.
4. **Reading a paper must never produce a git-modified file.** Same sha256, same extractor
   version ⇒ resolve, paint, write nothing.
5. **Ambiguous refuses to guess; detached is kept forever** (D2, D7). If more than one citekey
   claims a PDF path, refuse and ask — never let map iteration order decide whose notes appear.

Three measurements that shaped it, each of which invalidates an obvious simpler design:

* **A highlight is a list of runs, not one range.** Content order is not visual order in real
  publisher PDFs: the fraction of adjacent body-line pairs whose intervening content-order items
  belong to *neither* line is 4.3 % (Nature), 4.5 % (PLOS), 4.7 % (ATLAS), 2.1 % (Frontiers),
  2.7 % (arXiv), 0.5 % (CVPR). A drag across two visually consecutive lines can splice in a line
  from elsewhere on the page. A single range stores that splice as the quote and copies the
  corruption into the manuscript — and **because the quote is internally self-consistent, it
  re-anchors perfectly forever and the user never finds out.**
* **Resolution must be document-wide, not per page.** `locate()` returns its unique match
  immediately on whatever text it is given, so running it per page paints a highlight on every
  page that happens to contain the phrase — on first use, with no drift and no file change.
* **pdf.js can delete an annotation.** The prior design rebuilt the file from a recorded pristine
  baseline on every change because deletion was believed impossible; the missing piece was only
  the `pdfjs_internal_editor_` key prefix, without which the staged entry is silently ignored.
  That old design was a trap: the moment another application rewrote the paper, the baseline
  stopped matching and SUNA could never write to that file again, with no recovery.

**Rejected, with reasons worth keeping:** notes in `comments.json` (the unresolved-comment badge
counts project-wide — reading five papers would make the manuscript badge read 300); a `notes.md`
prose file (a silent, permanent data-loss path under rule 1); a committed extracted-text substrate
(≈185 KB of greppable paywalled full text per paper); an `output/<citekey>-annotated.pdf` (an
annotated copy is not where annotations go); path- or fingerprint-keyed notes (two copies of the
same paper have different fingerprints — a documented failure in other tools).

**Derived Markdown via OCR was evaluated and rejected on numbers**, not on taste: the best
available converter's text edit distance is 0.025 — about one character in forty, ≈1,250 errors in
a 50,000-character paper — its formula edit distance 0.278, and its reading-order edit distance
0.101 on double-column pages. Provenance does not survive the conversion, and VLM converters are
not bit-reproducible even at fixed weights. The asymmetry that replaced it: **pdf.js's own text
extraction is good enough to be an anchoring substrate and nowhere near good enough to be a
reading substrate** — on an 11-page two-column paper it yields 50,931 characters in correct body
reading order with **0 paragraph breaks and 219 unresolved line-break hyphenations**.

**Accepted cost, weighed and taken:** `references/<citekey>.pdf` is a tracked binary that changes
as you read it, at roughly 1 KB per edit, with a diff nobody can review.

---

## 15. The agent layer

SUNA has **two** AI surfaces, and they are different things.

### 15.1 In-app AI — provider adapters

`packages/agent/src/types.ts` is the entire provider contract:

```ts
interface Provider { id: string; chat(req: ChatRequest, opts: ProviderChatOptions): Promise<ChatResult> }
interface ChatRequest { system: string; messages: {role,content}[]; model?; maxTokens?; effort? }
```

Three adapters — Anthropic, OpenAI, Ollama — each a single POST with `fetch`, hand-parsed. **No
streaming. No tool use. No vendor SDK. No agent event stream.** Model *tiers* (`opus` / `sonnet`
/ `haiku`) rather than dated ids are what settings store, so bumping a generation is one table
and no committed `suna.json` has to be rewritten.

Keys never leave main (§5.1 rule 1), and errors never include them.

### 15.2 The MCP server — the real tool surface

`packages/agent/src/mcp/server.ts` is a **stdio MCP server over the project's plain-text files**.
It runs standalone, without Electron and without the app open. Root is `--project <dir>`, else
`cwd`.

* It is bundled by esbuild to `dist-mcp/server.mjs` with `zod` and `jsdom` external and
  everything else **inlined**, because it is spawned from the packaged app's resources where a
  runtime `node_modules` lookup is not guaranteed to find anything — and because `yaml`'s
  `require('process')` took the whole server down with *"Dynamic require of process is not
  supported"*.
* Packaged, the app spawns **its own binary as node** (`ELECTRON_RUN_AS_NODE=1`), so no system
  `node` is required. Without that flag the baked command would launch the Electron GUI.
* `.mcp.json` in the project root wires it; it is machine-local and git-ignored, and the app and
  the server both heal it.

**34 verbs**, grouped: documents/letters/rounds (10) · manuscript (13) · comments and reading
notes (4) · literature (3) · study acquisition (4). The full list is in `verbs.ts` and mirrored
in the shipped `resources/suna-context/MCP.md`. Every reply is plain text.

### 15.3 The agent's safety model

There are **no approval prompts**. Safety is expressed as *absent verbs* and *code gates*, which
is the stronger form:

1. **Path sandbox.** `resolveInside(root, …)` throws `'path escapes the project root'`; every
   verb that touches the filesystem goes through it. Destinations are re-asserted with `realpath`,
   because `resolveInside` is a string comparison and a symlinked `references/` walks straight
   through it.
2. **Stale-write refusal — the only write confirmation.** A sha256 fingerprint is kept per read;
   `write_manuscript` refuses when disk differs from what was last read. Without it, *the agent
   reads the manuscript, thinks for thirty seconds, and writes the whole file back — while the
   author has been typing the entire time.*
3. **Prefer the anchored edit.** `edit_manuscript {find, replace}` errors on 0 or >1 matches, with
   per-match context so the caller can extend `find`.
4. **No resolve verb** (§14.1). **No letter-assertion verb** (§14.3). **No reviewer-point write
   path** — only `set_point_status`, which writes the authors' bookkeeping beside the point.
   **No figure-write verb** (§10.4).
5. **Compliance verbs are advisory-only** and never rewrite anything.
6. **Project content is data, never instructions.** External paths and errors are quoted through
   `quoteExternalPath` / `describeExternalError`, and *the rule is enforced by a test that reads
   the source rather than held by hand at thirty call sites.*
7. Writes are atomic (temp + rename). There are no locks: when the app is open it live-reloads and
   three-way-merges (§5.5), which is why anchored edits matter.

### 15.4 The context layer

Three layers, and the ownership table is part of the contract because agents read it:

| Layer | Where | Owner |
|---|---|---|
| 1 | `~/SunaConfig/Context/UserContext/{WHO-AM-I,RULES}.md` | the **user**. Seeded once, never rewritten |
| 2 | `~/SunaConfig/Context/SunaContext/*.md` | **SUNA**. Overwritten on every update; nobody edits it |
| 3 | `<project>/context/{PROJECT,MEMORY,RULES,PEER-REVIEW}.md` | co-owned; `MEMORY.md` is the agent's |

`AGENTS.md` and `CLAUDE.md` are written with **identical bytes**, so Codex and Claude Code read
the same pointer. They are managed only while line 1 carries the `suna:agent-stub` marker; a user
who deletes the marker owns the file. An unparseable `.mcp.json` is preserved as
`.mcp.json.invalid` and **never silently destroyed**, and other servers already in it survive.

Healing runs on app project-open and on MCP server boot, best-effort and fire-and-forget:
**whichever surface runs first wins, every write is idempotent, and a project must open even when
the agent layer cannot be written.** Nothing is scaffolded into a directory with no readable
`suna.json`.

The staleness rule is *gone, not different*: a baked invocation is stale only when its
`serverPath` no longer exists — otherwise a differing path would pin a broken config forever.

### 15.5 Literature and the machine library

`~/SunaConfig/library.json` holds the user's own library roots and download policy. It is not in
`userData` because the standalone MCP server has no `userData` and must read the same roots the
Settings pane wrote. Two invariants: roots stay portable (`~` expanded only at use time), and
**nothing in that module throws** — an unusable `library.json` is reported in the answer text and
the defaults are used.

The scan is Spotlight (`mdfind` via `execFile` with an argv array, no shell, 5 s timeout) plus a
bounded walk, then a byte-read of the top candidates. Ranking lives in `@suna/bib` so the desktop
app and the standalone server rank the same files the same way.

**Reads leave the project; writes never do.** A PDF found on disk is **copied, never moved**, and
only strong evidence copies unasked — a lone "Smith 2020" in a filename names every Smith 2020
paper, so a weak match is *named as a candidate* and the ladder moves on; only a path the scan
itself reported can later be accepted. **Ambiguity writes nothing**: when a mention does not
identify one work, no bib entry and no PDF are written, and the alternatives come back with their
DOIs.

### 15.6 Agent CLIs

The palette's `?` prefix, directed AI actions, and the figure loop all spawn an agent CLI
(`claude` or `codex`) in the project directory, with a 180 s timeout and cancellation. Two
measured facts the design rests on: headless `claude -p` has **no MCP and no write tools** unless
`--mcp-config` and `--allowed-tools` are passed explicitly; and `claude -p` reads its prompt from
**stdin** when given no positional prompt, which is how prompts avoid both the argv length limit
and appearing in `ps`. Codex asks run `--sandbox read-only`, so directed *edit* actions never
target codex.

Model tier and reasoning effort resolve from `~/.suna/config.yml` **in main**, so a hand-edited
config reaches the spawn without renderer help; a per-task choice from the caller beats it.

---

## 16. The Python companions

### 16.1 `suna_mpl` — the matplotlib companion

11 source files, ~1200 lines, `matplotlib>=3.8` its only dependency.

```python
save_svg(fig, path, *, autogid=True, editable_text=True, deterministic=True,
         manifest=True, rasterize_threshold=800, metadata=None)
autogid(fig) · set_size(fig, width, height_mm=None, ratio=0.618, profile='nature')
journal_rc(profile) · WONG_PALETTE · resolve_width_mm(width, profile)
build_manifest / write_manifest / verify_manifest / sidecar_path
autorasterize(fig, threshold)
```

* **Stable ids.** `autogid` walks the figure and assigns deterministic semantic names —
  `ax{i}`, `ax{i}.title`, `ax{i}.line.<slug>`, `ax{i}.legend`, `suptitle` — deduplicated with
  `-2`, `-3`. It **never clobbers an author-set `gid`**. The renderer parses exactly this grammar.
* **`svg.fonttype: none` is enforced at the export boundary**, not merely advertised: it is set
  both in `journal_rc()` and inside `save_svg`'s `rc_context`, so it holds even if the caller
  never used `journal_rc`. Without it matplotlib converts text to paths and the canvas cannot
  edit it. Tested.
* **Determinism**: `svg.hashsalt` pinned to `"suna"` and `Date` metadata stripped, so repeated
  exports are byte-identical — which is what makes `figure.svg` diffable in git.
* **Auto-rasterization** above 800 primitives per artist: dense data layers export as one embedded
  `<image>` while axes and text stay vector, preserving canvas editability. Dense scatter is
  matplotlib's problem, not the canvas's.
* Width presets in mm per profile (`nature`: 89 / 136 / 183; `science`: 90 / 138 / 183).

**`suna_mpl` is never invoked by the app.** It is a library the *author's* figure scripts import;
the app never calls it and there is no "run script" button anywhere — a figure is regenerated by
the author, in a shell.

**It is not on PyPI, and it is staged into the packaged app.** Those two facts are one mechanism.
Because `pip install suna-mpl` rescues nobody, the only copy of the library is the one SUNA ships,
and `scripts/packaging/stage-resources.mjs` therefore stages `pyproject.toml` and `src/` into
`Contents/Resources/python/suna_mpl` — exactly what `uv run --with <dir>` needs, and not `tests/`
or `examples/`, which are the library's own development, nor `uv.lock`, which `--with` never
consults.

That copy is in a different absolute place in the two layouts, so a script cannot name it with a
relative path: `../../python/suna_mpl` is right in a source checkout and wrong in an installed app
(and wrong again in the *copy* of the example that "Open example" takes into user-data). The
resolution is `sunaMplProjectPath()` in `apps/desktop/src/main/services/suna-mpl.ts`, which carries
both branches as §19 requires and returns null when neither has a `pyproject.toml`; `terminal.ts`
exports its result as **`SUNA_MPL`** into every pty SUNA opens. Scripts are written

```bash
uv run --no-project --with "${SUNA_MPL:-../../python/suna_mpl}" python figures/<id>/source/plot.py
```

which resolves in SUNA's terminal under either layout and still works in a checkout shell SUNA
never launched.

**`--with`, not `--project`, and that is not a style preference.** `--project <dir>` makes the
staged directory uv's project root, and uv's first act is to create `<dir>/.venv` — inside
`Contents/Resources`, which is read-only in an installed app. It fails with
`Permission denied (os error 13)`, and on the day it did not it would be writing into a signed
bundle. `--with <dir>` builds the wheel and caches the resolved environment under `~/.cache/uv`,
writing nothing into the app. This was measured against a `chmod -R a-w` copy of the staged tree
before the packaging change was written (D13), and the figure it produced was byte-identical to
the committed `figures/timesheet/figure.svg`.

**`uv` itself remains the user's to install** — SUNA bundles no Python interpreter and no
matplotlib, and says so rather than pretending otherwise.

### 16.2 `suna_kernel` — the notebook kernel bridge

One file, `bridge.py`. It drives `jupyter_client.manager.KernelManager` — a **real Jupyter
kernel**, so any language with a kernelspec works.

Python is in the loop for one stated reason: speaking the Jupyter ZMQ wire protocol from Electron
would require a native `zeromq` addon compiled against the exact Electron ABI, rebuilt on every
Electron bump across a platform matrix, for an optional feature. `jupyter_client` already does it.

* **Protocol**: newline-delimited JSON over plain stdin/stdout. Requests
  `{id, op: execute|interrupt|restart|shutdown, code}`; events `ready status input output clear
  reply fatal exit`. **stdout carries protocol and nothing else**; human-facing text goes to
  stderr.
* **Zero translation**: an iopub message's `content` *is* an nbformat output once `output_type` is
  added, so the live kernel and the `.ipynb` need no translation layer. The renderer stores what
  the kernel said, verbatim.
* **Attribution**: each `execute_request` maps to the cell that asked. Output with no attributable
  parent is **dropped deliberately**, rather than pinned to whichever cell ran last.
* One kernel per open notebook; `allow_stdin=False`; failures are `fatal` events with actionable
  codes (`no-jupyter-client`, `no-kernelspec`, `start-failed`, `op-failed`), each naming its
  remedy. A remedy names **`sys.executable`**, not a bare `pip install ipykernel`: SUNA picked the
  interpreter, so telling a user with several of them to "run pip" is advice they cannot act on
  without first guessing which pip.
* It **does** ship in the packaged app (`stage-resources.mjs`).

**`ipykernel` is offered, never assumed.** The bridge needs `jupyter_client` (and a kernelspec) in
the *project's selected interpreter*, and there is nowhere to stage that into — which is why this
was open as ROADMAP item 5 for as long as it was. It is closed by one primitive with two asking
callers, not by packaging:

* `installKernelRuntime(envPath)` (`main/services/envs.ts`) — `uv pip install ipykernel` with a
  `python -m pip` fallback, guarded by a `probe` on both sides. The **trailing** probe is the
  load-bearing half: a pip that reports success into a different interpreter must not be reported
  as a working kernel, so the claim is *importable*, never *installed*. It never throws; every
  failure comes back as a message naming the exact command to run by hand.
* One channel, `env:install-kernel` (§5.2). Its two callers are the onboarding wizard's env
  sub-step and the notebook's own "no kernel" panel.

Both callers **ask first** (D5), and the wizard's default differs by branch because the branches
are not equivalent: on for "create with uv", where the environment is one SUNA is about to create;
**off** for an existing detected environment, which is the user's and may be shared with other
projects (D9). "Skip" is offered nothing, because there is no environment to install into, and the
step says that rather than showing an inert checkbox. A failed install is a wizard *warning*, never
an error on the env row — the environment does exist, and creation is never blocked on a step that
needs a network.

The notebook's fault panel is **not redundant** with the wizard: the interpreter is a per-project
pick changeable at any time from the status bar, projects also arrive by clone and by DOCX import,
and an install can fail on a machine with no network. So the kernel path degrades on its own terms
rather than assuming onboarding ran — it offers the same one-click repair against whichever
interpreter is selected *now*, and where it cannot repair (no env selected, no network, a read-only
interpreter) it says so and names the command.

**There is no sandbox.** This is a plain child process running arbitrary user code under the
project's own interpreter with full user privileges. The only containment is
`assertInsideAllowedRoot` on the working directory. This file says *user-trust execution*, and
nothing in the product may call it a sandbox.

### 16.3 `@suna/notebook` — the .ipynb model

> The `.ipynb` on disk **is** the document. A notebook SUNA opens and saves untouched must produce
> an empty git diff, or every notebook in a repository becomes a merge conflict the moment two
> tools disagree about whitespace.

Three conventions, all read off nbformat rather than guessed:

1. `JSON.stringify(sortKeysDeep(nb), null, 1)` plus one trailing newline — exactly Python's
   `indent=1, sort_keys=True, ensure_ascii=False`.
2. Multi-line strings are stored as **lists of lines** on disk and rejoined in memory;
   `joinLines`/`splitLines` reimplement `str.splitlines(True)` exactly. `SPLIT_MIMES` is
   `image/svg+xml`, `application/javascript` and `text/*` — **notably not `image/png`**: a base64
   blob stays one long string, so anything that "helpfully" splits it rewrites every notebook that
   has a figure in it.
3. **Unknown keys are never dropped.** Every interface carries an index signature and objects are
   mutated rather than rebuilt. Throwing them away on save is data loss.

Running a cell needs a kernel, and a kernel needs `ipykernel` in the project's selected
interpreter — which SUNA now offers to install rather than assuming (§16.2 has the mechanism and
who asks). The model half is unaffected either way: a notebook whose kernel never starts still
opens, still edits and still round-trips byte-identically, because the `.ipynb` is the document and
the kernel is only what executes it.

Cell ids are minted only when the format version actually has them (`nbformat > 4 ||
nbformat_minor >= 5`) — a v4.4 file that gains ids on save is a file every other tool then
re-diffs. An unknown cell type is coerced to `raw`, not rejected, so the file still opens and
still round-trips.

---

## 17. The renderer shell

### 17.1 The dock

`shell/dock/DockHost.tsx` is the only importer of dockview-core. Each panel is an
`IContentRenderer` owning a `div` into which one React root is mounted; disposal nulls the root
and unmounts in a `queueMicrotask`, because dockview can dispose synchronously mid-React-render.

**Panels render once, from `parameters.params`.** There is no re-render on update: a parameter
change goes through `api.updateParameters` + `onDidParametersChange`, or the panel is closed and
re-added. That is a sharp edge and it is stated here rather than rediscovered.

`DOCK_COMPONENTS` (in `App.tsx`) is the authoritative list of panel kinds — 22 today: `welcome`
`editor` `canvas` `dataview` `notebook` `manuscript` `letter` `supplement` `round` `version`
`compare` `review-import` `onboarding` `docx-import` `export` `settings` `trash` `reading-notes`
`pdf` `image` `html` `docx`. Panel-id conventions: a file tab's id **is its absolute path**;
others are `manuscript:<root>`, `document:<root>:<id>`, `round:<root>:<id>`,
`version:<root>:<id>`, `compare:<root>:<base>:<head>`, `export:<root>`. `welcome` and `settings`
are singletons.

The sidebar is separate: `SIDEBAR_VIEWS = explorer | manuscript | figures | references | git |
agent`. Compliance is a section inside the `export` panel. The terminal is a sibling of the dock,
not a panel in it.

**There is no dock-layout persistence.** Every launch opens the welcome panel. Only sidebar and
rail geometry persist, in `localStorage`. This is a gap, not a decision (§20.7).

### 17.2 State

**zustand only** — no React context anywhere in `renderer/src`. Around 25 stores, deliberately not
one document store:

* `documents` — registry metadata, read through from disk;
* `docSessions` — the text buffer, **one per absolute path** however many surfaces show it. The
  store holds only per-path metadata; the CodeMirror `Text` and its attached views live in a
  module-level map outside zustand;
* `manuscriptDoc` — derived outline and shared tab↔sidebar state.

Reconciliation with disk is §5.5. Autosave idles at 1 s, saves serialize through a chain so `:w`
racing ⌘S cannot land out of order, and autosave is blocked while a session is diverged.

### 17.3 The editor

CodeMirror 6 with `Compartment`-based reconfiguration and an optional vim keymap. **SciMark is
rendered by in-editor decorations, not a split preview pane** — a `ViewPlugin` plus a
`StateField<DecorationSet>` of widgets, driven by `parseSciMark` for block and AST-positioned
spans, with KaTeX for math and live figure SVGs inlined at their embeds.

The manuscript tab composes a rendered title page, **one** live-preview editor over the whole of
`manuscript.md`, and a profile-driven reference block, in a single scroll container with
offset-keyed scroll-spy against the derived outline. Three view modes cycle with ⌘E:
`source → reading → pages` (§13).

Rules the editor surface must keep:

1. **Live preview is decoration only. The file bytes never change from any of it**, and turning
   the mode off shows the Markdown verbatim. Escapes (`\*not emphasis\*`) and anything inside code
   fences are excluded, and ordered-list numbers stay literal because they carry meaning.
2. **This is Markdown, not a word processor.** Bold toggles `**…**`; applying it to already-bold
   text removes the markers. Every formatting command is a single CodeMirror transaction, so ⌘Z
   reverts the whole action.
3. **Content kind decides layout.** *Prose* obeys the measure setting; in source view it
   left-aligns against the line-number gutter and never floats away from it. *Code and data* never
   take the measure, never soft-wrap, scroll horizontally, and stay monospace. **One measure for
   the whole document** — the title page, the editor and the references block share it.
4. **An unresolvable id keeps its raw text with a warning style — never a silent blank.**
5. **Unanchored comments collect in their own group at the top of the rail, never lost**, and
   cards never overlap.

Known rough edges, recorded rather than implied away: `⌘K` is split by selection between *insert
link* and the command palette, so inserting an empty link from the keyboard is no longer possible
(if either ever needs the key unconditionally, the other has to move); the manuscript tab's dirty
dot is set by any edit and cleared only by a save, so undoing back to the on-disk text still shows
modified; `toggleWrap` matches delimiters as plain substrings rather than through the syntax tree,
so `*` and `**` are ambiguous where they overlap; the PDF tab resolves every page up front, so
open cost grows with page count and the 300-page case has never been measured; the layers panel
lists matplotlib's metadata and RDF nodes unfiltered.

### 17.4 Theming in the renderer

The generated stylesheet arrives whole on `config:changed` and is injected as one prepended
`<style>` element (§6.2 rule 5). The `ui:` block is applied separately as `:root` custom
properties — layout, never palette. `styles/tokens.css` carries three colour values and nothing
else: a first-paint ground before the generated sheet lands.

---

## 18. Testing

* **`pnpm typecheck` and `pnpm test` must pass workspace-wide before a commit.** 249 vitest
  files.
* **UI checks run against a hidden app.** `node scripts/e2e/drive.mjs --boot --example` boots one
  hidden window with an isolated `userData` and a relocated `SUNA_CONFIG_HOME` — *the user's real
  `~/.suna` must never be touched by a driven run* — then `--shot`, `--eval` and `run probe.mjs`
  iterate in seconds. `pnpm dev` is for humans only.
* **`pnpm smoke`** is 78 named end-to-end steps over CDP, hidden by default, filterable with
  `--only` / `--from` / `--until` / `--list`. Step names are the feature inventory. It runs to
  completion green (2026-09-01) and is a gate, not a document; a red step is either a stale
  selector or a regression, and **weakening one to make it pass is never the answer**.
* `scripts/e2e/probes/` holds focused drivers for areas the main suite does not cover. Some of
  them are not optional extras: **`pdf-export-bytes.mjs` is the only check anywhere that produces
  a real `.pdf` and inspects it** (§13), because `printToPDF` needs a live Electron process and
  no vitest file can have one. `node scripts/e2e/pdf-probes.mjs --only pdf-export-bytes.mjs`.
* Python: `cd python/suna_mpl && uv run pytest`.
* CI runs typecheck and tests on Linux and macOS for every PR, and additionally packages
  on macOS and launches the real bundle — **the packaged layout is the one thing `pnpm dev` can
  never exercise.**

The canvas carries the strongest test obligation in the repo, and it is a contract obligation:
round-trip byte-identity over real matplotlib exports, and apply → invert → redo → invert
byte-identity for every command (§10.2).

---

## 19. Packaging and release

Short by design; the two existing documents are correct and are not duplicated here.

* **What goes inside the bundle: `docs/PACKAGING.md`.** `electron-builder`, configured by
  `apps/desktop/electron-builder.yml`, with the one conditional it cannot express — whether a
  signing certificate is present — in `scripts/electron-builder.sh`, which every packaging path
  goes through. `scripts/packaging/stage-resources.mjs` stages the four things main resolves
  from `process.resourcesPath`: `examples/hello-suna`, the MCP bundle plus a flattened
  `node_modules` for its two external dependencies, `python/suna_kernel`, and `python/suna_mpl`
  (its `pyproject.toml`, `uv.lock` and `src/` only — §16.1).
* **Cutting a release, and the macOS signing and notarization rules: `docs/RELEASING.md`.**

One invariant belongs here rather than there: **anything main resolves from `process.resourcesPath`
must be staged, and anything staged must have a dev-path counterpart in the same function.** Today
that is four resolvers — the example project (`ipc.ts`), `mcp/server.mjs` (`agentLayer.ts`),
`python/suna_kernel/bridge.py` (`kernel.ts`), and `python/suna_mpl` (`suna-mpl.ts`).

---

## 20. Where the code and the documents disagree

This section is normative: where a design document contradicts what is written below, the code —
and this file — win. Every item was verified by reading source.

**20.1 There is no LaTeX and no Tectonic.** The design note this file replaced described a LaTeX
emitter and a Tectonic PDF path, and `@suna/formatter`'s package description repeated the claim
until it was removed. Neither exists. `@suna/markdown` has one emitter (HTML); `@suna/formatter` contains no
formatting at all — it is a profile loader plus four compliance checkers; PDF is Chromium
`printToPDF` and DOCX is the `docx` library, both in main (§13). SciMark's ` ```{=latex} ` escape
hatch parses to a node that renders as an HTML comment.

**20.2 The provenance loop does not exist.** The design record specified
generate → edit-as-overlay → regenerate-with-replay → absorb-into-code (§11.4 carries its rules
and its mechanics). `packages/provenance` is
`export {}`; no code writes an overlay op; there is no replay; `absorb_overlay` is not a verb
(§11.3).

**20.3 The canvas command bus is not the agent's bus — yet.** The canvas engine specification gave
the agent three tool surfaces: `canvas_query(figureId, query)` reading `{kind:'tree', depth}` /
`{kind:'element', id}` / `{kind:'selection'}`, `canvas_dispatch(figureId, command)` taking the same
`CanvasCommand` union through the same validation and the same history so an agent edit is
undoable by the human, and `canvas_screenshot(figureId)` returning a raster for visual
verification — with agent dispatches auto-labelled `agent: …` in history so the UI can show and
revert them as a group. **None of the three exists**; the agent's figure surface is read-only by
design (§10.4). If they are ever built, the auto-label is the part not to skip.

**20.4 "Colours are not in any stylesheet" is substantially, not completely, true.** Zero colour
literals in `.tsx`. In CSS the violations are real and clustered: a link blue `#8ab4d8` at three
sites with no token behind it; the export panel's severity colours (`#6bbf7a` / `#e5484d` /
`#e5a53d`) at five sites where `--s-ok` / `--s-warn` / `--s-err` already exist and are used
elsewhere; three ANSI-ish notebook colours with no `var()` fallback where their neighbours have
one; and roughly nine alpha-variants of the accent and danger hues re-spelled as raw `rgba`
instead of `color-mix(in srgb, var(--s-accent) …)`, which one file already demonstrates. Shadows,
scrims, paper-white document surfaces and the PDF annotation palette (which is Zotero-compatible
data written into the file, not chrome) are legitimately outside the theme. Separately,
`export-style.ts` keeps a **second copy** of every theme's palette in main, hand-synced, because
the main process cannot read the renderer's stylesheet — that is documented in the source but it
is still a second source of truth.

**20.5 Older documents describe a manuscript layout two generations old.** There
is no `manuscript/sections/*.md`; there is one `manuscript.md`. `references.bib` lives in
`manuscript/`, not at the project root. `authors.json`, `comments.json`, `revisions.json`,
`letters/`, `archive/`, `rounds/`, `context/`, `references/notes/` and `.suna/` are all real and
undocumented there.

**20.6 Both halves are resolved; what remains is that Python itself is the user's.** `suna_mpl` used not to be
staged into the bundle, so the packaged example shipped a `plot.py` that did `import suna_mpl`
while the library it imports did not ship at all, and — not being on PyPI — could not be installed
either. It is now staged (`python/suna_mpl`: `pyproject.toml`, `uv.lock`, `src/`) and located
through `$SUNA_MPL`, which SUNA's terminal exports from `sunaMplProjectPath()`; §16.1 has the
mechanism. Two corrections to what this item used to claim: `starter-scaffold.ts` writes no
`plot.py` at all — it writes a *code fence* into the starter Methods prose, illustrative rather
than runnable — and the script that actually shipped broken was the bundled example's
`figures/timesheet/source/plot.py`. The residual limit is honest and unfixed: **`uv` is the
user's to install.** SUNA bundles no Python interpreter, so a machine without `uv` still cannot
regenerate a figure, and the docs say so.

**The notebook half is now resolved too, and not by packaging.** The reasoning that kept it open
was correct and still is: the bridge runs under the *project's selected interpreter*, so there is
nowhere to stage `ipykernel` to. The fix is therefore in onboarding and in the kernel's own
startup path (§16.2), as one primitive — `installKernelRuntime` — behind one channel,
`env:install-kernel`, with two callers that both **ask first**: the wizard's env sub-step (checked
by default only for the env SUNA creates; off for an environment the user already owned) and the
notebook's "no kernel" panel, which repairs whichever interpreter is selected now. Proven end to
end by `scripts/e2e/probes/notebook-kernel-onboarding.mjs`, which drives the real wizard and
asserts a cell's *output text*.

**What is still open here is narrower and is the honest residue.** SUNA bundles no Python
interpreter and no `uv`, so both remain the user's to install: on a machine with neither, the
wizard's uv branch is offered disabled and a figure still cannot be regenerated. An install also
needs a **network**; where it fails — no network, no pip, a read-only or externally-managed
interpreter — nothing is silently swallowed. The wizard records a warning and the notebook panel
shows a message naming the interpreter and the exact command, because the one thing this item must
never become is a claim that it worked.

**20.7 Dock layout is not persisted.** Every launch opens the welcome panel. Session restore is a
gap, not a recorded decision.

**20.8 The compliance rule set is a fraction of the planned one.** The design pass specified 54
rules across four surfaces (CIT-001…014, FIG-001…019, MAN-001…015, EXP-001…006 — an earlier count
of "55" miscounted the export surface as seven) and a `{value, notStated, note}` field wrapper
under `figureRules` / `manuscriptRules`. **The 41 unbuilt rules are inventoried at the end of
§12.1**, with the profile field each would read, so the sourcing survives the plan. The shipped
schema is `schemaVersion: 3` with
flat `figures` / `manuscript` sections and per-section `provenance[]`; 26 rules are implemented,
with no `CIT-*` bibliography surface at all, and the `export` and `package` diagnostic surfaces
are declared but emitted by nothing.

**20.9 The reference-paper analysis is documentation only — but it is the measurement record, and
that half is worth keeping.** A structured analysis of four published papers (3× *Nature Astronomy*
Articles 2026, 1× *Nature Physics* Review 2017) produced a profile model with page geometry,
typography tokens, page templates and folio models. **All of that was descoped by DECISIONS
2026-08-13** — SUNA does not typeset, profiles encode author guidelines and never a publisher's
page design — and nothing in the profile schema consumes any of it. The same ADR descoped the
note's ranked canvas capability list (V1/V2/V3): figures come from matplotlib, and the canvas
adjusts, annotates and checks them.

What survives is the **corpus and its tallies**, because they are the only record of what a real
journal figure actually contains and they are what any future figure-capability argument has to
argue against. Across **24 figure objects, 4 native tables and 2 author-pre-typeset tables, 128+
individual panels**: multi-panel 17/24, embedding raster imagery 10/24, requiring log axes 14/24,
carrying shaded bands or confidence regions 15/24, and **every** figure requiring math-capable
text (Greek, multi-level sub/superscripts, overbars, ×10ⁿ, unit exponents) somewhere — in axis
titles, tick labels, legends, annotations or colorbar titles. Math text, not drawing tools, is the
single most pervasive requirement, and it is the reason the canvas is an *adjustment* surface over
matplotlib output rather than a chart authoring engine.

Two micro-formats from the same corpus are real, sourced constraints rather than design taste, and
they belong to whatever renders captions: **every caption is bold label + bold title fragment +
roman body, with bold lowercase panel letters inline** — compound and ranged forms all observed
(`a,` `b,c`, `a–f`, `a(i)`, `a1–a4`, and parenthesized `(a)` in Extended Data) — and the label word
itself is per-journal (`Fig. N |` for Nature Astronomy, `Figure N |` for Nature Physics), which is
why it is a profile string and not a constant. Figure widths in the corpus cluster at ~88–89 mm
single-column and ~180–183 mm double-column, consistent with the guideline-sourced
`widthPresetsMm` the profiles actually ship; the corpus corroborates those numbers but is not
their source (`resources/profiles/sources/` is). The raw analyses are
`resources/profiles/sources/reference-analyses.json`.

**20.10 The provider layer is not what §8 of the design document describes.** There is no
`stream()` returning `AsyncIterable<AgentEvent>`, no tool registry executed app-side, no
permission-gated tool classes, and no inline ghost suggestions. There are three non-streaming
`chat()` adapters (§15.1) and a separate MCP server (§15.2). Keys are in `safeStorage`, which the
document gets right.

**20.11 Two machine-level directories exist, not one.** `~/.suna` (settings and themes,
`SUNA_CONFIG_HOME`) and `~/SunaConfig` (agent context and `library.json`, `SUNA_CONFIG_DIR`). The
shipped `resources/suna-context/README.md` describes `~/SunaConfig` as though it were the only
one. `docs/CONFIGURATION.md` used to describe `~/.suna` the same way and now names the other
directory explicitly; the shipped context README is the remaining half of this (§6.3).

**20.12 Areas that are designed in detail and not built.** The sponsor-package model and its
rendered-page measurement (DECISIONS 2026-08-19) exist only as schema (§4.2). The round **freeze** is
specified as an annotated git tag plus a snapshot, and `FreezeSchema` is in `@suna/core` — but
there is no `git:tag` channel among the 153, so the tagging half has no transport; treat
`Freeze.tag` as reserved rather than produced. Collaboration (§22) has no code at all. The reply
markup (`::quote` / `+++`), the response check and the response export **do** exist
(`reply-markup.ts`, `check/response.ts`, `export:response`), so the reply half of the review loop
is real; what is not built is the further step where a `::quote{id=…}` resolves through the
anchor locator at format time, so today a red mark is *authored intent* rather than a derived
diff — which has the honest property that nothing silently changes colour behind the author's
back.

**20.13 Small divergences worth naming.** `resources/suna-context/README.md` says "the 23 MCP
verbs" in its reading map while `MCP.md` in the same directory correctly says 34.
`packages/core`'s `EDITOR_VIEW_MODES` is `['source','reading']` while the renderer's `DocViewMode`
has three members including `pages`. The `preview.profileId` / `editor.theme` naming divergence
recorded here is **resolved**: those are the YAML paths, the registry key ids are
`previewProfileId` and `editor.editorTheme`, and `docs/CONFIGURATION.md` now states the
distinction instead of only spelling the paths. The registry key id and the YAML path being
allowed to differ at all is the residual sharp edge.

---

## 21. Conventions

* TypeScript strict everywhere; no `any` in a public API. Every package exposes its surface from
  one `index.ts`.
* zod schemas live in `@suna/core` when more than one package or both IPC edges need them.
* Comments in this codebase are unusually load-bearing: where a rule exists because a naive
  approach failed, the failure is written down next to the code. **Keep doing that** — most of
  this file was recovered from those comments, and every one of them that is a rule rather than a
  note belongs here too.
* A new setting is one entry in `SETTING_KEYS`. A new themeable colour is one entry in the token
  registry. A new IPC channel is one entry in `CHANNELS`. If any of those takes more than one
  edit, the abstraction has broken and that is a bug.
* Every feature lands with tests; a rendering or export feature lands with a byte-level assertion,
  because a screenshot proves nothing an agent can check.
* **Verified means tested by unit suites *and* driven in the real app.** Anything claimed as
  working that has only unit coverage says so.
* **Adding an MCP verb is not done until the shipped docs say so.** The doc-drift gate compares
  `MCP.md`'s verb table against the `TOOLS` registry as *sorted arrays* (a set comparison waved a
  duplicated row through, and a table listing one verb twice reads to an agent as two verbs), and
  compares each row's input names *including their `?` markers* — because an input the docs omit
  is an input no agent will ever send. The generated context module must be byte-identical to a
  fresh regeneration, and no source doc may contain a machine path.

---

## 22. Collaboration — the settled position

Nothing in this section is built. It is here because the *rejections* are decisions, and a future
attempt should not have to rediscover them.

**Two tiers, in order.**

* **Tier 1 — git.** The GitHub repository *is* the access-control list: whoever GitHub says is a
  collaborator. **No SUNA accounts, no user table, no invite tokens of our own.** Tier 1 is not a
  stepping stone that gets thrown away — it stays the durable layer under everything, because live
  sessions are ephemeral and **git is what persists**. `admin` is deliberately not offered as an
  invite permission: transferring control of a repository is something to do on github.com,
  deliberately, not from a dropdown in a writing app.
* **Tier 2 — live text over a relay**, prose only (`manuscript.md`, `supplementary.md`, letter
  bodies, and comments). **Never figures, never `.bib`, never `manuscript.json`.** The relay is
  memory-only and stateless: losing it loses a session, not work. It must be self-hostable and
  **optional** — with no relay configured the app is exactly what it is today.

**Live figure co-editing is out of scope permanently.** Not "later". This clause is what keeps the
whole feature affordable, and it is recorded as a decision rather than an omission.

**CRDTs (Yjs, Automerge) are rejected**, for three reasons in ascending importance:

1. They require a parallel document model — a `Y.Text` that is the real document while the file is
   a projection of it. **That is exactly the shape D11 forbids for the SVG DOM, and the reasoning
   does not stop being true for prose.**
2. CRDT merge is character-level and unconditional. Two people who rewrite the same sentence
   offline get a mechanically valid *interleaving of both rewrites*, which is not a sentence. **A
   git conflict is uglier and correct.** SUNA has already been burned by the softer version of
   this: word-grain conflict detection merged a human's "inside-out" with an agent's "from the
   outside in" into "from the inside out" — text neither party wrote (§5.5).
3. Durability moves into the CRDT and the file stops being the truth. That is the whole
   architecture inverted to buy offline co-editing, which git already covers with better output.

Also rejected: a hosted-documents model ("a different product, and it deletes the property that
makes SUNA worth using"); serverless hosting (long-lived sockets and per-session memory are
exactly what it does not have); and host-peer authority (the session dies when the owner closes
their laptop, and the guest has been editing the owner's files while their own clone sat unchanged
underneath them).

**Accepted cost, stated plainly:** a co-author who is not connected cannot participate in a live
session; their work arrives as a reviewable diff. That is the intended answer, not a gap. And:
operating a relay means operating a service, which is new for this project.

The reason this is weeks rather than a rewrite is one observation: the sync core is already
transport-free, and its per-view pending queue — written so an IME-composing view can defer remote
changes — means **a network peer is just a view that lags.**

---

## 23. In-app updates

`apps/desktop/src/main/services/updater.ts`, five IPC verbs, one event channel, and a section in
Settings → About. Built on `electron-updater` against the GitHub Releases the `release.yml`
workflow publishes (§19), which is why `apps/desktop/electron-builder.yml` carries a `publish:`
block: it does not publish anything — `scripts/electron-builder.sh` hard-codes `--publish never` —
but it embeds `app-update.yml` (provider, owner, repo) into the packaged app and makes
electron-builder write the `latest-mac.yml` / `latest-linux.yml` feeds the workflow attaches.

**Main owns the network and the installer; the renderer sees small JSON.** The whole
renderer-visible state is `UpdateStatus` (`packages/core/src/ipc.ts`): a phase, the running
version, the available one, plain-text notes, a `received`/`total` pair, an error and the mode.
No bytes cross the bridge, and nothing installs without an `update:install` call carrying a click.

**Three postures, decided once per launch by `updateMode()` — from facts, never from preference.**

| Mode | When | What it may do |
|---|---|---|
| `inplace` | packaged macOS, or a Linux AppImage launch (`APPIMAGE` is set) | check, download, restart into the update |
| `notify` | a packaged Linux `.deb` / `.tar.gz` | check the same `latest-linux.yml` feed and offer the Releases page — the package manager owns the install |
| `off` | a dev tree (`!app.isPackaged`) or a driven run (`SUNA_HIDDEN=1`) | nothing, and it says so rather than pretending to check |

`updates.checkOnLaunch` (config.yml, default on) gates only the AUTOMATIC check, six seconds after
first paint. It is re-read when that timer fires, not at boot, and the check is skipped if the user
has meanwhile started one by hand. A user who switches it off can still press **Check now** —
asking is the user reaching the network, not the app doing it.

**The rules that make this a feature rather than a nuisance:**

1. **Nothing downloads without a click** (`autoDownload = false`), and nothing installs before an
   artifact has landed. `autoInstallOnAppQuit` is on, so a downloaded update the user postponed
   lands on the next quit — the least surprising meaning of having pressed Download.
2. **A skip answers a version, not the question.** `updates.skippedVersion` in `settings.json`
   (machine state — §6.2) silences the *launch* check for exactly that version; a newer release
   announces itself again, and a manual check clears the skip, because asking again is un-skipping.
3. **Release notes are reduced to plain text** before they reach the renderer. The GitHub provider
   returns the release body as HTML, and nothing renderer-side interprets markup off the network.
4. **A check never runs over a download.** A `checking` push would blank the progress the user is
   watching, and nothing a check could learn beats the artifact already arriving.
5. **Deliberately not a signing check.** A packaged-but-unsigned contributor build is `inplace` and
   will check; on macOS Squirrel then refuses the swap, which surfaces as an honest `error` phase
   rather than a silent no-op.

The version shown in Settings → About is `app.getVersion()`, arriving on every status — never a
string typed into the renderer, which is how it went stale before this section existed.

`electron-updater` is reached by dynamic `import()` on first use, so `updater.test.ts` injects an
`UpdaterImpl` and the suite never loads it and never touches the network. `pnpm smoke --only
settings-updates` asserts the `off` posture end to end: the page says this build cannot update
itself, offers no button that could only fail, and shows the real version.
