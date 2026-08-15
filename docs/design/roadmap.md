# SUNA — status & roadmap

Living status of what is built, verified, and outstanding. Verified means
tested by unit suites AND driven in the real app by `pnpm smoke` (CDP) or a
recorded manual check.

## Built & verified

| Area | State |
|---|---|
| Shell | VS Code-like: activity bar, resizable sidebar (persisted), dockview tabs, status bar, terminal panel |
| Project | Scaffold + git init; "Open example" copies the demo to userData and git-inits it |
| Editor | Reading default, working content-width (50–150ch), **layout by content kind** (prose wraps at the measure — left-aligned in Source, centered in Reading; code/data never wrapped or width-constrained, always mono, flush at the gutter), GFM tables in reading mode, vim motions, .bib language pack (highlight/lint/completion), CSV/TSV data grid |
| Manuscript editing | SciMark (math, citations, cross-refs, figure embeds, raw LaTeX); Source ↔ Reading modes, Reading = editable live preview with cursor-reveal |
| Manuscript document | Combined tab: title page (authors/affiliations/abstract/significance/highlights), per-section editors, references page numbered by first appearance per profile; scroll-spy outline with word counts; own settings gear driving **one measure** for title page + sections + references; live cross-reference resolution (`Fig. 1a`, `equation (1)`, numbered display equations) with unresolved ids flagged, never blanked |
| Editable title page | Every title-page field writes `manuscript.json`: click-to-edit in place for title/running title/abstract/significance/highlights, compact row editors for authors and affiliations (reorder, add/remove, ORCID + e-mail with inline validation, corresponding/equal-contribution flags, affiliation multi-select). Read → merge → validate → **atomic write** in the main process on every commit, so an agent editing the same file is never clobbered; invalid input shows an error and leaves the file byte-identical. Affiliation superscripts stay **derived** from author order |
| Comments | Sidecar `manuscript/comments.json` — the prose is never marked up. W3C-style prefix/quote/suffix anchors re-locate exactly → by context → fuzzy, and mark `detached` instead of ever deleting. **Margin gutter** beside the text (manuscript tab + prose editor tabs; the sidebar view is gone): each card sits level with its anchor's line (measured within ±8 px), collision push-down keeps neighbours from overlapping, off-screen anchors collapse to an "N above/below" edge badge, detached ones collect in *Unanchored (N)*, resolved hide behind a toggle, and below a 1100 px **window** it degrades to dots + popover. Click card ⇄ anchor both ways; in-editor highlight + line dot; ⌘⇧M on a selection. One anchoring implementation in `@suna/core` shared by the app and the MCP tools (`list_comments`, `add_comment`, `reply_comment`, `resolve_comment`), so human- and agent-authored anchors resolve identically |
| Text editing | Word/Flux-grade markdown formatting on prose files: ⌘B/⌘I/⌘⇧C/⌘⇧X/⌘K plus a right-click context menu (Comment, the four inline toggles, Link…, Insert citation…, **Open reference PDF**, Cut/Copy/Paste) that disables what cannot apply. ⌘K makes a link out of a **selection**; with an empty selection it falls through to the command palette, and the no-selection *Link…* stays on the context menu. `toggleWrap` is a pure `EditorState → TransactionSpec` function — it toggles the word under a bare cursor, unwraps the **whole** enclosing delimiter pair for a partial selection (so it can never orphan a `**`), and splits multi-line selections per line. Every command is one transaction, so one ⌘Z reverts it whole |
| Figure canvas | SVG-DOM engine (byte-identical round-trip, inverse-op undo), full editing suite (tools, handles, snapping, layers, properties), compliance chip; **create from scratch**: New Figure (Figures header + canvas tab) writes `figures/<slug>/{figure.svg,figure.json}` at the active profile's double-column width × 0.618, registers it in `manuscript.json` and opens it; a blank artboard shows a drop hint; drag-drop or ⌘⇧I imports an SVG as one `<g id="imported-N">` with every internal id namespaced to `impN-` (193 demo ids, zero collisions) or a PNG as a 300 dpi data-URI `<image>` — each a single undoable command; **parity rail**: align/distribute, mm rulers (1 mm ticks, 10 mm labels, artboard origin, live cursor, tracks pan/zoom), figure panel (artboard mm, background, duplicate figure, auto-letter panels as one undoable batch), palette ramps from the active profile, and export — SVG (byte-identical copy), PDF, PNG/TIFF rasterized at the exact journal-spec pixel size |
| Journal profiles | 4 profiles from official author guidelines with source URLs + provenance tags; figure & manuscript compliance checkers; the canvas export presets are driven by the *active* profile (`Double column (180 mm)` for Nature, not a hardcoded width) |
| References | Bib list, Cited/Uncited filter, missing-entry warnings; **"Rendered as" is one shared control** — it drives the sidebar preview *and* the manuscript body's in-text chips (author–year ⇄ numeric superscript) and both reference lists' sort/numbering |
| Literature search | Provider abstraction in `@suna/bib` (Crossref keyless by default, OpenAlex, NASA ADS, arXiv) shared by the main process and the standalone MCP server. Search tab with result cards, *Add to references.bib* (generated `firstauthorYEARword` key, deduped), *Copy DOI*, *Open*, *Find similar*. Failures are surfaced verbatim with the provider switch inline — OpenAlex's HTTP 429 is reported, never disguised as "no results". **AI search** (`ai-cli`) spawns Claude Code or Codex from the main process, billed to the user's existing subscription rather than a metered API: strict JSON-array prompt, per-item schema validation that drops malformed entries instead of failing the search, narrated progress, a hard 180 s budget, and a Cancel that really kills the child. It becomes the default once a CLI is detected, and asks for 8 papers (not 20 — the agent verifies each one, and 20 ran past the timeout). Measured: 8/8 results with DOIs in 129 s. Deliberately **not** exposed over MCP, so an agent never recurses into another agent CLI |
| Split view | ⌘\ / ⌘⇧\ duplicate the active tab into a group beside/below it, over dockview's own position API — never a second layout engine. The split reuses the existing second group instead of nesting endlessly, so ⌘\ any number of times leaves exactly two groups. `openViewerInSide` makes that group *the* viewer: a new PDF replaces the previous one rather than stacking tabs |
| PDF & image viewers | `.pdf` opens in a pdf.js viewer in the **renderer** (continuous scroll, page N-of-M + jump, fit-width/zoom/⌘±/⌘0, a real text layer so selection and ⌘F work). Pages render lazily through one IntersectionObserver and unmount outside a ±800 px window, so a long document keeps a small constant number of live canvases however far you scroll. `.png/.jpg/.jpeg/.gif/.webp` open in an image viewer with fit/100 %/zoom, drag-to-pan and a pixel readout. Bytes arrive over `fs:read-binary` (root-confined, 200 MB ceiling, base64) — no `file://`, no CSP relaxation, and PDFs are never rewritten |
| Reference PDFs | Pure `resolvePdfPath` in `@suna/bib`: the BibTeX `file` field (Zotero/JabRef forms included), then `references/<citekey>.pdf`, then an `Author_Year*` fuzzy match. A store scans once per project and on every save, so the citekey → PDF map is ready even if the References view was never opened. Right-clicking a citation in the manuscript offers **Open reference PDF** (disabled and naming the key when none resolves), which opens the paper in the side group without disturbing the manuscript. Selecting a References row auto-opens its PDF there (`references.autoOpenPdf`, default on); rows without one offer **Attach PDF…**, which *copies* the picked file to the conventional path and rescans |
| Command palette | One ⌘K popup (⌘⇧P straight into command mode) with four prefix modes: fuzzy file search over **project-relative** paths, `>` app commands from a registry any feature can add to, `$` a line run in the integrated terminal, `?` a prompt sent to the agent CLI with streamed progress and a Cancel that really kills the child. Recents persist per project |
| Source control | Status, diffs, commit, history, init |
| Terminal | node-pty + xterm panel, multiple tabs, env activation |
| Environments | uv/.venv/conda detection, per-project selection |
| Settings | App-wide settings tab persisted to userData |
| AI | Provider adapters (Anthropic/OpenAI/Ollama) + API-key chat; MCP server exposing manuscript verbs; "Open Claude Code here" launches a subscription-billed CLI wired to it |
| Python | suna_mpl: semantic gids, journal presets, deterministic SVG, anchor manifests, auto-rasterization |

