# ADR-008 — Reading notes on reference PDFs

**Status:** accepted · 2026-08-18 (user direction: "given that we have a pdf
previewer in our software is a big deal, but reading those pdf as part of the
research phase is crucial. including taking notes, comments, and highlights.
… i want something easy clean and professional for our users." Amended in the
same session: "for the highlighted pdf, just keep it in the original pdf. no
need to move it to output. never do that." Amended again: "the highlighting
functionality should be native to the pdf as if we were highlighting in Preview
App", "we must as easily be able to remove the highlight", one Copy action
producing plain prose, and a notes rail riding on the existing comments UI.)

**Depends on** ADR-007 (study acquisition — the ladder that puts a PDF at
`references/<citekey>.pdf`). **Precedent** ADR-006 (the caption standard, and
the sidecar regret it produced).

## Decision

Reading notes live in a **per-paper JSON sidecar** at
`references/notes/<citekey>.json`, anchored by the same
`{quote, prefix, suffix}` selector `packages/core/src/anchor.ts` already
implements for manuscript comments. The PDF page stays the reading surface.
The page index and every highlight rectangle are **derived at paint time**,
never stored.

Four sub-decisions carry it:

| decision | choice | consequence |
|---|---|---|
| storage | per-paper sidecar, keyed by citekey | small writes, per-paper git diffs, no pollution of `manuscript/comments.json` |
| anchoring | W3C text-quote, one anchor per **contiguous run** | survives a PDF being replaced; refuses to splice unrelated lines |
| the PDF itself | real `/Highlight` annotations written **in place, as you highlight** | `references/<citekey>.pdf` is the one artifact; Preview and Zotero see the highlights; nothing is copied to `output/` |
| derived Markdown | not built | no converter is accurate, licensable or shippable enough |

## The four questions, answered

### Reading notes are not manuscript comments, and the split is about people

`manuscript/comments.json` is review of *your* manuscript by *your
co-authors*. Reading notes are research on *someone else's* paper by *you*.
Different lifecycle, audience and volume, so a different file — but the same
anchoring code.

What is reused verbatim: `makeAnchor` / `locate` (`packages/core/src/anchor.ts`
has zero imports and is pure string work — the MCP server already calls it
over raw file text, which proves the cross-surface case), the
`{quote, prefix, suffix}` shape, the `detached`-never-deleted rule, and
`railLayout.layoutSlots`.

What is **not** reused, and why:

- `CommentsRail` — its props require a live `EditorView` and every card
  position comes from `view.lineBlockAt().top` / `documentTop` /
  `contentHeight`. A PDF has no height map. The presentational parts
  (`AuthorBadge`, the composer, the card head) get lifted to
  `comments/parts/` and shared; the geometry backend is new.
- `comments.json` as the store — the toolbar badge counts every unresolved
  comment project-wide (`RailToggleButton.tsx`), so reading five papers would
  make the manuscript badge read 300; `state/comments.ts` re-reads, re-parses
  and rewrites the whole review sidecar per add; and `mcp/comments.ts` falls
  through to `return 'manuscript'` for an unknown target kind, so a 4th kind
  would report to agents as a whole-manuscript comment.

### The sidecar holds the note prose, and that is not the caption mistake

ADR-006's regret has a testable discriminator, and it is not JSON versus
Markdown:

> Does this prose belong in the flow of a Markdown document the user edits?

A figure caption: **yes** — which is exactly why holding it in JSON forced
async caption loaders, `contentEditable` islands inside CodeMirror, custom vim
commands and write-back-with-revert, all to simulate what Markdown gives free.

A reading note on someone else's paper: **no.** There is no SUNA Markdown
document it belongs inside. The proof that JSON is right here already ships
unregretted — comment bodies live in `comments.json` and nobody built a
simulation layer, because the rail is a real editing surface rather than an
island inside another document.

The corollary is a hard rule: **SUNA never appends prose to a Markdown file it
does not own the buffer of.** There is no append channel — `ipc.ts` has
`fs:write-text` (whole file) and `fs:create-file` — while a `DocSession` writes
`core.text()` unconditionally on save with autosave on by default. An appended
quote would be destroyed on the next autosave tick. Quotes reach the
manuscript through a **CodeMirror transaction**, beside
`insertCitationEffect` (`editor/markdownCommands.ts:245`), or not at all.

