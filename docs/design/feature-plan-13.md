# Feature plan 13 — unbreakable tables, and a page view

**Goal (user direction, 2026-08-20):** two asks, one subject.

1. **"Make sure tables are never broken and split between pages when exported
   to PDF/DOCX."**
2. **"A view option in both the letter/manuscript that instead of a continuous
   scroll, is a paginated view that resembles the DOCX/PDF page layout."**
   Scoped by the user to a **viewable** page view — "robust clean approach,
   no heavy manipulation at the moment."

They are the same subject because they share one fact the app does not
currently expose: *where the page ends*. Today nothing in SUNA knows that —
not the exporters (which let Chromium and Word decide, unsupervised), and not
the editors (which are continuous by construction). Part A makes the
exporters hold blocks together across that boundary; Part B puts that boundary
on screen, one keystroke away from the writing surface.

Decided with the user before drafting:

| question | answer |
|---|---|
| page view: read-only proof, or editable? | **read-only proof** — the view renders the export's own pages, no editing in it. (An editable in-place variant was designed first and dropped: it needed a page-frame stylesheet, CodeMirror break widgets and PDF-text-to-source-offset matching to hold a contract weaker than this one's.) |
| a table taller than one page? | **flag it, repeat the header** — no auto-restyling (ADR-002) |
| figures too? | **yes**, same pass |

---

## Build status — 2026-08-20

Gates green: `pnpm typecheck` clean, `pnpm test` **3805 passing** (from a 3767
baseline measured on this branch before any of it landed), plus two drive
probes run against the real app.

| milestone | state |
|---|---|
| **13a** | **done.** `BREAK_CSS` in `export-html.ts`, reaching both `buildManuscriptHtml` and `buildSupplementHtml` through `pageCss`. Verified by rendered bytes, with a negative control (§A5). |
| **13b** | **done.** `cantSplit` on every row, `keepNext` on all but the last, `keepWithNext` wired at the `![[tbl:id]]` embed so a "Note." cannot strand. 5 tests. |
| **13c** | **done.** `measureOversizedBlocks` + `sizePrintViewport`; `renderContentPdf` returns `{pdf, oversized}`; `OversizedBlock` in the IPC contract; surfaced in the preview panel and the export toast. |
| **13d** | **done.** `PagedDocument.tsx` + `PagedDocument.css` extracted; `ExportPreview` reduced to fetch-and-caption; export dialog verified unchanged in the app. |
| **13e** | **done.** `DocViewMode`/`nextDocMode` in `editor/settings.ts`; `DocumentPages.tsx`; manuscript tab cycles source → reading → pages. |
| **13f** | **done.** `renderHtmlToPdf` split out of `printHtmlToPdf`; `buildLetterDocument`/`renderLetterPdf` split out of `exportLetter`; `letter:preview` channel printing in the SHARED hidden window; letter tab paginates. |
| **13g** | **not started.** Outline navigation in pages mode was optional; the outline is simply inert there. |

**Where the build deviates from this plan, and why:**

1. **Version tabs do not get pages mode**, though §B1 listed them. A version
   tab renders an ARCHIVED `manuscript.md`, and `export:preview` builds from
   the live project directory — so pages mode there would show the current
   manuscript while claiming to show an archived one. Wrong in the one way
   that matters for a mode whose whole promise is "these are the real pages".
   It needs the exporter to accept a snapshot, which is its own piece of work.

2. **`fit: 'page'` was added to `PagedDocument`, and is what pages mode uses.**
   Not in the plan, and necessary: fit-to-width fills the panel and a page END
   never appears on screen, which is precisely what the mode exists to show.
   The fit is a tested pure function (`pageFit.ts`) rather than inline
   arithmetic, because the first version silently degraded to fit-width — see
   deviation 3.

3. **The manuscript tab stops being the scroller in pages mode.**
   `.msdoc.editor-tab` is `overflow-y: auto`, so a `ResizeObserver` inside it
   reports the CONTENT height, not a viewport height — fit-page had nothing to
   fit into and quietly behaved like fit-width. `.msdoc--pages` is a flex
   column with `overflow: hidden`, and the probe asserts the scrollport is
   bounded so this cannot regress unnoticed.

