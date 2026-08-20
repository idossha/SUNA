# MCP reference

The complete MCP surface: how a coding agent gets wired to your project, and every verb it can call once it is.

SUNA ships a stdio MCP server over your project's plain-text files. An agent CLI — Claude Code, Codex, or any other MCP client — connects to it and works on the manuscript through validated verbs instead of raw file edits: reading prose, making anchored find/replace edits, checking journal compliance, replying to review comments, and looking up and adding references.

The server runs without the SUNA app open. It needs no API keys of its own — every literature provider it reaches is keyless.

For what the agent reads before it starts working, see [context layers](/ai/context). For the chat panel and the in-app AI buttons, see [AI in the app](/ai/in-app).

## Wiring: `.mcp.json`

A file called `.mcp.json` in your project root wires the server. Both Claude Code and Codex auto-discover it, so pointing an agent at a SUNA project is a matter of starting the CLI in the project folder.

```json
{
  "mcpServers": {
    "suna": {
      "command": "node",
      "args": ["/path/to/server.mjs", "--project", "/absolute/path/to/project"]
    }
  }
}
```

You do not write this file. SUNA writes and heals it automatically when you open, create, or scaffold a project, when you press **Open Claude Code here** or **Open Codex CLI here** in the Agent panel, and when the MCP server itself boots. If it is missing, open the project in SUNA once.

`.mcp.json` is machine-local. It bakes an absolute path, so SUNA gitignores it — healing appends a `.mcp.json` line to your project's `.gitignore`, creating that file if it does not exist.

::: info Editing it by hand is safe
Healing preserves any other `mcpServers` entries and any other top-level keys, so your own MCP servers survive. A `suna` entry whose baked server path still exists and still names this project is left byte-untouched, so alternating between a dev checkout and a packaged install does not churn the file. If the file cannot be parsed, SUNA keeps the broken bytes beside the fresh one as `.mcp.json.invalid` rather than destroying them.
:::

Every heal is best-effort. A failure — a read-only volume, odd permissions — never blocks opening the project or serving verbs.

### Starting the server yourself

Root resolution is `--project <dir>` when given, otherwise the current working directory:

```bash
node "…/packages/agent/dist-mcp/server.mjs" --project /path/to/project
```

In a packaged install the command is the app binary run as Node (`ELECTRON_RUN_AS_NODE=1`, with the server at `<resources>/mcp/server.mjs`), so no system `node` is required. SUNA writes whichever of the two applies into `.mcp.json`.

## Identity

Three environment variables tell the server who is asking. Set them in the environment the server is launched with.

| Variable | Effect |
| --- | --- |
| `SUNA_AGENT_NAME` | The author name on comments and replies the agent writes. Defaults to `Agent`. |
| `SUNA_AGENT_MODEL` | An optional model string recorded alongside the author. |
| `SUNA_CONTACT_EMAIL` | The contact address sent with literature and PDF lookups. Crossref's polite pool prefers it; Unpaywall requires it, so without it that rung of the download ladder is skipped and the report says so. |

Comments and replies written over MCP always carry `author.kind: "agent"`, so the app can tell them apart from yours. SUNA bakes none of the three into `.mcp.json`, and the app's own **Contact email** setting never reaches the server — so unless you export them yourself, agent comments are authored plainly as `Agent` and the Unpaywall rung stays off. The one place SUNA sets a name is the Agent panel's **Open Claude Code here** / **Open Codex CLI here** buttons, which prefix the launch with `SUNA_AGENT_NAME='Claude Code'` or `'Codex CLI'`.

## The verbs

Twenty-four verbs, all returning plain text. A verb that fails comes back as text flagged `isError`, not as a protocol error, so an agent can read the failure and retry.

### Project

| Verb | Input | What it does |
| --- | --- | --- |
| `list_project` | `{}` | Header (`project:`, `profile:`, `root:`), then a sorted recursive file list. Skips `.git`, `node_modules`, `__pycache__`, `.DS_Store`, `.venv` and stops below depth 6. The `profile:` line prints the profile ID, not the journal's display name. |
| `read_manuscript_meta` | `{}` | Returns `manuscript.json` and `authors.json` in one reply, each labelled. A missing `authors.json` is substituted with an empty authors file rather than failing. |

