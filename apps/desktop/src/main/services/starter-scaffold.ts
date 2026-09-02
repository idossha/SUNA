import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  STARTER_LETTER_ID,
  CommentsFileSchema,
  CoverLetterMetaSchema,
  LetterPrivateSchema,
  ManuscriptSchema,
  ReviewerReportSchema,
  RoundSchema,
  RoundsIndexSchema,
  makeAnchor,
  reportIsFaithful,
  segmentReviewerReport,
  unansweredMarker,
  type CommentsFile,
  type CoverLetterMeta,
  type LetterPrivate,
  type Manuscript,
  type Round
} from '@suna/core'

/**
 * The "Starter" scaffold: a Hello-SUNA manuscript that is a working tour of
 * every moving part, not a themed sample paper. It deliberately teaches ONE
 * of each thing an author will reach for on day one — a citation and its
 * .bib entry, a managed figure with panels, a table, inline and display
 * maths, cross-references to all of them — with prose that explains the
 * syntax it is demonstrating, so the file reads as documentation you can
 * type over.
 *
 * It is domain-neutral on purpose, and it is the same project the bundled
 * example (examples/hello-suna) grew out of — that one is this one a few days
 * in, with a generated second figure, a supplement and an answered round.
 *
 * Everything here is REAL: the two references exist and their DOIs resolve,
 * the figure is a genuine SVG on disk registered in manuscript.json (so the
 * canvas opens it, the compliance checker measures it, and an export embeds
 * it), and every cross-reference in the prose has something to point at.
 */

const STARTER_INTRO = `Hello,

This starter manuscript is a working tour of the editor — every feature below is live, so change a word and watch what happens. When you have seen enough, select all and start writing your own paper.

Prose is Markdown with a few additions for scientific writing. A citation is its BibTeX key in square brackets [@knuth1984], and the reference list at the end of an export is derived from the keys you actually cite — never hand-maintained. Cite two at once like this [@knuth1984; @wong2011].

Maths is LaTeX. Inline, it sits in single dollars ($E = mc^2$); on its own line it takes double dollars and, optionally, a label you can point at:

$$ {#eq:hello}
\\mathrm{manuscript} = \\mathrm{prose} + \\mathrm{figures} + \\mathrm{references}
$$

That is @eq:hello — the number is worked out at export time, so inserting another equation above it renumbers everything for you.
`

const STARTER_RESULTS = `# Results

A figure lives in its own folder under \`figures/\` as an SVG you can edit on the canvas. Embed it where it belongs in the prose:

![[fig:hello]]

Refer to the whole figure as @fig:hello, or to one panel of it as @fig:hello{a}. Captions are not written here — they live with the figure, so moving the embed never separates a figure from its caption.

Tables work the same way: an embed line carrying the caption, followed by the table itself in plain Markdown.

![[tbl:hello]]

| Piece | Where it lives | Format |
| --- | --- | --- |
| Prose | \`manuscript/manuscript.md\` | Markdown |
| References | \`manuscript/references.bib\` | BibTeX |
| Figures | \`figures/<id>/figure.svg\` | SVG |
| Metadata | \`manuscript/manuscript.json\` | JSON |

Every one of those is a plain-text file under version control. There is no SUNA file format, and nothing here is locked away from another tool (@tbl:hello).
`

const STARTER_METHODS = `# Methods

Describe how the work was done. Headings become the outline in the left sidebar, and the export applies whichever profile the project is set to — SUNA style while you draft, a journal's rules once you know where this is going.

Code goes in a fence tagged with its language, and is highlighted the same way in the editor and in Reading mode:

\`\`\`python
import matplotlib.pyplot as plt
import suna_mpl

# A figure normally comes from code kept beside it, in
# figures/<id>/source/. Figure 1 does not: it was drawn by hand, and the
# referees noticed.
with plt.rc_context(suna_mpl.journal_rc()):
    fig, ax = plt.subplots()
    suna_mpl.set_size(fig, "double", height_mm=58.0)
    ax.plot(time_on_project, happiness, label="SUNA")
    ax.set_xlabel("Time on project")
    ax.set_ylabel("Researcher happiness")
    suna_mpl.save_svg(fig, "figures/hello/figure.svg")
\`\`\`

\`suna_mpl.save_svg\` writes text as real \`<text>\` elements rather than outlines, which is what keeps a figure's labels editable on the canvas after it has been exported.

\`suna_mpl\` is not on PyPI; it ships inside SUNA. Run a script that imports it from SUNA's terminal panel, which exports \`$SUNA_MPL\` pointing at that copy:

\`\`\`bash
uv run --no-project --with "$SUNA_MPL" python figures/hello/source/plot.py
\`\`\`

You need \`uv\` on your PATH — SUNA bundles no Python interpreter.

Three things worth trying before you delete this file:

1. Open \`figures/hello/figure.svg\` to edit the figure on the canvas.
2. Open the Export tab to see the profile's requirements and export a PDF.
3. Open the cover letter and the review round in the Writing panel — a paper is
   more than its manuscript, and both are here already, part-answered.
`

/** The whole starter manuscript in ONE file — sections are Markdown headings. */
export const STARTER_MANUSCRIPT_MD = `${STARTER_INTRO}\n${STARTER_RESULTS}\n${STARTER_METHODS}`

