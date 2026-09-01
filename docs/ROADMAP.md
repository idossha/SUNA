# Roadmap

What SUNA does today, and what is still open. The contract is `docs/ARCHITECTURE.md`; every
decision behind a line here is in `docs/DECISIONS.md`.

**Verified means tested by unit suites *and* driven in the real app.** Anything with only unit
coverage says so, every time.

---

## What exists

**The workspace.** A VS Code-like Electron shell: activity bar, resizable sidebar, dockview tabs
with split view (⌘\ / ⌘⇧\), status bar, integrated terminal, command palette. A project is any
directory with a `suna.json`; opening one runs `git init` and an initial commit if it has no
repository. Dock layout is *not* persisted — every launch opens the welcome panel.

**Writing.** One flat prose file, `manuscript/manuscript.md`, in SciMark — CommonMark plus math,
citations, cross-references and figure embeds. Source ⇄ Reading modes over the same buffer, where
Reading is an *editable* live preview with cursor reveal, not a read-only pane. Vim motions,
markdown formatting commands, GFM tables, a `.bib` language pack, a CSV/TSV grid. The outline is
derived from headings; nothing about structure is stored. One buffer per file across every surface,
so the manuscript tab and a raw editor tab on the same file are two views of one document, with one
dirty state and one atomic save path.

**Comments.** A sidecar `manuscript/comments.json` — the prose is never marked up (D8). W3C-style
prefix/quote/suffix anchors re-locate exactly, then by context, then fuzzily, and mark `detached`
rather than ever deleting (D7). One anchoring implementation serves the app and the MCP verbs, so
human- and agent-authored anchors resolve identically (D10).

**Figures.** An SVG-DOM canvas whose document model *is* the file (§10): byte-identical round-trip
over real matplotlib exports, inverse-op undo through a command bus, tools, handles, snapping,
layers, mm rulers, align/distribute, artboard presets from the active profile, and export to SVG
(a byte-identical copy), PDF, PNG and TIFF at the exact journal-spec pixel size.

**References.** `references.bib` with a Cited/Uncited filter, literature search across Crossref,
OpenAlex, NASA ADS and arXiv, and an AI-search provider that spawns an agent CLI against the
user's existing subscription. Reference PDFs resolve from the BibTeX `file` field, then
`references/<citekey>.pdf`, then a fuzzy `Author_Year` match. Study acquisition turns a free-text
mention into a PDF-backed citation and always names which of four outcomes happened — with low
confidence writing nothing at all (D2).

**Journals.** Nine journal profiles plus the SUNA house style, each field carrying its source URL
and a provenance tag. Anything a journal does not state is `null`, never guessed (D4). Compliance
flags and never reformats (D3).

**Review.** Rounds, response letters with `::quote` / `+++` reply markup, cover letters, version
comparison, and reading notes over reference PDFs.

**Export.** DOCX via the `docx` library and PDF via Chromium's `printToPDF`, both profile-driven,
plus a self-contained HTML page. DOCX import creates a new project after a review screen.

**Agents.** An MCP server exposing 34 typed verbs over stdio, a three-layer context system, and
directed AI actions from the comment rail, the canvas and the palette. `docs/AUTOMATION.md` is the
reference.

**Shipping.** Signed and notarized macOS builds, plus Linux installers, published by a
release workflow that verifies its own assets before publishing. CI typechecks and tests on both
supported platforms and launches the packaged bundle on macOS.

---

## What is open

Ordered roughly by how much it would change the product.

**1. The provenance loop.** The whole point of the figure half — edit on the canvas, replay onto a
regenerated figure, absorb back into the generating script as a reviewable diff — is designed and
**not built**. `packages/provenance` is `export {}` with no importers. §11.3 states exactly what is
missing and §11.4 the rules any implementation must satisfy. Today, re-running a plotting script
overwrites canvas work.

**2. Agent depth on the canvas.** The command bus is designed for the agent and the GUI to be equal
clients, and today only the GUI is a client: `canvas_query` / `canvas_dispatch` /
`canvas_screenshot` do not exist and the agent's figure surface is read-only (§10.4). This is the
gap between the architecture's claim and its delivery.

**3. Manuscript-side compliance UI.** The engine is built and agent-reachable as `check_manuscript`;
compliance is surfaced in the Export dialog only, not as inline diagnostics while writing.

**4. The compliance rule set is a fraction of the planned one.** 26 rules are implemented; of the
54 sourced against real guidelines, only 13 ship, so **41 remain unbuilt** — inventoried at the end
of §12.1 with the profile field each would read. There is **no citation (`CIT-*`) surface at all**,
and the `export` and `package` diagnostic surfaces are declared but emitted by nothing (§20.8).

**5. Notebooks still need `ipykernel` installed by hand.** The kernel bridge asks for it and
nothing in onboarding installs it, so the first notebook a new user opens fails (§20.6). The
`suna_mpl` half of this item is **done**: the library is staged into the bundle and located
through `$SUNA_MPL`, so the bundled example's figure regenerates from an installed app (§16.1).
What no staging can fix is that `uv` and a Python interpreter are the user's to install; the docs
state that rather than implying a batteries-included Python.

**6. In-app AI is shallow.** Three non-streaming `chat()` adapters, no tool use, no streaming, no
ghost suggestions. The MCP path driven by an agent CLI is the capable route and is where the depth
should go.

