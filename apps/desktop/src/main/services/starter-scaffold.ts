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

const STARTER_INTRO = `Hello, SUNA. This starter manuscript is a working tour of the editor —
every feature below is live, so change a word and watch what happens.
When you have seen enough, select all and start writing your own paper.

Prose is Markdown with a few additions for scientific writing. A citation
is its BibTeX key in square brackets [@knuth1984], and the reference list
at the end of an export is derived from the keys you actually cite —
never hand-maintained. Cite two at once like this [@knuth1984; @wong2011].

Maths is LaTeX. Inline, it sits in single dollars ($E = mc^2$); on its own
line it takes double dollars and, optionally, a label you can point at:

$$ {#eq:hello}
\\mathrm{manuscript} = \\mathrm{prose} + \\mathrm{figures} + \\mathrm{references}
$$

That is @eq:hello — the number is worked out at export time, so inserting
another equation above it renumbers everything for you.
`

const STARTER_RESULTS = `# Results

A figure lives in its own folder under \`figures/\` as an SVG you can edit on
the canvas. Embed it where it belongs in the prose:

![[fig:hello]]

Refer to the whole figure as @fig:hello, or to one panel of it as
@fig:hello{a}. Captions are not written here — they live with the figure,
so moving the embed never separates a figure from its caption.

Tables work the same way: an embed line carrying the caption, followed by
the table itself in plain Markdown.

![[tbl:hello]]

| Piece | Where it lives | Format |
| --- | --- | --- |
| Prose | \`manuscript/manuscript.md\` | Markdown |
| References | \`manuscript/references.bib\` | BibTeX |
| Figures | \`figures/<id>/figure.svg\` | SVG |
| Metadata | \`manuscript/manuscript.json\` | JSON |

Every one of those is a plain-text file under version control. There is no
SUNA file format, and nothing here is locked away from another tool
(@tbl:hello).
`

const STARTER_METHODS = `# Methods

Describe how the work was done. Headings become the outline in the left
sidebar, and the export applies whichever profile the project is set to —
SUNA style while you draft, a journal's rules once you know where this is
going.

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
 * The starter figure, hand-authored rather than generated: two panels, Arial
 * labels at 8 pt, strokes at 1 pt and colours from the Wong colourblind-safe
 * ramp SUNA style recommends — i.e. a figure that already passes the
 * compliance check, so a new author sees a green panel rather than a list of
 * violations on their first export. 178 mm wide (SUNA style's double-column
 * preset) expressed in pt, the unit matplotlib writes.
 */
const STARTER_FIGURE_SVG = `<?xml version="1.0" encoding="utf-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="504.6pt" height="170pt" viewBox="0 0 504.6 170">
 <g id="figure">
  <rect x="0" y="0" width="504.6" height="170" fill="#ffffff"/>
  <g id="panel-a">
   <text x="14" y="20" font-family="Arial" font-size="10" font-weight="bold" fill="#000000">a</text>
   <g id="axes-a" fill="none" stroke="#000000" stroke-width="1">
    <path d="M 44 132 L 232 132"/>
    <path d="M 44 132 L 44 32"/>
   </g>
   <path d="M 44 124 L 91 104 L 138 76 L 185 52 L 232 40" fill="none" stroke="#0072B2" stroke-width="1.5"/>
   <path d="M 44 128 L 91 120 L 138 106 L 185 96 L 232 84" fill="none" stroke="#D55E00" stroke-width="1.5" stroke-dasharray="4,3"/>
   <g font-family="Arial" font-size="8" fill="#000000">
    <text x="138" y="152" text-anchor="middle">Time spent writing</text>
    <text x="28" y="82" text-anchor="middle" transform="rotate(-90 28 82)">Words that survive</text>
    <text x="240" y="43" fill="#0072B2">drafted</text>
    <text x="240" y="87" fill="#D55E00">kept</text>
   </g>
  </g>
  <g id="panel-b">
   <text x="274" y="20" font-family="Arial" font-size="10" font-weight="bold" fill="#000000">b</text>
   <g id="axes-b" fill="none" stroke="#000000" stroke-width="1">
    <path d="M 304 132 L 492 132"/>
    <path d="M 304 132 L 304 32"/>
   </g>
   <rect x="322" y="60" width="34" height="72" fill="#009E73"/>
   <rect x="382" y="44" width="34" height="88" fill="#56B4E9"/>
   <rect x="442" y="92" width="34" height="40" fill="#E69F00"/>
   <g font-family="Arial" font-size="8" fill="#000000" text-anchor="middle">
    <text x="339" y="144">Prose</text>
    <text x="399" y="144">Figures</text>
    <text x="459" y="144">Refs</text>
    <text x="288" y="82" transform="rotate(-90 288 82)">Files changed</text>
   </g>
  </g>
 </g>
</svg>
`

const STARTER_FIGURE_CAPTION = {
  title: 'Anatomy of a SUNA project.',
  body: '**a**, Placeholder curves — open this figure on the canvas and drag something to see an edit recorded against the source. **b**, The three kinds of file a manuscript is made of. Replace both panels with your own figure; the colours are from the colourblind-safe palette SUNA style recommends.',
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
    shortTitle: name,
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