/**
 * Two real references, chosen so an author can verify the pipeline against
 * something outside SUNA: both DOIs resolve, and both are about writing
 * things down clearly rather than about anybody's research field.
 */
export const STARTER_BIB = `@article{knuth1984,
  author  = {Knuth, Donald E.},
  title   = {Literate Programming},
  journal = {The Computer Journal},
  volume  = {27},
  number  = {2},
  pages   = {97--111},
  year    = {1984},
  doi     = {10.1093/comjnl/27.2.97}
}

@article{wong2011,
  author  = {Wong, Bang},
  title   = {Points of view: Color blindness},
  journal = {Nature Methods},
  volume  = {8},
  number  = {6},
  pages   = {441},
  year    = {2011},
  doi     = {10.1038/nmeth.1618}
}
`

/** Short on purpose: the id is what an author types (`![[fig:hello]]`). */
export const STARTER_FIGURE_ID = 'hello'

/**
 * The starter figure, hand-authored rather than generated: two panels drawn in
 * a deliberately hand-sketched style (wobbled strokes, a handwriting font stack
 * that falls back to Arial) so a new project opens on something obviously
 * placeholder and a little funny, not on a chart anyone would mistake for a
 * result. Labels are 8 pt, strokes 1 pt and up, colours from the Wong
 * colourblind-safe ramp SUNA style recommends — i.e. it already passes the
 * compliance check, so the first export shows a green panel rather than a list
 * of violations. 178 mm wide (SUNA style's double-column preset) expressed in
 * pt, the unit matplotlib writes.
 */