4. **`sizePrintViewport` was added to the PDF path** so the oversized
   measurement reads the layout that will actually print rather than an 800 px
   default window. Checked against the line-number gutter, which measures the
   same DOM: the rendered gutter is byte-identical before and after, so this
   changed no existing output.

**Not fixed, and not mine to fix here:** `LINE_NUMBER_SCRIPT` de-duplicates
wrapped lines by exact rounded `top`, so an inline `<sup>` or KaTeX span whose
rect sits a pixel off counts as an extra line — visible as overlapping numbers
in the gutter. Pre-existing, reproduced with the viewport sizing removed, and
unrelated to either ask.

---

## Part A — tables (and figures) never split

### A1. What is actually broken today

**The PDF path has no break rules at all.** The entire print stylesheet in
`export-html.ts` contains exactly one page-break declaration —
`export-html.ts:479`, `page-break-before` on the references section when the
profile asks for it. There is no `break-inside`, no `orphans`, no `widows`,
nowhere. So `printToPDF` (`export-pdf.ts:renderContentPdf`) splits a table
wherever the page happens to end, strands a caption at a page foot, and
separates a figure from its legend. This is not a subtle failure mode; it is
the default one.

**The DOCX path is half-protected, by accident.** `tableFromMdast`
(`export-docx.ts:377-410`) does set `tableHeader: true` on row 0, so Word
already repeats the header when a table runs long. And the caption paragraphs
(`export-docx.ts:1055`) and the figure image paragraph
(`export-docx.ts:602`) already carry `keepNext: true`, so caption-to-body
cohesion holds. What is missing is the two things that keep a *table* whole:

- no `cantSplit` on any `TableRow` (`export-docx.ts:384`) — a single row's
  cells can be torn in half across a page boundary, which is the ugliest
  version of this defect;
- no `keepNext` on the paragraphs *inside* the rows — which is Word's only
  mechanism for "keep this table on one page". OOXML has no table-level
  property for it.

So figures are largely fine in Word and broken in PDF; tables are broken in
both, differently. Worth stating plainly, because it means the two fixes are
not symmetric.

### A2. The PDF/HTML fix

Add to the print stylesheet in `export-html.ts` (the `pageCss` builder, not
the reading-web stylesheet at `:924`):

```css
.table-block, figure.figure, .ms-table-entry { break-inside: avoid; }
table, thead, tbody tr                       { break-inside: avoid; }
thead                                        { display: table-header-group; }
.ms-h-a, .ms-h-b, .ms-h-c                    { break-after: avoid; }
.ms-ref                                      { break-inside: avoid; }
p                                            { orphans: 3; widows: 3; }
```

Three notes on why this is written the way it is:

- `.table-block` is the wrapper that holds caption + table + note together
  (`export-html.ts:469`), so `break-inside: avoid` on it is the single rule
  that does the actual work the user asked for. The `table`/`tr` rules are the
  fallback for when the block is too tall to honour it (A4).
- `display: table-header-group` on `thead` is what makes the header repeat on
  a continuation page. It costs nothing when the table does not break.
- `break-after: avoid` on headings is thrown in because a heading alone at a
  page foot is the same class of defect and the rule is one line.

**This must be verified, not assumed.** Chromium's honouring of
`break-inside: avoid` differs between block containers and table rows, and
between the screen and print paths. The verification step in A5 asserts the
outcome on real bytes rather than trusting the declaration.

### A3. The DOCX fix

In `tableFromMdast` (`export-docx.ts:377`):

- every `TableRow` gains `cantSplit: true`. docx 9.7.1 exposes it on
  `ITableRowOptions` (verified in `docx/dist/index.d.ts:1935`, beside the
  `tableHeader` the code already uses).
