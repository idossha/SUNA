import { execFile } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  AuthorsFileSchema,
  DEFAULT_PROJECT_DIRS,
  ManuscriptSchema,
  SunaProjectManifestSchema,
  type AuthorsFile,
  type Manuscript,
  LETTER_PRIVATE_GITIGNORE_LINE,
  type SunaProjectManifest
} from '@suna/core'
import { ensureProjectAgentLayer, type McpInvocation } from '@suna/agent'
import { writeFileAtomic } from './atomic'
import {
  STARTER_BIB,
  STARTER_MANUSCRIPT_MD,
  starterDocuments,
  starterManuscript,
  writeStarterComments,
  writeStarterFigure,
  writeStarterLetter,
  writeStarterRound
} from './starter-scaffold'
import { allowRoot, assertInsideAllowedRoot } from './roots'
import { importDocumentIntoProject } from './document-import'
import { purgeExpired } from './trash'

const run = promisify(execFile)

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const PROJECT_GITIGNORE = `output/
.DS_Store
__pycache__/
.ipynb_checkpoints/
.venv/
.mcp.json
.suna/
${LETTER_PRIVATE_GITIGNORE_LINE}
`

/**
 * The placeholder byline every scaffold starts from. Lives in
 * manuscript/authors.json, never in manuscript.json (ARCHITECTURE §4.3).
 */
function starterAuthors(): AuthorsFile {
  return AuthorsFileSchema.parse({
    schemaVersion: 1,
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
    affiliations: [{ id: 'af1', text: 'Your Institution, City, Country' }]
  } satisfies AuthorsFile)
}

/** Onboarding wizard "Blank" scaffold: minimal, schema-valid, no demo prose. */
function blankManuscript(name: string, bibliography = 'references.bib'): Manuscript {
  return ManuscriptSchema.parse({
    title: name,
    articleType: 'article',
    doi: null,
    openAccess: null,
    history: { received: null, accepted: null, publishedOnline: null },
    abstract: { content: 'Write your abstract here.' },
    manuscriptFile: 'manuscript.md',
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
    bibliography
  } satisfies Manuscript)
}

/** Every scaffold writes the same four flat files; only their contents differ. */
async function writeManuscriptDir(
  manuscriptDir: string,
  manuscript: Manuscript,
  prose: string,
  bib: string | null
): Promise<void> {
  await writeFile(join(manuscriptDir, 'manuscript.json'), JSON.stringify(manuscript, null, 2) + '\n')
  await writeFile(join(manuscriptDir, 'authors.json'), JSON.stringify(starterAuthors(), null, 2) + '\n')
  await writeFile(join(manuscriptDir, manuscript.manuscriptFile), prose)
  if (bib !== null) await writeFile(join(manuscriptDir, 'references.bib'), bib)
}