const STARTER_FIGURE_SVG = `<?xml version="1.0" encoding="utf-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="504.6pt" height="196pt" viewBox="0 0 504.6 196">
 <g id="figure" font-family="Comic Sans MS, Chalkboard SE, Comic Neue, Arial" stroke-linecap="round" stroke-linejoin="round">
  <rect x="0" y="0" width="504.6" height="196" fill="#ffffff"/>
  <g id="panel-a">
   <text x="14" y="22" font-size="10" font-weight="bold" fill="#000000">a</text>
   <g id="axes-a" fill="none" stroke="#000000" stroke-width="1.4">
    <path d="M 62.0 152.1 L 71.4 151.9 L 80.8 151.7 L 90.1 152.6 L 99.5 151.1 L 108.9 152.8 L 118.2 151.5 L 127.6 152.2 L 137.0 152.0 L 146.4 152.0 L 155.8 151.9 L 165.1 152.1 L 174.5 152.0 L 183.9 151.6 L 193.2 152.6 L 202.6 151.3 L 212.0 152.1"/>
    <path d="M 62.2 152.0 L 61.8 144.0 L 62.5 136.0 L 61.2 128.0 L 62.2 120.0 L 61.5 112.0 L 62.7 104.0 L 61.9 96.0 L 62.3 88.0 L 61.5 80.0 L 61.8 72.0 L 61.9 64.0 L 62.2 56.0 L 62.5 48.0 L 62.0 40.0"/>
    <path d="M 62.0 152.0 L 61.9 153.0 L 61.8 154.0 L 62.0 155.0 L 62.0 156.0"/>
    <path d="M 137.0 152.0 L 136.7 153.0 L 136.7 154.0 L 136.9 155.0 L 137.0 156.0"/>
    <path d="M 212.0 152.0 L 211.7 153.0 L 211.8 154.0 L 211.8 155.0 L 212.0 156.0"/>
    <path d="M 62.0 152.1 L 61.0 152.0 L 60.0 152.0 L 59.0 152.0 L 58.0 152.0"/>
    <path d="M 62.0 96.0 L 61.0 95.9 L 60.0 96.0 L 59.0 95.9 L 58.0 96.0"/>
    <path d="M 62.0 40.0 L 61.0 40.2 L 60.0 40.2 L 59.0 40.0 L 58.0 40.0"/>
   </g>
   <path id="curve-suna" d="M 62.1 138.1 L 67.9 134.5 L 73.9 131.3 L 79.9 128.1 L 85.3 123.9 L 91.5 121.0 L 97.1 117.0 L 102.7 113.1 L 108.2 109.1 L 113.0 104.2 L 118.6 100.3 L 123.4 95.4 L 128.7 91.1 L 134.1 87.0 L 139.2 82.4 L 145.2 79.1 L 150.4 74.7 L 156.0 70.8 L 161.7 67.0 L 166.9 62.6 L 173.0 59.4 L 179.1 56.7 L 185.7 55.2 L 192.3 53.6 L 198.7 51.1 L 205.5 50.1 L 212.0 47.9" fill="none" stroke="#0072B2" stroke-width="2"/>
   <path id="curve-control" d="M 62.0 132.1 L 67.7 132.8 L 73.6 133.0 L 79.3 134.2 L 84.9 135.6 L 90.8 135.6 L 96.4 137.1 L 102.3 137.4 L 108.1 137.3 L 113.8 138.8 L 119.6 139.2 L 125.4 139.8 L 131.1 140.7 L 136.9 141.1 L 142.7 141.0 L 148.4 142.3 L 154.2 142.9 L 160.0 143.2 L 165.7 144.9 L 171.5 144.5 L 177.3 144.9 L 183.1 145.9 L 188.9 145.9 L 194.6 146.7 L 200.4 147.6 L 206.2 147.6 L 212.0 147.9" fill="none" stroke="#D55E00" stroke-width="2" stroke-dasharray="5,4"/>
   <g font-size="8" fill="#000000">
    <text x="137" y="182" text-anchor="middle">Time on project</text>
    <text x="55" y="155" text-anchor="end">low</text>
    <text x="55" y="43" text-anchor="end">high</text>
    <text x="28" y="96" text-anchor="middle" transform="rotate(-90 28 96)">Researcher happiness</text>
    <text x="120" y="66" fill="#0072B2">SUNA</text>
    <text x="112" y="128" fill="#D55E00">your old text editor</text>
   </g>
  </g>
  <g id="panel-b">
   <text x="252" y="22" font-size="10" font-weight="bold" fill="#000000">b</text>
   <g id="axes-b" fill="none" stroke="#000000" stroke-width="1.4">
    <path d="M 340.0 152.0 L 349.4 152.4 L 358.8 151.4 L 368.1 152.5 L 377.5 151.8 L 386.9 151.9 L 396.2 152.2 L 405.6 151.9 L 415.0 152.0 L 424.4 152.1 L 433.8 152.1 L 443.1 151.6 L 452.5 152.6 L 461.9 151.4 L 471.2 152.3 L 480.6 152.1 L 490.0 151.9"/>
    <path d="M 340.1 152.0 L 340.7 144.0 L 339.5 136.0 L 340.0 128.0 L 339.1 120.0 L 340.5 112.0 L 339.9 104.0 L 340.9 96.0 L 339.6 88.0 L 340.0 80.0 L 339.2 72.0 L 340.2 64.0 L 340.2 56.0 L 340.6 48.0 L 340.0 40.0"/>
   </g>
   <g id="bars-before" fill="#D55E00" stroke="#D55E00" stroke-width="1">
    <path d="M 343.0 39.9 L 358.8 39.7 L 374.6 40.1 L 390.3 40.3 L 406.1 40.0 L 421.9 40.2 L 437.7 40.4 L 453.4 40.2 L 469.2 39.9 L 474.9 50.0 L 459.2 50.0 L 443.4 50.3 L 427.7 50.3 L 411.9 50.1 L 396.1 50.2 L 380.3 50.2 L 364.6 50.0 L 348.8 49.8 L 343.0 40.0"/>
    <path d="M 343.0 68.0 L 355.8 68.0 L 368.6 68.2 L 381.3 67.7 L 394.1 67.8 L 406.9 68.1 L 419.7 68.4 L 432.4 68.1 L 445.2 67.7 L 448.0 78.0 L 435.2 78.0 L 422.4 78.0 L 409.7 78.2 L 396.9 77.7 L 384.1 77.8 L 371.3 78.1 L 358.6 78.4 L 345.8 78.0 L 343.1 68.0"/>
    <path d="M 343.0 95.9 L 353.4 96.3 L 363.9 95.7 L 374.3 96.1 L 384.8 96.2 L 395.2 96.0 L 405.7 96.0 L 416.1 96.1 L 426.6 95.6 L 426.6 106.0 L 416.6 106.2 L 406.1 105.8 L 395.7 106.0 L 385.2 106.3 L 374.8 105.9 L 364.3 106.0 L 353.9 106.0 L 343.4 105.7 L 342.9 96.0"/>
    <path d="M 343.0 123.9 L 351.7 124.3 L 360.3 123.6 L 369.0 124.2 L 377.7 124.0 L 386.3 124.2 L 395.0 123.6 L 403.7 124.4 L 411.1 125.3 L 411.0 134.0 L 402.3 134.2 L 393.7 133.8 L 385.0 134.1 L 376.3 133.8 L 367.7 134.3 L 359.0 133.8 L 350.3 133.9 L 342.9 132.7 L 342.9 124.0"/>
   </g>
   <g id="bars-after" fill="#0072B2" stroke="#0072B2" stroke-width="1">
    <path d="M 343.0 52.0 L 345.7 51.6 L 348.3 51.9 L 351.0 52.1 L 353.7 52.0 L 356.3 52.4 L 356.9 54.0 L 357.3 56.7 L 357.2 59.3 L 357.2 62.0 L 354.3 61.7 L 351.7 61.8 L 349.0 62.0 L 346.3 61.8 L 343.7 62.4 L 342.8 60.0 L 343.2 57.3 L 343.2 54.7 L 343.1 52.0"/>
    <path d="M 343.0 80.0 L 345.0 80.0 L 347.0 80.1 L 349.0 79.6 L 351.0 79.8 L 351.0 82.0 L 350.9 84.0 L 350.9 86.0 L 350.7 88.0 L 350.7 90.0 L 349.0 90.2 L 347.0 90.1 L 345.0 90.2 L 343.0 90.1 L 342.8 88.0 L 343.4 86.0 L 343.3 84.0 L 343.1 82.0 L 343.0 80.0"/>
    <path d="M 343.0 108.1 L 346.9 108.0 L 350.8 107.8 L 354.7 107.7 L 358.6 108.0 L 362.4 108.3 L 366.3 107.7 L 368.1 110.2 L 368.1 114.1 L 367.6 118.0 L 364.1 117.9 L 360.2 118.2 L 356.3 118.0 L 352.4 117.8 L 348.6 117.6 L 344.7 118.2 L 343.0 115.8 L 343.0 111.9 L 343.1 108.0"/>
    <path d="M 343.0 135.9 L 346.1 136.3 L 349.2 136.0 L 352.3 136.1 L 355.4 135.7 L 358.6 136.0 L 360.9 136.7 L 360.8 139.8 L 361.0 142.9 L 361.3 146.0 L 357.9 146.0 L 354.8 146.0 L 351.7 145.6 L 348.6 146.0 L 345.4 146.1 L 342.6 145.3 L 343.0 142.2 L 343.2 139.1 L 343.1 136.0"/>
   </g>
   <g font-size="8" fill="#000000" text-anchor="end">
    <text x="334" y="49">Relabeling figures</text>
    <text x="334" y="77">Fixing references</text>
    <text x="334" y="105">Reformatting files</text>
    <text x="334" y="133">Note consolidation</text>
   </g>
   <text x="415" y="182" font-size="8" fill="#000000" text-anchor="middle">Hours you are never getting back</text>
   <g id="legend-b">
    <path d="M 398.0 14.9 L 399.8 14.6 L 401.6 14.9 L 403.3 15.0 L 405.1 15.1 L 406.0 15.9 L 405.6 17.7 L 405.8 19.4 L 405.9 21.2 L 406.3 23.0 L 404.2 23.0 L 402.4 23.2 L 400.7 23.2 L 398.9 23.2 L 398.3 22.1 L 398.3 20.3 L 398.2 18.6 L 398.0 16.8 L 398.0 15.0" fill="#D55E00" stroke="#D55E00" stroke-width="1"/>
    <text x="410" y="23" font-size="8" fill="#000000">before</text>
    <path d="M 444.0 15.0 L 445.8 14.6 L 447.6 15.1 L 449.3 15.2 L 451.1 15.4 L 452.0 15.9 L 451.8 17.7 L 452.0 19.4 L 452.1 21.2 L 452.5 23.0 L 450.2 23.1 L 448.4 23.0 L 446.7 22.9 L 444.9 23.0 L 444.3 22.1 L 444.3 20.3 L 443.9 18.6 L 443.7 16.8 L 443.9 15.0" fill="#0072B2" stroke="#0072B2" stroke-width="1"/>
    <text x="456" y="23" font-size="8" fill="#000000">after</text>
   </g>
  </g>
 </g>
</svg>

`

