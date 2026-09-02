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
supported platforms and launches the packaged bundle on macOS. Installed copies update themselves
(§23): a launch check against the published Releases, and download-and-restart on macOS and the
AppImage — a `.deb`/`.tar.gz` is told, not replaced.

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

**5. Python itself is the user's to install.** The `ipykernel` half of this item is **done** and
**verified**: onboarding offers to install the notebook runtime into the environment it is about
to create, the notebook's own "no kernel" panel repairs whichever interpreter is selected later,
and `scripts/e2e/probes/notebook-kernel-onboarding.mjs` drives the real wizard and asserts a cell's
output text. Both callers ask first, and an environment the user already owned is offered the
install **unchecked** (§16.2, §20.6). The `suna_mpl` half is done too: the library is staged into
the bundle and located through `$SUNA_MPL`, so the bundled example's figure regenerates from an
installed app (§16.1).

What is left is the part no code can fix: SUNA bundles no interpreter and no `uv`, and the install
needs a network. On a machine with neither, the uv branch is offered disabled and a figure cannot
be regenerated; where an install fails it is reported with the command to run, never swallowed.
The docs state this rather than implying a batteries-included Python.

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

- ~~**`pnpm smoke` gets through 62 of ~80 steps; 16 fail.**~~ **Closed 2026-09-01.** The suite runs
  all **78** steps to completion, green, on two consecutive full runs. Of the sixteen, three were
  one environmental fault (`pnpm package:mac` rebuilding `node-pty` per-slice and leaving the wrong
  arch in the shared `node_modules`, fixed in `scripts/electron-builder.sh`), two more were cascades
  of a single earlier failure, one more only looked like a bug (see the shared-buffer note in
  DECISIONS 2026-09-01), and the rest were **stale steps** — assertions still describing an
  app that had deliberately moved: the explorer no longer pre-expands folders, theme variables live
  on `.app[data-suna-theme]` rather than `:root`, the wizard lost its "Import existing" step, the
  sidebar no longer repeats the manuscript title, the help overlay gained a Notebook section, and
  three steps still named the demo paper `examples/hello-suna` replaced. **One was a real
  regression** — see the next entry.

  The steps were fixed, never weakened: no assertion was deleted, no matcher loosened, and nothing
  was skipped. Where a step could not pass honestly it was rewritten to assert the *new intended*
  behaviour, which in two cases is a stronger check than the one it replaced (the agent-layer heal
  must now be shown NOT to clobber a project's own `context/MEMORY.md`, and the shared-buffer step
  targets its editor tab by `data-path` rather than by "the first visible one").

  **The stall under it is fixed too (2026-09-01).** Roughly one run in six parked forever in
  `crossref-resolution` — the app answered a second CDP client normally, so it was the driver's
  connection that stalled, and `cdp.mjs` had no deadline on a call and nothing rejecting calls in
  flight when the socket died. Both are closed: every CDP call carries a generous timeout
  (240 s default, `SUNA_CDP_TIMEOUT_MS` or a per-call override), and a closed or errored socket
  now fails every request waiting on it. A hang is the worst failure a suite can have — it is
  indistinguishable from slow progress, and CI would burn its whole job budget before saying
  anything — so this converts "never" into a named failure, deliberately without policing latency:
  the agent-CLI steps legitimately hold a call open for their full 180 s budget.

  **Separately, the suite is currently flaky and that is NOT the same problem.** Measured
  2026-09-01 across four consecutive runs: three greens earlier in the day, then four runs that
  each failed a *different* step — `recent-projects-list-open-and-forget`,
  `explorer-create-rename-delete`, `explorer-drag-move`, `canvas-opens-figure` — including one run
  with the CDP change reverted, so the deadline is not the cause. Every one of those steps waits
  for an asynchronous UI update (a file watcher reaching the tree, a canvas mounting), which is the
  same class of fixed-`sleep`-instead-of-poll problem that made `app-loads-welcome` fail on boot
  timing. Treat a single red run as unproven until the step is re-run alone.

- ~~**The New project wizard's Review page previewed a `suna.json` it did not write.**~~ **Fixed
  2026-09-01, and it is the most valuable thing the stale suite was hiding.** `scaffoldProject`
  gained `documents: starterDocuments()` when a project learned to hold more than one document
  (§4.2); `buildProjectManifest`, which renders the Review preview, did not — so the page whose
  entire promise is "this is exactly what Create will write" showed a manifest missing the whole
  document registry, and the cover letter the Starter ships was invisible until after Create. One
  definition now serves both (`starterDocuments()` in `@suna/core`), with a unit test either side
  of it. DECISIONS 2026-09-01.

- ~~**PDF export has never been produced under automation.**~~ **Closed 2026-09-01.**
  `scripts/e2e/probes/pdf-export-bytes.mjs` exports `examples/hello-suna` from the hidden driven
  app under two profiles and asserts the bytes with pdf.js: `%PDF-` header and `%%EOF` trailer,
  page count, US Letter page geometry on every page, seven manuscript strings in the text layer,
  and a painted image XObject. `pnpm test` still stops at the HTML `printToPDF` consumes — that has
  not changed and does not need to; the bytes are the driven probe's job.
  Run it with `node scripts/e2e/pdf-probes.mjs --only pdf-export-bytes.mjs`. It is **not** in
  `pnpm smoke` yet, for the reason the whole `pdf-probes.mjs` runner is not (see `docs/TESTING.md`).
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
