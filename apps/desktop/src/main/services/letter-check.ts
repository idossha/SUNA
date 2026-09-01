import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AuthorsFileSchema, type Author } from '@suna/core'
import { BUNDLED_PROFILE_IDS, checkLetter, getBundledProfile, type Diagnostic } from '@suna/formatter'
import { readLetterMeta } from './letter-new'
import { documentFile, projectDocument, projectSubdir } from './paths'

/**
 * Run the letter checker for one document in a project (ARCHITECTURE §12.1).
 *
 * Lives here rather than in the IPC handler because it has to gather four
 * things off disk — the sidecar, the prose, authors.json, and the venue's
 * profile — and the renderer should not be doing any of that.
 */
export async function checkLetterDocument(
  rootDir: string,
  documentId: string
): Promise<Diagnostic[]> {
  const doc = await projectDocument(rootDir, documentId)
  if (doc === null) throw new Error(`no document "${documentId}" in this project`)
  if (doc.kind !== 'cover-letter' || doc.meta === null) {
    throw new Error(`document "${documentId}" is not a cover letter`)
  }

  const meta = await readLetterMeta(rootDir, doc.meta)
  const profile = getBundledProfile(meta.targetProfileId)
  if (profile === null) {
    throw new Error(`unknown publisher profile "${meta.targetProfileId}"`)
  }

  const prosePath = await documentFile(rootDir, doc, 'prose')
  const letterText = prosePath === null ? '' : await readFile(prosePath, 'utf8').catch(() => '')

  let authors: Author[] = []
  try {
    const manuscriptDir = await projectSubdir(rootDir, 'manuscript')
    authors = AuthorsFileSchema.parse(
      JSON.parse(await readFile(join(manuscriptDir, 'authors.json'), 'utf8'))
    ).authors
  } catch {
    // No authors.json is itself what letter.corresponding-contact-missing
    // reports, so an empty list is the right input, not an error.
  }

  return checkLetter({
    // Only the meta's STRUCTURED fields are read (prior submissions, data
    // locations); the assertion sidecar is retired and never consulted.
    meta,
    letterText,
    profile,
    authors,
    knownJournalNames: knownJournalNames()
  })
}

/**
 * Every bundled profile's display name, for `letter.journal-name-mismatch`.
 * The checker is given them rather than importing the registry itself, so it
 * stays pure and the caller decides which venues are in play.
 */
export function knownJournalNames(): string[] {
  const out: string[] = []
  for (const id of BUNDLED_PROFILE_IDS) {
    const p = getBundledProfile(id)
    if (p !== null) out.push(p.journalName)
  }
  return out
}
