# Context files

What an AI agent knows about you and your project comes from plain Markdown files you can read and edit. This page explains the three layers, what belongs in each, and who owns what.

An agent working in a SUNA project — Claude Code or Codex at your terminal, or one of the in-app actions described in [AI in the app](/ai/in-app) — has no memory of you between sessions. The context layer is where that memory lives. It is three layers of Markdown: who you are (machine-wide), how SUNA works (shipped by the app), and what this project is (in the project folder, under git).

## The three layers

The first two layers live at the machine level, in `~/SunaConfig/Context/` — or under `$SUNA_CONFIG_DIR/Context/` if you set that environment variable. The third is the project itself.

```text
~/SunaConfig/Context/
  UserContext/          # layer 1 — yours; seeded once, never overwritten
    WHO-AM-I.md
    RULES.md
  SunaContext/          # layer 2 — SUNA's; replaced on every update
    README.md  PROJECT-GUIDE.md  MANUSCRIPT.md  COMMENTS.md
    FIGURES.md  MCP.md  WORKFLOW.md

<project>/
  AGENTS.md  CLAUDE.md  # layer 3 — generated stubs pointing at the layers above
  context/
    MISSION.md          # the charter
    NOTEBOOK.md         # the agent's memory
    RULES.md            # standing rules for this project
  .mcp.json             # machine-local, gitignored; wires the MCP server
```

## Layer 1 — who you are

`UserContext/WHO-AM-I.md` and `UserContext/RULES.md` are seeded once by SUNA and never overwritten. They are yours. Agents read them first and, by the shipped doctrine, may propose edits but never write to them unasked.

**WHO-AM-I.md** answers what an agent should know to write and plot the way you would: your background, field, position, expertise, interests, and taste. It ships with the placeholder `*(not filled out yet)*`. Fill it in once and every project benefits.

```markdown
# Who am I

Observational astronomer, fifth year postdoc, cluster galaxy evolution. I work in
Python (astropy, numpy) and read IDL under duress. I write for ApJ and MNRAS: past
tense for what we did, present tense for what the data show, no "novel" and no
"paradigm". I would rather cut a sentence than add a qualifier. Figures: colourblind-
safe, no rainbow maps, panel labels lowercase in the top left.
```

**UserContext/RULES.md** holds standing rules that apply to every project — writing style, figure conventions, workflow preferences. It ships as `- *(none yet)*`. Keep it to rules, not background; background belongs in WHO-AM-I.md.

```markdown
# Standing rules — all SUNA projects

- Never write a literal "Figure 3" — always the cross-reference `@fig:id`.
- Ask before deleting a paragraph I wrote; rewriting one in place is fine.
- Cite with the key from references.bib. Never invent a cite key.
- Uncertainties as ±1σ unless I say otherwise.
```

::: tip
The fastest way to fill these in is to notice yourself repeating a correction to an agent. The second time you say it, it is a rule — write it down here (for every project) or in the project's `context/RULES.md` (for this one).
:::

## Layer 2 — SUNA's own docs

`~/SunaConfig/Context/SunaContext/` holds seven stock documents that teach an agent how SUNA works: `README.md` (the scheme and the reading map), `PROJECT-GUIDE.md` (project layout, `suna.json`, directory roles, journal profiles), `MANUSCRIPT.md` (the prose dialect — see [SciMark](/writing/scimark)), `COMMENTS.md` (the review-comment sidecar and procedure), `FIGURES.md` (figure folders, provenance, compliance), `MCP.md` (the [MCP verbs](/ai/mcp)) and `WORKFLOW.md` (the session playbook).

::: warning Do not edit this folder
These files are owned by the app and rewritten whenever SUNA's bundled copy changes. Anything you add here is lost on the next update. Put your instructions in layer 1 or layer 3 instead.
:::

The docs are compiled into SUNA itself, so the MCP server can write them with no app running. A version stamp in `SunaContext/.version` decides when they are rewritten; while that stamp is current, only missing files are restored.

## Layer 3 — the project

Everything in this layer lives in the project folder, so it is under git with the manuscript and travels with the project when you share it.

### context/MISSION.md

The charter — what this project is and what "done" means. It is co-owned: an agent may draft it from your answers, you correct it in place, and you have the final say. SUNA seeds five headings for you to fill in.

