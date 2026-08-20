import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PEER_REVIEW_FILE,
  PeerReviewApprovalSchema,
  SunaProjectManifestSchema,
  type PeerReviewApproval,
  type PeerReviewSource,
  type SunaProjectManifest
} from '@suna/core'
import { writeFileAtomic } from './atomic'
import { assertInsideAllowedRoot } from './roots'

/**
 * The AI-reply approval gate (peer review).
 *
 * SUNA will not draft a reply to a referee until a person has read
 * `context/PEER-REVIEW.md` — the instructions the AI follows — and recorded
 * that they accept them. This module owns the record.
 *
 * The hash is computed HERE, from the file on disk, and never accepted from
 * the caller. An approval is a claim that a specific document was read; a
 * renderer-supplied hash could attest to text that was only ever in a
 * textarea. Reading the file also means the gate fails honestly when there
 * is nothing to approve, instead of recording consent to an empty file.
 */

function guidelinesPath(root: string): string {
  return join(root, 'context', PEER_REVIEW_FILE)
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Current hash of the project's guidelines, or null when there is no file. */
export async function peerReviewHash(dir: string): Promise<string | null> {
  const root = assertInsideAllowedRoot(dir)
  try {
    const text = await readFile(guidelinesPath(root), 'utf8')
    return text.trim() === '' ? null : sha256(text)
  } catch {
    return null
  }
}

export interface ApproveInput {
  dir: string
  approvedBy: string
  source: PeerReviewSource
  learnedFrom: string | null
}

/**
 * Record the approval in suna.json.
 *
 * Read-merge-validate-write on a freshly read manifest, the same discipline
 * updateProjectSettings uses: the file may have been edited by a person or
 * an agent since the app read it, and every manifest key this schema version
 * does not know must survive verbatim.
 */
export async function approvePeerReviewAi(
  input: ApproveInput
): Promise<{ manifest: SunaProjectManifest; approval: PeerReviewApproval }> {
  const root = assertInsideAllowedRoot(input.dir)

  let text: string
  try {
    text = await readFile(guidelinesPath(root), 'utf8')
  } catch {
    throw new Error(
      `there are no guidelines to approve — context/${PEER_REVIEW_FILE} does not exist`
    )
  }
  if (text.trim() === '') {
    throw new Error(`context/${PEER_REVIEW_FILE} is empty; there is nothing to approve`)
  }

  const file = join(root, 'suna.json')
  const raw = await readFile(file, 'utf8').catch(() => {
    throw new Error(`not a SUNA project (no suna.json): ${input.dir}`)
  })
  let current: unknown
  try {
    current = JSON.parse(raw) as unknown
  } catch (error) {
    throw new Error(
      `suna.json is not valid JSON (${file}): ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (typeof current !== 'object' || current === null || Array.isArray(current)) {
    throw new Error(`suna.json is not an object (${file})`)
  }

  const approval = PeerReviewApprovalSchema.parse({
    approvedAt: new Date().toISOString(),
    approvedBy: input.approvedBy,
    source: input.source,
    contentHash: sha256(text),
    learnedFrom: input.learnedFrom
  })

  const base = current as Record<string, unknown>
  const existingApprovals =
    typeof base['approvals'] === 'object' &&
    base['approvals'] !== null &&
    !Array.isArray(base['approvals'])
      ? (base['approvals'] as Record<string, unknown>)
      : {}
  const next = {
    ...base,
    approvals: { ...existingApprovals, peerReviewAi: approval }
  }

  // Validate before writing: a bad record must never reach the file.
  const manifest = SunaProjectManifestSchema.parse(next)
  await writeFileAtomic(file, JSON.stringify(next, null, 2) + '\n')
  return { manifest, approval }
}