const STARTER_FIGURE_CAPTION = {
  title: 'The measurable effect of SUNA on the working scientist.',
  body: '**a**, Self-reported happiness over the life of a project, with your old text editor as the control (n = 1, the author, unblinded). **b**, Time per week spent on four chores, before and after adopting SUNA. Open this figure on the canvas and drag something to see an edit recorded against the source, then replace both panels with a real result; the colours are from the colourblind-safe palette SUNA style recommends.',
  abbreviations: []
}

const STARTER_FIGURE_PANELS = [
  { letter: 'a', subLabels: [] },
  { letter: 'b', subLabels: [] }
]

/** manuscript.json's figure entry — the manuscript's view of the figure. */
function starterFigureEntry(): unknown {
  return {
    id: STARTER_FIGURE_ID,
    namespace: 'main',
    canvasRef: `figures/${STARTER_FIGURE_ID}/figure.svg`,
    widthPreset: 'double',
    caption: STARTER_FIGURE_CAPTION,
    panels: STARTER_FIGURE_PANELS
  }
}

/** figures/<id>/figure.json — the figure's own record, canvasRef excluded. */
function starterFigureDoc(): unknown {
  return {
    id: STARTER_FIGURE_ID,
    namespace: 'main',
    widthPreset: 'double',
    caption: STARTER_FIGURE_CAPTION,
    // Null, not `{ generator: null }`: ProvenanceSchema requires a generator
    // and the whole block is what is nullable — "no provenance" is how a
    // figure drawn from scratch says it came from no code. The starter figure
    // was drawn by hand, so it has none.
    provenance: null
  }
}

/** The one table the starter prose embeds; its cells are the Markdown grid. */
function starterTableEntry(): unknown {
  return {
    id: 'hello',
    namespace: 'main',
    source: 'native',
    caption: {
      title: 'What a SUNA project is made of.',
      body: 'Every row is a plain-text file you can open in any editor and track in git.'
    },
    footnotes: []
  }
}

/** The starter manuscript record: one figure, one table, both really present. */
export function starterManuscript(name: string): Manuscript {
  return ManuscriptSchema.parse({
    title: name,
    articleType: 'article',
    doi: null,
    openAccess: null,
    history: { received: null, accepted: null, publishedOnline: null },
    abstract: {
      content:
        'Replace this with your abstract. Everything in this starter project is a real, editable file — delete what you do not need.'
    },
    manuscriptFile: 'manuscript.md',
    figures: [starterFigureEntry()],
    tables: [starterTableEntry()],
    availability: { data: '', code: '' },
    backMatter: {
      acknowledgements: null,
      authorContributions: null,
      funding: [],
      competingInterests: null,
      peerReview: null,
      supplementaryInfo: null
    },
    bibliography: 'references.bib'
  })
}

