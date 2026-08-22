import {
  createLetter,
  missingDocuments,
  readLetterMeta,
  removeDocument,
  writeLetterMeta
} from './services/letter-new'
import { createSupplement } from './services/supplement-new'
import { checkLetterDocument } from './services/letter-check'
import {
  analyseReviewerReport,
  commitReviewerReports,
  createRound,
  extractReviewText,
  listRounds,
  readReviewerReports,
  readRound,
  writeRound
} from './services/round-new'
import { listVersions, logVersion, readVersionFile } from './services/version-log'
import { listCompareSides, readCompareDocument, setRoundBaseline } from './services/compare'
import { documentFile, projectDocument, projectDocuments } from './services/paths'
import { readFile } from 'node:fs/promises'
import {
  archiveDirName,
  EXAMPLE_STAMP_FILE,
  parseExampleStamp,
  serializeExampleStamp,
  slugifyProjectName
} from './services/example-stamp'
import { pointStateFor } from '@suna/core'
import { checkResponse } from '@suna/formatter'
import { BrowserWindow, app, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { access, cp, readdir, rename, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import {
  CHANNELS,
  EVENT_CHANNELS,
  LIT_PROVIDER_IDS,
  LIT_PROVIDER_META,
  type ChannelName,
  type LoadedConfigPayload,
  type LitCliPreference,
  type MigrationOutcome,
  type RequestOf,
  type ResponseOf
} from '@suna/core'
import { anthropicModelId, getProvider } from '@suna/agent'
import { cancelAiAsk, runAiAsk } from './services/ai-ask'
import {
  getKey,
  getLitKey,
  hasKey,
  hasLitKey,
  setKey,
  setLitKey
} from './services/agent-keys'
import { captureRect, devInfo, repairBundle } from './services/capture'
import { screenAskBundle } from './services/screen-ask'
import { readCommentsFile, writeCommentsFile } from './services/comments'
import { readRevisionsFile, writeRevisionsFile } from './services/revisions'
import {
  embedHighlightsIntoPdf,
  listAllReferenceNotes,
  readReferenceNotes,
  writeReferenceNotes
} from './services/refnotes'
import { analyzeDocx, commitDocxAnalysis } from './services/docx-import'
import { previewDocx } from './services/docx-preview'
import { exportDocx } from './services/export-docx'
import { exportHtml } from './services/export-html'
import { exportNotes } from './services/export-notes'
import { exportLetter, renderLetterPdf } from './services/export-letter'
import { exportResponse } from './services/export-response'
import { exportPdf } from './services/export-pdf'
import { exportPreview, withPreviewWindow } from './services/export-preview'
import { createFigure } from './services/figure-create'
import { duplicateFigure } from './services/figure-duplicate'
import { exportFigure } from './services/figure-export'
import {
  copyFileInto,
  createFile,
  listTree,
  makeDir,
  moveEntries,
  readBinary,
  fileSize,
  readText,
  renameEntry,
  writeBinary,
  writeText
} from './services/fs'
import { emptyTrash, listTrash, restoreTrash, trashEntry } from './services/trash'
import {
  acquireLibraryPdf,
  findLibraryPdf,
  readLibraryConfig,
  writeLibraryConfig
} from './services/library'
import {
  aiCliSearch,
  cancelAiCliSearch,
  detectAvailableClis,
  lookupByDoi,
  searchLiterature
} from './services/lit'
import { appMcpInvocation, healProjectAgentLayer } from './services/agentLayer'
import { approvePeerReviewAi } from './services/peer-review-approval'
import { updateManuscript } from './services/manuscript'
import { migrateProject } from './services/migrate-manuscript'
import {
  gitApplyHunk,
  gitCommit,
  gitDiffFile,
  gitDiscard,
  gitInit,
  gitLastCommitMessage,
  gitLog,
  gitStage,
  gitStatus,
  gitUndoCommit,
  gitUnstage
} from './services/git'
import { gitFileHistory, gitGraph, gitShowCommit } from './services/git-graph'
import {
  gitBranches,
  gitCreateBranch,
  gitDeleteBranch,
  gitMergeBranch,
  gitSwitchBranch
} from './services/git-branch'
import {
  gitAbort,
  gitConflictState,
  gitContinue,
  gitFetch,
  gitMarkResolved,
  gitPull,
  gitResolveConflict
} from './services/git-sync'
import {
  githubSession,
  githubSignOut,
  pollDeviceFlow,
  startDeviceFlow
} from './services/github-auth'
import {
  gitCheckRemote,
  gitPush,
  gitRemote,
  gitSetRemote,
  sshStatus
} from './services/git-remote'
import { ghCreateRepo, githubOwners } from './services/github'
import {
  checkScaffoldTarget,
  createProject,
  openProject,
  scaffoldProject,
  scaffoldStatus
} from './services/project'
import { watchProjectManifest } from './services/projectWatch'
import { watchProjectTree } from './services/projectTreeWatch'
import { watchGitDir } from './services/gitWatch'
import { allowRoot } from './services/roots'
import {
  awaitProvision,
  createEnvWithUv,
  detectEnvs,
  provisionProjectEnv,
  selectEnv,
  selectedEnv,
  uvAvailable
} from './services/envs'
import {
  forgetRecentProject,
  listRecentProjects,
  readSettings,
  touchRecentProject,
  writeSettings
} from './services/settings'
import {
  getSetting,
  loadConfig,
  resolveAiChoice,
  setSetting,
  type LoadedConfig
} from './services/userconfig'
import { openPathWithOs, revealPath } from './services/shell-open'
import {
  adoptTerminal,
  createTerminal,
  killTerminal,
  listTerminals,
  resizeTerminal,
  writeTerminal
} from './services/terminal'
import {
  executeInKernel,
  interruptKernel,
  restartKernel,
  shutdownKernel,
  startKernel
} from './services/kernel'

const AGENT_PROVIDER_IDS = ['anthropic', 'openai', 'ollama'] as const

/**
 * The config, as the IPC contract spells it. `settings` and `sources` are open
 * records on the wire (see LoadedConfigSchema): the typed shape lives in
 * @suna/core, and re-declaring it in zod would be a second place to add a key.
 */
function toPayload(config: LoadedConfig): LoadedConfigPayload {
  return config as unknown as LoadedConfigPayload
}

/**
 * Contact address for the Crossref/OpenAlex polite pools. `literature.mailto`
 * in the user's config.yml; an empty one falls back to the identity SUNA
 * already knows, which is what makes the polite pool work without the user
 * being asked for an address twice.
 */
async function politeMailto(): Promise<string | null> {
  const configured = (await getSetting('literature.mailto')).trim()
  if (configured !== '') return configured
  const email = (await readSettings())['user.email']
  return typeof email === 'string' && email.trim() !== '' ? email.trim() : null
}

/** `literature.cli`: which agent CLI the 'ai-cli' provider should prefer. */
async function litCliPreference(): Promise<LitCliPreference> {
  return getSetting('literature.cli')
}

/** The demo paper shipped with the repo (dev) or app resources (packaged). */
async function exampleProjectDir(): Promise<string> {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'examples', 'hello-suna')]
    : [
        resolve(app.getAppPath(), '..', '..', 'examples', 'hello-suna'),
        resolve(process.cwd(), '..', '..', 'examples', 'hello-suna'),
        resolve(process.cwd(), 'examples', 'hello-suna')
      ]
  for (const dir of candidates) {
    try {
      await access(join(dir, 'suna.json'))
      return dir
    } catch {
      // keep looking
    }
  }
  throw new Error('example project not found (examples/hello-suna)')
}

