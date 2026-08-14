# Feature plan 3 — text-editing UX, AI-powered literature search, margin comments, figure creation

Requested 2026-08-14 after using the app. Ground truth probed before writing
(§2.0). A Flux dissection runs as phase 1 of the build workflow and its report
is handed to the builders; this plan defines *what* and the acceptance
criteria, the dissection informs *how*.

---

## 1. Word/Flux-grade text editing

Today reading mode renders widgets but offers no formatting affordances: no
selection toolbar, no context menu, no ⌘B.

**Selection context menu (right-click on a selection).** A compact menu at the
pointer with: **Comment** (⌘⇧M), separator, **Bold** (⌘B), *Italic* (⌘I),
`Code` (⌘E is taken by mode-cycle → use ⌘⇧C), Strikethrough, separator,
**Link…** (⌘K), **Insert citation…** (⌘⇧K, opens the reference picker),
**Insert cross-reference…**, separator, Cut/Copy/Paste. Items disable when
they cannot apply (e.g. Comment with an empty selection). Right-click with no
selection gives the plain Cut/Copy/Paste + Insert group.

**Keyboard shortcuts** (all modes, prose files only): ⌘B bold, ⌘I italic,
⌘⇧C code, ⌘⇧X strikethrough, ⌘K link, ⌘⇧M comment, ⌘⇧K insert citation.

**Semantics — this is Markdown, not a word processor.** Bold toggles `**…**`
around the selection; applying it to already-bold text removes the markers.
The implementation is a pure `toggleWrap(state, marker)` CodeMirror command
so it is unit-testable: it must handle (a) no selection → toggle the word
under the cursor, (b) selection already wrapped → unwrap, (c) selection
partially overlapping markers → normalize, (d) multi-line selections → wrap
per line for inline markers. Link inserts `[text](url)` with the URL
selected. All edits go through one CodeMirror transaction so ⌘Z reverts the
whole action.

**Acceptance.** Select a word, ⌘B → `**word**` in the file after save; ⌘B
again → back to `word`; right-click shows the menu with Comment enabled;
Comment from the menu creates the same anchored comment as ⌘⇧M; undo of any
menu action is a single step.

---

## 2. Literature search through an agent CLI ("AI bash")

### 2.0 Ground truth (probed 2026-08-14)

- Metered APIs are the problem: OpenAlex search returns HTTP 429
  *"Insufficient budget… $0 remaining"*.
- **`claude -p "<prompt>" --output-format json --allowed-tools WebSearch`
  works and is billed to the user's existing subscription.** Verified: it
  returned Gunn & Gott 1972 (`10.1086/151605`), Abadi et al. 1999, and
  GASP I with correct DOIs.
- Response shape: a JSON object whose **`result` field is a string**
  containing the model's answer; `is_error` flags failure. Latency ≈ 30–60 s
  for a 3-result search.
- `codex` is installed too (`codex exec` for headless runs) — treat as a
  second adapter, verified by the builder.

### Design

A new provider `ai-cli` in the same provider abstraction, becoming the
**default** when a CLI is detected:

- Spawns the configured CLI (`claude`, else `codex`) as a child process from
  the **main** process, cwd = project root, with a strict prompt: return ONLY
  a JSON array of `{title, authors[], year, venue, doi, url, abstract?}`.
