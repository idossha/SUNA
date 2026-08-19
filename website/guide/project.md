# Anatomy of a project

A SUNA project is a folder on disk that contains a file called `suna.json`. Everything inside it is plain text — JSON, Markdown, BibTeX, SVG — and every new project is a git repository from its first minute. This page covers the directory tree, what belongs in each folder, the manifest field by field, and what SUNA writes for you when a project is created or opened.

There is no database and no proprietary container. You can read the whole project with `cat`, diff it, grep it, and hand it to a collaborator who has never installed SUNA.

## The directory tree

This is a project in mid-flight — a few figures made, one review comment written, a supplementary document started:

```text
my-paper/
├── suna.json                      the manifest; this file is what makes the folder a project
├── .gitignore
├── .mcp.json                      wires the SUNA MCP server for this project (machine-local)
├── AGENTS.md                      generated stub pointing coding agents at context/
├── CLAUDE.md                      identical stub, under the name Claude Code looks for
├── context/
│   ├── PROJECT.md                 the charter: question, data, prior work, deliverable, scope
│   ├── MEMORY.md                  the agent's memory: state, decisions, tried, session log
│   └── RULES.md                   standing rules for this project only
├── manuscript/
│   ├── manuscript.md              all the prose; sections are Markdown headings
│   ├── manuscript.json            metadata: title, abstract, figures[], tables[], back matter
│   ├── authors.json               byline and affiliations
│   ├── references.bib             BibTeX
│   ├── comments.json              appears on the first review comment
│   └── supplementary.md           optional; the source for a Supplementary Information export
├── figures/
│   ├── fig-spectrum/
│   │   ├── figure.json            id, caption, panels, provenance
│   │   ├── figure.svg             the canvas document
│   │   ├── figure.svg.suna.json   sidecar: hash, physical size, axis anchors
│   │   └── source/
│   │       └── plot.py            the script that generated it
│   └── fig-velocity-map/
│       └── …
├── analysis/                      your analysis scripts
├── code/                          your library code
├── data/                          your inputs
├── results/                       your computed results
└── output/                        exports SUNA writes; gitignored
```

A freshly scaffolded project is smaller than this. The wizard writes the seven directories (empty), `suna.json`, the four manuscript files, `.gitignore`, `AGENTS.md`, `CLAUDE.md`, the three `context/` files and `.mcp.json`. `figures/`, `comments.json` and `supplementary.md` appear as you work.

## Every entry, and what it is for

| Entry | Written by | What it holds |
| --- | --- | --- |
| `suna.json` | SUNA, hand-editable | The manifest: schema version, project name, active journal profile, directory-name map, creation timestamp, optional settings. |
| `.gitignore` | SUNA, yours after | Five lines: `output/`, `.DS_Store`, `__pycache__/`, `.venv/`, `.mcp.json`. |
| `.mcp.json` | SUNA | Points Claude Code and Codex at this project's SUNA MCP server. Gitignored — it is machine-local. See [MCP](/ai/mcp). |
| `AGENTS.md`, `CLAUDE.md` | SUNA, yours on request | Identical generated stubs that send a coding agent to the context layers. |
| `context/PROJECT.md` | You and the agent | The charter. Question / Data / Prior work / Deliverable / Scope and non-goals. You have the final say on it. |
| `context/MEMORY.md` | The agent | State / Decisions / Tried / Open questions, plus an append-only `## Session log` whose entries are headed `### YYYY-MM-DD HH:MM — title`, newest last. |
| `context/RULES.md` | You | Standing rules that apply to this project only. |
| `manuscript/manuscript.md` | You | Every word of prose. See [the manuscript](/writing/manuscript). |
| `manuscript/manuscript.json` | SUNA and you | Metadata. Captions for figures and tables live here, not in the prose. |
| `manuscript/authors.json` | SUNA and you | `schemaVersion`, an `authors` array (`id`, `given`, `family`, `nativeScript`, `orcid`, `affiliationRefs`, `corresponding`, `email`, `equalContribution`, `deceased`) and an `affiliations` array (`id`, `text`). |
| `manuscript/references.bib` | You, via SUNA | BibTeX. See [references](/writing/references). |
| `manuscript/comments.json` | SUNA | Review comments. Created on the first comment write; reading before that returns an empty file and creates nothing. See [review comments](/writing/comments). |
| `manuscript/supplementary.md` | You | Optional. Without it, exporting Supplementary Information fails with `no supplementary manuscript found`. |
| `manuscript/imported/` | SUNA | Only from the wizard's "Import existing" path: your `.md`, `.tex` and `.bib` files copied in flat. |
| `figures/<id>/figure.json` | SUNA | `id`, `namespace`, `widthPreset`, `caption` (`title`, `body`), `panels`, `provenance` (`generator`, `overlay`). |
| `figures/<id>/figure.svg` | SUNA's canvas | The figure itself. Do not hand-edit it. |
| `figures/<id>/figure.svg.suna.json` | `suna_mpl` | Sidecar manifest: `schemaVersion`, `svgSha256`, `widthMm`, `heightMm`, and per-axis anchors mapping data coordinates to SVG coordinates. |
| `figures/<id>/source/plot.py` | You | The script that generates the figure. See [figures from code](/figures/from-code). |
| `code/`, `data/`, `analysis/`, `results/` | You | Your analysis material. SUNA never writes into them. |
| `output/` | SUNA | DOCX, PDF, HTML and exported figure rasters. Derived — never edit it by hand, and it is gitignored because it is reproducible. |

