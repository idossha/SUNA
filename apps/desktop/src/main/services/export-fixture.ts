import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * A small, deliberately non-trivial fixture project for the export tests
 * (export-content.test.ts, export-docx.test.ts, export-html.test.ts): two
 * authors/affiliations, two sections (an untitled leading section plus a
 * "Results" heading), a citation cluster that includes one key MISSING from
 * references.bib (exercises the "cited but not found" row), a figure embed,
 * a GFM table, a managed (caption-only) manuscript table, keywords, and a
 * populated backMatter/availability block — writes the FLAT layout
 * (feature-plan-7 §1):
 * manuscript.json, manuscript.md, authors.json, references.bib and
 * figures/fig-a/figure.png (a real, valid 1x1 PNG) under `dir`, which the
 * caller must have already `allowRoot`-ed.
 */

/** A byte-valid 1x1 PNG (black pixel) — enough for pngDimensions() and a real ImageRun/embed. */
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

export const FIXTURE_MANUSCRIPT = {
  title: 'Fixture study of $z=1$ stripping',
  articleType: 'article',
  doi: null,
  openAccess: null,
  history: { received: null, accepted: null, publishedOnline: null },
  abstract: { content: 'We test the export pipeline with a small fixture manuscript.' },
  keywords: ['export pipelines', 'fixtures', 'stripping'],
  significance: null,
  highlights: null,
  manuscriptFile: 'manuscript.md',
  figures: [
    {
      id: 'fig-a',
      namespace: 'main',
      canvasRef: 'figures/fig-a/figure.svg',
      widthPreset: 'single',
      caption: { title: 'A fixture figure.', body: 'Panel **a** shows nothing in particular.' },
      panels: []
    }
  ],
  tables: [
    {
      id: 'tbl-a',
      namespace: 'main',
      source: 'native',
      caption: { title: 'A fixture table of stripped quantities.' },
      footnotes: []
    }
  ],
  // `code` left empty on purpose: the back-matter renderer must emit a
  // data-only availability section, never an empty "Code Availability" one.
  availability: { data: 'Fixture data are available from the corresponding author.', code: '' },
  backMatter: {
    acknowledgements: 'We thank the export test harness.',
    authorContributions: 'A.R. designed the fixture. B.C. audited it.',
    funding: [
      { funder: 'Fixture Science Foundation', grant: 'FSF-0042' },
      { funder: 'Open Testing Trust', grant: null }
    ],
    competingInterests: 'The authors declare no competing interests.',
    peerReview: null,
    supplementaryInfo: null
  },
  bibliography: 'references.bib'
}

export const FIXTURE_AUTHORS = {
  schemaVersion: 1,
  authors: [
    {
      id: 'a1',
      given: 'Ada',
      family: 'Researcher',
      nativeScript: null,
      orcid: null,
      affiliationRefs: ['af1'],
      corresponding: true,
      email: 'ada@example.edu',
      equalContribution: false,
      deceased: false
    },
    {
      id: 'a2',
      given: 'Ben',
      family: 'Collaborator',
      nativeScript: null,
      orcid: null,
      affiliationRefs: ['af2'],
      corresponding: false,
      email: null,
      equalContribution: false,
      deceased: false
    }
  ],
  affiliations: [
    { id: 'af1', text: 'Department of Astronomy, Fixture University' },
    { id: 'af2', text: 'Institute of Testing' }
  ]
}

/** One flat manuscript.md — two headed sections, "Introduction" then "Results". */
export const FIXTURE_MANUSCRIPT_MD = `# Introduction

Prior work established the baseline [@smith2020].

# Results

Our results extend this [@smith2020; @jones2019] and note an
unresolved citation [@missing2099] (@fig:fig-a, @tbl:tbl-a).

![[fig:fig-a]]

| A | B |
| --- | --- |
| 1 | 2 |
`

/**
 * Optional supplement source (feature: Supplementary Information export) —
 * written only when writeFixtureProject is asked for it. Deliberately
 * exercises: an H2 (0.45 in Contents indent), a citation whose key differs
 * from the MAIN manuscript's first citation (so independent numbering is
 * observable: jones2019 is [2] in the manuscript but [1] here), a GFM table
 * (-> "Table S1." at 9 pt cells), and a re-embedded managed figure
 * (-> "Figure S1", 165 mm).
 */
export const FIXTURE_SUPPLEMENT_MD = `# Supplementary Methods

Extended detail on the fixture pipeline [@jones2019].

## Parameter grid

| Parameter | Value |
| --- | --- |
| Depth | 3 |

# Supplementary Results

The supplementary figure supports the main text [@smith2020; @jones2019]
(@fig:fig-a).

![[fig:fig-a]]
`

export const FIXTURE_BIB = `@article{smith2020,
  author  = {Smith, Jane},
  title   = {A baseline study},
  journal = {Journal of Fixtures},
  volume  = {1},
  pages   = {1--10},
  year    = {2020},
  doi     = {10.1000/fix.1}
}

@article{jones2019,
  author  = {Jones, Rob and Lee, Kim},
  title   = {Extending the baseline},
  journal = {Journal of Fixtures},
  volume  = {2},
  pages   = {11--20},
  year    = {2019},
  doi     = {10.1000/fix.2}
}
`

export interface FixtureProject {
  dir: string
  /** figureId -> absolute PNG path, ready to pass as `figurePngPaths` to buildExportContent/exportDocx/exportPdf. */
  figurePngPaths: Record<string, string>
}

export async function writeFixtureProject(
  dir: string,
  opts: { supplement?: boolean } = {}
): Promise<FixtureProject> {
  await mkdir(join(dir, 'manuscript'), { recursive: true })
  await writeFile(
    join(dir, 'manuscript', 'manuscript.json'),
    JSON.stringify(FIXTURE_MANUSCRIPT, null, 2) + '\n',
    'utf8'
  )
  await writeFile(join(dir, 'manuscript', 'authors.json'), JSON.stringify(FIXTURE_AUTHORS, null, 2) + '\n', 'utf8')
  await writeFile(join(dir, 'manuscript', 'manuscript.md'), FIXTURE_MANUSCRIPT_MD, 'utf8')
  await writeFile(join(dir, 'manuscript', 'references.bib'), FIXTURE_BIB, 'utf8')
  if (opts.supplement === true) {
    await writeFile(join(dir, 'manuscript', 'supplementary.md'), FIXTURE_SUPPLEMENT_MD, 'utf8')
  }

  const figurePngPath = join(dir, 'output', 'fig-a.png')
  await mkdir(join(dir, 'output'), { recursive: true })
  await writeFile(figurePngPath, Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'))

  return { dir, figurePngPaths: { 'fig-a': figurePngPath } }
}