/** A project manifest's `name`, or null if it cannot be read. */
async function projectName(dir: string): Promise<string | null> {
  try {
    const manifest: unknown = JSON.parse(await readFile(join(dir, 'suna.json'), 'utf8'))
    if (typeof manifest !== 'object' || manifest === null) return null
    const name = (manifest as Record<string, unknown>)['name']
    return typeof name === 'string' ? name : null
  } catch {
    return null
  }
}

/** The name a stale example copy is filed under when it is moved aside. */
async function archiveStaleExampleCopy(userData: string, target: string): Promise<void> {
  const name = await projectName(target)
  const label = name === null ? 'previous' : slugifyProjectName(name)
  const siblings = await readdir(userData).catch(() => [] as string[])
  const archived = join(userData, archiveDirName(basename(target), label, siblings))
  allowRoot(archived)
  await rename(target, archived)
  console.warn(`example copy came from a different bundled example; kept it at ${archived}`)
}

/**
 * The example opens as a user-owned COPY under userData so edits and commits
 * never dirty the shipped demo (or the SUNA repo in dev). The copy is made
 * once and reused as-is, preserving user edits.
 *
 * "As-is" is qualified by WHICH example it is a copy of. The copy carries a
 * stamp naming its source (services/example-stamp.ts); when the app starts
 * shipping a different example, a copy of the old one no longer answers to
 * "open the example", so it is moved aside — never deleted, it may hold real
 * work — and a fresh copy is taken.
 */
async function ensureExampleProjectCopy(): Promise<string> {
  const userData = app.getPath('userData')
  const target = join(userData, 'example-project')
  allowRoot(target)
  const source = await exampleProjectDir()
  const sourceId = basename(source)

  const alreadyCopied = await access(join(target, 'suna.json')).then(
    () => true,
    () => false
  )
  if (alreadyCopied) {
    const stamp = parseExampleStamp(
      await readFile(join(target, EXAMPLE_STAMP_FILE), 'utf8').catch(() => '')
    )
    if (stamp === sourceId) return target
    if (stamp === null) {
      // A copy from before stamps existed. Its manifest name is the only
      // evidence available, and it is enough: a copy of the CURRENT example
      // is adopted and stamped rather than needlessly archived, which is
      // what nearly every existing install has.
      const [copied, shipped] = await Promise.all([projectName(target), projectName(source)])
      if (copied !== null && copied === shipped) {
        await writeFile(join(target, EXAMPLE_STAMP_FILE), serializeExampleStamp(sourceId), 'utf8')
        return target
      }
    }
    await archiveStaleExampleCopy(userData, target)
  }

  await cp(source, target, {
    recursive: true,
    filter: (src) => {
      const rel = relative(source, src)
      if (rel === '') return true
      const top = rel.split(sep)[0]
      if (top === 'output' || top === '.git') return false
      return basename(src) !== '.DS_Store'
    }
  })
  await writeFile(join(target, EXAMPLE_STAMP_FILE), serializeExampleStamp(sourceId), 'utf8')
  // Version control from birth; best-effort if git is unavailable.
  try {
    await gitInit(target)
  } catch (error) {
    console.warn('git init for example copy failed (continuing without VCS):', error)
  }
  return target
}

