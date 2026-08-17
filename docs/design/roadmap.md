# SUNA — status & roadmap

Living status of what is built, verified, and outstanding. Verified means
tested by unit suites AND driven in the real app by `pnpm smoke` (CDP) or a
recorded manual check.

**Exception — feature-plan-6 (journal profiles, DOCX import, DOCX/PDF
export).** `pnpm smoke` was explicitly excluded from that milestone by the
user, so those three rows are verified by unit suites plus **Node-driven
fixture round-trips** (a real 55 MB manuscript for import; `examples/demo-paper`
exported under two contrasting profiles) rather than by CDP. One gap is
honest and known: the exported **`.pdf` has never been produced under
automation**, because `printToPDF` needs a running Electron process that the
verification environment could not launch. The DOCX half is asserted down to
`word/document.xml`; the PDF half only as far as the HTML it prints. See
TESTING.md → *DOCX import / export*.

**Exception — feature-plan-7 (flat manuscript, authors.json,
tab-opens-manuscript, project switcher).** `pnpm smoke` was excluded from
this milestone too, and the driver was **not updated** for the new layout:
`scripts/e2e/smoke.mjs` still clicks the removed `.ms__open` button and
still reads and writes `manuscript/sections/*.md`, so it would fail if
run. That is deliberate — rewriting an e2e driver that cannot be executed
to confirm the rewrite would trade a known-stale suite for an unverified
one. The milestone's gates were `pnpm typecheck`, `pnpm test` and
`pnpm --filter @suna/desktop build` (all green: 1762 unit tests across 129
files), plus four **Node-driven fixture round-trips**: the shipped example
is flat and schema-valid with every citation key and every line of prose
intact; the pre-flat example restored from git history migrates with 84/84
non-empty prose lines preserved, idempotently, and rolls back byte-identical
when it must abandon; a real `.docx` exports from the flat example with the
title, an author name and all three derived headings present in
`word/document.xml`; and the bundled MCP server answers `read_manuscript`,
`list_outline` and the legacy `read_section` alias over stdio. **Not
verified**: the switcher and the automatic on-open migration inside a
running Electron process. See TESTING.md → *Flat-layout coverage*.

## Built & verified