- every `Paragraph` inside every row *except the last row's* gains
  `keepNext: true`. That is the standard OOXML idiom for holding a table
  together; there is no table-level equivalent.
- when a note paragraph follows the table, the last row's paragraphs get
  `keepNext: true` as well, so the note cannot strand.

Word degrades correctly on its own when the constraint is unsatisfiable: a
table taller than a page simply ignores `keepNext` and breaks. We do not need
to detect that case to avoid a bug — we detect it in A4 to *tell the author*.

### A4. The oversized case, which physically cannot be fixed

A table taller than the printable page has to break. Per ADR-002 the exporter
flags rather than restyles, so:

`renderContentPdf` already has a live DOM in a hidden window and already runs
a measuring script in it (`LINE_NUMBER_SCRIPT`, `export-pdf.ts`, which walks
`Range.getClientRects()`). Add a second measuring pass in the same place,
before `printToPDF`:

```js
// printable box in CSS px, from the SAME resolved style printToPDF gets
var printablePx = (style.page.heightMm - 2 * style.page.marginMm) / 25.4 * 96
// report every .table-block / figure.figure whose offsetHeight exceeds it
```

`renderContentPdf` currently returns a bare `Buffer`. It returns
`{ pdf, oversized }` instead, where `oversized` is
`{ kind: 'table' | 'figure', label: string, heightRatio: number }[]`. Both
callers already exist and both want the data:

- `export:preview` adds an `oversized` field to its response
  (`packages/core/src/ipc.ts:1941`), and `ExportPreview.tsx` renders it beside
  the existing `approximate` note — the same visual slot, the same tone.
- `export:pdf` surfaces it through the export toast.

**The DOCX export reuses the PDF's measurement rather than taking its own.**
It cannot measure inside Word, but both writers resolve the same
`ResolvedDocumentStyle` through `export-style.ts`, so the printable box is
identical and the measurement is honest for both. This is worth stating in
the code comment, because it looks like a shortcut and is not one.

The message names the fix the author can actually make:

> ⚠ Table 3 is 1.4× the printable page height. It will break across pages;
> its header row repeats on the continuation. Consider moving it to the
> supplement, or reducing its columns.

### A5. Verification

Unit tests do not prove a page break. Three checks, on real bytes:

1. **A fixture that straddles a boundary.** Add an example whose table lands
   near a page end. Export to PDF, read it back with `pdfjs-dist` (already a
   main dependency, `document-import.ts:158-160`), and assert every row of the
   table reports the same page index. This is the actual acceptance criterion
   for the user's ask.
2. **The oversized fixture.** A deliberately 40-row table: assert the
   `oversized` array names it, and that the header text appears on more than
   one page (the repeat working).
3. **DOCX structural assertion.** Unzip `document.xml` and assert `w:cantSplit`
   on every `w:trPr` and `w:keepNext` on the non-final rows' paragraphs. Word
   itself cannot be driven in CI, so this asserts the instruction, and check 1
   asserts the outcome in the medium we *can* render.

---

## Part B — the paginated view

### B0. The contract

**Pages mode is a read-only proof of the exported document.** It renders
nothing of its own: it calls the same `export:preview` channel the export
dialog calls, which runs the same builders `export:pdf` runs, and draws the
resulting pages. The page breaks are not approximated, inferred or measured —
they are the export's, because the thing on screen *is* the export.

You cannot type in it. ⌘E returns you to reading or source to edit. That is
the whole trade, and it is what makes the rest of Part B small: no page-frame
stylesheet, no CodeMirror block widgets, no PDF-text-to-source-offset
matching, no zoom arithmetic to get wrong. The three files this touches are
files that already exist and already do most of the job.

### B1. The mode

`EditorViewMode` (`editor/settings.ts:20`) grows a third member:

```ts
export type EditorViewMode = 'source' | 'reading' | 'pages'
```