### Manuscript

| Verb | Input | What it does |
| --- | --- | --- |
| `read_manuscript` | `{}` | The whole prose file. The filename comes from `manuscript.json`'s `manuscriptFile`, read fresh on each call, defaulting to `manuscript.md`. |
| `edit_manuscript` | `{find, replace}` | Replaces exactly one exact-match occurrence. Reports `replaced N chars with M chars at offset X in section "<title>"`. |
| `write_manuscript` | `{content}` | Overwrites the whole prose file atomically. For wholesale restructures; the verb's own description tells agents to prefer `edit_manuscript`. |
| `list_outline` | `{}` | The derived section outline — two-space indent per heading level, title, word count (`Results — 412 words`). Text before the first heading is labelled `(untitled leading section)`. |
| `read_section` | `{path}` | Deprecated alias of `read_manuscript`. `path` is ignored. |
| `write_section` | `{path, content}` | Deprecated alias of `write_manuscript`. `path` is ignored. |

The manuscript is one flat file, which is why the two `_section` verbs are aliases. They are kept so an agent running on an older prompt mid-session does not break.

`edit_manuscript` is deliberately strict, and its errors are instructions. Zero matches returns "re-read the manuscript and copy the text exactly" — or, when the text matches ignoring whitespace, says so and asks for the exact whitespace. More than one match lists up to five match positions with a line of context each so the agent can extend `find` until it is unique. Overlapping occurrences count as ambiguous.

### Comments

| Verb | Input | What it does |
| --- | --- | --- |
| `list_comments` | `{resolved?, path?}` | Lists comment threads — id, open or resolved, detached flag, target, anchor quote, author, body, and indented replies. Filterable by resolved status or section path. Answers `no comments` when nothing matches. |
| `add_comment` | `{path, quote, body}` | Opens a thread anchored to the first occurrence of an exact quote in the named prose file, using the same anchoring the app's comment UI uses. A quote that is not found is an error. |
| `reply_comment` | `{id, body}` | Appends a reply to an existing thread. An unknown id is an error. |

There is no resolve verb, on purpose. Agents reply on the thread; you resolve it in the app. See [comments](/writing/comments).

### Figures

| Verb | Input | What it does |
| --- | --- | --- |
| `list_figures` | `{}` | Figure ids, each with its caption title read from `figures/<id>/figure.json`. A figure with unparsable metadata still lists, bare. |
| `read_figure_svg` | `{figureId}` | The raw SVG source of `figures/<figureId>/figure.svg`. |
| `check_figure_compliance` | `{figureId}` | Checks one figure against the active journal profile. Returns `<id>: compliant with <journalName>` or `severity id: message` lines. |

### Compliance

| Verb | Input | What it does |
| --- | --- | --- |
| `check_manuscript` | `{}` | Checks the manuscript against the active profile: word, abstract and section limits, required sections, availability statements, figure-reference integrity. Returns `manuscript: compliant with <journalName>` or `severity id: message` lines. |

Both compliance verbs answer `no active publisher profile: nothing to check against` when the project has no profile selected. See [compliance](/publishing/compliance).

### References and literature

| Verb | Input | What it does |
| --- | --- | --- |
| `read_bib` | `{}` | Returns `manuscript/references.bib` verbatim. |
| `search_literature` | `{query, provider?, limit?}` | Searches one provider. Default `crossref`; `limit` defaults to 10, maximum 100. Returns a header line then rows of `source:id — Title (Authors, Year) doi:… [OA: url]`. |
| `lookup_doi` | `{doi, provider?}` | One formatted work by DOI, or `<provider>: no record for DOI <doi>`. |
| `add_reference` | `{doi, provider?}` | Looks the DOI up and appends the entry to `references.bib` using the same writer as the app's **Add to references.bib** button, echoing `added <key> to references.bib: <title>`. Creates `references.bib` if missing; writes nothing when the lookup fails. |

