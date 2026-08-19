import { execFile } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { promisify } from 'node:util'
import {
  AuthorsFileSchema,
  DEFAULT_PROJECT_DIRS,
  ManuscriptSchema,
  SunaProjectManifestSchema,
  applySettingsPatch,
  mergeProjectSettings,
  type AuthorsFile,
  type Manuscript,
  type ProjectSettings,
  type SunaProjectManifest
} from '@suna/core'
import { ensureProjectAgentLayer, type McpInvocation } from '@suna/agent'
import { writeFileAtomic } from './atomic'
import {
  STARTER_BIB,
  STARTER_MANUSCRIPT_MD,
  starterManuscript,
  writeStarterFigure
} from './starter-scaffold'
import { allowRoot, assertInsideAllowedRoot } from './roots'
import { importDocumentIntoProject } from './document-import'

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
.venv/
.mcp.json
`

/**
 * The placeholder byline every scaffold starts from. Lives in
 * manuscript/authors.json, never in manuscript.json (feature-plan-7 §1).
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

const IMPORT_PLACEHOLDER = `Imported files are in manuscript/imported/. Copy the prose you want to keep
into this file — nothing was auto-linked.
`

/** Onboarding wizard "Blank"/"Import" scaffold: minimal, schema-valid, no demo prose. */
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
  await writeFile(join(dir, '.gitignore'), PROJECT_GITIGNORE)

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
  return { manifest, manuscriptPresent }
}

/**
 * Read → merge → validate → atomic write on suna.json's `settings` block, the
 * same contract manuscript:update honours: the file is re-read from disk every
 * time (the user or an agent may be editing it), the patch is merged onto that
 * fresh object, the result is validated BEFORE anything is written, and every
 * other manifest key — including ones this schema version does not know — is
 * preserved verbatim. A null in the patch deletes its key ("Reset to global").
 */
export async function updateProjectSettings(
  dir: string,
  patch: ProjectSettings
): Promise<SunaProjectManifest> {
  const root = assertInsideAllowedRoot(dir)
  const file = join(root, 'suna.json')
  const raw = await readFile(file, 'utf8').catch(() => {
    throw new Error(`not a SUNA project (no suna.json): ${dir}`)
  })
  let current: unknown
  try {
    current = JSON.parse(raw) as unknown
  } catch (error) {
    throw new Error(
      `suna.json is not valid JSON (${file}): ${error instanceof Error ? error.message : String(error)}`
    )
  }

  const next = applySettingsPatch(current, patch)
  // Validate before writing: an invalid patch must never reach the file.
  const manifest = SunaProjectManifestSchema.parse(next)
  await writeFileAtomic(file, JSON.stringify(next, null, 2) + '\n')
  return manifest
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
/* Onboarding wizard (feature-plan-5 §5)                                */
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

export interface ImportableFile {
  path: string
  name: string
  ext: 'md' | 'tex' | 'bib'
}

const IMPORTABLE_EXTENSIONS: Record<string, ImportableFile['ext']> = {
  '.md': 'md',
  '.tex': 'tex',
  '.bib': 'bib'
}
const IMPORT_SCAN_IGNORED = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__'])
const IMPORT_SCAN_MAX_DEPTH = 4

/** Step 3 "Import existing": shallow-scan a folder for files the wizard can copy in. */
export async function listImportableFiles(dir: string): Promise<ImportableFile[]> {
  const out: ImportableFile[] = []

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > IMPORT_SCAN_MAX_DEPTH) return
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || IMPORT_SCAN_IGNORED.has(entry.name)) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      const kind = IMPORTABLE_EXTENSIONS[extname(entry.name).toLowerCase()]
      if (kind !== undefined) out.push({ path: full, name: entry.name, ext: kind })
    }
  }

  await walk(dir, 0)
  out.sort((a, b) => a.path.localeCompare(b.path))
  return out
}

/**
 * Copies every importable file into `<manuscriptDir>/imported/`, flat (source
 * subdirectories are not preserved — names are what the user will recognize
 * their own files by). A name collision is skipped, not overwritten; the
 * caller surfaces skips as warnings. Returns the first `.bib` copy's path
 * relative to `manuscriptDir`, if any, for the manifest's `bibliography` field.
 */
async function copyImportableFiles(
  importDir: string,
  manuscriptDir: string
): Promise<{ copied: string[]; skipped: string[]; bibliography: string | null }> {
  const found = await listImportableFiles(importDir)
  const destDir = join(manuscriptDir, 'imported')
  await mkdir(destDir, { recursive: true })

  const copied: string[] = []
  const skipped: string[] = []
  let bibliography: string | null = null

  for (const file of found) {
    const dest = join(destDir, file.name)
    try {
      await copyFile(file.path, dest, fsConstants.COPYFILE_EXCL)
      copied.push(file.name)
      if (file.ext === 'bib' && bibliography === null) {
        bibliography = relative(manuscriptDir, dest)
      }
    } catch {
      skipped.push(file.name)
    }
  }
  return { copied, skipped, bibliography }
}

export interface ScaffoldRequest {
  dir: string
  name: string
  activeProfileId: string
  scaffold: 'blank' | 'starter' | 'import' | 'document'
  importDir: string | null
  /** Source .docx/.pdf/.html manuscript when `scaffold` is 'document'. */
  documentPath?: string | null
  settings: ProjectSettings
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
 * onboarding wizard. Directories → suna.json → the scaffolded/imported
 * manuscript → .gitignore → git init/commit, in that order, mirroring
 * createProject's shape but parameterized by profile/scaffold-kind/import and
 * an optional settings patch (feature-plan-5 §4/§5). A git failure is
 * reported as a warning, never thrown — the project still exists on success.
 */
export async function scaffoldProject(
  req: ScaffoldRequest,
  agent?: McpInvocation
): Promise<ScaffoldResult> {
  const { dir, name, activeProfileId, scaffold, importDir, settings } = req
  const documentPath = req.documentPath ?? null
  if (await exists(join(dir, 'suna.json'))) {
    throw new Error(`already a SUNA project: ${dir}`)
  }

  const warnings: string[] = []
  const settingsBlock = mergeProjectSettings({}, settings)
  const manifest = SunaProjectManifestSchema.parse({
    schemaVersion: 1,
    name,
    activeProfileId,
    directories: DEFAULT_PROJECT_DIRS,
    createdAt: new Date().toISOString(),
    ...(settingsBlock !== undefined ? { settings: settingsBlock } : {})
  })

  await mkdir(dir, { recursive: true })
  for (const sub of Object.values(DEFAULT_PROJECT_DIRS)) {
    await mkdir(join(dir, sub), { recursive: true })
  }
  const manuscriptDir = join(dir, DEFAULT_PROJECT_DIRS.manuscript)

  await writeFile(join(dir, 'suna.json'), JSON.stringify(manifest, null, 2) + '\n')

  if (scaffold === 'starter') {
    await writeManuscriptDir(manuscriptDir, starterManuscript(name), STARTER_MANUSCRIPT_MD, STARTER_BIB)
    await writeStarterFigure(dir, DEFAULT_PROJECT_DIRS.figures)
  } else if (scaffold === 'blank') {
    await writeManuscriptDir(manuscriptDir, blankManuscript(name), '', '')
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
    let bibliography: string | null = null
    if (importDir !== null) {
      const result = await copyImportableFiles(importDir, manuscriptDir)
      bibliography = result.bibliography
      if (result.copied.length === 0) {
        warnings.push(`No .md/.tex/.bib files found in ${importDir}`)
      }
      for (const name2 of result.skipped) {
        warnings.push(`Skipped "${name2}" — a file with that name already exists`)
      }
    }
    await writeManuscriptDir(
      manuscriptDir,
      blankManuscript(name, bibliography ?? 'references.bib'),
      IMPORT_PLACEHOLDER,
      bibliography === null ? '' : null
    )
  }

  await writeFile(join(dir, '.gitignore'), PROJECT_GITIGNORE)

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
