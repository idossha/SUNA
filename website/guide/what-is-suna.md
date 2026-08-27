# What SUNA is

SUNA is a desktop workspace for writing a research paper: prose, figures, references, journal rules and your analysis code in one folder, under git, editable by you and by an AI agent through the same files.

## The problem it solves

A paper today is spread across four tools that do not know about each other. The prose is in Overleaf or Word. The citations are in Zotero. The figures are PNGs exported from a notebook and dragged in. The journal's author guidelines are a PDF you read once and then approximated from memory.

Every one of those seams costs you time at the worst moment — during revision, and again at submission. A figure changes and you re-export, re-crop, re-place it. A reviewer asks for a different citation style and you re-run the whole bibliography. You discover on submission day that the abstract is 60 words over the limit and the figure text is below the minimum point size.

SUNA puts all of it in one versioned directory tree and makes the journal's rules a machine-readable object that checks your document instead of a PDF you half-remember.

## The shape of the workspace

If you have used VS Code, you already know the layout: an activity bar down the left, a file tree, tabs you can split with <kbd>⌘&#92;</kbd> (right) or <kbd>⌘⇧&#92;</kbd> (down), an integrated terminal on <kbd>⌃&#96;</kbd>, source control, and a command palette on <kbd>⌘K</kbd>. Press <kbd>?</kbd> anywhere for the shortcut overlay, which opens on the tab matching whatever surface you were in.

<figure class="shot">
  <img src="/shots/manuscript-reading.webp" alt="The SUNA manuscript tab in Reading mode: a typeset title page with authors and superscript affiliation markers, body prose with superscript numeric citations, and a centred display equation rendered with KaTeX." />
  <figcaption>The Manuscript tab in Reading mode. Citations, cross-references and equations are resolved live — and this view is editable, not a read-only preview.</figcaption>
</figure>

What is different from a code editor is the Manuscript tab: one combined document with a typeset title page drawn from `authors.json`, the whole of your prose, and a reference list numbered by first appearance. It has two modes, toggled with <kbd>⌘E</kbd> — **Source** (Markdown with syntax highlighting) and **Reading** (rendered math, resolved citations, numbered figures with the live SVG). Reading is the default, and it is an editable live preview with cursor reveal, so you can write directly in the typeset view. Vim motions are available if you want them.

## A project is a folder of plain text

A SUNA project is an ordinary directory containing a `suna.json` manifest and these folders: `manuscript/`, `figures/`, `code/`, `data/`, `analysis/`, `results/`, `output/`. Creating one runs `git init -b main` and makes an initial commit.

The manuscript is one flat prose file — `manuscript/manuscript.md` — beside `manuscript.json` (metadata only), `authors.json`, and `references.bib`. There is no `sections/` directory; your sections are Markdown headings, and the outline is derived from them.

You can open that folder in any other editor, diff it, branch it, and hand it to a collaborator who has never heard of SUNA. Nothing is locked in a database.

::: info The format doctrine
JSON, Markdown, BibTeX, SVG and LaTeX are the only sources of truth. PDF and DOCX are produced at export time only, into `output/`, and sources are never mutated.

The practical consequence: every file that matters is diffable. `git diff` on a revision shows you the sentences that changed, not a binary blob. And because numbering — figures, tables, equations, references — is derived at format time and never stored, inserting a figure in the middle renumbers everything downstream with no stale "Figure 3" left behind in the prose.
:::

## The six things it does

| | What you get |
|---|---|
| [Manuscript](/writing/manuscript) | One prose file in [SciMark](/writing/scimark) — CommonMark plus math, citations, and pandoc-crossref cross-references — with [Source and Reading views](/writing/editor) over the same buffer |
| [Figure canvas](/figures/canvas) | A vector editor whose document model is the SVG file itself, with mm rulers, layers, snapping, align and distribute |
| [References](/writing/references) | `references.bib` with a Cited/Uncited filter, literature search across Crossref, OpenAlex, bioRxiv/medRxiv and arXiv, and PDF attachment |
| [Journal profiles](/publishing/profiles) | Ten profiles in the picker — SUNA's house style plus Science, Nature, Neuron, PNAS, Brain Stimulation, SLEEP, Sleep Advances, J. Neural Engineering and J. Neuroscience |
| [Compliance and export](/publishing/compliance) | Word, PDF and HTML [export](/publishing/export) driven by the active profile, with the profile's stated limits checked first |
| [Agent access](/ai/overview) | An [MCP server](/ai/mcp) exposing 23 typed manuscript verbs, so an agent edits the same files you do |

