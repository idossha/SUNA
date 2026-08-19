# A typical workflow

How a paper actually gets written in SUNA: from an empty folder and a PROJECT statement, through drafting with figures and citations, review passes, journal compliance, and export.

The phases below are not enforced by the app. They are the order in which a manuscript tends to come together, and the places where SUNA's design either helps or deliberately stays out of the way.

## Phase 1 — Set up the project and say what it is for

A SUNA project is an ordinary folder containing a `suna.json` manifest. The New Project wizard walks seven steps — Where & what, Target journal, What to scaffold, Python environment, AI, Defaults, Review — and creates exactly what its Review step showed.

The scaffold gives you `manuscript/` (`manuscript.md`, `manuscript.json`, `authors.json`, `references.bib`), plus `figures/`, `code/`, `data/`, `analysis/`, `results/` and `output/`. It then runs `git init -b main` and makes an initial commit, so your first draft is already under version control before you type a word.

Leave the journal alone for now. A new project's active profile is `suna` — SUNA's own house style, not a journal. It flags nothing and sets the manuscript in clean typography. You switch to a journal profile when you know where you are submitting, which for most papers is much later than you think.

The step people skip and regret is `context/PROJECT.md`. It is seeded with five headings — Question, Data, Prior work, Deliverable, Scope and non-goals — and it is the project charter both you and any AI agent read first. "Deliverable" asks what you are producing, for what venue and audience, and what *done* looks like. Ten minutes there saves an agent from confidently drafting the wrong paper.

Alongside it SUNA writes `context/MEMORY.md` (agent-owned working memory: State, Decisions, Tried, Open questions, plus an append-only session log) and `context/RULES.md` for standing rules that apply to this project only. Rules that apply to everything you write belong in `~/SunaConfig/Context/UserContext/RULES.md`, next to `WHO-AM-I.md`, which describes your field, position and taste. These are yours; SUNA seeds them once and never overwrites them.

## Phase 2 — Draft, with figures and citations arriving as the analysis lands

The manuscript is one flat file, `manuscript/manuscript.md`. There is no `sections/` directory — sections are Markdown headings, and the outline is derived from them. Activating **Manuscript** in the activity bar opens the combined document: title page, the whole of the prose, and the reference list.

<figure class="shot">
  <img src="/shots/manuscript-document.webp" alt="The Manuscript tab showing the title page editors with authors and abstract at the top, the rendered prose below with numbered figures and resolved citations, and the reference list at the end." />
  <figcaption>One tab holds the title page, the prose and the references. Title-page fields are click-to-edit and write straight into manuscript.json.</figcaption>
</figure>

Press <kbd>⌘E</kbd> to toggle between Reading and Source. Reading is the default and it is a live preview you can type into, not a read-only render — math renders through KaTeX, citations resolve, figures show their live SVG. Source shows the SciMark markup with syntax highlighting.

The habit worth forming early: never write a number. Citations are `[@wang2025]` or narrative `@wang2025`; cross-references are `@fig:cluster`, `@tbl:params`, `@eq:tf`, `@sec:methods`. Figures are embedded with `![[fig:cluster]]` on its own line, tables with `![[tbl:id]]` directly above the table. Figure and table numbering is derived from the order those embeds first appear in the prose, at format time. Move a paragraph and the numbers follow. Write "Figure 3" by hand and it will be wrong within a week.