/**
 * Writes the starter figure's own directory (SVG + figure.json). The
 * manuscript.json entry is written by the caller alongside the rest of the
 * manuscript, so this only owns what lives under figures/.
 */
export async function writeStarterFigure(projectDir: string, figuresDir: string): Promise<void> {
  const dir = join(projectDir, figuresDir, STARTER_FIGURE_ID)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'figure.svg'), STARTER_FIGURE_SVG)
  await writeFile(join(dir, 'figure.json'), JSON.stringify(starterFigureDoc(), null, 2) + '\n')
}

/* ------------------------------------------------------------------ */
/* The starter cover letter (ARCHITECTURE §4.2, ARCHITECTURE §14.3)              */
/* ------------------------------------------------------------------ */

/**
 * A paper is not just its manuscript, and the starter says so on day one.
 *
 * The letter is the smallest honest demonstration of the assertion model:
 * ONE assertion the author has answered, and ONE left unanswered so that the
 * Assertions panel has something to report and the marker is visible in the
 * prose where an author will meet it. The unanswered marker is built by
 * `unansweredMarker` rather than typed, so it cannot drift from the parser
 * that finds it.
 *
 * SUNA never writes an assertion's text on the author's behalf — every
 * sentence below is either about the starter project itself or is a
 * placeholder that says so.
 */
// The id itself lives in @suna/core beside starterDocuments(), so the
// wizard's Review preview and this writer name the same letter.
export { STARTER_LETTER_ID } from '@suna/core'

export const STARTER_LETTER_MD = `Dear Editor,

This is the starter cover letter. A letter lives under \`manuscript/letters/\`, which means it gets the same editor, comment gutter and version history the manuscript has — it is prose, not a form.

Here is where you make the case for the paper: what the result is, why it is new, and why it belongs in this journal rather than a more specialist one. Two or three paragraphs in your own words. Notice that the abstract has not been pasted in for you; several venues explicitly ask that a letter not repeat it.

Ours, for the sake of the demonstration, is this. We report that researcher happiness rises monotonically with time spent in SUNA, while the control condition — the author's previous text editor — drifts gently in the other direction (Fig. 1a). The effect survives our one serious limitation, which is that n = 1, the sample is the author, and the author was not blind to condition. We further show that four categories of chore collapse to something a person could finish on a Friday afternoon (Fig. 1b). We believe this is of interest to your general readership, by which we mean everyone who has ever renumbered a figure by hand.

What a letter also has to do is make factual claims on your behalf, and those are tracked rather than trusted to prose. A claim is placed with a directive and answered in the sidecar beside this file:

::assert{competingInterests}
The authors declare no competing interests.

The next one has been left for you, which is why it shows a marker instead of a sentence. SUNA will not write it, and neither should an agent — the AI drafts the argument, the human signs the affidavit:

${unansweredMarker('dataLocation')} ::assert{dataLocation}

Both appear in the Assertions panel beside this letter. Answering the second one — in the panel, in your own words — clears the marker. Once a venue's cover-letter requirements have been recorded in its profile, that panel also reports the claims the venue asks for and you have not made.

One part of this letter is deliberately not in this file. The reviewers we would like, the ones we would rather not have, and the colleagues who have already read the draft are in \`${STARTER_LETTER_ID}.private.json\` beside it — other people's names and emails, and, on an exclusion, a reason that is nobody else's business. That file is added to \`.gitignore\` before it is written, so it cannot reach a repository the whole author list can read. Have a look at what the starter put in it; the entries are jokes, and the fields are not.

Sincerely,

Your Name
`

export function starterLetterMeta(projectName: string, targetProfileId: string): CoverLetterMeta {
  return CoverLetterMetaSchema.parse({
    schemaVersion: 1,
    kind: 'cover-letter',
    letterKind: 'submission',
    targetProfileId,
    salutation: 'Dear Editor,',
    identityId: null,
    signerIds: [],
    covers: [
      {
        documentId: 'manuscript',
        siblingProjectPath: null,
        title: projectName,
        articleType: 'article',
        authorsLine: null
      }
    ],
    assertions: [
      {
        id: 'competingInterests',
        placement: 'directive',
        text: 'The authors declare no competing interests.',
        reason: null
      },
      // Deliberately unanswered: `text: null` is what the checker reports and
      // what the marker in the prose stands for. A starter that pre-answered
      // everything would demonstrate nothing.
      { id: 'dataLocation', placement: 'directive', text: null, reason: null }
    ],
    dataLocations: [],
    abbreviatedSummary: null,
    priorSubmissions: [],
    reviewRoundId: null
  })
}

/**
 * `manuscript/letters/<id>.private.json` — the confidential half of a letter.
 *
 * The creator has always written the `*.private.json` ignore line before the
 * letter, for a file no scaffold ever produced. This produces it, so the
 * ordering guards something real and an author meets the sidecar on day one
 * rather than the first time they are asked for suggested reviewers by a
 * submission system.
 *
 * The names are jokes and are obviously placeholders; the FIELDS are not.
 * Every entry carries what a real one carries — an affiliation, an email
 * where there would be one, and on the exclusion a reason, because a bare
 * name is not a case an editor can act on.
 */
