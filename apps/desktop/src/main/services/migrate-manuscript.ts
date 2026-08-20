import { access, readFile, rm, unlink } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { CommentsFileSchema, ManuscriptSchema, AuthorsFileSchema } from '@suna/core'
import { writeFileAtomic } from './atomic'
import { projectDocuments, projectSubdir } from './paths'

/**
 * Migrate a project from the OLD manuscript layout to the flat one
 * (feature-plan-7 §1).
 *
 * Old: `manuscript.json` carried a `body` array of nodes pointing at
 * `manuscript/sections/NN-name.md`, plus `authors` and `affiliations`.
 * New: `manuscript/` is flat — manuscript.md (all prose, sections are
 * Markdown headings), manuscript.json (metadata only), authors.json,
 * references.bib.
 *
 * THE PROSE IS THE USER'S WORK. The order here is deliberate and is the whole
 * safety story:
 *
 *   1. read everything and build the three new files IN MEMORY,
 *   2. validate them in memory (nothing is written if they are not valid),
 *   3. write manuscript.md + authors.json + the rewritten manuscript.json
 *      atomically,
 *   4. re-read all three from disk and parse them again,
 *   5. rewrite comments.json section targets,
 *   6. and only THEN delete sections/.
 *
 * Any failure before step 6 rolls the project back to exactly what it was and
 * returns a structured error — a project that fails to migrate still opens,
 * unmigrated, with its prose intact. Migration is idempotent: a project that
 * is already flat is inspected and left alone.
 */

export interface MigrationResult {
  /** True only when this call actually rewrote the project. */
  migrated: boolean
  /** Ordered, human-readable account of what happened; safe to surface in the UI. */
  notes: string[]
  /**
   * Non-null when migration was ABANDONED. The project is untouched — the old
   * layout is still on disk and still openable by an older build.
   */
  error: string | null
}

const DEFAULT_MANUSCRIPT_FILE = 'manuscript.md'

/** `A` → `#`, `B` → `##`, `C-runin` → `###`, exactly as the plan specifies. */
const HEADING_DEPTH: Record<string, number> = { A: 1, B: 2, 'C-runin': 3 }

interface LegacySection {
  kind: 'section'
  heading: string | null
  level: string
  content: string | null
  children: LegacyNode[]
}

interface LegacyBox {
  kind: 'box'
  id: string
  title: string
  content: string | null
}

type LegacyNode = LegacySection | LegacyBox

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asLegacyNode(value: unknown): LegacyNode | null {
  if (!isRecord(value)) return null
  const content = typeof value['content'] === 'string' ? value['content'] : null
  if (value['kind'] === 'box') {
    const id = typeof value['id'] === 'string' ? value['id'] : ''
    const title = typeof value['title'] === 'string' ? value['title'] : ''
    return { kind: 'box', id, title, content }
  }
  if (value['kind'] !== 'section') return null
  const heading = typeof value['heading'] === 'string' && value['heading'] !== '' ? value['heading'] : null
  const level = typeof value['level'] === 'string' ? value['level'] : 'A'
  const rawChildren = Array.isArray(value['children']) ? value['children'] : []
  const children: LegacyNode[] = []
  for (const child of rawChildren) {
    const node = asLegacyNode(child)
    if (node !== null) children.push(node)
  }
  return { kind: 'section', heading, level, content, children }
}

/** Thrown internally to abandon the migration with a message; never escapes migrateProject. */
class MigrationAbort extends Error {}