- Parses `result` → strips ``` fences if present → `JSON.parse` → validates
  each item with the `LitResult` schema, dropping malformed entries rather
  than failing the whole search.
- **Timeout 180 s, cancellable** (the UI shows a Cancel button); the child is
  killed on cancel or tab close.
- Streams progress: since `--output-format stream-json` exists, the adapter
  should emit "searching…/reading…" status lines to the renderer over an
  event channel so the UI is not a frozen spinner for a minute.
- Honest failure: CLI missing → *"Install Claude Code or Codex, or use
  Crossref (no key needed)"*; non-zero exit or unparseable output → show the
  first 300 chars of what came back, never an empty list.

The existing Crossref/OpenAlex/ADS/arXiv providers stay: `ai-cli` is best for
open-ended discovery, Crossref for exact lookups, and the agent path costs the
user tokens, so the provider selector shows a cost/latency hint per provider.

**Also expose it to agents**: the MCP `search_literature` tool keeps its API
providers (an agent already has web search of its own; it should not recurse
into a CLI).

**Acceptance.** With Claude Code installed, an `ai-cli` search for "ram
pressure stripping" returns ≥3 parseable results with DOIs inside 180 s,
each addable to `references.bib`; killing the search mid-flight terminates the
child process; with the CLI absent the UI shows the install hint.

---

## 3. Comments in the margin, not a tab

Replace the sidebar Comments view with **margin comments beside the text**
(the Flux/Word model).

- The manuscript document and prose editors get a right **comment gutter**
  (~260 px, collapsible) inside the same scroll container. Each comment
  renders as a card vertically aligned to its anchor's line.
- **Collision handling**: cards never overlap — later cards push down; a card
  whose anchor scrolls off screen sticks to the top/bottom edge with a
  count badge.
- Clicking a card highlights its anchor and vice versa; the active card
  expands (replies + reply box + Resolve).
- Detached comments collect in a small "Unanchored (N)" group at the top of
  the gutter, never lost.
- Resolved comments hide by default with a "Show resolved (N)" toggle.
- The activity-bar Comments entry is **removed**; the store and MCP tools stay
  exactly as they are (they already work) — this is a presentation change.
- The gutter appears in the combined manuscript tab and in prose editor tabs;
  when the window is narrow (< 1100 px) it collapses to margin dots that open
  a popover.

**Acceptance.** A comment's card sits within ±8 px of its anchor's vertical
position; two comments on adjacent lines do not overlap; clicking a card
scrolls/highlights the anchor; no Comments entry remains in the activity bar;
existing `comments.json` files render unchanged.

---

## 4. Create figures from scratch on the canvas

Today the canvas only opens existing `figure.svg` files.

- **New Figure** from: the Figures view header button, the canvas tab's own
  "+" button, and the command palette. Asks only for a name; creates
  `figures/<id>/{figure.svg,figure.json}` with a blank artboard at the active
  profile's **double-column width** and a 0.618 ratio height, registers the
  figure in `manuscript.json` (via `manuscript:update`), and opens it.
- **Empty-canvas affordance** (from the Flux screenshot): a blank artboard
  shows a centered drop hint — *"Drop or import a plot · ⌘⇧I import SVG/PNG ·
  or draw with the tools"* — that disappears once the document has content.
- **Import into a figure**: drag-and-drop an SVG or PNG onto the canvas, or
  ⌘⇧I. SVG is inserted as a group (ids namespaced to avoid collisions with
  existing ones); PNG is embedded as a data-URI `<image>` sized to its natural
  size in mm at 300 dpi. Both are single undoable commands.
- **Panel composition**: dropping a second plot offsets it and, if the figure
  now has ≥2 top-level groups, offers "Auto-letter panels" (already built).
- The new figure is compliance-checked immediately, so a blank artboard at a
  non-preset width is flagged like any other.

**Acceptance.** New Figure creates the directory, a schema-valid
`figure.json`, a valid SVG whose artboard width equals the profile's
double-column preset, and a `manuscript.json` entry; the blank canvas shows
the hint; dropping the demo `figure.svg` inserts it as a group and one undo
removes it; drawing a rectangle then saving produces a file the engine
re-opens byte-identically.

---

## 5. Flux dissection (phase 1 of the build)

A research agent reads `fluxsci/flux` (MIT) and reports **implementation-grade**
detail on exactly four things, for the builders:

1. **Text editing UX** — selection toolbar/context menu structure, the
   command set, how markdown formatting toggles are implemented over
   CodeMirror, shortcut registration, and how "insert citation" is wired.
2. **Margin comments** — DOM/layout strategy (absolute positioning vs flex
   column), how card ↔ anchor vertical alignment and collision push-down are
   computed, scroll/resize handling, and the data flow from their comment
   store.
3. **Canvas figure creation** — new-figure flow, the blank-canvas affordance,
   drag-drop/import pipeline (SVG namespacing, PNG sizing), and how a new
   figure is registered in their project model.
4. **Anything architectural worth stealing** that we have not already taken
   (we have: verb registry, MCP, semantic ids, determinism, overrides).

Report must separate *portable* (framework-free logic) from *Svelte-specific*
(reimplement), and confirm MIT attribution needs for any verbatim port.

---

## Constraints

- Sources of truth unchanged: prose stays Markdown, comments stay sidecar,
  figures stay SVG. No feature may introduce a binary or proprietary format.
- Every formatting command is a single undoable transaction.
- Tests for pure logic (`toggleWrap`, card layout math, import namespacing);
  smoke steps for anything only observable in the app.
- Gates: `pnpm typecheck && pnpm test && pnpm smoke` green.
