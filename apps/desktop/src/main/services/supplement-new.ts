import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DOCUMENT_KIND_FILES,
  DocumentEntrySchema,
  SunaProjectManifestSchema,
  resolveDocuments,
  type DocumentEntry
} from '@suna/core'
import { writeFileAtomic } from './atomic'
import { projectSubdir } from './paths'

/**
 * Create the project's Supplementary Information (document-kinds-ux.md §A).
 *
 * There is exactly ONE per project and its path is fixed
 * (`manuscript/supplementary.md`, DOCUMENT_KIND_FILES.supplement), because
 * that is the path the whole supplement pipeline already reads: the export
 * builders, the PDF/DOCX/HTML targets and the export dialog's document picker
 * all resolve it by convention rather than through the registry. So this has
 * nothing to ask the author and no sheet to show — it seeds the file and
 * registers it.
 *
 * Idempotent on the bytes: an existing supplementary.md is NEVER overwritten.
 * A project can easily have the file (written by hand, or by an older SUNA)
 * without a registry entry, and the useful thing to do there is adopt it.
 */

export const SUPPLEMENT_DOCUMENT_ID = 'supplement'
export const SUPPLEMENT_TITLE = 'Supplementary Information'

/**
 * The starter supplement. Two headings, because the outline in the sidebar is
 * the point of this being a document rather than a file — an empty file gives
 * the author nothing to see there.
 */
const SKELETON = `# Supplementary Methods

Everything the main text had no room for: the full protocol, the parameters,
the checks that did not change the conclusion.

# Supplementary Figures

Embed a figure with \`![[fig:id]]\` — supplement figures are numbered S1, S2, …
independently of the main text, at format time.
`

export interface NewSupplementResult {
  documentId: string
  /** Manuscript-dir-relative prose path — always 'supplementary.md'. */
  proseFile: string
  /** False when the file was already on disk and was adopted as it stands. */
  fileCreated: boolean
}

export async function createSupplement(rootDir: string): Promise<NewSupplementResult> {
  const proseFile = DOCUMENT_KIND_FILES.supplement.prose ?? 'supplementary.md'
  const manuscriptDir = await projectSubdir(rootDir, 'manuscript')
  const manifestPath = join(rootDir, 'suna.json')

  const manifest = SunaProjectManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, 'utf8'))
  )
  const documents = resolveDocuments(manifest)
  const existing = documents.find((d) => d.kind === 'supplement')
  if (existing !== undefined) {
    throw new Error('this project already has a Supplementary Information document')
  }
  if (documents.some((d) => d.id === SUPPLEMENT_DOCUMENT_ID)) {
    throw new Error(`this project already has a document called "${SUPPLEMENT_DOCUMENT_ID}"`)
  }

  const proseAbs = join(manuscriptDir, proseFile)
  let fileCreated = false
  try {
    await readFile(proseAbs, 'utf8')
  } catch {
    await writeFileAtomic(proseAbs, SKELETON)
    fileCreated = true
  }

  const entry: DocumentEntry = DocumentEntrySchema.parse({
    id: SUPPLEMENT_DOCUMENT_ID,
    kind: 'supplement',
    file: proseFile,
    meta: null,
    title: SUPPLEMENT_TITLE
  })

  // The registry is written LAST, the same order createLetter uses: an
  // unregistered file is invisible and harmless, an entry pointing at a file
  // that does not exist is a project that fails to open.
  const nextDocuments =
    manifest.documents === undefined ? [...documents, entry] : [...manifest.documents, entry]
  await writeFileAtomic(
    manifestPath,
    `${JSON.stringify(
      SunaProjectManifestSchema.parse({ ...manifest, documents: nextDocuments }),
      null,
      2
    )}\n`
  )

  return { documentId: SUPPLEMENT_DOCUMENT_ID, proseFile, fileCreated }
}