Two of those deserve a sentence more.

**The canvas edits the SVG, not a copy of it.** There is no import/export conversion and no parallel scene graph — `figures/<slug>/figure.svg` on disk is always a valid SVG, byte-identical after a round trip. Text stays text, so a matplotlib figure exported through the `suna_mpl` companion remains editable label by label.

**A profile encodes author guidelines, not page design.** Each field — citation format, figure width in mm, minimum font size, abstract word limit, required sections — carries the source URL it came from, and anything the journal does not state is `null` rather than guessed. Checkers flag; they never silently reformat your document.

<figure class="shot">
  <img src="/shots/export.webp" alt="The Export tab showing Document, Format, Journal profile and Article type pickers, checkboxes for double spacing, line numbers and page numbers, a COMPLIANCE CHECK panel listing two errors, and a REQUIREMENTS panel of the journal's stated rules with guideline links." />
  <figcaption>Export runs the compliance check against the profile you are about to render with. Warnings are non-blocking, and each requirement links back to the guideline it came from.</figcaption>
</figure>

## How it compares

| | What it does that SUNA does not | What SUNA does that it does not |
|---|---|---|
| Overleaf | Full LaTeX typesetting, real-time co-editing in the browser | Figures, references and journal compliance in the same tree; a vector figure editor |
| Word | Track changes with co-authors; everyone already has it | Plain-text sources under git; derived numbering; agent access to the document |
| Zotero | A machine-wide library across every project | Cites, renders and checks against the journal from the same `references.bib` |
| A plain LaTeX repo | Typesetting quality, full macro control | A figure editor, live rendering, profile-driven compliance, an MCP interface |

## What SUNA is not, yet

SUNA is in active development. Be clear-eyed about these before you move a paper into it.

::: warning Not built yet
**No packaged binary.** SUNA is macOS-first and runs from source — `pnpm install`, then `pnpm dev`. There is no signed installer. See [install](/guide/install).

**No LaTeX typesetting path.** PDF export is produced from SUNA's own HTML, not by running LaTeX or Tectonic — there is no external typesetting binary anywhere in the project. Output is clean and profile-driven, but it is not TeX-quality line breaking.

**Figure-to-code provenance is not built.** Editing a figure on the canvas does not sync those edits back into the Python that generated it; re-running the script overwrites your canvas work. Read [figures from code](/figures/from-code) before you build a workflow on it.

**Compliance is surfaced in the Export dialog only** — not yet as inline diagnostics in the manuscript view.

**Agent chat has no streaming and no tool use.** The conversation is multi-turn — each send posts the accumulated transcript — but the panel cannot read or edit your files. The capable path today is the [MCP server](/ai/mcp) driven by a coding CLI, plus [directed actions](/ai/in-app) from a comment card or the canvas.
:::

Two profiles also need care: `neuron` and `sleep-advances` are thin. Cell Press returned HTTP 403 to every automated fetch of Neuron's author pages, and SLEEP Advances' guidelines page is materially thinner than its sibling's. Their word limits and figure rules are largely `null`, so check them against the journal's own site before you trust a clean compliance run. The [profiles page](/publishing/profiles) says which fields are missing.

## Where to go next

[Install SUNA](/guide/install) — download an installer, or run from a source checkout.

[Quickstart](/guide/quickstart) — create a project, write a paragraph, cite a paper, place a figure, export a Word file.

[The workflow](/guide/workflow) — how a paper actually moves through SUNA from first draft to submission.