| Area | State |
|---|---|
| Shell | VS Code-like: activity bar, resizable sidebar (persisted), dockview tabs, status bar, terminal panel |
| Project | Scaffold + git init; "Open example" copies the demo to userData and git-inits it |
| Editor | Reading default, working content-width (50–150ch), **layout by content kind** (prose wraps at the measure — left-aligned in Source, centered in Reading; code/data never wrapped or width-constrained, always mono, flush at the gutter), GFM tables in reading mode, vim motions, .bib language pack (highlight/lint/completion), CSV/TSV data grid |
| Manuscript editing | SciMark (math, citations, cross-refs, figure embeds, raw LaTeX); Source ↔ Reading modes, Reading = editable live preview with cursor-reveal |
| Manuscript layout | **One flat prose file** (feature-plan-7 §1). `manuscript/` is exactly `manuscript.md` + `manuscript.json` (metadata only) + `authors.json` + `references.bib`; no `sections/`. Sections are Markdown headings and the outline is **derived** by `outlineFromMarkdown` in `@suna/markdown` (fence/setext/blockquote aware, tiling offsets, word counts excluding markdown syntax), with the prose before the first heading kept as an untitled leading section. `manuscript.json` names its own prose file in `manuscriptFile`. Old projects **migrate on open**: build and validate in memory → atomic-write the three files → re-read and re-parse → retarget `comments.json` → and only then delete `sections/`; any failure rolls back to a byte-identical project that still opens unmigrated, and the outcome rides back on `project:open` as `{ migrated, notes, error }` for the UI to surface. Idempotent. Everything downstream follows the same one file: DOCX import writes it, export derives its sections from it, compliance matches required sections against its headings, `useCitedKeys` reads it once, and the MCP verbs became `read_manuscript`/`write_manuscript`/`list_outline` with `read_section`/`write_section` kept as path-ignoring aliases |
| Manuscript document | Combined tab: title page (authors/affiliations from `authors.json`, abstract/significance/highlights), **one** live-preview editor over the whole of `manuscript.md` (feature-plan-7 §1 — headings render through the editor's own live preview, not per-section wrappers), references page numbered by first appearance per profile; scroll-spy outline with word counts, run against each outline entry's heading offset in that single document; own settings gear driving **one measure** for title page + prose + references; live cross-reference resolution (`Fig. 1a`, `equation (1)`, numbered display equations) with unresolved ids flagged, never blanked. Activating **Manuscript** in the activity bar opens or focuses this tab directly — the *Open full manuscript* button is gone (§2) |
| Project switcher | The title bar's project name is a menu button (feature-plan-7 §3): up to 8 recents with their parent paths (a missing one dimmed, with Remove), *Open project…*, *New project…*, *Open example*; it reads *Open project* with nothing open. One switching function, `openProjectAt(dir)`, serves every "open an existing project" path — it re-points the project store, closes the previous project's file/canvas/PDF/image/manuscript tabs (settings/export/import/onboarding stay), refreshes the tree, reloads comments and runs the migration; reference-PDF and settings resolution follow on their own because both already subscribe to the project store |
| Editable title page | Every title-page field writes `manuscript.json`: click-to-edit in place for title/running title/abstract/significance/highlights, compact row editors for authors and affiliations (reorder, add/remove, ORCID + e-mail with inline validation, corresponding/equal-contribution flags, affiliation multi-select). Read → merge → validate → **atomic write** in the main process on every commit, so an agent editing the same file is never clobbered; invalid input shows an error and leaves the file byte-identical. Affiliation superscripts stay **derived** from author order |
| Comments | Sidecar `manuscript/comments.json` — the prose is never marked up. W3C-style prefix/quote/suffix anchors re-locate exactly → by context → fuzzy, and mark `detached` instead of ever deleting; in-session, anchors are CodeMirror-mapped through every edit (StateField), and refreshed against the saved text on every save. **Right-side comments rail** (manuscript tab + prose editor tabs; the flux model): a collapsible, resizable column with its own scrolling list sorted by document position — no per-card positioning, so scrolling costs the comments layer nothing. Click highlight ⇄ card both ways (card click flashes + scrolls to the anchor; highlight click activates + scrolls the card into the rail); resolved threads stay listed dimmed with Reopen; detached/unanchored collect in a delete-friendly bucket; delete is immediate with an app-shell **Undo toast**; ⌘⇧M on a selection auto-opens the rail with the composer; ⌘⌥M / 💬 toggles it. One anchoring implementation in `@suna/core` shared by the app and the MCP tools (`list_comments`, `add_comment`, `reply_comment`, `resolve_comment`), so human- and agent-authored anchors resolve identically |
| Shared doc sessions | One buffer per file across every editing surface (`state/docSessions`): the raw editor tab and the Manuscript tab are two live views of the same document — typing mirrors instantly (ChangeSet forwarding with IME-safe OT rebasing), one dirty state, one atomic save path (`fs:write-text` is tmp+rename now). External writes (agent MCP edits, git) reach live editors through the project watcher as a **minimal mapped change**, so caret/scroll/comment anchors survive; a dirty buffer gets a divergence banner (Reload from disk / Keep mine) instead of silent clobbering. The Explorer marks `manuscript.md` open/active while the Manuscript tab holds it |
| Text editing | Word/Flux-grade markdown formatting on prose files: ⌘B/⌘I/⌘⇧C/⌘⇧X/⌘K plus a right-click context menu (Comment, the four inline toggles, Link…, Insert citation…, **Open reference PDF**, Cut/Copy/Paste) that disables what cannot apply. ⌘K makes a link out of a **selection**; with an empty selection it falls through to the command palette, and the no-selection *Link…* stays on the context menu. `toggleWrap` is a pure `EditorState → TransactionSpec` function — it toggles the word under a bare cursor, unwraps the **whole** enclosing delimiter pair for a partial selection (so it can never orphan a `**`), and splits multi-line selections per line. Every command is one transaction, so one ⌘Z reverts it whole |
| Figure canvas | SVG-DOM engine (byte-identical round-trip, inverse-op undo), full editing suite (tools, handles, snapping, layers, properties), compliance chip; **create from scratch**: New Figure (Figures header + canvas tab) writes `figures/<slug>/{figure.svg,figure.json}` at the active profile's double-column width × 0.618, registers it in `manuscript.json` and opens it; a blank artboard shows a drop hint; drag-drop or ⌘⇧I imports an SVG as one `<g id="imported-N">` with every internal id namespaced to `impN-` (193 demo ids, zero collisions) or a PNG as a 300 dpi data-URI `<image>` — each a single undoable command; **parity rail**: align/distribute, mm rulers (1 mm ticks, 10 mm labels, artboard origin, live cursor, tracks pan/zoom), figure panel (artboard mm, background, duplicate figure, auto-letter panels as one undoable batch), palette ramps from the active profile, and export — SVG (byte-identical copy), PDF, PNG/TIFF rasterized at the exact journal-spec pixel size |
| Journal profiles | **12 profiles** from official author guidelines with per-value source URLs + provenance tags (`documented` / `counted-empirically` / `inferred`); figure & manuscript compliance checkers; the canvas export presets are driven by the *active* profile (`Double column (180 mm)` for Nature, not a hardcoded width). feature-plan-6 §1 added the neuroscience set — Nature, Neuron, PNAS, Brain Stimulation, SLEEP, Sleep Advances, J. Neural Engineering, J. Neuroscience — beside the original Nature Astronomy / Science / ApJ / MNRAS. **Anything a journal does not state is `null`, never guessed**; where a publisher's site refused every fetch (Elsevier/Cell/PNAS/SfN all returned HTTP 403), the affected fields stay null and the profile's `notes[]` says so rather than borrowing a sibling journal's rules |
| References | Bib list, Cited/Uncited filter, missing-entry warnings; **"Rendered as" is one shared control** — it drives the sidebar preview *and* the manuscript body's in-text chips (author–year ⇄ numeric superscript) and both reference lists' sort/numbering |
| Literature search | Provider abstraction in `@suna/bib` (Crossref keyless by default, OpenAlex, NASA ADS, arXiv) shared by the main process and the standalone MCP server. Search tab with result cards, *Add to references.bib* (generated `firstauthorYEARword` key, deduped), *Copy DOI*, *Open*, *Find similar*. Failures are surfaced verbatim with the provider switch inline — OpenAlex's HTTP 429 is reported, never disguised as "no results". **AI search** (`ai-cli`) spawns Claude Code or Codex from the main process, billed to the user's existing subscription rather than a metered API: strict JSON-array prompt, per-item schema validation that drops malformed entries instead of failing the search, narrated progress, a hard 180 s budget, and a Cancel that really kills the child. It becomes the default once a CLI is detected, and asks for 8 papers (not 20 — the agent verifies each one, and 20 ran past the timeout). Measured: 8/8 results with DOIs in 129 s. Deliberately **not** exposed over MCP, so an agent never recurses into another agent CLI |
| Split view | ⌘\ / ⌘⇧\ duplicate the active tab into a group beside/below it, over dockview's own position API — never a second layout engine. The split reuses the existing second group instead of nesting endlessly, so ⌘\ any number of times leaves exactly two groups. `openViewerInSide` makes that group *the* viewer: a new PDF replaces the previous one rather than stacking tabs |
| PDF & image viewers | `.pdf` opens in a pdf.js viewer in the **renderer** (continuous scroll, page N-of-M + jump, fit-width/zoom/⌘±/⌘0, a real text layer so selection and ⌘F work). Pages render lazily through one IntersectionObserver and unmount outside a ±800 px window, so a long document keeps a small constant number of live canvases however far you scroll. `.png/.jpg/.jpeg/.gif/.webp` open in an image viewer with fit/100 %/zoom, drag-to-pan and a pixel readout. Bytes arrive over `fs:read-binary` (root-confined, 200 MB ceiling, base64) — no `file://`, no CSP relaxation, and PDFs are never rewritten |
| Reference PDFs | Pure `resolvePdfPath` in `@suna/bib`: the BibTeX `file` field (Zotero/JabRef forms included), then `references/<citekey>.pdf`, then an `Author_Year*` fuzzy match. A store scans once per project and on every save, so the citekey → PDF map is ready even if the References view was never opened. Right-clicking a citation in the manuscript offers **Open reference PDF** (disabled and naming the key when none resolves), which opens the paper in the side group without disturbing the manuscript. Selecting a References row auto-opens its PDF there (`references.autoOpenPdf`, default on); rows without one offer **Attach PDF…**, which *copies* the picked file to the conventional path and rescans |
| Command palette | One ⌘K popup (⌘⇧P straight into command mode) with four prefix modes: fuzzy file search over **project-relative** paths, `>` app commands from a registry any feature can add to, `$` a line run in the integrated terminal, `?` a prompt sent to the agent CLI with streamed progress and a Cancel that really kills the child. Recents persist per project |
| DOCX import | `.docx` → a real project (`manuscript.json`, `manuscript.md`, `authors.json`, `references.bib`, extracted figures) with `mammoth` + `jszip`, no external binary. Documented heuristics — title as the first heading *or fully-bold paragraph* (real manuscripts bold it), authors from `<sup>` markers, affiliations, abstract — each reported with its reason in an **import review screen that writes nothing until confirmed**. Citation markers are rewritten to `[@key]` **only where the mapping is unambiguous**; everything else stays literal and is listed. Import refuses to overwrite an existing SUNA project unconditionally. Verified on a real 55 MB manuscript: 10/10 authors with affiliation links, 24 sections, 69 references round-tripping through `parseBibtex`, 7 figures as files, **zero `data:` URIs**, source byte-identical |
| DOCX / PDF export | Both driven by the **active profile** off one shared content model that reproduces the live Manuscript tab's citation numbering, reference ordering and cross-reference labels. `.docx` via the bundled `docx` library; `.pdf` via Electron's `printToPDF` on our own HTML — **no LaTeX, no Tectonic, no external binary** (the former optional `docx-tools` accelerator was removed; everything ships in-package). Output lands in `output/`; sources are never mutated. The compliance checker runs first and **warns, never blocks** |
| Source control | Status, diffs, commit, history, init |
| Terminal | node-pty + xterm panel, multiple tabs, env activation |
| Environments | uv/.venv/conda detection, per-project selection |
| Settings | App-wide settings tab persisted to userData |
| AI | Provider adapters (Anthropic/OpenAI/Ollama) + API-key chat; MCP server exposing 20 manuscript verbs (incl. `edit_manuscript` anchored edits and `check_manuscript` compliance); "Open Claude Code here" launches a subscription-billed CLI wired to it |
| Agent context layer | adr-004: machine-level `~/SunaConfig/Context/` (UserContext seeds + 7 hash-synced SunaContext docs teaching the SUNA contract), per-project marker-tagged `AGENTS.md`/`CLAUDE.md` stubs + `context/` memory files (MISSION/NOTEBOOK/RULES), machine-local gitignored `.mcp.json`, `~/.claude/skills/suna` pointer skill — written by every scaffold, healed on every project open and MCP boot, drift-gated against the verb registry in `pnpm test` |
| Python | suna_mpl: semantic gids, journal presets, deterministic SVG, anchor manifests, auto-rasterization |

## In progress

**feature-plan-9** — help from a vim buffer (⌘? / `:help`), explorer
drag-and-drop whose moves retarget open tabs, and the two Finder actions
— smoke steps 70–71 plus `probes/explorer-dnd.mjs` cover it as far as the
IPC boundary; the OS effect of Reveal/Open is manual (TESTING.md →
*Explorer drag-and-drop, and the OS actions*, last measured: PENDING).

**feature-plan-8** — the `?` shortcut-help overlay plus directed AI
actions (comment fix, canvas figure edit, dev-only UI repair) — is built
with the unit gates green; smoke steps 67–69 and the two drive probes
(`scripts/e2e/probes/`) cover the unbilled halves, and both billed legs
are unmeasured (TESTING.md → *Directed AI actions*, last measured:
PENDING). **The `pnpm smoke` account below is from
before feature-plan-7 and the driver has not been updated since** (see the
feature-plan-7 exception at the top): the steps that touch the manuscript
tab, its per-section saves and its comment targets — 17, 18, 29, 31,
35–37 and 43 — reference selectors and paths the flat layout removed.
What each of them measures is still a real requirement.

`pnpm smoke` ran **55 steps green** at feature-plan-6:
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

0. **Bring `scripts/e2e/smoke.mjs` up to the flat layout**, then run it.
   Concretely: replace the `.ms__open` clicks (lines 1070, 1074, 1658,
   1662, 2029) with activating the Manuscript view, which now opens the
   tab itself; retarget the per-section ⌘S round-trip and the
   bogus-crossref byte-identical probe (1183, 1607, 1852, 4490) at
   `manuscript/manuscript.md`; and change the comment targets (2316,
   2409) from `sections/02-results.md` to `manuscript.md`. Then add the
   two steps feature-plan-7 has no automated coverage for at all: a
   project **switch** through `__sunaDev.openProjectAt` asserting the old
   project's tabs closed, and an **old-layout project opened** so the
   automatic migration runs inside a live Electron process.
1. **LaTeX-native export** — *not* a repeat of feature-plan-6. DOCX and PDF
   export are **built** (see *Built & verified*); PDF goes through Electron's
   `printToPDF`, which is a clean submission manuscript, **not
   LaTeX-quality typesetting**. A LaTeX → PDF path via bundled Tectonic
   remains a possible future milestone for LaTeX-native journals, and was
   explicitly out of scope for feature-plan-6 (§4). Nothing in the current
   export path requires it, so this is a quality upgrade, not a gap.
   Remaining smaller pieces: a smoke step for export, and producing/checking
   a real `.pdf` under automation.
2. **Provenance loop** — record canvas edits as replayable overlay ops in
   figure.json, replay on regeneration, "absorb" into the generating script
   as a reviewable diff (spec: provenance-loop.md).
3. **Manuscript-side compliance UI** — surface word/section/availability
   diagnostics in the manuscript view (the engine is implemented and now
   agent-reachable as the `check_manuscript` MCP verb; the in-app surface
   is what remains).
4. **Agent depth** — live bridge so an agent can drive the canvas command
   bus and editor with undoable, human-equivalent edits; figure screenshots
   for vision models.
5. **Packaging** — signed macOS build, MCP server in resources. Tectonic
   only becomes a packaging concern if milestone 1's LaTeX path lands;
   DOCX/PDF export as built needs no external binary. The packaged
   `.mcp.json` already runs the app binary as Node
   (`process.execPath` + `ELECTRON_RUN_AS_NODE`, adr-004), so no system
   `node` is needed once the bundle ships in resources.

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
- Comments render in a right-side rail (a plain list sorted by document
  position, with its own scroller — the flux model); every thread's card
  is always clickable, and highlight ↔ card navigation works in both
  directions. Comment delete is immediate with an Undo toast.
- The manuscript tab's dirty dot is set by any edit and only cleared by a
  save — undoing back to the on-disk text still shows the tab as
  modified. With one editor over the whole file it is now one dot for the
  whole manuscript rather than an aggregate over sections.
- **`@suna/formatter` gained a dependency on `@suna/markdown`** so the
  required-section check can read headings out of the prose through the
  one outline implementation instead of a second, private heading scanner.
  It is declared in `packages/formatter/package.json`; the workspace link
  was created by hand (no `pnpm install` was run during this milestone),
  so the next real install is what makes it official.
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
- **`brain-stimulation` is a skeleton profile.** ScienceDirect, elsevier.com
  and brainstimjrnl.com all returned HTTP 403 to every fetch, so only the
  citation family, the 250-word structured abstract and the 300 dpi figure
  spec are recorded; word limits, entry templates, figure widths and
  required sections are `null`. `sleep-advances` is similarly thin — its
  guidelines page states no citation style at all, and the four
  non-nullable citation fields carry a **placeholder flagged `inferred`**
  rather than SLEEP's rules, which would have violated the no-sibling
  -inference rule. Both need direct re-verification before their limits are
  trusted for compliance checking.
- **`authorTruncation.truncateWhenMoreThan` is "the largest author count
  still printed in full"**, so a journal that truncates *at* N authors is
  encoded as `N - 1`. SLEEP ("all names when fewer than seven; when seven or
  more, list the first three") shipped as `7` and printed all seven names on
  a 7-author reference; it is now `6`, with a boundary test. Any new profile
  should be read against this off-by-one.
- **Import guesses the corresponding author when the document marks
  nobody.** A `*`/`†`-marked correspondence line is detected, split out of
  the affiliation list, and its e-mail attached to the marked author. With
  no marker at all the first author is flagged corresponding — a convention,
  not a fact the document stated, and the review screen is where the user
  fixes it.
- **OMML equations are counted and flagged, never converted.** A
  Word-equation-heavy manuscript imports its text and warns rather than
  emitting broken LaTeX (feature-plan-6 §2's explicit instruction).
- Conda detection shells out to `conda env list`; a slow conda install
  makes the env popover wait up to 8s on first open.
