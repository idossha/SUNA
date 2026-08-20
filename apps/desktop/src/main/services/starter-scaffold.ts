import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ManuscriptSchema, type Manuscript } from '@suna/core'

/**
 * The "Starter" scaffold: a Hello-SUNA manuscript that is a working tour of
 * every moving part, not a themed sample paper. It deliberately teaches ONE
 * of each thing an author will reach for on day one — a citation and its
 * .bib entry, a managed figure with panels, a table, inline and display
 * maths, cross-references to all of them — with prose that explains the
 * syntax it is demonstrating, so the file reads as documentation you can
 * type over.
 *
 * It is domain-neutral on purpose. The bundled example project
 * (examples/demo-paper) is the astrophysics one; a brand-new project has no
 * business pretending to be about ram-pressure stripping.
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

Two things worth trying before you delete this file:

1. Open \`figures/hello/figure.svg\` to edit the figure on the canvas.
2. Open the Export tab to see the profile's requirements and export a PDF.
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
    panels: STARTER_FIGURE_PANELS,
    provenance: { generator: null, overlay: [] }
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