## In progress

Nothing — the last batch landed. `pnpm smoke` runs **55 steps green**:
steps 29–33 measure the layout/citation contract in
`docs/design/ui-fix-plan.md`, steps 34–43 measure every acceptance
criterion in `docs/design/feature-plan-2.md` — including a live Crossref
search, an `add_comment` driven into the running app through the bundled
MCP server over stdio, and a PNG export verified by decoding the file's
own IHDR bytes — and steps 44–47 do the same for
`docs/design/feature-plan-3.md`: ⌘B round-tripped through the file on
disk and a context menu opened with a real right-click; margin-comment
card↔anchor alignment measured off `getBoundingClientRect()` (±8 px) with
a non-overlap check; New Figure asserted on disk (directory, schema-valid
`figure.json`, 180 mm artboard, `manuscript.json` entry) plus an SVG
import with zero duplicate ids that one ⌘Z removes; and the `ai-cli`
provider's default/cancel plumbing, with the cancelled child's pid
confirmed gone from `ps`.

Steps 48–54 do the same for `docs/design/feature-plan-4.md`. Each number
below is measured, not asserted from the spec:

- **Split** — ⌘\ on a focused section yields exactly **2** dockview
  groups, each holding one panel for that file; two further `openInSplit`
  calls leave the group list byte-identical, so the split reuses rather
  than nests.