export function starterLetterPrivate(): LetterPrivate {
  return LetterPrivateSchema.parse({
    schemaVersion: 1,
    suggestedReviewers: [
      {
        name: 'A. Colleague',
        email: 'a.colleague@example.edu',
        affiliation: 'A department that would recognise the problem',
        reason: 'Knows the method, has no stake in the result, and answers email.'
      },
      {
        name: 'B. Specialist',
        email: null,
        affiliation: 'The one other group doing this',
        reason: 'Would catch it if we were wrong, which is the entire point.'
      }
    ],
    excludedReviewers: [
      {
        name: 'The Corresponding Author',
        email: null,
        affiliation: 'This desk',
        reason: 'Wrote the manuscript. We are told this is disqualifying.'
      }
    ],
    colleaguesShown: [
      {
        name: 'A. Corridor Colleague',
        email: null,
        affiliation: 'Two doors down',
        reason: 'Read the abstract and said it was fine. Has not read the abstract.'
      }
    ]
  })
}

/* ------------------------------------------------------------------ */
/* The starter review round (ARCHITECTURE §4.5)                   */
/* ------------------------------------------------------------------ */

export const STARTER_ROUND_ID = 'round-1'

/**
 * A demonstration decision letter, written to be unmistakably a joke about
 * the starter project rather than plausible feedback on anybody's research.
 * That is the point: a new project has not been submitted anywhere, so the
 * only honest reviewer text is text that admits what it is.
 *
 * It is segmented at scaffold time by the SAME offline segmenter a real
 * import runs, so the round on disk is a real round — every point's verbatim
 * is a contiguous slice of this string, with the offsets to prove it.
 */
export const STARTER_REVIEW_TEXT = `Dear Author,

This is a demonstration decision letter. It came with your starter project so that the peer-review panel has something in it, and it is about the starter manuscript, not about your work. Delete the rounds/ directory whenever you like.

Three referees have seen the manuscript. Their reports follow. We would be prepared to consider a revised version, on the understanding that nothing here has actually been submitted anywhere.

Sincerely,

The Editor

Reviewer #1 (Comments for the Author):

Major comments

1. The manuscript is a tour of a text editor rather than a study, and I was unable to locate a hypothesis anywhere in it. The authors may wish to consider writing a paper instead.

2. Equation (1) asserts that a manuscript is prose plus figures plus references. This omits the coffee term.

3. In Figure 1a the sample size is one, the sample is the corresponding author, and the author was not blind to condition. I found this admitted in a parenthesis in the caption. It should be a sentence.

Minor comments

4. Figure 1 appears to have been drawn by hand. I mean this as a compliment; the journal may not.

5. Table 1 lists BibTeX among the plain-text formats. BibTeX is many things. On reflection I will allow it.

Reviewer #2 (Comments for the Author):

1. Please state how many times the corresponding author rewrote the first sentence before giving up and shipping this one.

2. Table 1 is accurate and I have nothing to add. I would like that noted in the record.

3. The Methods section instructs the reader to open a tab. I have opened the tab. Nothing in my training prepared me for this, and yet here we are.

Reviewer #3 (Comments for the Author):

1. I read this manuscript twice: once as submitted, and once as I was imagining it while reading. The second was the better paper and I encourage the authors to write that one.

2. The authors claim the reference list is derived from the keys they actually cite. I deleted a citation to test this. It worked, which I resent.

3. There is no Introduction and no Discussion. In fairness, this makes the paper unusually easy to read.
`

/**
 * The replies the starter arrives with, keyed by point id.
 *
 * Four points are answered and the rest are not, which is what a round in
 * progress actually looks like — and between them they use all four statuses,
 * so the tab opens showing the whole vocabulary rather than a single Done.
 * 'rebutted' is in here on purpose: a starter that only ever demonstrated
 * conceding would quietly teach that disagreeing is not an option.
 *
 * Keyed by id rather than by position so that editing STARTER_REVIEW_TEXT
 * cannot silently re-attach a reply to a different referee's point;
 * `starterRound` throws if a key here names a point that no longer exists.
 */
const STARTER_REPLIES: Record<string, { status: 'drafted' | 'done' | 'rebutted'; reply: string }> = {
  'r1.1': {
    status: 'done',
    reply: `RE: The referee is right that there was no hypothesis, and we have put one where a reader would look for it:

::quote
Prose is Markdown with a few additions for scientific writing. +++We hypothesise that this is enough.+++
::

That is what a reply looks like here. You write it beside the referee's words rather than in a separate document, and their text above is read-only — nothing in SUNA offers a control that would edit it, because editing a referee's words is misconduct.

A response letter has three voices and this one uses all of them: ours, the manuscript quoted back unchanged, and the part of the quotation that is new. They are marks in the text — \`::quote … ::\` around the excerpt, \`+++ … +++\` around the change — not formatting you apply, so the reply stays a plain string you could email. The response document is derived from these replies at export, which means what you write here IS the letter.`
  },
  'r1.2': {
    status: 'rebutted',
    reply: `RE: We have considered the coffee term and respectfully decline to add it. @eq:hello is an identity over the things a manuscript is made of; coffee is a thing the author is made of.

This point is marked Rebutted, which is a real outcome rather than a failure. The counter at the top of this tab treats a rebuttal as answered, because arguing back in writing is answering — a tool that scored only compliance would quietly press you into conceding points you should defend.`
  },
  'r1.3': {
    status: 'drafted',
    reply: `RE: Agreed. The caption will state the sample size and the absence of blinding in its own sentence rather than in a parenthesis, and

<!-- Drafted: a reply that exists but is not finished. Nothing advances the status for you — you set it when you mean it, and until then this point still counts as outstanding at the top of the tab. -->`
  },
  'r2.2': {
    status: 'done',
    reply: `RE: So noted. We thank the referee for the only unambiguous endorsement in this round.`
  }
}