export async function createProject(
  dir: string,
  name: string,
  agent?: McpInvocation
): Promise<SunaProjectManifest> {
  if (await exists(join(dir, 'suna.json'))) {
    throw new Error(`already a SUNA project: ${dir}`)
  }

  const manifest = SunaProjectManifestSchema.parse({
    schemaVersion: 1,
    name,
    // A new project drafts in the house style: it flags nothing and is set
    // in SUNA style's own clean typography. Authors switch to a journal
    // profile when they know where they are submitting.
    activeProfileId: 'suna',
    directories: DEFAULT_PROJECT_DIRS,
    // The starter is a document SET, not one manuscript: it ships a cover
    // letter beside the paper, so the registry is declared rather than
    // synthesized (ARCHITECTURE §4.2).
    documents: starterDocuments(),
    createdAt: new Date().toISOString()
  })

  await mkdir(dir, { recursive: true })
  for (const sub of Object.values(DEFAULT_PROJECT_DIRS)) {
    await mkdir(join(dir, sub), { recursive: true })
  }
  const manuscriptDir = join(dir, DEFAULT_PROJECT_DIRS.manuscript)

  await writeFile(join(dir, 'suna.json'), JSON.stringify(manifest, null, 2) + '\n')
  await writeManuscriptDir(manuscriptDir, starterManuscript(name), STARTER_MANUSCRIPT_MD, STARTER_BIB)
  await writeStarterFigure(dir, DEFAULT_PROJECT_DIRS.figures)
  // .gitignore BEFORE the letter: it carries the `*.private.json` line, and a
  // confidential sidecar must never exist in a tree that is not ignoring it.
  await writeFile(join(dir, '.gitignore'), PROJECT_GITIGNORE)
  await writeStarterLetter(manuscriptDir, name, manifest.activeProfileId)
  await writeStarterRound(dir, manifest.createdAt)
  await writeStarterComments(manuscriptDir, manifest.createdAt)

  // Agent layer before git init so the stubs + context/ land in the initial
  // commit (.mcp.json stays out — it is in PROJECT_GITIGNORE). Best-effort:
  // the project must exist even when the layer cannot be written.
  if (agent !== undefined) {
    try {
      await ensureProjectAgentLayer(dir, agent, { projectName: name })
    } catch (error) {
      console.warn('agent layer write failed (continuing):', error)
    }
  }

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
  // Retention is kept on open as well as on opening the Trash view, so a file
  // past its window leaves even if the user never looks at the trash again.
  // Best-effort and after allowRoot: a trash sweep must never block an open.
  void purgeExpired(dir).catch((error: unknown) => {
    console.warn('trash purge failed (continuing):', error)
  })
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

/* ------------------------------------------------------------------ */
/* Onboarding wizard (DECISIONS 2026-08-15)                                */
/* ------------------------------------------------------------------ */

/** Deliberately UNconfined by allowedRoots — the target project doesn't exist yet (step 1). */
async function writable(dir: string): Promise<boolean> {
  try {
    await access(dir, fsConstants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Step 1 live validation: does `<parentDir>/<name>` already exist, and is
 * `parentDir` writable. Filename-shape checks (empty/illegal characters) are
 * pure and run renderer-side without a round trip.
 */
export async function checkScaffoldTarget(
  parentDir: string,
  name: string
): Promise<{ path: string; exists: boolean; parentWritable: boolean }> {
  const path = join(parentDir, name)
  const [pathExists, parentWritable] = await Promise.all([exists(path), writable(parentDir)])
  return { path, exists: pathExists, parentWritable }
}

export interface ScaffoldRequest {
  dir: string
  name: string
  activeProfileId: string
  scaffold: 'blank' | 'starter' | 'document'
  /** Source .docx/.pdf/.html manuscript when `scaffold` is 'document'. */
  documentPath?: string | null
}

export interface ScaffoldResult {
  manifest: SunaProjectManifest
  gitInitialized: boolean
  /** Whether the agent layer (stubs, context/, .mcp.json) was fully written. */
  agentLayerWritten: boolean
  warnings: string[]
}

/**
 * Step 7 "Create project": the one call that writes anything for the
 * onboarding wizard. Directories → suna.json → the scaffolded manuscript →
 * .gitignore → git init/commit, in that order, mirroring createProject's
 * shape but parameterized by profile/scaffold-kind and an optional settings
 * patch (DECISIONS 2026-08-15). A git failure is reported as a warning, never
 * thrown — the project still exists on success.
 */
export async function scaffoldProject(
  req: ScaffoldRequest,
  agent?: McpInvocation
): Promise<ScaffoldResult> {
  const { dir, name, activeProfileId, scaffold } = req
  const documentPath = req.documentPath ?? null
  if (await exists(join(dir, 'suna.json'))) {
    throw new Error(`already a SUNA project: ${dir}`)
  }

  const warnings: string[] = []
  const manifest = SunaProjectManifestSchema.parse({
    schemaVersion: 1,
    name,
    activeProfileId,
    directories: DEFAULT_PROJECT_DIRS,
    createdAt: new Date().toISOString(),
    // Only the starter ships a letter, so only the starter declares a
    // registry. Every other scaffold keeps the synthesized one-manuscript
    // registry it has always had — a zero-file difference (ARCHITECTURE §4.2).
    ...(scaffold === 'starter' ? { documents: starterDocuments() } : {}),
  })

  await mkdir(dir, { recursive: true })
  for (const sub of Object.values(DEFAULT_PROJECT_DIRS)) {
    await mkdir(join(dir, sub), { recursive: true })
  }
  const manuscriptDir = join(dir, DEFAULT_PROJECT_DIRS.manuscript)

  await writeFile(join(dir, 'suna.json'), JSON.stringify(manifest, null, 2) + '\n')
  // Written BEFORE any scaffold, because it carries the `*.private.json` line
  // that keeps a letter's confidential reviewer lists out of git. The window
  // between writing such a sidecar and ignoring it is small and the
  // consequence is permanent, so the ignore always lands first.
  await writeFile(join(dir, '.gitignore'), PROJECT_GITIGNORE)

  if (scaffold === 'starter') {
    await writeManuscriptDir(manuscriptDir, starterManuscript(name), STARTER_MANUSCRIPT_MD, STARTER_BIB)
    await writeStarterFigure(dir, DEFAULT_PROJECT_DIRS.figures)
    await writeStarterLetter(manuscriptDir, name, activeProfileId)
    await writeStarterRound(dir, manifest.createdAt)
    await writeStarterComments(manuscriptDir, manifest.createdAt)
  } else if (scaffold === 'document') {
    // A blank manuscript first, so the project is valid even when the
    // document turns out to be unreadable — the import writes over it.
    await writeManuscriptDir(manuscriptDir, blankManuscript(name), '', '')
    if (documentPath === null) {
      warnings.push('No source document was chosen — the manuscript was left blank.')
    } else {
      try {
        const result = await importDocumentIntoProject(documentPath, dir, name)
        warnings.push(...result.warnings)
      } catch (error) {
        warnings.push(
          `Could not import ${documentPath}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  } else {
    await writeManuscriptDir(manuscriptDir, blankManuscript(name), '', '')
  }

  // Agent layer before git init so the stubs + context/ land in the initial
  // commit (.mcp.json stays out — it is in PROJECT_GITIGNORE).
  let agentLayerWritten = false
  if (agent !== undefined) {
    try {
      await ensureProjectAgentLayer(dir, agent, { projectName: name })
      agentLayerWritten = true
    } catch (error) {
      warnings.push(
        `agent layer could not be written (open the project to retry): ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  let gitInitialized = false
  try {
    await run('git', ['init', '-b', 'main'], { cwd: dir })
    await run('git', ['add', '-A'], { cwd: dir })
    await run('git', ['commit', '-m', 'Initialize SUNA project'], { cwd: dir })
    gitInitialized = true
  } catch (error) {
    warnings.push(
      `git initialization failed (continuing without VCS): ${error instanceof Error ? error.message : String(error)}`
    )
  }

  allowRoot(dir)
  return { manifest, gitInitialized, agentLayerWritten, warnings }
}