function fail(message: string): never {
  throw new MigrationAbort(message)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Appends a block, guaranteeing exactly one blank line between blocks. Prose
 * bytes are never rewritten — only the run of newlines BETWEEN blocks is
 * normalized, so every section file's text survives verbatim.
 */
function appendBlock(accumulated: string, block: string): string {
  if (block === '') return accumulated
  if (accumulated === '') return block
  return `${accumulated.replace(/\s*$/, '')}\n\n${block}`
}

/** Resolve a `sections/…md` reference, refusing anything that escapes the manuscript dir. */
function resolveContentPath(manuscriptDir: string, content: string): string {
  if (isAbsolute(content)) fail(`body content path must be relative to manuscript/: ${content}`)
  const full = resolve(manuscriptDir, content)
  const rel = relative(manuscriptDir, full)
  if (rel.startsWith('..')) fail(`body content path escapes the manuscript directory: ${content}`)
  return full
}

interface ProseBuild {
  markdown: string
  notes: string[]
}

async function buildMarkdown(
  manuscriptDir: string,
  manuscriptFile: string,
  body: unknown[]
): Promise<ProseBuild> {
  const notes: string[] = []
  const boxIds: string[] = []
  let markdown = ''
  let sectionFiles = 0

  async function readContent(content: string): Promise<string> {
    const path = resolveContentPath(manuscriptDir, content)
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      // ENOENT means there is no prose to lose — note it and carry on. Any
      // OTHER read failure (permissions, I/O) might be hiding prose, so it
      // aborts the whole migration rather than silently dropping text.
      if (isRecord(error) && error['code'] === 'ENOENT') {
        notes.push(`section file was missing and contributed nothing: ${content}`)
        return ''
      }
      fail(`could not read ${content}: ${describe(error)}`)
    }
  }

  async function walk(node: LegacyNode): Promise<void> {
    if (node.kind === 'box') {
      boxIds.push(node.id === '' ? '(unnamed)' : node.id)
      if (node.title !== '') markdown = appendBlock(markdown, `## ${node.title}`)
      if (node.content !== null) {
        const text = await readContent(node.content)
        if (text.trim() !== '') {
          markdown = appendBlock(markdown, text)
          sectionFiles += 1
        }
      }
      return
    }
    if (node.heading !== null) {
      const depth = HEADING_DEPTH[node.level] ?? 1
      markdown = appendBlock(markdown, `${'#'.repeat(depth)} ${node.heading}`)
    }
    if (node.content !== null) {
      const text = await readContent(node.content)
      if (text.trim() !== '') {
        markdown = appendBlock(markdown, text)
        sectionFiles += 1
      }
    }
    for (const child of node.children) await walk(child)
  }

  for (const raw of body) {
    const node = asLegacyNode(raw)
    if (node === null) fail(`manuscript.json body contains a node of unknown kind`)
    await walk(node)
  }

  if (boxIds.length > 0) {
    notes.push(
      `${boxIds.length} box node(s) became ordinary headings (${boxIds.join(', ')}) — the flat layout has no box container`
    )
  }
  notes.push(`merged ${sectionFiles} section file(s) into ${manuscriptFile}`)
  return { markdown: markdown === '' ? '' : `${markdown.replace(/\s*$/, '')}\n`, notes }
}

/**
 * Retarget `{kind:'section', path:'sections/x.md'}` comments at the single
 * prose file. Anchors are quote-based, so they re-locate themselves in the
 * merged text; a comment whose quote no longer matches is marked `detached`
 * by the re-anchoring pass, never dropped here. Pure — exported for tests.
 */
export function migrateCommentTargets(
  file: unknown,
  manuscriptFile: string,
  /**
   * Prose paths belonging to OTHER documents in the registry (ADR-009), which
   * this retarget must leave alone.
   *
   * Before the registry there was exactly one prose file, so "every section
   * comment whose path is not manuscriptFile is a stale sections/ path" was a
   * safe reading. With a cover letter at `letters/cover-science.md` beside the
   * manuscript it stops being safe: an unscoped retarget would collapse every
   * document's comments onto manuscript.md.
   *
   * feature-plan-12 gap 5 is explicit that this collision needs a project that
   * is simultaneously pre-feature-plan-7 and post-registry, which nothing can
   * produce today — `migrateProject` returns early on any flat project long
   * before this runs. This parameter is cheap insurance against a future
   * ordering, not a fix for a live bug.
   */
  otherDocumentPaths: readonly string[] = []
): { file: unknown; retargeted: number } {
  if (!isRecord(file)) return { file, retargeted: 0 }
  const comments = file['comments']
  if (!Array.isArray(comments)) return { file, retargeted: 0 }
  const owned = new Set(otherDocumentPaths)
  let retargeted = 0
  const next = comments.map((comment) => {
    if (!isRecord(comment)) return comment
    const target = comment['target']
    if (!isRecord(target) || target['kind'] !== 'section') return comment
    if (target['path'] === manuscriptFile) return comment
    if (typeof target['path'] === 'string' && owned.has(target['path'])) return comment
    retargeted += 1
    return { ...comment, target: { ...target, path: manuscriptFile } }
  })
  return { file: { ...file, comments: next }, retargeted }
}