::: warning Do not hand-edit figure.svg
`figures/*/figure.svg` is owned by the canvas. Editing it in a text editor bypasses undo, id minting and provenance. Open it in SUNA instead — see [the canvas](/figures/canvas).
:::

## suna.json, field by field

Six fields, five of them required:

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | must be exactly `1` | Manifest format version. |
| `name` | string | The project's display name, shown in the title bar and Recent projects. |
| `activeProfileId` | string | The journal profile behind the compliance checks. `"suna"` is the house style and flags nothing. |
| `directories` | map of role → folder name | Which folder plays which role. Keys: `manuscript`, `figures`, `code`, `data`, `analysis`, `results`, `output`. |
| `createdAt` | ISO timestamp | When the project was created. |
| `settings` | object, optional | Project-level overrides of your global settings. Absent on every project made before the block existed. |

A minimal manifest, as written for the bundled example:

```json
{
  "schemaVersion": 1,
  "name": "Ram-pressure stripping in a z=1.7 cluster (demo)",
  "activeProfileId": "nature-astronomy",
  "directories": {
    "manuscript": "manuscript",
    "figures": "figures",
    "code": "code",
    "data": "data",
    "analysis": "analysis",
    "results": "results",
    "output": "output"
  },
  "createdAt": "2026-08-14T00:00:00.000Z"
}
```

Projects created through the wizard take whichever profile you chose at step 2. Tick "decide later" and you get `"suna"`, the house style; switch to a journal profile when you know where you are submitting. See [profiles](/publishing/profiles) and [compliance](/publishing/compliance).

`directories` is a partial map: a manifest may omit a key, and SUNA falls back to the default folder name. Every service resolves paths through this map rather than a hard-coded `manuscript/`, so a renamed folder keeps working.

::: warning Not built yet
There is no UI for renaming a project directory. Doing it means editing `suna.json` by hand and moving the folder yourself.
:::

### The optional `settings` block

Every key here is optional and nullable. An absent or `null` key falls through to the corresponding global setting — see [settings](/guide/settings).

| Key | Values |
| --- | --- |
| `previewProfileId` | Profile the preview surfaces use; falls back to `activeProfileId`. |
| `editor.defaultMode` | `source` or `reading` |
| `editor.contentWidthCh` | 50–150 |
| `editor.fontSizePx` | 12–22 |
| `editor.lineHeight` | 1.4–2.0 |
| `editor.fontFamily` | `serif`, `sans`, `mono` |
| `editor.editorTheme` | `suna-dark`, `suna-light`, `gruvbox`, `jellybeans` |
| `editor.vimMotions` | boolean |
| `figures.defaultWidthPreset` | `single`, `onehalf`, `double` |
| `python.envPath` | Path to the project's Python environment. |
| `literature.provider` | Literature-search provider. |
| `ai.mode` | `cli`, `api` or `none` |
| `ai.cliCommand` | The CLI to spawn, such as `claude` or `codex`. `null` means auto-detect. |