### Highlights are native to the PDF, written as you make them

**Amended 2026-08-18, second round** (user direction: "the highlighting
functionality should be native to the pdf as if we were highlighting in
Preview App" and "we must as easily be able to remove the highlight"). The
first amendment had already replaced export-to-`output/` with an explicit
in-place command; this one drops the command as well. Highlighting writes the
PDF, the way Preview does.

The two requirements fight each other in the PDF object model, and the way out
is the byte-prefix property:

- pdf.js **cannot delete or edit an annotation the loaded document already
  had** (mozilla/pdf.js#18407). Append-on-change would duplicate every
  highlight forever and removal would be impossible.
- but `saveDocument()` is a strict incremental append, so the pristine file
  remains a byte-exact prefix.

So the PDF's annotation layer is **derived and regenerated**, never edited:
truncate to `pristineBytes` → verify `pristineSha256` → load that → stage every
current note → save → restamp the sidecar. Removal is simply a regeneration
with one fewer note.

Measured in the running app (`probes/pdf-native-highlight.mjs`), on the example
paper at 447,218 pristine bytes:

| step | file | highlights |
|---|---|---|
| baseline | 447,218 | 0 |
| one highlight | 448,354 | 1 |
| two highlights | 448,981 | 2 |
| remove one | 448,326 | 1 |
| remove both | **447,218** | 0 |

The last row is the point: removing every highlight leaves the paper
**byte-identical to how ADR-007 acquired it**, verified by hashing the prefix.
The written annotation is a real `/Subtype /Highlight` with `/QuadPoints`, `/C`,
`/T` and an `/AP` appearance stream — without that stream Preview renders
nothing — and a note body rides along as `/Contents` with a `/Popup`, so the
note text is visible in Preview and Acrobat too, not just the colour.

Writes are **debounced (700 ms)**, so a burst of highlighting costs one
regeneration rather than one per colour click; each regeneration re-parses and
re-serialises the whole document.

The sidecar remains the source of truth, because the PDF cannot hold what the
rail needs: pdf.js writes no `/NM`, so an annotation has no stable identity to
attach a thread or a tag to, and `/QuadPoints` is absolute page coordinates, so
nothing in the file can re-anchor when the PDF is replaced.

**Accepted cost:** `references/<citekey>.pdf` is a tracked binary that now
changes as you read. `git log` on a paper carries roughly 1 KB per edit and its
diff is never reviewable. Weighed and accepted by direction.

### The superseded first amendment: embedding as a command

This is the amended decision, and it reverses the draft's export-to-`output/`.

The in-PDF machinery is real and was measured rather than assumed:
`pdfjs-dist@6.2.108` (already in the tree, Apache-2.0) writes a standard
`/Type /Annot /Subtype /Highlight` with `/QuadPoints /C /CA /T /CreationDate
/Contents /Popup` **and an `/AP` appearance stream**, so Preview and poppler
render it. `saveDocument()` is a true incremental save: the original bytes are
a **byte-for-byte prefix** of the output. Measured over four real publisher
PDFs — arXiv 2,215,244→2,216,305; Nature 1,188,902→1,190,385; PLOS
973,278→974,528; Frontiers 2,576,543→2,578,042 — and 25 successive rounds grew
the Nature file by +3.42% total with all 25 highlights still readable.

The sidecar remains the source of truth. Embedding is an explicit command, not
a write-through: a tracked binary must not churn on every highlight.

**In-place embedding creates a problem export-to-`output/` did not have, and
the byte-prefix property is what solves it.** An export always started from the
pristine file; an in-place embed starts from the file it wrote last time, and
pdf.js *cannot delete or edit an annotation that already existed in the loaded
document* (mozilla/pdf.js#18407). Re-embedding would therefore duplicate every
highlight, permanently.

So the sidecar records the file's **pristine length and hash** — the state in
which ADR-007's ladder delivered it — and embedding is defined as:

1. Truncate `references/<citekey>.pdf` to `source.pristineBytes`.
2. Verify the truncated bytes hash to `source.pristineSha256`. **If they do
   not, stop**: another tool rewrote the file (Preview does not do incremental
   updates — one highlight took our Nature specimen from 1,188,902 to 800,682
   bytes and perturbed the font table 29→31), and truncation would corrupt it.
   Report that, and offer to append a fresh layer or do nothing.
3. Write every current note through `annotationStorage` and `saveDocument()`.
4. Restamp `source.sha256` and `embed` in the sidecar in the same operation.

Step 4 is not bookkeeping. Without it the next open sees a changed sha256 and
runs the re-anchor sweep, reporting "this PDF changed" about SUNA's own write.

This also buys **Remove embedded highlights** for free: truncate to the
pristine length, verify, done — byte-identical to the file as downloaded.

Two costs are accepted rather than solved, both consequences of writing into a
committed binary: `git log` on a paper carries roughly 1.6 KB per embed, and a
PDF's diff is never reviewable. Both were weighed and accepted by direction.

### Docling and OCR-to-Markdown are not built

Every candidate fails on shipping, licensing or accuracy, usually more than
one. `docling` on PyPI is a 5 KB meta-package; the real install pulls torch
(111 MB macOS-arm64 / 527 MB linux) plus 320–390 MB of weights, and is
Python-only — the `@docling/docling-core` npm package explicitly "does not
convert documents". `marker`'s weights are `cc-by-nc-sa-4.0` and it scores
worst on the current OmniDocBench leaderboard (78.44 against MinerU-Pipeline's
86.47). GROBID has the best coordinate story in existence and needs OpenJDK 21.
PyMuPDF4LLM is AGPL. olmOCR wants ≥12 GB VRAM. Nougat's weights are CC-BY-NC
and it collapses into repetition on ~1.5% of in-domain pages. Hosted OCR
uploads paywalled and embargoed PDFs to a third party by default.

Three findings kill the category rather than the candidates:

- **Accuracy is not there for a reading surface.** Academic papers are the
  easiest class in OmniDocBench and the best text edit distance is 0.025 —
  about one character in forty, ~1,250 errors in a 50,000-character paper.
  Best formula edit distance in the CVPR-2025 evaluation was 0.278.
  Reading-order edit distance on double-column pages is 0.101 at best.
- **Provenance does not survive.** Docling's `DocItem.prov` carries
  `{page_no, bbox, charspan}` and `export_to_markdown()` returns a bare `str`.
  An anchor in the Markdown has no path back to the page.
- **Converters drift silently.** Re-converting the same PDF a year later
  yields materially different Markdown, and every note anchored to it breaks
  with no way to say what changed. VLM converters are not bit-reproducible
  even at fixed weights.

It is also the external-runtime dependency this project already rejected once,
when export dropped LaTeX/Tectonic and the docx-tools accelerator.

**What we do instead** is an asymmetry that was measured, not asserted:

> pdf.js's own text extraction is good enough to be an *anchor* substrate and
> nowhere near good enough to be a *reading* substrate.

On an 11-page 2-column CVPR paper, raw `getTextContent()` yields 50,931
characters in correct body reading order — with 0 paragraph breaks and 219
unresolved line-break hyphenations. On a 38-page REVTeX paper: 184,396
characters, 405 hyphenations, 0 paragraph breaks, 46 misordered combining-bar
artifacts, 120 flattened superscripts. Unreadable; entirely sufficient to
search, quote and re-anchor against. The page stays the reading surface and
the extracted text is machinery the user never sees.

## Mechanism

### One Copy, producing prose

**Amended 2026-08-18** (user direction: "remove *copy with citation* and *quote
into manuscript*. instead just have copy, which will copy the selection with
the citation. this should be simply text as if we typed it. eg: xxx [@cite].").

`quoteWithCitation` returns the passage with an inline Pandoc citation, and
moves sentence-final punctuation to after the bracket — `Ram pressure strips
the gas [@gunn1972, p. 3].` — because that is where a writer's own hand leaves
it. Line breaks the PDF's column introduced are flattened, since they are an
artifact of the page rather than the prose. Paste it mid-paragraph and it reads
as written rather than as pasted.

The dedicated *Quote into manuscript* command is gone with it, and so is the
machinery that made it safe — `viewer/quoteTarget.ts`, `insertBlockEffect` and
`DocSession.views()` were all deleted rather than left as unreferenced code.
The **rule** they enforced outlives them and is recorded above: SUNA never
appends prose to a markdown file it does not own the buffer of. Anything that
sends a quote into the manuscript later must go through a CodeMirror
transaction on a live view, and will have to rebuild that seam deliberately.

### Notes ride on the comments rail

**Amended 2026-08-18** (user direction: "we must have the commenting/note
functionality which is similar to our existing comments … Ride on exising
functionality for it as much as logically possible.").

`NotesRail` reuses the manuscript rail's entire `cmt-*` class vocabulary — card
shape, compose box, badges, button styles — so a researcher who has used one
already knows the other. What is deliberately NOT reused is `CommentsRail`
itself: its props require a live `EditorView` and every card position comes from
`view.lineBlockAt().top`. A PDF has no height map, so the geometry half could
not survive the move even though the presentation half transfers whole. The
list simply scrolls in document order.

Still absent, and still on purpose: replies and Resolve. Nobody resolves a note
they made to themselves about someone else's paper.

### `runs[]`, not one range — the schema decision that matters most

Content order is not visual order in real publisher PDFs. Measured fraction of
adjacent body-line pairs whose intervening content-order items belong to
*neither* line: Nature 4.3%, PLOS 4.5%, ATLAS 4.7%, Frontiers 2.1%, arXiv
2.7%, CVPR 0.5%. Concretely, on Frontiers p10 a drag across two consecutive
*visible* lines splices in a line from elsewhere on the page.

A single `[from,to)` range over concatenated item strings stores that splice as
the quote, paints a highlight over unrelated text, and copies the corruption
into the manuscript — and because the quote is internally self-consistent it
re-anchors perfectly forever and the user never finds out. Collecting the
selected **item-index set** and emitting one anchor per contiguous run is the
only correct model. Cross-page selection then falls out for free as runs on
two pages, rather than being silently truncated.

### One shared text function, or the two halves disagree

`packages/core/src/pdftext.ts` exports `buildPageText(items)` →
`{ text, itemStarts, itemOfOffset }`, with zero runtime imports. Both the
anchor builder and the renderer's offset→geometry mapping call it, so they
agree by construction rather than by luck. It owns de-hyphenation and
whitespace normalisation, which are mandatory: Nature shows 596 item
boundaries with no whitespace on either side and 93 hyphenated line breaks in
9 pages; ATLAS shows 1,373 and 243 in 12. Hypothesis strips whitespace before
matching for the same reason — "text extracted from a PDF by different PDF
viewers can often differ in the whitespace."

Normalise once and store normalised, so the stored quote is simultaneously the
matching key and publishable prose. (The naive spelling of this function,
`items.map(i => i.str).join()`, joins with **commas** in JavaScript and would
poison every quote ever stored. That is why it is one tested function.)

### Rectangles come from PDF user space, not the DOM

`TextItem` is `{str, dir, width, height, transform, fontName, hasEOL}`, so an
item's box is `[tx, ty, tx+width, ty+height]` from `transform[4], transform[5]`;
partial items interpolate proportionally, because pdf.js has no per-character
boxes. Mapping through `page.getViewport({scale, rotation})` at paint time is
rotation- and zoom-correct by construction, and avoids the drift of
`range.getClientRects()`, which returns span boxes fitted with
`scaleX(var(--scale-x))`.

**This depended on a live bug, now fixed (M0).** `viewer.css` pinned
`--total-scale-factor: 1`, but `setLayerDimensions` (`build/pdf.mjs:1509`)
sizes the text layer from `viewport.rawDims` — the *unscaled* page — and defers
all scaling to that variable; and pdf.js's span-sizing block was absent
entirely. Measured in the running app before the fix: canvas 1480×1916 against
a 612×792 text layer at fit-width, an **868 px** disagreement (1164 px zoomed),
with all 60 sampled spans computing to `13px` against declared `--font-height`
values of 6.52–16.58 px. Every selection-derived rectangle inherited that.
After: 0 px at both zooms, font sizes tracking their declared heights. Pinned
by `scripts/e2e/probes/pdf-textlayer-scale.mjs`, which asserts rather than
reports.

### Resolution order, and why the page hint is load-bearing

1. `locate(pageText(hintedPage), run)` — the common case.
2. Neighbours ±2 pages.
3. Whole document, from the background extraction.
4. Fail → `detached`.

Running `locate()` independently per page is fatal. `anchor.ts` returns tier-1
immediately when the quote appears exactly once on the text it is given, and
its header says so — *"if the quote appears exactly once, that's it, regardless
of whether the surrounding prefix/suffix has drifted."* A highlight on "the
star formation rate" from page 3, in a paper where pages 8, 12 and 19 each
contain that phrase once, would paint on all four pages — on first use, with
no drift and no PDF change.

Extraction never blocks first paint: full-document `getTextContent()` measures
38p/264ms, 27p/125ms, 756p/1,609ms in Node and is slower in-renderer. The
viewer paints immediately and highlights arrive a beat later.

### What happens when a highlight cannot re-anchor

**Nothing, on a normal open.** The PDF's sha256 is compared to
`source.sha256`; unchanged and same extractor version means resolve against
the stored hints, paint, and **write nothing**. Reading a paper must never
produce a git-modified file.

When the PDF actually changed — ADR-007 re-acquisition, a preprint→published
swap, a `pdfjs-dist` bump, or SUNA's own embed — the sweep runs entirely in
memory and reports before it writes. Four outcomes, each first-class:

| outcome | meaning | behaviour |
|---|---|---|
| `anchored` | unique match, or best match with a positive context score | silent |
| `moved` | anchored on a different page than the hint | hint updated, listed in the report |
| `ambiguous` | several occurrences, all context scores tied at 0 | **refuses to guess**; warning chip and a picker |
| `detached` | no match at any tier | kept forever, never deleted |

`ambiguous` needs one additive change to `anchor.ts`: `bestOccurrence`
initialises `best = occurrences[0]` with `bestScore = -1`, so a tie at 0
silently returns the first occurrence and the caller cannot tell. Add
`locateDetailed()` returning `{range, tier, occurrenceCount, contextScore}`
beside the existing `locate()`, leaving the manuscript path untouched.

A detached note keeps its quote, body, tags and last known page, and renders
under a `Detached (n)` section with **Find in this PDF** and **Re-attach here**.
The flag lands in the JSON, so `git diff` on the sidecar reads as
*13 page changes, 1 detached flag* — the re-anchoring event is reviewable
rather than invisible.

The field record this is measured against: Zotero has no supported way to
replace a PDF under an item at all; PDF++ encoded position only, so when
Obsidian 1.8.0 changed `data-idx` from 0- to 1-based, saved links silently
highlighted the wrong text; Skim stores notes in macOS extended attributes,
which git, Dropbox and email all strip.

## The sidecar

```jsonc
{
  "schema": 1,
  "citekey": "gunn1972",
  "source": {
    "path": "references/gunn1972.pdf",  // project-relative; EVIDENCE, not the key
    "sha256": "9f2c…",                  // the file as it is now, at last sweep
    "pristineBytes": 1188902,           // length before any SUNA embed
    "pristineSha256": "4d81…",          // hash of those first pristineBytes
    "fingerprint": ["a1b2…", null],     // pdf.js doc.fingerprints
    "pageCount": 14,
    "pageLabelOffset": 0,               // printed page − index; user sets once
    "extractor": { "pdfjs": "6.2.108", "pageText": 1 },
    "sweptAt": "2026-08-18T09:14:02.113Z"
  },
  "embed": null,                        // or { at, noteIds[], resultSha256 }
  "notes": [
    {
      "id": "n_01J8Q…",
      "color": "yellow",                // NAME, not hex — hex is a theme concern
      "runs": [                         // one per contiguous text-item run
        { "page": 5, "quote": "…", "prefix": "…", "suffix": "…", "detached": false }
      ],
      "body": "",                       // Markdown; "" is a bare highlight
      "tags": ["method"],
      "author": { "name": "…", "email": "…" },
      "createdAt": "…", "updatedAt": "…",
      "ambiguous": false
    }
  ]
}
```

Storing the page index does not violate "numbering is derived at format time".
That rule governs numbering derived from *the manuscript*. A PDF page index is
a fact about an external artifact, held as a search hint with a verification
procedure attached — the sweep is what makes it honest.

### Keying is the citekey, because it survives re-acquisition

`PdfTab` receives only `path`, so the citekey is reverse-resolved:
`references/<citekey>.pdf` by exact filename first; otherwise by reversing the
`referencePdfs` map. That map's third tier is fuzzy — `resolvePdfPath` matches
any basename starting `fold(family)_fold(year)`, so `smith2020a` and
`smith2020b` both claim `Smith_2020_Foo.pdf`, and the librarian skill names
files exactly that way. **If more than one citekey claims a path, refuse and
ask**, offering to normalise by rename; never let Map iteration order decide
whose notes appear. A PDF with no citekey at all is offered
*File as reference…* rather than notes — one keying scheme, forever.

Out-of-project PDFs are a non-issue: `fs:read-binary` is confined to
allow-listed roots and library roots are not allow-listed, so a Zotero-storage
PDF cannot be opened here, let alone annotated.

### Boundary

Writes stay inside the project, through the same discipline ADR-007 records:
`resolveInside` is lexical, so the directory and the project root are both
realpath-resolved and the prefix re-asserted before bytes are written — a
`references/` symlinked out of the project walks straight through a string
check. The two new channels are `refnotes:read` / `refnotes:write`, both
`{ dir, citekey }`; `packages/core/src/ipc.test.ts` asserts the exact channel
key set, so `pnpm test` fails until that list is updated.

`references` is a hard-coded literal in at least five modules and is not a
`PROJECT_DIR_KEYS` entry; two of the five are shared packages and two are
renderer modules, so `main/services/paths.ts` cannot own it. The notes path is
resolved in two places, pinned by a shared test — the same accepted
duplication the standalone MCP server already carries for `comments.json`.

## Accepted simplifications

- **No reply threads and no `resolved` state.** Reading notes are not review.
  Tags instead.
- **No AnnotationEditorLayer.** pdf.js's editor UI lives in a 163 KB
  `web/pdf_viewer.css` with 46 `url()` references into an 81-file image
  directory and selectors scoped to Firefox's own viewer DOM; its
  `AnnotationEditorUIManager` constructor takes 16 undocumented positional
  arguments and the `.d.ts` misdeclares the `textLayer` option. We use pdf.js's
  **writer** (`annotationStorage` + `saveDocument`) without its editor UI.
- **Existing annotations render read-only.** `getAnnotations({intent:'any'})`
  returns `{subtype, quadPoints, rect, color, contentsObj}`; today `PdfTab`
  mounts only a `TextLayer`, so a paper highlighted in Zotero or Preview opens
  blank. That is a correctness bug independent of this feature. *Adopt into
  notes* maps quads → overlapping item boxes → runs → a real anchor, which is
  the migration path off Zotero.

## Rejected

- **Reading notes in `manuscript/comments.json`** — project-wide badge counts,
  a whole-file rewrite per highlight, and an MCP verb that mislabels an unknown
  target kind as `manuscript`.
- **A `notes.md` prose file written by SUNA** — no append channel exists and
  `DocSession` writes the whole buffer on autosave, so it is a silent,
  permanent data-loss path.
- **A committed `references/text/*.txt` substrate** — references are already
  committed, so extraction is reproducible from a committed input; storing it
  adds ~185 KB of greppable paywalled full text per 40-page paper, rewritten
  wholesale on every extractor bump.
- **`output/<citekey>-annotated.pdf`** — rejected by direction. One artifact,
  annotated in place.
- **Path-keyed or fingerprint-keyed notes** for unfiled PDFs — fingerprints
  differ between two copies of the same paper, isolating the notes; this is a
  documented Hypothesis failure.
- **One contiguous range per highlight** — 2–5% of adjacent body-line pairs
  splice unrelated text, silently and permanently.
- **Docling / marker / MinerU / GROBID / olmOCR / Nougat / PyMuPDF4LLM /
  hosted OCR** — see above.

## Build order

`M0` geometry truth (**done**, pinned by `probes/pdf-textlayer-scale.mjs`) ·
`M1` clean quotes with no storage · `M2` the sidecar and painted highlights ·
`M3` notes and the rail · `M4` the sweep and its review banner · `M5` interop
(render existing annotations, *Adopt into notes*, embed in place) · `M6` an
MCP verb. M6 must regenerate `context/docs.gen.ts` and update
`resources/suna-context/MCP.md`, or two drift gates in
`context/context.test.ts` fail.
