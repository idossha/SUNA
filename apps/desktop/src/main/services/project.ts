import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  DEFAULT_PROJECT_DIRS,
  ManuscriptSchema,
  SunaProjectManifestSchema,
  type Manuscript,
  type SunaProjectManifest
} from '@suna/core'
import { allowRoot } from './roots'

const run = promisify(execFile)

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const STARTER_INTRO = `Galaxies falling into dense cluster environments experience ram pressure
from the intracluster medium [@gunn1972]. Recent JWST observations suggest
this process operates even at cosmic noon (see @fig:overview).

The stripping condition can be written as

$$ {#eq:stripping}
P_\\mathrm{ram} = \\rho_\\mathrm{ICM} v^2 > 2\\pi G \\Sigma_\\ast \\Sigma_\\mathrm{gas}
$$

Replace this starter text with your introduction. SciMark supports inline
math ($z = 2.51$), citations like [@gunn1972], cross-references like
@eq:stripping, and raw LaTeX escape blocks when you need them.
`

const STARTER_RESULTS = `Present your results here. Embed managed figures with:

![[fig:overview]]

Panel references render as cross-references: @fig:overview{a}.
`

const STARTER_METHODS = `Describe observations, data reduction, and analysis here. Methods
sub-headings become run-in heads (bold, ending with a period) in
Nature-family output profiles.
`

const STARTER_BIB = `@article{gunn1972,
  author  = {Gunn, James E. and Gott, J. Richard},
  title   = {On the infall of matter into clusters of galaxies and some effects on their evolution},
  journal = {The Astrophysical Journal},
  volume  = {176},
  pages   = {1--19},
  year    = {1972},
  doi     = {10.1086/151605}
}
`

const PROJECT_GITIGNORE = `output/
.DS_Store
__pycache__/
.venv/
`

function starterManuscript(name: string): Manuscript {
  return ManuscriptSchema.parse({
    title: name,
    shortTitle: name,
    articleType: 'article',
    doi: null,
    openAccess: null,
    authors: [
      {
        id: 'a1',
        given: 'First',
        family: 'Author',
        nativeScript: null,
        orcid: null,
        affiliationRefs: ['af1'],
        corresponding: true,
        email: null,
        equalContribution: false,
        deceased: false
      }
    ],
    affiliations: [{ id: 'af1', text: 'Your Institution, City, Country' }],
    history: { received: null, accepted: null, publishedOnline: null },
    abstract: { content: 'Replace this with your abstract.' },
    body: [
      { kind: 'section', heading: null, level: 'A', content: 'sections/01-introduction.md', children: [] },
      { kind: 'section', heading: 'Results', level: 'A', content: 'sections/02-results.md', children: [] },
      { kind: 'section', heading: 'Methods', level: 'A', content: 'sections/03-methods.md', children: [] }
    ],
    figures: [],
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
  } satisfies Manuscript)
}

export async function createProject(
  dir: string,
  name: string
): Promise<SunaProjectManifest> {
  if (await exists(join(dir, 'suna.json'))) {
    throw new Error(`already a SUNA project: ${dir}`)
  }

  const manifest = SunaProjectManifestSchema.parse({
    schemaVersion: 1,
    name,
    activeProfileId: 'nature-astronomy',
    directories: DEFAULT_PROJECT_DIRS,
    createdAt: new Date().toISOString()
  })

  await mkdir(dir, { recursive: true })
  for (const sub of Object.values(DEFAULT_PROJECT_DIRS)) {
    await mkdir(join(dir, sub), { recursive: true })
  }
  const manuscriptDir = join(dir, DEFAULT_PROJECT_DIRS.manuscript)
  await mkdir(join(manuscriptDir, 'sections'), { recursive: true })

  await writeFile(join(dir, 'suna.json'), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(
    join(manuscriptDir, 'manuscript.json'),
    JSON.stringify(starterManuscript(name), null, 2) + '\n'
  )
  await writeFile(join(manuscriptDir, 'sections', '01-introduction.md'), STARTER_INTRO)
  await writeFile(join(manuscriptDir, 'sections', '02-results.md'), STARTER_RESULTS)
  await writeFile(join(manuscriptDir, 'sections', '03-methods.md'), STARTER_METHODS)
  await writeFile(join(manuscriptDir, 'references.bib'), STARTER_BIB)
  await writeFile(join(dir, '.gitignore'), PROJECT_GITIGNORE)

  // Version control from birth; best-effort if git is unavailable.
  try {
    await run('git', ['init', '-b', 'main'], { cwd: dir })
    await run('git', ['add', '-A'], { cwd: dir })
    await run('git', ['commit', '-m', 'Initialize SUNA project'], { cwd: dir })
  } catch (error) {
    console.warn('git init failed (continuing without VCS):', error)
  }

  allowRoot(dir)
  return manifest
}

export async function openProject(
  dir: string
): Promise<{ manifest: SunaProjectManifest; manuscriptPresent: boolean }> {
  const raw = await readFile(join(dir, 'suna.json'), 'utf8').catch(() => {
    throw new Error(`not a SUNA project (no suna.json): ${dir}`)
  })
  const manifest = SunaProjectManifestSchema.parse(JSON.parse(raw))
  const manuscriptPresent = await exists(
    join(dir, manifest.directories.manuscript ?? 'manuscript', 'manuscript.json')
  )
  allowRoot(dir)
  return { manifest, manuscriptPresent }
}

export async function scaffoldStatus(
  dir: string
): Promise<{ manifestPresent: boolean; dirs: Record<string, boolean> }> {
  const dirs: Record<string, boolean> = {}
  for (const [key, sub] of Object.entries(DEFAULT_PROJECT_DIRS)) {
    dirs[key] = await exists(join(dir, sub))
  }
  return { manifestPresent: await exists(join(dir, 'suna.json')), dirs }
}