- **PDF** — `references/nphys3816.pdf`, copied into the project through
  the real `fs:copy-file` channel, opens reading **"of 7"** — compared
  against the page count pdf.js reports for the same bytes *headlessly*
  in Node, never a number typed into the test. Page 1's canvas comes back
  3582 × 4708 device px (1243 × 1634 css), its text layer carries 165
  spans of real text, and three full scroll sweeps of the document leave
  **2** live canvases each time (budget 6, of 7 pages) — the lazy window
  really unmounts.
- **Image** — the canvas PNG export is reopened in the image viewer and
  its toolbar reads **2126 × 685 px**, equal to the dimensions decoded
  from the file's own IHDR chunk.
- **Reference PDFs** — three fixtures at `references/<citekey>.pdf`
  resolve via the `citekey` rule (and `peng2010`, which has none, resolves
  to `null` rather than a guess). Clicking gunn1972 → cortese2021 →
  jachym2019 in the References list leaves **exactly one** PDF tab after
  each click, in the side group, showing the one just clicked.
- **Citation right-click** — the `[@poggianti2017]` chip's menu carries a
  **disabled** *"No PDF found for @poggianti2017"*; a click on plain prose
  carries no such item at all; the `[@gunn1972]` chip's is enabled and
  choosing it opens the paper in the side group with the manuscript
  group's panel list unchanged.
