import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * A small, deliberately non-trivial fixture project for the export tests
 * (export-content.test.ts, export-docx.test.ts, export-html.test.ts): two
 * authors/affiliations, two sections, a citation cluster that includes one
 * key MISSING from references.bib (exercises the "cited but not found" row),
 * a figure embed, and a GFM table — writes manuscript.json, sections/*.md,
 * references.bib and figures/fig-a/figure.png (a real, valid 1x1 PNG) under
 * `dir`, which the caller must have already `allowRoot`-ed.
 */

/** A byte-valid 1x1 PNG (black pixel) — enough for pngDimensions() and a real ImageRun/embed. */
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

export const FIXTURE_MANUSCRIPT = {
  title: 'Fixture study of $z=1$ stripping',
  shortTitle: 'Fixture stripping',
  articleType: 'article',
  doi: null,
  openAccess: null,
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
  ],
  history: { received: null, accepted: null, publishedOnline: null },
  abstract: { content: 'We test the export pipeline with a small fixture manuscript.' },
  significance: null,
  highlights: null,
  body: [
    { kind: 'section', heading: 'Introduction', level: 'A', content: 'sections/01-intro.md', children: [] },
    { kind: 'section', heading: 'Results', level: 'A', content: 'sections/02-results.md', children: [] }
  ],
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
  tables: [],
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
}

export const FIXTURE_INTRO_MD = 'Prior work established the baseline [@smith2020].\n'

export const FIXTURE_RESULTS_MD = `Our results extend this [@smith2020; @jones2019] and note an
unresolved citation [@missing2099] (@fig:fig-a).

![[fig:fig-a]]

| A | B |
| --- | --- |
| 1 | 2 |
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

export async function writeFixtureProject(dir: string): Promise<FixtureProject> {
  await mkdir(join(dir, 'manuscript', 'sections'), { recursive: true })
  await writeFile(
    join(dir, 'manuscript', 'manuscript.json'),
    JSON.stringify(FIXTURE_MANUSCRIPT, null, 2) + '\n',
    'utf8'
  )
  await writeFile(join(dir, 'manuscript', 'sections', '01-intro.md'), FIXTURE_INTRO_MD, 'utf8')
  await writeFile(join(dir, 'manuscript', 'sections', '02-results.md'), FIXTURE_RESULTS_MD, 'utf8')
  await writeFile(join(dir, 'manuscript', 'references.bib'), FIXTURE_BIB, 'utf8')

  const figurePngPath = join(dir, 'output', 'fig-a.png')
  await mkdir(join(dir, 'output'), { recursive: true })
  await writeFile(figurePngPath, Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'))

  return { dir, figurePngPaths: { 'fig-a': figurePngPath } }
}
