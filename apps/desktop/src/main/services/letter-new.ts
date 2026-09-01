import { access, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  AuthorsFileSchema,
  CoverLetterMetaSchema,
  DocumentEntrySchema,
  LETTER_PRIVATE_GITIGNORE_LINE,
  LetterPrivateSchema,
  LetterSeedSourceSchema,
  SunaProjectManifestSchema,
  abstractSeedComment,
  buildLetterSkeleton,
  emptyCoverLetterMeta,
  filesForKind,
  resolveDocuments,
  type Author,
  type CoverLetterMeta,
  type DocumentEntry,
  type LetterAssertionId,
  type LetterKind
} from '@suna/core'
import { ensureGitignoreLine } from '@suna/agent'
import { getBundledProfile } from '@suna/formatter'
import { writeFileAtomic } from './atomic'
import { projectDocuments, projectSubdir } from './paths'

/**
 * Create a cover letter (DECISIONS 2026-08-19, document-kinds-ux.md §A).
 *
 * The order of operations is the whole point and is not negotiable:
 *
 *   1. resolve everything and BUILD the files in memory
 *   2. write the .gitignore line for the confidential sidecar
 *   3. only then write any file
 *
 * Step 2 before step 3 because `<id>.private.json` carries suggested and
 * excluded reviewers — other people's names, emails and, on an exclusion, a
 * reason that is often a personal conflict. If the write lands first and the
 * ignore line second, there is a window in which `git add -A` commits it. The
 * window is small and the consequence is permanent, so the ignore line goes
 * first or nothing is written at all.
 */

export interface NewLetterInput {
  rootDir: string
  /** Slug; becomes letters/<id>.md. */
  id: string
  letterKind: LetterKind
  /** The venue this letter addresses. Never inherited silently. */
  targetProfileId: string
  title?: string
  salutation?: string | null
}

export interface NewLetterResult {
  documentId: string
  /** Manuscript-relative, i.e. 'letters/cover-science.md'. */
  proseFile: string
  metaFile: string
  /** The seeded abstract comment, for the caller to add through the comment path. */
  seedComment: string | null
  /** Assertions the venue requires, all unanswered. */
  requiredAssertions: LetterAssertionId[]
  gitignoreTouched: boolean
}

const SLUG_RE = /^[a-z][a-z0-9-]*$/

export async function createLetter(input: NewLetterInput): Promise<NewLetterResult> {
  const { rootDir, id, letterKind, targetProfileId } = input
  if (!SLUG_RE.test(id)) {
    throw new Error(`letter id "${id}" must be a lowercase slug`)
  }

  const profile = getBundledProfile(targetProfileId)
  if (profile === null) throw new Error(`unknown publisher profile "${targetProfileId}"`)

  const manuscriptDir = await projectSubdir(rootDir, 'manuscript')
  const manifestPath = join(rootDir, 'suna.json')

  // ---- read what we seed from --------------------------------------------
  const manifest = SunaProjectManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, 'utf8'))
  )
  const documents = resolveDocuments(manifest)
  if (documents.some((d) => d.id === id)) {
    throw new Error(`this project already has a document called "${id}"`)
  }

  // Deliberately NARROW. A letter needs the title, the article type and
  // (for the seed comment) the abstract or significance statement; demanding
  // a fully valid manuscript.json would make "create a cover letter" fail
  // because some unrelated block is mid-edit. The manuscript checker is what
  // validates the manuscript — not this.
  const manuscript = LetterSeedSourceSchema.parse(
    JSON.parse(await readFile(join(manuscriptDir, 'manuscript.json'), 'utf8'))
  )
  let authors: Author[] = []
  try {
    authors = AuthorsFileSchema.parse(
      JSON.parse(await readFile(join(manuscriptDir, 'authors.json'), 'utf8'))
    ).authors
  } catch {
    // A project with no authors.json still gets a letter; the
    // corresponding-contact check is what reports the gap, not this.
  }

  const requiredAssertions = (profile.letters?.assertions ?? [])
    .filter((a) => a.stance === 'required')
    .map((a) => a.id)

  // ---- build in memory ----------------------------------------------------
  const files = filesForKind('cover-letter', id)
  const proseRel = join('letters', files.prose ?? `${id}.md`)
  const metaRel = join('letters', files.meta ?? `${id}.json`)
  const privateRel = join('letters', files.extra[0] ?? `${id}.private.json`)

  const prose = buildLetterSkeleton({
    letterKind,
    journalName: profile.journalName,
    manuscript,
    authors,
    requiredAssertions,
    salutation: input.salutation ?? null
  })

  const meta: CoverLetterMeta = emptyCoverLetterMeta({
    letterKind,
    targetProfileId,
    requiredAssertions,
    covers: [
      {
        documentId: documents.find((d) => d.kind === 'manuscript')?.id ?? 'manuscript',
        siblingProjectPath: null,
        title: manuscript.title,
        articleType: manuscript.articleType,
        authorsLine: null
      }
    ]
  })

  const entry: DocumentEntry = DocumentEntrySchema.parse({
    id,
    kind: 'cover-letter',
    file: proseRel,
    meta: metaRel,
    title: input.title ?? `Cover letter — ${profile.journalName}`,
    profile: { registry: 'journal', id: targetProfileId }
  })

  // ---- the ignore line, BEFORE any write ---------------------------------
  const gitignoreTouched = await ensureGitignoreLine(rootDir, LETTER_PRIVATE_GITIGNORE_LINE)

  // ---- write --------------------------------------------------------------
  const proseAbs = join(manuscriptDir, proseRel)
  await mkdir(dirname(proseAbs), { recursive: true })
  await writeFileAtomic(proseAbs, prose)
  await writeFileAtomic(
    join(manuscriptDir, metaRel),
    `${JSON.stringify(CoverLetterMetaSchema.parse(meta), null, 2)}\n`
  )
  await writeFileAtomic(
    join(manuscriptDir, privateRel),
    `${JSON.stringify(
      LetterPrivateSchema.parse({
        schemaVersion: 1,
        suggestedReviewers: [],
        excludedReviewers: [],
        colleaguesShown: []
      }),
      null,
      2
    )}\n`
  )

  // ---- register it --------------------------------------------------------
  // The registry is written LAST. A half-created letter that is not in
  // suna.json is invisible and harmless; a registry entry pointing at files
  // that do not exist is a project that fails to open.
  const nextDocuments = manifest.documents === undefined ? [...documents, entry] : [...manifest.documents, entry]
  await writeFileAtomic(
    manifestPath,
    `${JSON.stringify(
      SunaProjectManifestSchema.parse({ ...manifest, documents: nextDocuments }),
      null,
      2
    )}\n`
  )

  return {
    documentId: id,
    proseFile: proseRel,
    metaFile: metaRel,
    seedComment: abstractSeedComment(manuscript, profile.journalName),
    requiredAssertions,
    gitignoreTouched
  }
}