The numeric bounds are enforced. A hand-edited `fontSizePx` of 40 is rejected by the writer rather than silently clamped.

### Editing suna.json by hand

Safe to do. The settings writer re-reads the file from disk, merges its change, validates the whole result *before* writing anything, writes atomically, and preserves every other key verbatim — including keys this schema version does not know about. Invalid JSON is reported as `suna.json is not valid JSON (<path>): …` rather than being overwritten.

## What SUNA owns, and what is yours

| SUNA owns it | Shared | Yours |
| --- | --- | --- |
| `figures/*/figure.svg` and `figure.svg.suna.json` | `suna.json` | `code/`, `data/`, `analysis/`, `results/` |
| `output/` | `manuscript.json`, `authors.json`, `figure.json` | `manuscript.md`, `references.bib` |
| `.mcp.json` | `AGENTS.md`, `CLAUDE.md` | `context/RULES.md`, and `context/PROJECT.md` in the end |

`AGENTS.md` and `CLAUDE.md` start life as generated stubs whose first line is a marker:

```markdown
<!-- suna:agent-stub v1 — generated by SUNA; edit freely, delete this marker line to opt out of updates -->
```

SUNA keeps them in sync while that marker is present. Delete the marker line and the file becomes yours; SUNA will never touch it again.

`.mcp.json` gets the same care in the other direction. When SUNA rewrites it, any other MCP servers you added are preserved, and if the file is unparseable it is kept beside the fresh one as `.mcp.json.invalid` rather than destroyed. If the existing SUNA entry still points at a live server binary and still names this project, the file is left byte-for-byte alone.

## Numbering is never stored

You will not find "Figure 3" anywhere in the project. Figure, table, equation and reference numbers are derived at format time from array and tree order plus the active profile. In the prose you embed a figure with `![[fig:fig-spectrum]]` and refer to it with `@fig:fig-spectrum`; the number appears in the export. This is why renumbering after you move a section costs nothing.

## What is gitignored

The `.gitignore` written into every new project is exactly:

```text
output/
.DS_Store
__pycache__/
.venv/
.mcp.json
```

`output/` is excluded because it is derived from the sources beside it. `.mcp.json` is excluded because it holds absolute paths for one machine.

## Creating a project

The welcome screen offers five buttons — **Create project**, **Open project…**, **Open example**, **Set up project…**, **Import .docx…** — with your Recent projects listed below them.

| Button | What it does |
| --- | --- |
| **Create project** | Opens the seven-step wizard in a new folder. |
| **Open project…** | Folder picker titled "Open a SUNA project folder". |
| **Open example** | Copies the bundled demo into the app's own data folder as `example-project` and opens the copy, so the shipped example is never modified. The copy is made once; later opens reuse it, edits and all. |
| **Set up project…** | Picks an *existing* folder and runs the same wizard from step 2 against it. If the folder already has a `suna.json` it refuses and tells you to use Open project instead. |
| **Import .docx…** | Picks a Word file and opens an Import Review tab. Nothing is written until you press Import in that tab. |

The title-bar project-name button opens the same set: your recent projects (capped at 8 in the menu, missing ones dimmed with a Remove action), then **Open project…**, **New project…** — the same wizard — and **Open example**.

### The wizard

Seven steps: **1 Where & what**, **2 Target journal**, **3 What to scaffold**, **4 Python environment**, **5 AI**, **6 Defaults**, **7 Review**. <kbd>esc</kbd> cancels from anywhere while the wizard tab is visible, and nothing is written to disk until you press Create project on the last step.

Step 3 decides what lands in `manuscript/`:

| Choice | Result |
| --- | --- |
| **Blank** | The project directories, an empty `manuscript.md` and an empty `references.bib`. |
| **Starter** (default) | A one-section manuscript with demo prose, a real citation, a `$$ … {#eq:stripping}` equation, Results and Methods sections, and a one-entry `references.bib`. |
| **Import existing** | Point at a folder; matching `.md`, `.tex` and `.bib` files are copied flat into `manuscript/imported/`. |

The import scan looks only for `.md`, `.tex` and `.bib`, descends at most four directory levels, and skips `.git`, `node_modules`, `.venv`, `venv`, `__pycache__` and every dot-prefixed entry. A name collision is skipped, not overwritten, and reported as a warning. Your `manuscript.md` is left with a placeholder telling you where the files went — nothing is auto-linked. The first imported `.bib` becomes `manuscript.json`'s `bibliography`.

Creation runs in a fixed order, reported as five sub-steps: **Creating directories** → **Writing manuscript files** → **Initializing git** → **Python environment** → **Agent wiring**. On disk the order is directories, `suna.json`, the manuscript files, `.gitignore`, the agent layer, then git. The agent layer is written before `git init` on purpose, so `AGENTS.md`, `CLAUDE.md` and `context/` land in the first commit while `.mcp.json` — already listed in the `.gitignore` written a moment earlier — stays out.

A failure at the Python or defaults step is a warning, not an abort: the project still exists and still opens. The wizard auto-closes only when there were no warnings, so anything that went wrong stays on screen for you to read.

::: info Version control from minute one
Every new project gets `git init -b main`, `git add -A`, `git commit -m "Initialize SUNA project"`. If git is not available the failure becomes a warning and the project is created anyway.
:::

## Opening a project

Point SUNA at the folder. Opening reads and validates `suna.json`, reports whether `manuscript.json` exists, runs the layout migration if needed, records the folder in Recent projects, starts watchers on `suna.json` and the project directory, and opens the manuscript tab. Repairing the agent layer happens in the background and never blocks the open.

A folder without `suna.json` fails with `not a SUNA project (no suna.json): <dir>`. Creating or scaffolding into a folder that already has one fails with `already a SUNA project: <dir>`.

Recent projects holds 10 entries, most recent first, deduped by path with trailing separators ignored. A project you have moved or deleted is marked missing inline and offers a Remove action.

### Self-healing on open

Opening a project restores what is missing, and only what is missing:

- `AGENTS.md` and `CLAUDE.md`, if absent — and refreshed if still carrying the stub marker.
- The three `context/` memory files.
- The `.mcp.json` line in `.gitignore`, appended rather than rewriting the file.
- `.mcp.json` itself.

It refuses to run at all in a directory without `suna.json`, and never touches a file whose stub marker you deleted.

### Migration of older projects

Projects that predate the flat manuscript layout — a `manuscript.json` carrying a `body` sections array, or authors and affiliations inline — are converted on open into `manuscript.md` plus `authors.json`. The migration is idempotent, refuses to overwrite an existing prose file, and on failure leaves the project untouched. You see it as a status note: `Opened project "X" (migrated to the flat manuscript layout)`.

## Git

Source Control is one of the six sidebar views. It shows the current branch, the changed files (modified, added, deleted, renamed, untracked, conflicted), a per-file diff when you click one, a **Commit message** box whose **Commit all** button stages everything and commits, and the last 20 commits.

If the folder is not a repository yet, the panel offers an **Initialize repository** button that runs `git init -b main` followed by an initial commit.

Source Control operates only when the project folder *is* the repository top level. A project nested inside a larger checkout reports as not-a-repo, so SUNA can never commit to the surrounding repository on your behalf.

::: warning Not built yet
SUNA does not push, pull, create or switch branches, stage individual files, amend, or auto-commit while you edit. The shipped surface is init, status, per-file diff, commit-all and the last 20 log entries. Anything beyond that is your own terminal.
:::

## Any folder with a suna.json is a project

That is the whole rule. Clone a colleague's repository, open the folder, and SUNA reads it — the manifest tells it which directory plays which role, and the rest is text it already understands. Point a coding agent at the same folder from a terminal and it reads the same files. See [the context system](/ai/context) and the [file reference](/reference/files).