/**
 * Give a project a python environment when it opens without one selected, so
 * terminals, the run button and notebook kernels work with no setup step.
 *
 * Two ways, in order: an env that is already there (a `.venv` a colleague or
 * a previous run created — selecting it is free and instant), then, for a
 * project that ships a `requirements.txt`, provisioning one from it. The
 * example project is the case this exists for: its requirements name
 * `ipykernel`, and a kernel without `ipykernel` is the one failure a reader
 * cannot be expected to fix. It applies to EVERY project open, not just the
 * bundled example — the same folder opened from recents or from disk must
 * behave identically.
 *
 * Deliberately not awaited by the open: an install takes tens of seconds on a
 * cold cache and the project must appear at once. Anything that starts an
 * interpreter waits on `awaitProvision()` instead, and the chosen env is
 * pushed to the renderer so the env chip stops saying "no env". Best-effort
 * throughout: without python or a network the project opens exactly as before.
 */
async function ensureProjectEnv(dir: string): Promise<void> {
  if ((await selectedEnv(dir)) !== null) return

  const existing = (await detectEnvs(dir).catch(() => [])).find((env) => env.python !== null)
  if (existing) {
    await selectEnv(dir, existing.path)
    broadcast(EVENT_CHANNELS.envChanged, { dir, envPath: existing.path })
    return
  }

  const result = await provisionProjectEnv(dir)
  if (!result.ok || result.envPath === null) {
    console.warn('project env not provisioned (continuing without one):', result.error)
    return
  }
  if ((await selectedEnv(dir)) !== null) return
  await selectEnv(dir, result.envPath)
  broadcast(EVENT_CHANNELS.envChanged, { dir, envPath: result.envPath })
}

/**
 * Record a project open in the recents list. Best-effort by design: a settings
 * write that fails must never stop a project from opening — it is logged, and
 * the welcome screen simply misses one row.
 */
async function noteRecentProject(dir: string, name: string): Promise<void> {
  try {
    await touchRecentProject(dir, name)
  } catch (error) {
    console.warn('could not record recent project:', error)
  }
}

/**
 * Follow the newly-opened project's suna.json (feature-plan-5 §4). Every entry
 * point that makes a project "the open one" calls this, so an external edit —
 * an agent, `$` in the terminal, another editor — reaches the renderer's
 * resolver without a restart. Best-effort: a project that cannot be watched
 * still opens, it just loses live re-resolution.
 */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function followProjectManifest(dir: string): void {
  watchProjectManifest(dir, (changed) => {
    broadcast(EVENT_CHANNELS.projectManifestChanged, { dir: changed })
  })
  // and the directory itself, so the explorer reflects writes the renderer
  // never made — exports, agents, the terminal, Finder (nav-bar item 4).
  watchProjectTree(dir, (changed) => {
    broadcast(EVENT_CHANNELS.projectTreeChanged, { dir: changed })
  })
  // and `.git`, which the tree watch ignores — staging, committing, checking
  // out or rebasing from a terminal or an agent moves nothing else.
  watchGitDir(dir, (changed) => {
    broadcast(EVENT_CHANNELS.gitChanged, { dir: changed })
  })
}

/**
 * Bring a project to the flat manuscript layout as it opens (feature-plan-7
 * §1). migrateProject already returns a structured error rather than throwing,
 * but an unexpected throw must not stop a project from opening either — the
 * old layout on disk is intact in that case, and the renderer surfaces the
 * outcome.
 */
async function migrateOnOpen(dir: string): Promise<MigrationOutcome> {
  try {
    return await migrateProject(dir)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('manuscript migration failed (opening the project as-is):', error)
    return { migrated: false, notes: [], error: message }
  }
}

/** Register a handler with request/response zod validation on both edges. */
function handle<C extends ChannelName>(
  channel: C,
  handler: (req: RequestOf<C>, event: IpcMainInvokeEvent) => Promise<ResponseOf<C>>
): void {
  ipcMain.handle(channel, async (event, payload: unknown) => {
    const contract = CHANNELS[channel]
    const request = contract.request.parse(payload) as RequestOf<C>
    const response = await handler(request, event)
    return contract.response.parse(response)
  })
}