/** Read a letter's sidecar. */
export async function readLetterMeta(
  rootDir: string,
  metaRel: string
): Promise<CoverLetterMeta> {
  const manuscriptDir = await projectSubdir(rootDir, 'manuscript')
  return CoverLetterMetaSchema.parse(
    JSON.parse(await readFile(join(manuscriptDir, metaRel), 'utf8'))
  )
}

/** Read-modify-write a letter's sidecar atomically. */
export async function writeLetterMeta(
  rootDir: string,
  metaRel: string,
  meta: CoverLetterMeta
): Promise<void> {
  const manuscriptDir = await projectSubdir(rootDir, 'manuscript')
  await writeFileAtomic(
    join(manuscriptDir, metaRel),
    `${JSON.stringify(CoverLetterMetaSchema.parse(meta), null, 2)}\n`
  )
}



/**
 * Registry ids whose prose file has gone from disk.
 *
 * `suna.json` is a plain file people edit and move things around in, and a
 * letter deleted in Finder leaves its entry behind. Reporting that is better
 * than opening an empty editor and better than silently pruning something the
 * user might be about to restore from git.
 */
export async function missingDocuments(rootDir: string): Promise<string[]> {
  const manuscriptDir = await projectSubdir(rootDir, 'manuscript')
  const docs = await projectDocuments(rootDir)
  const out: string[] = []
  for (const doc of docs) {
    const rel = doc.kind === 'manuscript' ? null : doc.file
    if (rel === null) continue
    try {
      await access(join(manuscriptDir, rel))
    } catch {
      out.push(doc.id)
    }
  }
  return out
}

/**
 * Remove one entry from the registry. Deletes NO file — a registry entry and
 * the bytes it points at are different things, and only one of them is this
 * function's business.
 */
export async function removeDocument(rootDir: string, documentId: string): Promise<DocumentEntry[]> {
  const manifestPath = join(rootDir, 'suna.json')
  const manifest = SunaProjectManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, 'utf8'))
  )
  const current = resolveDocuments(manifest)
  const target = current.find((d) => d.id === documentId)
  if (target === undefined) return current
  if (target.kind === 'manuscript') {
    throw new Error('the manuscript cannot be removed from the registry')
  }
  const next = current.filter((d) => d.id !== documentId)
  await writeFileAtomic(
    manifestPath,
    `${JSON.stringify(SunaProjectManifestSchema.parse({ ...manifest, documents: next }), null, 2)}\n`
  )
  return next
}