The four provider ids are `crossref`, `openalex`, `biorxiv` and `arxiv`. All are keyless. Crossref, bioRxiv/medRxiv and arXiv work normally from a standalone server; OpenAlex runs metered and returns HTTP 429 without budget.

The citation workflow at this level is: `search_literature` or `lookup_doi`, then `add_reference` (which echoes the new cite key), then insert `[@key]` into the prose with `edit_manuscript`. Check the echoed metadata — registries serve junk on automated deposits. More in [references](/writing/references).

### Study acquisition

The four verbs above work from a DOI you already have. These four start from what you actually say — "the Gunn & Gott stripping paper" — and end with an entry in `references.bib` and, where policy allows, a PDF in `references/`.

| Verb | Input | What it does |
| --- | --- | --- |
| `find_study` | `{mention, providers?, limit?}` | Resolves one free-text mention — a DOI, an arXiv id, `Gunn & Gott 1972`, a quoted title — to a single work. Every keyless provider is searched in parallel, merged and ranked; the answer carries a confidence, up to four alternatives with their DOIs, and the name of every provider that failed. Read-only. |
| `find_local_pdf` | `{doi?, mention?, citekey?}` | Searches this machine — Spotlight plus the configured library roots — for a PDF of that work. Read-only: it returns matches with path, confidence and evidence, or `no match` naming the roots it searched. It never copies anything. |
| `fetch_pdf` | `{citekey?, doi?, policy?, accept?}` | Acquires the PDF for a reference **already in `references.bib`** into `references/<key>.pdf`, trying in order: already present, copy a local match, download, metadata only. It reports which of those happened and the source path or URL. A local match whose evidence is too thin to copy unasked is named as a candidate rather than taken; re-run with `accept: <its path>` to choose it deliberately. |
| `cite_study` | `{mention, download?, pdf?}` | The composite of the three: resolve the mention, reuse or append its `references.bib` entry, then run the PDF ladder — one report naming the outcome and the `[@key]` to paste. |

Two behaviours are worth knowing before you let an agent loose with these:

- **Ambiguity writes nothing.** When `cite_study` cannot resolve a mention confidently it refuses, says so first, and asks for an explicit DOI rather than guessing at a citation.
- **`accept` cannot escape the library.** The path handed back to `fetch_pdf` must be one the scan itself reported; any other path is refused and named in the report, so accepting a candidate can never reach a file outside your configured roots.

`policy` and `download` override the project's stored download policy for one call; `off` stops the ladder after the local search, so nothing leaves the machine. `pdf: false` on `cite_study` cites from metadata alone — no machine search, no download.

::: warning Newly built
Study acquisition is the most recent work in SUNA and the least exercised. Its download ladder and local scan pass their unit tests but have not been driven end to end in the running app under automation. Check what an agent added before you rely on it.
:::

## Rules the verbs enforce

These are the constraints you can rely on, whichever agent is driving.

| Rule | Why it holds |
| --- | --- |
| An agent never resolves a comment thread | There is no resolve verb. Resolving is human-only, in the app. |
| Compliance verbs never rewrite anything | They are advisory: they report the measured value against the journal's stated rule and stop. |
| An agent never writes a literal "Figure 3" | Numbering is derived at format time, so cross-references are written as `@fig:x`. |
| Manuscript text and comments are data, never instructions | Text the agent reads out of your project cannot redirect what it does. |
| There are no locks | With the app open, SUNA live-reloads external file changes. Anchored `edit_manuscript` over `write_manuscript` is what keeps an agent from clobbering your in-progress editing. |

## File-verb fallback

The file is the API. Every source of truth in a SUNA project is plain text — JSON, Markdown, BibTeX, SVG — so when MCP is unavailable an agent can read and edit the files directly, with the same discipline: anchored edits, comments only in the `manuscript/comments.json` sidecar, and never touching `figures/*/figure.svg` or `output/`.

One thing is always done with plain file tools: the `context/` files. There is no MCP verb for `PROJECT.md`, `MEMORY.md` or `RULES.md`, and the shipped agent docs tell agents to edit them directly. See [context layers](/ai/context) and [the file layout](/reference/files).