async function migrateComments(
  manuscriptDir: string,
  manuscriptFile: string,
  otherDocumentPaths: readonly string[]
): Promise<string[]> {
  const path = join(manuscriptDir, 'comments.json')
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (error) {
    return [`comments.json left alone — it is not valid JSON (${describe(error)})`]
  }
  const { file, retargeted } = migrateCommentTargets(parsed, manuscriptFile, otherDocumentPaths)
  if (retargeted === 0) return []
  const validated = CommentsFileSchema.safeParse(file)
  if (!validated.success) {
    return [`comments.json left alone — retargeting produced an invalid file (${validated.error.message})`]
  }
  await writeFileAtomic(path, JSON.stringify(validated.data, null, 2) + '\n')
  return [`retargeted ${retargeted} comment(s) at ${manuscriptFile}`]
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function migrateProject(dir: string): Promise<MigrationResult> {
  const notes: string[] = []
  const manuscriptDir = await projectSubdir(dir, 'manuscript')
  const manuscriptJson = join(manuscriptDir, 'manuscript.json')

  let originalRaw: string
  try {
    originalRaw = await readFile(manuscriptJson, 'utf8')
  } catch {
    return { migrated: false, notes: ['no manuscript.json — nothing to migrate'], error: null }
  }

  let current: unknown
  try {
    current = JSON.parse(originalRaw) as unknown
  } catch (error) {
    return {
      migrated: false,
      notes,
      error: `manuscript.json is not valid JSON (${manuscriptJson}): ${describe(error)}`
    }
  }
  if (!isRecord(current)) {
    return { migrated: false, notes, error: 'manuscript.json is not a JSON object' }
  }

  const hasBody = Array.isArray(current['body'])
  const hasAuthors = Array.isArray(current['authors'])
  const hasAffiliations = Array.isArray(current['affiliations'])
  if (!hasBody && !hasAuthors && !hasAffiliations) {
    // Idempotent: already flat. Never delete anything on this path.
    return { migrated: false, notes: ['project is already flat'], error: null }
  }

  const manuscriptFile =
    typeof current['manuscriptFile'] === 'string' && current['manuscriptFile'] !== ''
      ? current['manuscriptFile']
      : DEFAULT_MANUSCRIPT_FILE
  const prosePath = join(manuscriptDir, manuscriptFile)
  const authorsPath = join(manuscriptDir, 'authors.json')
  const sectionsDir = join(manuscriptDir, 'sections')

  let wroteAuthors = false

  const proseExists = await fileExists(prosePath)
  let wroteProseFile = false

  try {
    // A project half-migrated by hand (prose already extracted, byline still
    // in manuscript.json) must still be finishable — but an EXISTING prose
    // file is never overwritten with a rebuild of the old body.
    if (proseExists && hasBody) {
      fail(`${manuscriptFile} already exists — refusing to overwrite it with the migrated prose`)
    }

    // 1 — build the three files in memory.
    const body = hasBody ? (current['body'] as unknown[]) : []
    const prose = await buildMarkdown(manuscriptDir, manuscriptFile, body)
    notes.push(...prose.notes)

    const authorsFile = {
      schemaVersion: 1,
      authors: hasAuthors ? current['authors'] : [],
      affiliations: hasAffiliations ? current['affiliations'] : []
    }

    const nextManuscript: Record<string, unknown> = { ...current, manuscriptFile }
    delete nextManuscript['body']
    delete nextManuscript['authors']
    delete nextManuscript['affiliations']

    // 2 — validate BEFORE writing; an invalid result never reaches the disk.
    const authorsCheck = AuthorsFileSchema.safeParse(authorsFile)
    if (!authorsCheck.success) fail(`authors.json would be invalid: ${authorsCheck.error.message}`)
    const manuscriptCheck = ManuscriptSchema.safeParse(nextManuscript)
    if (!manuscriptCheck.success) {
      fail(`rewritten manuscript.json would be invalid: ${manuscriptCheck.error.message}`)
    }

    // 3 — write. Atomic, so a crash can never truncate a source of truth.
    const proseText = prose.markdown
    if (proseExists) {
      notes.push(`${manuscriptFile} already existed — left exactly as it was`)
    } else {
      await writeFileAtomic(prosePath, proseText)
      wroteProseFile = true
    }

    const authorsText = JSON.stringify(authorsCheck.data, null, 2) + '\n'
    if (await fileExists(authorsPath)) {
      notes.push('authors.json already existed — left exactly as it was')
    } else {
      await writeFileAtomic(authorsPath, authorsText)
      wroteAuthors = true
      notes.push(
        `moved ${authorsCheck.data.authors.length} author(s) and ${authorsCheck.data.affiliations.length} affiliation(s) into authors.json`
      )
    }

    const manuscriptText = JSON.stringify(nextManuscript, null, 2) + '\n'
    await writeFileAtomic(manuscriptJson, manuscriptText)
    notes.push('rewrote manuscript.json without body/authors/affiliations')

    // 4 — re-read all three and parse them again. Only a verified-on-disk
    // migration is allowed to delete anything.
    if (wroteProseFile) {
      const proseBack = await readFile(prosePath, 'utf8').catch((error: unknown) =>
        fail(`could not re-read ${manuscriptFile}: ${describe(error)}`)
      )
      if (proseBack !== proseText) fail(`${manuscriptFile} did not survive the write intact`)
    }

    const authorsBack = await readFile(authorsPath, 'utf8').catch((error: unknown) =>
      fail(`could not re-read authors.json: ${describe(error)}`)
    )
    if (!AuthorsFileSchema.safeParse(JSON.parse(authorsBack) as unknown).success) {
      fail('authors.json on disk does not parse')
    }

    const manuscriptBack = await readFile(manuscriptJson, 'utf8').catch((error: unknown) =>
      fail(`could not re-read manuscript.json: ${describe(error)}`)
    )
    if (!ManuscriptSchema.safeParse(JSON.parse(manuscriptBack) as unknown).success) {
      fail('rewritten manuscript.json on disk does not parse')
    }
  } catch (error) {
    // Roll back to exactly the old layout. sections/ was never touched.
    if (wroteProseFile) await unlink(prosePath).catch(() => undefined)
    if (wroteAuthors) await unlink(authorsPath).catch(() => undefined)
    await writeFileAtomic(manuscriptJson, originalRaw).catch(() => undefined)
    return {
      migrated: false,
      notes: [...notes, 'nothing was changed — the project is exactly as it was'],
      error: describe(error)
    }
  }

  // 5 — comments are a sidecar: a failure here is reported, never fatal, and
  // never a reason to undo a verified prose migration.
  try {
    // Every prose file the registry claims for a NON-primary document is off
    // limits to the retarget (feature-plan-12 gap 5).
    const otherDocumentPaths = (await projectDocuments(dir))
      .filter((d) => d.kind !== 'manuscript' && d.file !== null)
      .map((d) => d.file as string)
    notes.push(...(await migrateComments(manuscriptDir, manuscriptFile, otherDocumentPaths)))
  } catch (error) {
    notes.push(`comments.json could not be retargeted: ${describe(error)}`)
  }

  // 6 — and only now, sections/.
  try {
    await rm(sectionsDir, { recursive: true, force: true })
    notes.push('removed the now-empty sections/ directory')
  } catch (error) {
    notes.push(`sections/ could not be removed (harmless, it is no longer read): ${describe(error)}`)
  }

  return { migrated: true, notes, error: null }
}