| Heading | What goes under it |
|---|---|
| `## Question` | What are we trying to learn? |
| `## Data` | What data exists, where it lives, and what shape it is in |
| `## Prior work` | Analyses, code, figures and drafts that predate this project |
| `## Deliverable` | What you are producing, for what venue and audience, and what "done" looks like |
| `## Scope and non-goals` | What is explicitly in and out of scope |

The non-goals section earns its keep. It is what stops an agent from helpfully expanding your letter into a review.

### context/NOTEBOOK.md

The agent's memory of the project. Agent-owned: agents write it, you read it and leave comments. It has a body kept true by surgical in-place edits — `## State`, `## Decisions`, `## Tried`, `## Open questions` — and an append-only `## Session log` whose entries are headed `### YYYY-MM-DD HH:MM — title`, newest last.

Read it when you come back to a project after two weeks. `## Tried` is the section that saves you: it records dead ends, so the next session does not repeat them.

### context/RULES.md

Standing rules for this project only, seeded as `- *(none yet)*`. Global rules go in layer 1. SUNA's shipped workflow tells agents to promote feedback you have given twice into this file, and to propose — never write — a rule at the machine level.

### AGENTS.md and CLAUDE.md

Two identical generated stubs, one for Codex and one for Claude Code, that point an agent at the other two layers. You do not need to write them.

Line 1 of each carries a marker:

```markdown
<!-- suna:agent-stub v1 — generated by SUNA; edit freely, delete this marker line to opt out of updates -->
```

That marker decides ownership. While it is there, SUNA may refresh the file when you open the project. Delete the marker line — or replace the file entirely — and the file is yours permanently; SUNA never touches it again. The same contract governs the pointer skill SUNA syncs to `~/.claude/skills/suna/SKILL.md`, which carries a `suna:managed-skill` marker.

## Who owns what

| File | Owner | Everyone else may… |
|---|---|---|
| `UserContext/WHO-AM-I.md` | you | read; never edit |
| `UserContext/RULES.md` | you | propose edits; never write unasked |
| `SunaContext/**` | the app | read only; overwritten on every update |
| `AGENTS.md`, `CLAUDE.md` | SUNA, while line 1 carries the marker | leave alone; delete the marker to take the file |
| `context/MISSION.md` | co-owned, you have final say | edit with your agreement |
| `context/NOTEBOOK.md` | the agent | you read it and leave comments |
| `context/RULES.md` | co-owned | an agent promotes your recurring feedback into it |
| `manuscript/**` | you | anchored edits; comments go in `comments.json`, never inline |
| `figures/*/figure.svg` | the app's canvas | read only; hand-edits bypass undo, id-minting and provenance |
| `output/` | derived | never edited by hand |

## The reading order an agent follows

SUNA's shipped instructions put the layers in this order at the start of a session:

1. Everything in `UserContext/` — WHO-AM-I.md, then RULES.md.
2. `SunaContext/README.md`, then `WORKFLOW.md`; other reference docs as the task needs them.
3. The project's `context/` files — MISSION.md, NOTEBOOK.md, RULES.md.
4. Open review comments, via `list_comments {"resolved": false}`.

The orientation stage of `WORKFLOW.md` adds three read-only verbs to step 4 — `list_project`, `read_manuscript_meta` and `list_outline` — so the agent sees the file tree, the metadata and the section outline before it changes anything. See [the MCP verbs](/ai/mcp) for what each returns, and [review comments](/writing/comments) for how threads work.

::: info Context files have no MCP verb
Deliberately. An agent edits MISSION.md, NOTEBOOK.md and RULES.md with its own file tools, the same way it would edit any Markdown file. The MCP verbs cover the manuscript, figures, references and comments only.
:::

## If the files are missing

SUNA restores them. Opening or creating a project writes any missing stub, the three `context/` files and `.mcp.json` in the background; `~/SunaConfig` is healed when the app starts. The repair is additive — existing `context/` files are never rewritten, and a stub whose marker you deleted is left alone. If an agent tells you `.mcp.json` is missing, open the project in SUNA once.

Every repair is best-effort and never blocks a project from opening. See [Your project on disk](/guide/project) for the rest of the folder, and [Files reference](/reference/files) for the full list.