/**
 * Where a reply points in the manuscript. The quote is matched against the
 * document's CURRENT text at format time, the same discipline comments.json
 * uses, so the page and line reference in an exported response is derived
 * rather than typed — and cannot go stale the way a hand-written one does.
 */
const STARTER_LINKS: Record<string, { documentId: string; quote: string }[]> = {
  'r1.1': [
    {
      documentId: 'manuscript',
      quote: 'Prose is Markdown with a few additions for scientific writing'
    }
  ]
}

export interface StarterRound {
  round: Round
  reports: ReturnType<typeof ReviewerReportSchema.parse>[]
  preamble: string
}

/**
 * Build the starter round from STARTER_REVIEW_TEXT. Pure and deterministic,
 * so the wizard preview and the writer cannot disagree about what lands.
 *
 * Throws if the segmentation is not faithful. That can only happen if someone
 * edits STARTER_REVIEW_TEXT into a shape the segmenter reads differently, and
 * shipping a round whose verbatim does not match its source is the one thing
 * this model exists to prevent — so it fails loudly at the seam rather than
 * quietly on an author's disk.
 */
export function starterRound(createdAt: string): StarterRound {
  const analysis = segmentReviewerReport(STARTER_REVIEW_TEXT)
  const reports = analysis.reviewers.map((block) => {
    const report = ReviewerReportSchema.parse({
      schemaVersion: 1,
      index: block.index,
      label: block.label,
      sourceText: STARTER_REVIEW_TEXT,
      points: block.points.map((p) => ({
        id: p.id,
        reviewerIndex: p.reviewerIndex,
        pointIndex: p.pointIndex,
        section: p.section,
        verbatim: p.verbatim,
        from: p.from,
        to: p.to,
        reason: p.reason
      })),
      unassigned: analysis.unassigned
        .filter((u) => u.from >= block.from && u.to <= block.to)
        .map((u) => ({ from: u.from, to: u.to }))
    })
    if (!reportIsFaithful(report)) {
      throw new Error(`starter round: reviewer ${block.index} verbatim does not match its source`)
    }
    return report
  })

  const allPoints = reports.flatMap((r) => r.points)
  // A reply keyed to a point that no longer exists is silent data loss — the
  // demonstration would simply lose a reply and nobody would see it go. Same
  // reasoning as the faithfulness check above: fail at the seam.
  const ids = new Set(allPoints.map((p) => p.id))
  for (const id of [...Object.keys(STARTER_REPLIES), ...Object.keys(STARTER_LINKS)]) {
    if (!ids.has(id)) throw new Error(`starter round: reply written for missing point ${id}`)
  }
  const round = RoundSchema.parse({
    schemaVersion: 1,
    id: STARTER_ROUND_ID,
    kind: 'external',
    label: 'Round 1 — demonstration',
    venue: 'A journal you have not chosen yet',
    state: 'returned',
    createdAt,
    freeze: null,
    recipients: [],
    // Some points answered and most not, so the tab opens on a real
    // "3 of N addressed" and the completeness check has something to say.
    pointStates: allPoints.map((p) => {
      const written = STARTER_REPLIES[p.id]
      return {
        pointId: p.id,
        status: written?.status ?? 'unaddressed',
        assignee: null,
        reply: written?.reply ?? '',
        links: STARTER_LINKS[p.id] ?? []
      }
    }),
    decision: 'major-revision',
    decidedAt: createdAt,
    responseDocumentId: null,
    baselineVersionId: null
  })

  return { round, reports, preamble: analysis.preamble }
}

/* ------------------------------------------------------------------ */
/* Comments                                                           */
/* ------------------------------------------------------------------ */

/**
 * Two threads in the margin, so the comment rail teaches itself the way the
 * cover letter and the review round do.
 *
 * The guided tour stops on this rail and says that a coauthor's threads and
 * an agent's share it, that each keeps its history, and that only the author
 * ever resolves one (tour/steps.ts, `comments-rail`) — claims an empty rail
 * asks the reader to take on faith. So one thread is a question the agent has
 * ANSWERED but not closed, and the other is a question the agent RAISED:
 * between them every rule the rail runs on is visible without reading a word
 * of documentation.
 *
 * Anchors are derived from STARTER_MANUSCRIPT_MD by the same `makeAnchor` the
 * editor uses, so they resolve against the prose on open instead of arriving
 * detached. Both quotes are also present verbatim in examples/hello-suna,
 * which keeps its own comments.json in step with these.
 */
const STARTER_COMMENT_QUOTES = {
  citation: 'A citation is its BibTeX key in square brackets [@knuth1984]',
  methods: 'Describe how the work was done.'
} as const