`EDITOR_VIEW_MODES` (`editor/EditorTab.tsx:46`) grows to match, and the four
`MODE_LABEL` tables — `EditorTab.tsx:48`, `ManuscriptTab.tsx:33`,
`LetterTab.tsx:33`, `VersionTab.tsx:28` — each gain an entry. The four
`toggleMode` callbacks (`ManuscriptTab.tsx:155`, `LetterTab.tsx:86`,
`VersionTab.tsx:83`, and EditorTab's) currently flip a two-state boolean;
they become a cycle over `EDITOR_VIEW_MODES`. ⌘E keeps cycling.

Pages mode is offered on **manuscript, letter and version tabs** — the three
that correspond to something exported as pages. Plain `.md` tabs in
`EditorTab` keep source/reading: a loose markdown file has no page geometry
to show, and inventing one would be a lie.

Because the mode is read-only, entering it takes the editor out of the tab
entirely rather than disabling it. A disabled CodeMirror still shows a
caret, still takes focus, and still invites typing that silently does
nothing; an absent one cannot. The toolbar, the divergence banner and the
comments rail stay exactly as they are.

### B2. One page renderer, extracted rather than rebuilt

`ExportPreview.tsx` already does every hard part: it drives `export:preview`,
loads the bytes with pdf.js, tracks the container width for fit-to-width,
handles zoom, redraws each page on scale change, drops stale renders by
generation, and keeps the previous page on screen while the next is in
flight.

The work is **extraction, not authorship**. Split it in two:

- `export/PagedDocument.tsx` — the part that owns the pdf.js document, the
  page canvases, the zoom control and the scroll container. Takes bytes and
  a status; renders pages.
- `export/ExportPreview.tsx` — keeps the export-dialog-specific parts: the
  format switch, the `approximate` note, the render timing, the HTML iframe
  branch.

Pages mode then mounts `PagedDocument` with its own small hook that owns the
`export:preview` call. This is the invariant worth protecting: **there is
exactly one component in the app that turns exported bytes into pages.** A
second one would drift from the first, and the drift would be invisible.

### B3. What the view renders with

No new pickers and no new persisted state:

- **Profile** comes from `usePreviewProfileId()` (`state/renderProfile.ts`) —
  the explicit 'Rendered as' override, else the project's `activeProfileId`,
  else the house style. This is already the profile the References view and
  the combined Manuscript tab visualize with, so pages mode agrees with
  reading mode by construction rather than by coincidence.
- **Submission options** (`doubleSpacing`, `lineNumbers`, `pageNumbers`) come
  from that profile's own `manuscript.submissionFormat`, which is exactly
  where `ExportDialog.tsx:214-218` initializes its checkboxes from. So the
  page view shows what the export dialog will pre-select, without either one
  reading the other's state.
- **Theme** is the active editor theme, as the export already does.
- **Figures** rasterize through the existing
  `rasterizeManuscriptFigures(..., { compress: true, cache: true })` — preview
  resolution, cached by SVG text, unchanged.

**Format is PDF.** The page view is not format-switched: showing a Word
pagination would mean showing the PDF render of Word's geometry with the
"can differ by one near a boundary" caveat attached, which is a caveat worth
carrying in an export dialog and not worth carrying in a writing view. If a
DOCX-geometry page view is wanted later it is one prop.

### B4. Refresh policy

Rendering costs a `printToPDF`. The existing machinery already makes that
cheap — one hidden window reused across renders with a 60 s idle release,
serialized so two renders never print at once (`export-preview.ts`) — but
cheap is not free, and a writing view is not an export dialog.

So: **render on entering the mode, and re-render debounced when the document
changes**, reusing the dialog's 250 ms debounce and its stale-dimming. The
previous pages stay on screen and dim while the next render is in flight;
they never blank. A visible "Rendering…" in the toolbar, and the page count
beside it.

Since the mode is read-only, the document only changes underneath it — an
agent edit, a save from another tab, a git operation — so re-renders will be
rare in practice. The debounce is there for correctness, not for typing.

### B5. Letters need a prerequisite

`export-letter.ts` is a separate, simpler pipeline: it calls `printHtmlToPdf`
(`export-notes.ts:279`), which hardcodes 8.5 × 11 at 0.75 in margins and
writes straight to a file path. It has **no in-memory variant**, so
`export:preview` has nothing to hand back for a letter.

It needs the same split commit `15b6231` ("Separate what the exporters render
from where they write it") already performed for the manuscript: a
`renderLetterPdf` that returns bytes, with `exportLetter` writing them, and
`export:preview` growing a letter target. Note that a letter's page geometry
legitimately differs from a manuscript's — it comes from the letter path, not
from `resolveDocumentStyle`.

This is the largest single piece of Part B and the reason letters land after
manuscripts in the milestones.

### B6. Outline navigation (optional)

The manuscript tab's outline drives a scroll-spy and click-to-scroll
(`ManuscriptTab.tsx:113-155, 267-285`) that has no meaning over a canvas of
page images. Two honest options:

1. **Ship without it.** In pages mode the outline greys out. Simple, and no
   machinery.
2. **Map headings to pages.** After the render, read each page's
   `getTextContent()` and locate each outline heading's text. Headings are
   short and distinctive, so matches are reliable; a heading that is not found
   simply does not jump. The failure mode is a dead click, which is benign —
   unlike a mis-placed page break, which is why this fuzzy matching is
   acceptable here and was rejected for pagination.

Recommend 2, as its own milestone that can be dropped without touching
anything else.

### B7. What stays approximate, and where it is said

Almost nothing, which is the point of choosing read-only:

- The page breaks are exact. So is the pagination, the page count, the
  margins and the typography.
- **Figures render at preview resolution**, not submission resolution — the
  same trade the export dialog's preview already makes. Layout is unaffected;
  only raster sharpness is.
- **The view is PDF pagination.** A Word export of the same document shares
  its page box and typography (both writers resolve `export-style.ts`) but
  breaks lines itself, so its page count can differ by one near a boundary.
  Said once, in the mode's toolbar, in `ExportPreview.tsx`'s existing wording.

---

## Milestones

| id | scope | gate |
|---|---|---|
| **13a** | Print-stylesheet break rules (A2) | fixture PDF: table rows all on one page |
| **13b** | `cantSplit` + row `keepNext` (A3) | `document.xml` assertion |
| **13c** | Oversized measurement; `renderContentPdf` returns `{pdf, oversized}`; surfaced in preview + toast (A4) | 40-row fixture flagged, header repeats |
| **13d** | `PagedDocument` extracted from `ExportPreview` (B2) | export dialog behaves identically; no visual diff |
| **13e** | `'pages'` mode through the four mode tables; manuscript tab renders it (B1, B3, B4) | smoke probe: mode cycles, pages appear, count matches an exported PDF |
| **13f** | `renderLetterPdf` split; letters and version tabs in pages mode (B5) | letter tab paginates |
| **13g** | *(optional)* heading-to-page outline navigation (B6) | outline click lands on the right page |

13a–13c and 13d–13f are independent and can proceed in either order. Part A
is the ask with the sharper edge; Part B is now small enough that neither
blocks the other.

## Risks

1. **Chromium may not honour `break-inside: avoid` on `tr` in the print
   path.** Mitigated by A5's fixture, which asserts the rendered outcome, not
   the declaration. If it does not hold, the `.table-block` rule still carries
   the common case and the row rule is dropped as decoration.
2. **Extracting `PagedDocument` can regress the export dialog.** It is the
   one place in Part B where working code is moved rather than added. 13d
   lands on its own, with the dialog verified before pages mode consumes it.
3. **Hidden-window lifetime under two consumers.** `export-preview.ts`
   reuses one window with a 60 s idle release; with a pages-mode tab open the
   window may now be held far longer than the export dialog ever held it.
   Confirm the idle release still fires when the tab is closed, and that a
   long-lived hidden window does not accumulate memory across many renders.
4. **A read-only mode that looks editable is worse than no mode.** B1 removes
   the editor rather than disabling it for exactly this reason; the smoke
   probe should assert there is no focusable editor in pages mode.