Captions live in `manuscript.json`, not in the prose. With vim motions on, `:cap`, `:title` and `:note` jump to the caption title (or a table's "Note." body) of the nearest embed for in-place editing.

<kbd>⌘⇧K</kbd> inserts a citation and <kbd>⌘⇧F</kbd> a figure. Both are also on the right-click menu, along with Comment, the formatting commands and **Open reference PDF**.

Figures are editable SVG on a canvas whose document model is the SVG file itself — `figures/<id>/figure.svg` is always a valid SVG, and the canvas edits it directly rather than importing and exporting. New Figure creates it at the active profile's double-column width. <kbd>⌘⇧I</kbd> (or drag-and-drop) imports an SVG as a single namespaced group, or a PNG at 300 dpi. When a plot comes out of matplotlib, the `suna_mpl` package keeps the text editable on the canvas by setting `svg.fonttype: none`.

References come in from the References view: search Crossref, OpenAlex, bioRxiv/medRxiv or arXiv, then **Add to references.bib**. Rows carry **Attach PDF…**, and selecting a row auto-opens its PDF in the side group.

::: warning Not built yet
Edits you make on the canvas do not propagate back to the Python that generated the plot. The provenance/overlay loop described in some design documents is an empty stub. Re-running your script overwrites the figure, so make canvas edits after the analysis has settled, or re-apply them.
:::

## Phase 3 — Bring the agent in

SUNA's main AI path is external. Opening a project writes a machine-local `.mcp.json` in the project root, which both Claude Code and Codex discover automatically. The Agent view's **Open Claude Code here** button heals that wiring and opens the CLI in a terminal tab at the project folder, billed to your existing subscription.

The agent then works through validated verbs over the same files you edit: `read_manuscript`, `edit_manuscript` (an exact-match find/replace of exactly one occurrence — ambiguity is an error, not a guess), `list_outline`, `read_manuscript_meta`, `list_figures`, `read_figure_svg`, `read_bib`, `check_manuscript`, `check_figure_compliance`, `list_comments`, `add_comment`, `reply_comment`, `search_literature`, `lookup_doi`, `add_reference`. Its edits reach your open editors as a mapped change, so your cursor, scroll position and comment anchors survive.

There is also an Agent sidebar panel that chats with Anthropic, OpenAI or a local Ollama using your own API key. Know what it is: text only. It has no tools and no file access — it cannot read or edit your manuscript. Use it for "tighten this abstract" when you paste the abstract in; use the CLI for anything that touches files.

::: info Where the agent stops on its own
Compliance verbs are advisory: they report, they never rewrite. The agent writes `@fig:x`, never a literal figure number. Directed AI actions carry the rule "Never run destructive git commands, never commit" and end by summarising exactly what changed, shown to you in the app. And the agent never resolves a comment thread — see below.
:::

## Phase 4 — Review passes

Select text in the manuscript and press <kbd>⌘⇧M</kbd>. The comment lands in `manuscript/comments.json`, a pretty-printed sidecar that diffs cleanly in git — the prose is never marked up. Anchors are the quoted text plus 32 characters of context on each side; if the text later changes beyond recognition, the thread is marked `detached` and kept, never deleted.

<figure class="shot">
  <img src="/shots/comments.webp" alt="Prose with an amber-highlighted phrase, and the Comments rail beside it showing an expanded thread with a reply and the Reply, AI, Resolve and Delete buttons." />
  <figcaption>Cards sit level with the text they annotate. An expanded card offers Reply, ✦ AI, Resolve and Delete.</figcaption>
</figure>

<kbd>⌘⌥M</kbd> toggles the rail. Resolved threads move into a collapsible **History** section; open threads whose anchor is missing collect at the top under **Detached / unanchored**.

The loop that works: leave an anchored comment saying what is wrong, press the card's **✦ AI** button, and the agent gets that thread, the live anchor, and about 400 characters of surrounding prose — with permission to make a minimal edit through `edit_manuscript` and to reply on the thread, and nothing else. When the comment is ambiguous it is told to ask on the thread rather than guess.

Then you read the change and click **Resolve** yourself. This is a deliberate asymmetry: there is no resolve verb over MCP at all. The agent's reply is the signal that a thread is *ready* for review; judging whether the fix is right stays with the author. Delete is immediate but raises an Undo toast.

Your co-authors' comments and the agent's arrive in the same rail, live — an external write to `comments.json` refreshes the rail, except while you have a composer open, so in-progress typing is never clobbered.

## Phase 5 — Pick a journal and see what it flags

Switch the active profile when the target is decided. Ten are offered in the pickers: the SUNA house style plus nine journals. Each profile encodes that journal's *author guidelines* — citation and reference format, figure width presets in millimetres, minimum font size, line-weight range, palette guidance, abstract and section limits — with a source URL per value. Anything the guidelines do not state is `null`, and renders as "not stated" rather than a guess.

Compliance is advisory everywhere it appears. Manuscript checks surface in the **Export** dialog, which runs them before rendering and lists them as non-blocking warnings ("No issues found." when clean), beside a Requirements panel derived from the profile. Figures carry a compliance chip on the canvas. Nothing is silently reformatted, and nothing blocks you.

::: warning Not built yet
Manuscript compliance diagnostics do not yet appear in the manuscript view itself. Until they do, the Export dialog is where you see them — so open it once before you think you are finished, not only on submission day.
:::

Two visible profiles deserve caution: `neuron` and `sleep-advances` are thin — Cell Press blocked every automated fetch of Neuron's author pages, and SLEEP Advances' page states less than its sibling's — so their limits are largely unset. Read the profile's own notes before trusting a clean check from either. See [journal profiles](/publishing/profiles).

## Phase 6 — Export

Export offers Word (.docx), PDF and Web page (.html), against either the manuscript or a Supplementary Information document built from `manuscript/supplementary.md`. The dialog carries the profile picker, an article type drawn from the profile, an output file name, and Double spacing / Line numbers / Page numbers.

All three formats are driven by the active profile off one shared content model, so citation numbering, reference ordering and cross-reference labels match what the Manuscript tab shows. Output lands in `output/`; sources are never touched. There is no LaTeX step anywhere — PDF is produced from SUNA's own HTML — and PDF/DOCX remain export-only artefacts, never sources of truth.

## Git, throughout

Commit like you would commit code, because everything that matters is text: prose, metadata, `references.bib`, `figure.svg`, `comments.json`. A review round is a readable diff.

<figure class="shot">
  <img src="/shots/source-control.webp" alt="The Source Control sidebar listing changed files with a diff, a commit message box, and the commit history below." />
  <figcaption>Source Control gives you status, diffs, commit and history without leaving the app.</figcaption>
</figure>

The view is live. It re-reads the moment anything moves — your own edits, an export, an agent, a `git add` you typed in the built-in terminal, a branch switch from another window — because SUNA watches both the project tree and `.git` itself. Nothing needs refreshing, and there is no refresh button to look for.

Changes arrive in the two lists git actually keeps: **Staged changes** (the index) and **Changes** (the working tree). A file appears in both when you stage it and then keep writing, and clicking a row shows the diff for *that* side. Each row stages (`+`), unstages (`−`) or discards (`↺`) just that file, and each hunk inside a diff carries the same three actions, so you can commit the paragraph you finished without committing the half-written one below it. **Commit** takes exactly what is staged; when nothing is staged, **Stage all & commit** is offered instead of quietly committing everything. Discarding always asks first — it is the one action here that destroys work, and for an untracked file it deletes it outright.

A folder that is not a repository yet gets an **Initialize repository** button: `git init -b main` plus a first commit of what is already there, entirely on your machine.

To keep a copy elsewhere, you can create the repository without leaving SUNA: if you have logged the GitHub CLI in yourself (`gh auth login`), the Remote section offers **Create on GitHub** — name, visibility, optional organization owner — and points `origin` at the new repository's SSH URL. SUNA borrows that existing login and never asks for or stores a token; creation uploads nothing, so the first push is still yours to make. Without `gh`, create an empty repository on your host and paste its URL under **Remote**. SUNA stores remotes as SSH — paste an `https://github.com/owner/repo` URL and it is saved as `git@github.com:owner/repo.git`, because HTTPS asks for a username and password on every push and SUNA has no terminal in which to answer it. (A **Keep HTTPS** button is there if you really want it, and a plain path to a backup disk works too.) **Publish branch** pushes and sets the upstream; after that it is just **Push**, with the count of commits waiting to go.

If SSH is not set up on this machine, expand **SSH setup**: a four-step checklist — git identity, a key in `~/.ssh`, ssh-agent, and the key authorized on your host — that shows which steps are already done, hands you the exact command for the ones that are not, copies your public key for pasting, and ends with a **Test connection** button that runs the real handshake. A push that fails on authentication opens the same checklist with git's own message underneath.

Two things not to worry about: `.mcp.json` bakes an absolute path, so SUNA gitignores it and re-creates it per machine — a collaborator who clones your project gets their own on first open. And no AI run in SUNA commits or runs destructive git commands; the history is yours.

## Where to go next

- [SciMark](/writing/scimark) for the full markup dialect, and [the editor](/writing/editor) for its modes and shortcuts.
- [Comments](/writing/comments) for the review model in detail.
- [Profiles](/publishing/profiles) and [compliance](/publishing/compliance) before you commit to a journal.
- [MCP](/ai/mcp) and [agent context](/ai/context) for how the agent sees your project.