/** Anchored to `quote`'s FIRST occurrence in the starter prose. */
function starterAnchor(quote: string): { quote: string; prefix: string; suffix: string } {
  const from = STARTER_MANUSCRIPT_MD.indexOf(quote)
  if (from === -1) throw new Error(`starter comment quote is not in the prose: ${quote}`)
  return makeAnchor(STARTER_MANUSCRIPT_MD, from, from + quote.length)
}

/**
 * `manuscript/comments.json` for the starter. `createdAt` is the manifest's,
 * so a scaffolded project carries one timestamp rather than several a few
 * milliseconds apart, and the ids it produces are reproducible.
 */
export function starterComments(createdAt: string): CommentsFile {
  const day = createdAt.slice(0, 10)
  return CommentsFileSchema.parse({
    schemaVersion: 1,
    comments: [
      {
        id: `c-${day}-starter01`,
        target: {
          kind: 'section',
          path: 'manuscript.md',
          anchor: starterAnchor(STARTER_COMMENT_QUOTES.citation)
        },
        body: 'Is knuth1984 a real entry, or a placeholder we still owe a citation for?\n\nThis is a comment. It is anchored to the sentence rather than typed into it — the prose above is untouched, and the thread lives beside it in `manuscript/comments.json`. Select any text and press ⌘⇧M to leave one of your own.',
        author: { kind: 'human', name: 'A coauthor' },
        createdAt,
        resolved: false,
        detached: false,
        replies: [
          {
            id: `r-${day}-starter01a`,
            body: 'Real: `references.bib` carries the entry and its DOI resolves.\n\nI have replied and left the thread open, which is the only thing an agent can do — there is no verb that resolves a comment, so the judgement of whether an answer settles the matter stays yours. An open thread is a decision still owed.',
            author: { kind: 'agent', name: 'Agent' },
            createdAt
          }
        ]
      },
      {
        id: `c-${day}-starter02`,
        target: {
          kind: 'section',
          path: 'manuscript.md',
          anchor: starterAnchor(STARTER_COMMENT_QUOTES.methods)
        },
        body: 'This section is still the sentence the scaffold wrote. I can draft it from whatever ends up in `analysis/` and `code/`, but what belongs in Methods is your call, so the question waits in your margin instead of interrupting you.\n\nAn agent raises a comment the same way you do, into the same file. Reply to this one and it becomes a conversation; delete it and nothing else in the project notices.',
        author: { kind: 'agent', name: 'Agent' },
        createdAt,
        resolved: false,
        detached: false,
        replies: []
      }
    ]
  })
}

/* ------------------------------------------------------------------ */
/* Writers                                                             */
/* ------------------------------------------------------------------ */

/** `manuscript/letters/<id>.md` + `<id>.json`. */
export async function writeStarterLetter(
  manuscriptDir: string,
  projectName: string,
  targetProfileId: string
): Promise<void> {
  const dir = join(manuscriptDir, 'letters')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${STARTER_LETTER_ID}.md`), STARTER_LETTER_MD)
  await writeFile(
    join(dir, `${STARTER_LETTER_ID}.json`),
    JSON.stringify(starterLetterMeta(projectName, targetProfileId), null, 2) + '\n'
  )
  // The confidential half. Safe to write here because every creator puts the
  // `*.private.json` ignore line in .gitignore BEFORE calling this.
  await writeFile(
    join(dir, `${STARTER_LETTER_ID}.private.json`),
    JSON.stringify(starterLetterPrivate(), null, 2) + '\n'
  )
}

/** `manuscript/comments.json` — the starter's two margin threads. */
export async function writeStarterComments(
  manuscriptDir: string,
  createdAt: string
): Promise<void> {
  await writeFile(
    join(manuscriptDir, 'comments.json'),
    JSON.stringify(starterComments(createdAt), null, 2) + '\n'
  )
}

/** `rounds/index.json` + `rounds/<id>/…`, laid out exactly as an import would. */
export async function writeStarterRound(projectDir: string, createdAt: string): Promise<void> {
  const { round, reports, preamble } = starterRound(createdAt)
  const dir = join(projectDir, 'rounds', STARTER_ROUND_ID)
  await mkdir(join(dir, 'reviewers'), { recursive: true })
  await writeFile(join(dir, 'round.json'), JSON.stringify(round, null, 2) + '\n')
  for (const report of reports) {
    await writeFile(
      join(dir, 'reviewers', `${report.index}.json`),
      JSON.stringify(report, null, 2) + '\n'
    )
  }
  if (preamble.trim() !== '') {
    await writeFile(join(dir, 'editor-letter.txt'), `${preamble.trimEnd()}\n`)
  }
  await writeFile(
    join(projectDir, 'rounds', 'index.json'),
    JSON.stringify(RoundsIndexSchema.parse({ schemaVersion: 1, rounds: [STARTER_ROUND_ID] }), null, 2) + '\n'
  )
}

/**
 * The registry the starter declares. The manuscript entry is listed
 * explicitly rather than left to `resolveDocuments`' synthesized one, because
 * a manifest that declares ANY document has to declare them all.
 */
// starterDocuments() moved to @suna/core: the wizard's Review preview needs
// the SAME registry this writer writes, and a second copy here is exactly how
// the two came to disagree. Re-exported so existing importers are unaffected.
export { starterDocuments } from '@suna/core'