**7. Collaboration.** Nothing built. §22 records the settled position and the rejections — CRDTs,
hosted documents, host-peer authority — so a future attempt does not rediscover them.

**8. Sponsor packages and the round freeze.** Schema only. `FreezeSchema` exists but there is no
`git:tag` IPC channel, so the tagging half has no transport; treat `Freeze.tag` as reserved.

**9. The response workspace's third pane.** Undecided: should it show the manuscript, or the diff
against the frozen submission? Both are defensible and a toggle is the obvious way to ship two half
features, so this wants an answer before it is built rather than after. Recorded here because the
design note that raised it is gone and the question outlived it.

**10. LaTeX-native export.** Deliberately absent, not missing: PDF export is a clean submission
manuscript, not TeX-quality typesetting. A bundled-Tectonic path is a quality upgrade for
LaTeX-native journals, and nothing in the current export path needs it.

---

## Known broken, right now

These are failures, not gaps. Fix them before adding to the list above.

- **`pnpm smoke` gets through 62 of ~80 steps; 16 fail.** Measured 2026-09-01. It used to die at
  step 6, so this is a backlog being worked off rather than one stale selector. Fixed so far: the
  `reading-mode` step's stale `.editor-tab__mode` precondition; a flat `sleep(1500)` after CDP
  connect that made `app-loads-welcome` fail on cold-dev-server boot timing rather than on anything
  it asserts (now a real poll, outside the step system so `--only` runs get it too); and the PDF
  steps, which read three real journal PDFs from a **local stash at `<repo>/references/` that was
  never committed** — those steps could not pass on any clean checkout, and committing publisher
  PDFs would breach this repo's own no-third-party-content rule, so the fixtures are generated
  instead (`scripts/e2e/fixtures/make-pdf.mjs`).

  Still failing: `tree-icons`, `onboarding-version-control`, `agent-cli-mcp-config`,
  `terminal-panel`, `references-panel-fits`, `shared-buffer-live-sync`, `external-edit-live-reload`,
  `mcp-server-exposes-all-verbs`, `reference-pdfs-resolve-and-open-in-side-group`,
  `command-palette-modes`, `palette-ai-ask-cancel`, `recent-projects-list-open-and-forget`,
  `onboarding-creates-exactly-what-review-showed`, `help-overlay`, `help-in-vim-mode`,
  `figure-save-shows-in-manuscript`.

  **That list is not 16 independent bugs.** It was measured under
  `SUNA_SMOKE_KEEP_GOING=1`, and steps consume state earlier steps create — so an unknown number
  are cascades from an earlier failure rather than faults of their own. Triage by running the first
  failing step alone with its prerequisites (`--only`) before believing any single entry.
  `terminal-panel` in particular is suspected environmental: `term:create` fails with
  `posix_spawnp failed` in the driven dev app, and that reproduces with unrelated changes reverted.
- **PDF export has never been produced under automation.** `printToPDF` needs a running Electron
  process; the DOCX half is asserted down to `word/document.xml`, the PDF half only as far as the
  HTML it prints.
- **The study-acquisition download ladder and local scan have no smoke step.** Unit-tested end to
  end with injected providers and a real temp tree; never driven in the running app.

---

## Rough edges

Small, known, and each one is a real thing a user can hit.

- `toggleWrap` matches delimiters as substrings rather than through the syntax tree, so `*` and
  `**` are ambiguous where they overlap. Doing it properly needs CommonMark delimiter-run counting.
- ⌘K is split by selection: a non-empty selection makes a link, an empty one falls through to the
  palette. Inserting an *empty* link from the keyboard is therefore not possible — the context
  menu's *Link…* is.
- The palette's `$` mode always opens a new terminal tab; `terminal/sessions.ts` exposes no way to
  write into a running session from outside it.
- `PdfTab` resolves every page proxy up front to size placeholders. Rendering is properly lazy
  (measured: 2 live canvases across a 7-page document), but open cost grows with page count, and a
  300-page PDF has not been measured.
- The manuscript tab's dirty dot clears only on save — undoing back to the on-disk text still shows
  modified.
- The layers panel lists matplotlib's metadata and RDF nodes unfiltered.
- Canvas ruler labels crowd below roughly 40% zoom on a narrow viewport; the ticks stay correct.
- `brain-stimulation` is a skeleton profile and `sleep-advances` is thin — ScienceDirect, Elsevier
  and the journal sites returned HTTP 403 to every fetch, so their limits are `null` rather than
  borrowed from a sibling journal. Both need direct re-verification before their limits are trusted.
- `authorTruncation.truncateWhenMoreThan` means "the largest author count still printed in full", so
  a journal truncating *at* N is encoded as `N − 1`. Read any new profile against this off-by-one.
- DOCX import flags the first author as corresponding when the document marks nobody — a
  convention, not a fact the document stated. The review screen is where the user fixes it.
- OMML equations are counted and flagged, never converted: a Word-equation-heavy manuscript imports
  its text and warns rather than emitting broken LaTeX.
- Conda detection shells out to `conda env list`; a slow install makes the environment popover wait
  up to 8 s on first open.
- OpenAlex is metered — keyless search can return HTTP 429 while a single-work DOI lookup still
  answers. The panel reports each honestly; a key in Settings makes search dependable.