export function registerIpcHandlers(): void {
  handle('project:create', async ({ dir, name }) => {
    const manifest = await createProject(dir, name, appMcpInvocation())
    await noteRecentProject(dir, manifest.name)
    followProjectManifest(dir)
    return manifest
  })
  handle('project:open', async ({ dir }) => {
    const opened = await openProject(dir)
    void ensureProjectEnv(dir)
    const migration = await migrateOnOpen(dir)
    // Fire-and-forget: the heal never throws, and a wedged ~/SunaConfig or
    // slow home volume must not block a project from opening.
    void healProjectAgentLayer(dir)
    await noteRecentProject(dir, opened.manifest.name)
    followProjectManifest(dir)
    return { ...opened, migration }
  })
  handle('project:migrate', ({ dir }) => migrateProject(dir))

  /* ---- documents, letters and rounds (feature-plan-12) ------------------ */
  handle('documents:list', async ({ dir }) => ({
    documents: await projectDocuments(dir),
    missing: await missingDocuments(dir)
  }))
  handle('documents:remove', async ({ dir, documentId }) => ({
    documents: await removeDocument(dir, documentId)
  }))
  handle('supplement:new', async ({ dir }) => createSupplement(dir))
  handle('letter:new', async (input) => {
    const res = await createLetter({
      rootDir: input.dir,
      id: input.id,
      letterKind: input.letterKind,
      targetProfileId: input.targetProfileId,
      title: input.title,
      salutation: input.salutation ?? null
    })
    return { ...res, requiredAssertions: res.requiredAssertions.map(String) }
  })
  handle('letter:read', async ({ dir, metaFile }) => ({
    meta: await readLetterMeta(dir, metaFile)
  }))
  handle('letter:write', async ({ dir, metaFile, meta }) => {
    await writeLetterMeta(dir, metaFile, meta)
    return { ok: true as const }
  })
  handle('letter:check', async ({ dir, documentId }) => ({
    diagnostics: await checkLetterDocument(dir, documentId)
  }))

  handle('round:new', async (input) => ({
    round: await createRound({
      rootDir: input.dir,
      id: input.id,
      kind: input.kind,
      label: input.label,
      venue: input.venue ?? null
    })
  }))
  handle('round:list', async ({ dir }) => ({ rounds: await listRounds(dir) }))
  handle('round:read', async ({ dir, roundId }) => ({
    round: await readRound(dir, roundId),
    reports: await readReviewerReports(dir, roundId)
  }))
  handle('round:write', async ({ dir, round }) => {
    await writeRound(dir, round)
    return { ok: true as const }
  })

  handle('round:set-baseline', async ({ dir, roundId, versionId }) => ({
    round: await setRoundBaseline(dir, roundId, versionId)
  }))

  handle('compare:sides', async ({ dir }) => ({ sides: await listCompareSides(dir) }))
  handle('compare:read', async ({ dir, ref }) => ({
    document: await readCompareDocument(dir, ref)
  }))

  handle('version:list', async ({ dir }) => ({ versions: await listVersions(dir) }))
  handle('version:log', async ({ dir, stage, note }) => ({
    version: await logVersion({ rootDir: dir, stage, note })
  }))
  handle('version:read-file', async ({ dir, versionId, path }) => ({
    text: await readVersionFile(dir, versionId, path)
  }))

  handle('review:analyse', async ({ text, path }) => {
    // A file goes through the SAME extraction the DOCX importer uses —
    // .docx via mammoth, .pdf via pdfjs text items — so the three routes in
    // the import sheet converge on one string before anything is segmented.
    const sourceText = text !== null ? text : await extractReviewText(path ?? '')
    const a = analyseReviewerReport(sourceText)
    return {
      sourceText: a.sourceText,
      reviewers: a.reviewers.map((r) => ({
        index: r.index,
        label: r.label,
        from: r.from,
        to: r.to,
        points: r.points,
        headings: r.headings
      })),
      preamble: a.preamble,
      unassigned: a.unassigned,
      coveragePercent: a.coveragePercent,
      totalPoints: a.totalPoints,
      unsplitReviewers: a.unsplitReviewers,
      replyGaps: a.replyGaps
    }
  })
  handle('review:commit', async (input) => {
    const reports = await commitReviewerReports({
      rootDir: input.dir,
      roundId: input.roundId,
      analysis: {
        sourceText: input.sourceText,
        preamble: input.preamble,
        reviewers: input.reviewers,
        unassigned: input.unassigned,
        coverage: 1,
        coveragePercent: 100,
        totalPoints: input.reviewers.reduce((n, r) => n + r.points.length, 0),
        unsplitReviewers: [],
        replyGaps: []
      }
    })
    return {
      reviewers: reports.length,
      points: reports.reduce((n, r) => n + r.points.length, 0)
    }
  })
  handle('review:set-point', async (input) => {
    const round = await readRound(input.dir, input.roundId)
    const existing = pointStateFor(round, input.pointId)
    const next = {
      ...existing,
      status: input.status,
      assignee: input.assignee === undefined ? existing.assignee : input.assignee,
      reply: input.reply === undefined ? existing.reply : input.reply
    }
    const updated = {
      ...round,
      pointStates: [...round.pointStates.filter((s) => s.pointId !== input.pointId), next].sort(
        (a, b) => a.pointId.localeCompare(b.pointId)
      )
    }
    await writeRound(input.dir, updated)
    return { round: updated }
  })
  handle('review:check', async ({ dir, roundId, forExport }) => {
    const round = await readRound(dir, roundId)
    const reports = await readReviewerReports(dir, roundId)
    let responseText = ''
    if (round.responseDocumentId !== null) {
      const doc = await projectDocument(dir, round.responseDocumentId)
      if (doc?.file != null) {
        const abs = await documentFile(dir, doc, 'prose')
        if (abs !== null) responseText = await readFile(abs, 'utf8').catch(() => '')
      }
    }
    return {
      diagnostics: checkResponse({ round, reports, responseText, forExport: forExport ?? false })
    }
  })
  handle('project:open-example', async () => {
    const dir = await ensureExampleProjectCopy()
    void ensureProjectEnv(dir)
    const { manifest } = await openProject(dir)
    const migration = await migrateOnOpen(dir)
    void healProjectAgentLayer(dir)
    await noteRecentProject(dir, manifest.name)
    followProjectManifest(dir)
    return { dir, manifest, migration }
  })
  handle('project:scaffold-status', ({ dir }) => scaffoldStatus(dir))
  handle('peer-review:approve', async ({ dir, approvedBy, source, learnedFrom }) =>
    approvePeerReviewAi({ dir, approvedBy, source, learnedFrom })
  )
  handle('project:check-target', ({ parentDir, name }) => checkScaffoldTarget(parentDir, name))
  handle('project:scaffold', async (req) => {
    const result = await scaffoldProject(req, appMcpInvocation())
    await noteRecentProject(req.dir, result.manifest.name)
    followProjectManifest(req.dir)
    return result
  })
  handle('project:recents', async () => ({ recents: await listRecentProjects() }))
  handle('project:touch-recent', async ({ path, name }) => ({
    recents: await touchRecentProject(path, name)
  }))
  handle('project:forget-recent', async ({ path }) => ({
    recents: await forgetRecentProject(path)
  }))

  handle('docx:analyze', async ({ path }) => ({ analysis: await analyzeDocx(path) }))
  handle('docx:preview', ({ path }) => previewDocx(path))
  handle('docx:commit', async ({ analysis, dir, force }) => {
    const result = await commitDocxAnalysis(analysis, dir, force)
    void healProjectAgentLayer(result.dir)
    await noteRecentProject(result.dir, basename(result.dir))
    followProjectManifest(result.dir)
    return result
  })

  handle('fs:read-text', async ({ path }) => ({ content: await readText(path) }))
  handle('fs:write-text', async ({ path, content }) => ({
    bytesWritten: await writeText(path, content)
  }))
  handle('fs:read-binary', ({ path }) => readBinary(path))
  handle('fs:file-size', async ({ path }) => ({ bytes: await fileSize(path) }))
  handle('fs:copy-file', async ({ from, to }) => ({ path: await copyFileInto(from, to) }))
  handle('fs:list', async ({ dir }) => ({ root: await listTree(dir) }))
  handle('fs:rename', async ({ path, newName }) => ({
    path: await renameEntry(path, newName)
  }))
  // One drop is one call: moveEntries collects per-path failures, so this
  // resolves with a partial outcome rather than rejecting the whole batch.
  handle('fs:move', ({ paths, targetDir }) => moveEntries(paths, targetDir))
  // Light files land in SUNA's own trash (restorable for the retention
  // window); directories and heavy files go to the OS trash.
  handle('fs:delete', ({ path }) => trashEntry(path))

  handle('trash:list', async ({ dir }) => ({ entries: await listTrash(dir) }))
  handle('trash:restore', ({ dir, ids }) => restoreTrash(dir, ids))
  handle('trash:empty', async ({ dir, ids }) => ({ removed: await emptyTrash(dir, ids) }))
  handle('fs:mkdir', async ({ path }) => {
    await makeDir(path)
    return {}
  })
  handle('fs:create-file', async ({ path, content }) => {
    await createFile(path, content)
    return {}
  })

  handle('shell:reveal', ({ path }) => revealPath(path))
  handle('shell:open-path', ({ path }) => openPathWithOs(path))

  // manuscript.json / comments.json: read fresh, merge, validate, write atomically.
  handle('manuscript:update', async ({ dir, patch }) => ({
    manuscript: await updateManuscript(dir, patch)
  }))
  handle('comments:read', async ({ dir }) => ({ file: await readCommentsFile(dir) }))
  handle('comments:write', async ({ dir, file }) => {
    await writeCommentsFile(dir, file)
    return {}
  })

  // manuscript/revisions.json — the pre-image the AI-diff view diffs against.
  handle('revisions:read', async ({ dir }) => ({ file: await readRevisionsFile(dir) }))
  handle('revisions:write', async ({ dir, file }) => {
    await writeRevisionsFile(dir, file)
    return {}
  })

  // references/notes/<citekey>.json — reading notes on a reference PDF (ADR-008).
  handle('refnotes:read', async ({ dir, citekey }) => ({
    file: await readReferenceNotes(dir, citekey)
  }))
  handle('refnotes:write', async ({ dir, citekey, file }) => {
    await writeReferenceNotes(dir, citekey, file)
    return {}
  })
  handle('refnotes:list-all', async ({ dir }) => ({ papers: await listAllReferenceNotes(dir) }))
  handle('refnotes:embed', async ({ dir, citekey, base64 }) =>
    embedHighlightsIntoPdf(dir, citekey, base64)
  )

  handle('lit:search', async ({ provider, query, limit }) =>
    searchLiterature(provider, query, {
      limit,
      apiKey: await getLitKey(provider),
      mailto: await politeMailto()
    })
  )
  handle('lit:by-doi', async ({ provider, doi }) =>
    lookupByDoi(provider, doi, {
      apiKey: await getLitKey(provider),
      mailto: await politeMailto()
    })
  )
  handle('lit:set-key', async ({ provider, key }) => {
    await setLitKey(provider, key)
    return {}
  })
  handle('lit:providers', async () => ({
    providers: await Promise.all(
      LIT_PROVIDER_IDS.map(async (id) => ({
        id,
        hasKey: await hasLitKey(id),
        keyless: LIT_PROVIDER_META[id].keyless
      }))
    )
  }))
  handle('lit:cli-status', async () => ({ available: await detectAvailableClis() }))
  handle('lit:ai-search', async ({ query, limit, dir }, event) => {
    const searchId = `lit-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const webContents = event.sender
    const cliPreference = await litCliPreference()

    // Fire-and-forget: the child keeps running after this handler returns.
    // Progress/outcome arrive over EVENT_CHANNELS.litProgress/litDone(searchId).
    void aiCliSearch(searchId, query, limit, {
      dir,
      cliPreference,
      onProgress: (status) => {
        if (!webContents.isDestroyed()) webContents.send(EVENT_CHANNELS.litProgress(searchId), status)
      }
    }).then(({ results, error }) => {
      if (!webContents.isDestroyed()) {
        webContents.send(EVENT_CHANNELS.litDone(searchId), { results, error })
      }
    })

    return { searchId }
  })
  handle('lit:cancel', async ({ searchId }) => {
    cancelAiCliSearch(searchId)
    return {}
  })

  // The reference library (feature-plan-10 §Layer 5). The settings live in
  // ~/SunaConfig/library.json rather than userData, so the standalone MCP
  // server searches the same folders this pane writes — which is why these
  // are their own channels and not keys on 'settings:get'/'settings:set'.
  handle('library:read-config', () => readLibraryConfig())
  handle('library:write-config', ({ patch }) => writeLibraryConfig(patch))
  handle('library:find-pdf', ({ result, projectRoot }) =>
    findLibraryPdf({ result, projectRoot })
  )
  // The contact address is main's to supply, exactly as it is for 'lit:search':
  // Unpaywall's keyless API requires one, and a renderer must not be able to
  // put an arbitrary address on the app's outgoing requests.
  //
  // The download rung can run for its full 60 s budget, so the call carries an
  // AbortSignal. This channel is a plain invoke with no id of its own, so it
  // cannot follow the 'lit:ai-search'/'lit:cancel' idiom — that one hands the
  // renderer a searchId to cancel BY, and adding one here means a new request
  // field and a 'library:cancel' channel in @suna/core's contract. What main
  // can already observe is the sender going away: closing the window while a
  // fetch is in flight now aborts it instead of leaving it running to its
  // deadline with nobody left to answer.
  handle('library:acquire-pdf', async ({ result, citekey, projectRoot, policy }, event) => {
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    event.sender.once('destroyed', abort)
    try {
      return await acquireLibraryPdf({
        result,
        citekey,
        projectRoot,
        policy,
        mailto: await politeMailto(),
        // The renderer cannot name a candidate to accept yet: the contract in
        // @suna/core carries no `accept` field. The ladder's accept path is
        // implemented and tested; wiring the button to it is a contract change.
        acceptPath: null,
        signal: controller.signal
      })
    } finally {
      event.sender.removeListener('destroyed', abort)
    }
  })

  handle('ai:ask', async (input, event) => {
    const { prompt, dir, allowedTools, useMcp, viaStdin } = input
    const askId = `ai-ask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const webContents = event.sender
    const cliPreference = await litCliPreference()
    // Model/effort resolve from ~/.suna/config.yml here rather than being
    // passed in, so a hand-edited config reaches the spawn without renderer
    // help — and a per-task choice from the caller beats it, because "this one
    // letter is worth Opus" is a decision about the task, not about the setup.
    const resolved = await resolveAiChoice()
    const model = input.model ?? resolved.model
    const effort = input.effort ?? resolved.effort

    // Fire-and-forget: the child keeps running after this handler returns.
    // Progress/outcome arrive over EVENT_CHANNELS.aiAskProgress/aiAskDone(askId).
    void runAiAsk(askId, prompt, {
      dir,
      cliPreference,
      allowedTools,
      useMcp,
      viaStdin,
      model,
      effort,
      onProgress: (status) => {
        if (!webContents.isDestroyed()) webContents.send(EVENT_CHANNELS.aiAskProgress(askId), status)
      }
    }).then(({ text, error }) => {
      if (!webContents.isDestroyed()) {
        webContents.send(EVENT_CHANNELS.aiAskDone(askId), { text, error })
      }
    })

    return { askId }
  })
  handle('ai:cancel', async ({ askId }) => {
    cancelAiAsk(askId)
    return {}
  })
  handle('ai:repair-bundle', (req, event) => repairBundle(event, req))

  handle('app:capture-rect', (req, event) => captureRect(event, req))
  handle('ai:screen-ask-bundle', (req) => screenAskBundle(req))
  handle('app:dev-info', async () => devInfo())

  handle('figure:export', ({ dir, figureId, format, widthMm, dpi, transparent }) =>
    exportFigure({ dir, figureId, format, widthMm, dpi, transparent })
  )
  handle('figure:write-binary', async ({ path, base64 }) => ({
    path: await writeBinary(path, base64)
  }))
  handle('figure:duplicate', ({ dir, figureId, newId }) => duplicateFigure(dir, figureId, newId))
  handle('figure:create', ({ dir, name, widthMm }) => createFigure(dir, name, widthMm))

  handle('export:letter', (req) => exportLetter(req))
  handle('letter:preview', async (req) => {
    const started = Date.now()
    // Prints in the shared hidden window the manuscript preview uses, so a
    // page view never costs a second BrowserWindow.
    const pdf = await withPreviewWindow((win) => renderLetterPdf(req.dir, req.documentId, win))
    return { data: pdf.toString('base64'), ms: Date.now() - started }
  })
  handle('export:response', (req) => exportResponse(req))
  handle('export:docx', (req) => exportDocx(req))
  handle('export:html', (req) => exportHtml(req))
  handle('export:pdf', (req) => exportPdf(req))
  handle('export:preview', (req) => exportPreview(req))
  handle('export:notes', (req) => exportNotes(req))

  handle('git:status', ({ dir }) => gitStatus(dir))
  handle('git:log', ({ dir, limit }) => gitLog(dir, limit))
  handle('git:commit', ({ dir, message, stageAll, amend }) =>
    gitCommit(dir, message, stageAll, amend ?? false)
  )
  handle('git:undo-commit', ({ dir }) => gitUndoCommit(dir))
  handle('git:last-message', ({ dir }) => gitLastCommitMessage(dir))
  handle('git:graph', ({ dir, limit, scope }) => gitGraph(dir, limit, scope ?? 'all'))
  handle('git:file-history', ({ dir, path, limit }) => gitFileHistory(dir, path, limit))
  handle('git:show-commit', ({ dir, hash }) => gitShowCommit(dir, hash))
  handle('git:diff-file', ({ dir, path, side }) => gitDiffFile(dir, path, side ?? 'both'))
  handle('git:apply-hunk', async ({ dir, path, index, action }) => {
    await gitApplyHunk(dir, path, index, action)
    return {}
  })
  handle('git:stage', async ({ dir, paths }) => {
    await gitStage(dir, paths)
    return {}
  })
  handle('git:unstage', async ({ dir, paths }) => {
    await gitUnstage(dir, paths)
    return {}
  })
  handle('git:discard', ({ dir, paths, deleteUntracked }) =>
    gitDiscard(dir, paths, deleteUntracked ?? false)
  )
  handle('git:init', ({ dir }) => gitInit(dir))
  handle('git:remote', ({ dir }) => gitRemote(dir))
  handle('git:set-remote', ({ dir, url, allowHttps }) => gitSetRemote(dir, url, allowHttps ?? false))
  handle('git:check-remote', ({ dir }) => gitCheckRemote(dir))
  handle('git:push', ({ dir }) => gitPush(dir))
  handle('git:ssh-status', ({ host, probe }) => sshStatus(host ?? 'github.com', probe))

  handle('git:branches', ({ dir }) => gitBranches(dir))
  handle('git:create-branch', ({ dir, name }) => gitCreateBranch(dir, name))
  handle('git:switch-branch', ({ dir, name }) => gitSwitchBranch(dir, name))
  handle('git:delete-branch', ({ dir, name, force }) => gitDeleteBranch(dir, name, force ?? false))
  handle('git:merge-branch', ({ dir, name }) => gitMergeBranch(dir, name))

  handle('git:fetch', ({ dir }) => gitFetch(dir))
  handle('git:pull', ({ dir, mode }) => gitPull(dir, mode ?? 'rebase'))
  handle('git:conflict-state', ({ dir }) => gitConflictState(dir))
  handle('git:resolve-conflict', async ({ dir, path, side }) => {
    await gitResolveConflict(dir, path, side)
    return {}
  })
  handle('git:mark-resolved', async ({ dir, path }) => {
    await gitMarkResolved(dir, path)
    return {}
  })
  handle('git:continue', ({ dir, setAside }) => gitContinue(dir, setAside ?? false))
  handle('git:abort', ({ dir }) => gitAbort(dir))

  handle('github:session', () => githubSession())
  handle('github:device-start', () => startDeviceFlow())
  handle('github:device-poll', ({ deviceCode, interval }) => pollDeviceFlow(deviceCode, interval))
  handle('github:sign-out', async () => {
    await githubSignOut()
    return {}
  })
  handle('github:owners', () => githubOwners())
  handle('github:create-repo', ({ dir, name, visibility, owner, description, useHttps }) =>
    ghCreateRepo(dir, name, visibility, owner ?? null, description ?? null, useHttps ?? false)
  )

  handle('agent:set-key', async ({ provider, key }) => {
    await setKey(provider, key)
    return {}
  })
  handle('agent:provider-status', async () => ({
    providers: await Promise.all(
      AGENT_PROVIDER_IDS.map(async (id) => ({ id, hasKey: await hasKey(id) }))
    )
  }))
  handle('agent:chat', async ({ provider, system, messages, dir }) => {
    const key = await getKey(provider)
    if (provider !== 'ollama' && key === null) {
      throw new Error(`no API key configured for ${provider} — add one in settings`)
    }
    const { model, effort } = await resolveAiChoice()
    // The tier only names an Anthropic model; openai/ollama keep their own
    // default and take the effort hint only if their adapter understands it.
    const modelId = provider === 'anthropic' ? anthropicModelId(model) : undefined
    return getProvider(provider).chat(
      { system, messages, model: modelId, effort },
      { apiKey: key ?? undefined }
    )
  })

  handle('term:create', async ({ cwd, cols, rows, envPath }, event) => {
    const webContents = event.sender
    return { id: createTerminal({ cwd, cols, rows, envPath, webContents }) }
  })
  handle('term:write', async ({ id, data }) => {
    writeTerminal(id, data)
    return {}
  })
  handle('term:resize', async ({ id, cols, rows }) => {
    resizeTerminal(id, cols, rows)
    return {}
  })
  handle('term:kill', async ({ id }) => {
    killTerminal(id)
    return {}
  })
  handle('term:list', async () => ({ ids: listTerminals() }))
  handle('term:adopt', async ({ id }, event) => {
    const adopted = adoptTerminal(id, event.sender)
    return adopted === null ? { adopted: false, replay: '' } : { adopted: true, replay: adopted.replay }
  })

  handle('kernel:start', async ({ cwd, envPath, kernelName }, event) => {
    // A kernel asked for while its env is still installing waits for the
    // install rather than reporting a missing jupyter_client.
    await awaitProvision(envPath)
    return { id: startKernel({ cwd, envPath, kernelName, webContents: event.sender }) }
  })
  handle('kernel:execute', async ({ id, reqId, code }) => {
    executeInKernel(id, reqId, code)
    return {}
  })
  handle('kernel:interrupt', async ({ id }) => {
    interruptKernel(id)
    return {}
  })
  handle('kernel:restart', async ({ id }) => {
    restartKernel(id)
    return {}
  })
  handle('kernel:shutdown', async ({ id }) => {
    shutdownKernel(id)
    return {}
  })

  handle('env:detect', async ({ dir }) => ({ envs: await detectEnvs(dir) }))
  handle('env:select', async ({ dir, envPath }) => {
    await selectEnv(dir, envPath)
    return {}
  })
  handle('env:selected', async ({ dir }) => ({ envPath: await selectedEnv(dir) }))
  handle('env:uv-available', async () => ({ available: await uvAvailable() }))
  handle('env:create', ({ dir }) => createEnvWithUv(dir))

  handle('config:get', async () => ({ config: toPayload(await loadConfig()) }))
  handle('config:set', async ({ key, value }) => {
    // The key arrives as a string over IPC; setSetting validates it against the
    // registry, so an unknown key is a rejected write rather than a stray
    // top-level entry appearing in the user's file.
    const out = await setSetting(key as Parameters<typeof setSetting>[0], value ?? null)
    return { config: toPayload(out.config), error: out.error }
  })
  handle('settings:get', async () => ({ settings: await readSettings() }))
  handle('settings:set', async ({ patch }) => ({ settings: await writeSettings(patch) }))

  handle('agent:write-mcp-config', async ({ dir }) => {
    // Claude Code and Codex both auto-discover .mcp.json in the project root.
    // Healing the whole layer (adr-004) writes it plus the stubs/context
    // files, so "Open Claude Code here" always launches into a wired project.
    // A failed heal must throw — launching a CLI that claims MCP wiring which
    // was never written is worse than an error the view can show.
    if (!(await healProjectAgentLayer(dir))) {
      throw new Error('could not write the agent layer — check that the project folder is writable')
    }
    return { path: join(dir, '.mcp.json') }
  })

  handle('dialog:pick-directory', async ({ title, allowCreate }) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return { path: null }
    const result = await dialog.showOpenDialog(win, {
      title,
      properties: allowCreate
        ? ['openDirectory', 'createDirectory']
        : ['openDirectory']
    })
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) }
  })

  handle('dialog:pick-file', async ({ title, extensions }) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return { path: null }
    // Electron wants bare extensions; callers may pass '.pdf' or 'pdf'.
    const bare = extensions.map((ext) => ext.replace(/^\./, '').toLowerCase()).filter(Boolean)
    const filters =
      bare.length > 0
        ? [
            { name: bare.map((ext) => ext.toUpperCase()).join(', '), extensions: bare },
            { name: 'All files', extensions: ['*'] }
          ]
        : [{ name: 'All files', extensions: ['*'] }]
    const result = await dialog.showOpenDialog(win, {
      title,
      properties: ['openFile'],
      filters
    })
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) }
  })
}