- **Palette** — ⌘K opens over a focused prose editor with focus on
  `.palette__input`; `intro` matches **one** file, shown as
  `manuscript/sections/01-introduction.md`, and Enter opens it; ⌘⇧P
  prefills `>`; `>split right` produces 2 groups; `$echo SUNA_PALETTE`
  puts the marker in the terminal buffer **twice** (the echoed command,
  then the shell's output); Escape closes leaving tabs, terminals and the
  document text untouched.
- **Palette `?` mode** — a real agent CLI run is started and cancelled;
  the child is found in `ps` by the run's own unique prompt text and is
  gone afterwards, with the palette back to an enabled, empty input.

Three harness defects were fixed to make those measurements mean
anything. The suite pins the renderer viewport to 1600×1100 (macOS window
tiling was handing the app anything from 900 to 1265 px wide across runs,
which silently decided whether the comment gutter rendered cards or
dots); that pin is now **scaled by the page zoom**, because on a display
whose macOS scale factor is not an integer Chromium folds the remainder
into a page zoom and a raw `width: 1600` landed at `innerWidth === 1217`
(measured), quietly invalidating every width assertion under it. And the
drag-select helper works off per-line-box rects, so a phrase that
soft-wraps is selected instead of the whole paragraph between the union
box's corners.

One acceptance criterion is **verified by hand rather than by smoke**:
the billed `ai-cli` search ("≥3 results with DOIs inside 180 s") spends
real tokens per run. Last measured 2026-08-14 — 8/8 results with DOIs in
129 s, Gunn & Gott 1972 among them. See TESTING.md step 47. The palette's
`?` mode has the same shape: `pnpm smoke` starts and cancels a run, and
the full billed answer is not exercised on every run.

## Outstanding (next milestones)

1. **Submission export** — manuscript → LaTeX → PDF via bundled Tectonic,
   plus DOCX. Figure numbers/captions/refs baked to literal text before the
   renderer (flux's lesson); export dialog runs the compliance checker first.
2. **Provenance loop** — record canvas edits as replayable overlay ops in
   figure.json, replay on regeneration, "absorb" into the generating script
   as a reviewable diff (spec: provenance-loop.md).
3. **Manuscript-side compliance UI** — surface word/section/availability
   diagnostics (engine already implemented) in the manuscript view.
4. **Agent depth** — live bridge so an agent can drive the canvas command
   bus and editor with undoable, human-equivalent edits; figure screenshots
   for vision models.
5. **Packaging** — signed macOS build, bundled Tectonic + MCP server in
   resources.

## Known rough edges

- **`Insert cross-reference…` is specified (feature-plan-3 §1) but not
  built.** The context menu supports the action and omits any item whose
  callback a host does not supply; no host supplies this one, so the item
  never renders. `Insert citation…` beside it is wired and working.
- **⌘K is shared between *Insert link* and the command palette.**
  feature-plan-3 §1 gave it to the link command, feature-plan-4 §5 gave it
  to the palette. It is now split by selection: a non-empty selection
  becomes `[text](url)`, an empty one lets the key through to the palette
  (`editor/keymap.ts`, `insertLinkOnSelection`). Inserting an *empty* link
  from the keyboard is therefore no longer possible — use the context
  menu's *Link…*, which is enabled either way. If one of the two ever
  needs the key unconditionally, the other has to move.
- The palette's `$` mode always starts a **new** terminal tab for the
  command rather than typing into the running shell — `terminal/sessions.ts`
  exposes no way to write into a session from outside itself, so "reuse"
  currently means reusing the panel.
- `PdfTab` resolves **every** `doc.getPage(n)` up front, to lay out
  correctly-sized placeholders before anything renders. Rendering itself
  is properly lazy (measured: 2 live canvases across a 7-page document,
  however far you scroll), but the open cost grows with page count. The
  shipped fixtures are 7–21 pages and open instantly; the "300-page PDF"
  the spec names has not been measured, and page *proxies* — not
  canvases — are what would grow there.
- `toggleWrap` matches delimiters as plain substrings rather than through
  the markdown syntax tree, so `*` (italic) and `**` (bold) are ambiguous
  where they overlap — toggling italic on already-bold text can read one
  of the bold delimiters as an italic one. Disambiguating properly needs
  CommonMark's delimiter-run counting.
- The margin gutter only renders a card for an anchor inside the visible
  strip; everything else becomes an edge badge. That is the intended
  design, but it means "click the card for comment X" is only possible
  once X's anchor is scrolled into view.
- A section's dirty dot is set by any edit and only cleared by a save —
  undoing back to the on-disk text still shows the tab as modified.
- Layers panel lists matplotlib's metadata/RDF nodes unfiltered.
- Agent chat has no streaming or tool use yet (single-turn text); the MCP
  path (agent CLIs) is the richer route.
- Reordering the *affiliations array* only renumbers superscripts for
  affiliations no author references — numbering is derived from first
  appearance in author order, so an author-referenced affiliation keeps
  its number until the authors move. The row editor shows the derived
  number (not the array position) so the two never disagree.
- OpenAlex is metered: keyless `search` returns HTTP 429 on this machine,
  while a single-work `by-doi` lookup still answers. The panel reports
  each honestly; add a key in Settings for dependable search.
- Canvas ruler labels crowd at low zoom on a narrow viewport (10 mm
  labels can touch below ~40 % zoom); ticks stay correct.
- The ruler's tick positions are pushed in from a layout effect after the
  world transform commits — computing them during render reads the
  previous transform and leaves the ruler a frame behind the canvas.
- The MCP server externalizes zod/jsdom, so packaging must ship those
  node_modules alongside dist-mcp/server.mjs.
- Conda detection shells out to `conda env list`; a slow conda install
  makes the env popover wait up to 8s on first open.
