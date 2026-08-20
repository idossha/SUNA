import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  CoverLetterMetaSchema,
  DOCUMENT_KIND_FILES,
  PointStatusSchema,
  ReviewerReportSchema,
  RoundSchema,
  RoundsIndexSchema,
  isAddressed,
  pointStateFor,
  roundProgress,
  type DocumentEntry,
  type ReviewerReport,
  type Round
} from '@suna/core'
import { checkLetter, checkResponse, getBundledProfile } from '@suna/formatter'
import { resolveInside, type ProjectContext } from './project'

/**
 * Document-registry, letter and round verbs (feature-plan-12 §10).
 *
 * One deliberate omission, and it is a design decision rather than an
 * oversight: **there is no verb that writes a letter assertion.** A cover
 * letter's assertions are the author's factual claims — that the work is not
 * under consideration elsewhere, that there are no competing interests, that
 * a named colleague has read the draft — made to an editor over the author's
 * signature. An agent may draft the argument and may read what the venue
 * requires; it may not sign the affidavit. `read_letter` exists so an agent
 * can see what is still unanswered and say so. Filling it in is a person's
 * job, through the Assertions panel.
 */

export const listDocumentsInput = z.object({})
export const readDocumentInput = z.object({ documentId: z.string().min(1) })
export const writeDocumentInput = z.object({
  documentId: z.string().min(1),
  content: z.string()
})
export const readLetterInput = z.object({ documentId: z.string().min(1) })
export const checkLetterInput = z.object({ documentId: z.string().min(1) })
export const listRoundsInput = z.object({})
export const readRoundInput = z.object({ roundId: z.string().min(1) })
export const listReviewPointsInput = z.object({
  roundId: z.string().min(1),
  /** Only points in this state. */
  status: PointStatusSchema.optional(),
  /** Only points assigned to this person. */
  assignee: z.string().min(1).optional()
})
export const setPointStatusInput = z.object({
  roundId: z.string().min(1),
  pointId: z.string().min(1),
  status: PointStatusSchema,
  assignee: z.string().min(1).nullable().optional()
})
export const checkResponseInput = z.object({
  roundId: z.string().min(1),
  forExport: z.boolean().optional()
})

/* ------------------------------------------------------------------ */
/* Documents                                                            */
/* ------------------------------------------------------------------ */

function documentOr404(ctx: ProjectContext, id: string): DocumentEntry {
  const doc = ctx.documents.find((d) => d.id === id)
  if (doc === undefined) {
    const known = ctx.documents.map((d) => d.id).join(', ')
    throw new Error(`no document "${id}" in this project (documents: ${known})`)
  }
  return doc
}

/** The prose path of a document, manuscript-relative. */
async function proseRel(ctx: ProjectContext, doc: DocumentEntry): Promise<string> {
  if (doc.kind !== 'manuscript') {
    if (doc.file === null) throw new Error(`document "${doc.id}" has no prose file`)
    return doc.file
  }
  // The manuscript's prose filename lives in manuscript.json, so the registry
  // cannot drift from it.
  try {
    const raw = await readFile(
      resolveInside(ctx.root, ctx.dirs.manuscript, 'manuscript.json'),
      'utf8'
    )
    const parsed = JSON.parse(raw) as { manuscriptFile?: unknown }
    if (typeof parsed.manuscriptFile === 'string' && parsed.manuscriptFile !== '') {
      return parsed.manuscriptFile
    }
  } catch {
    // fall through to the schema default
  }
  return 'manuscript.md'
}

export async function listDocuments(ctx: ProjectContext): Promise<string> {
  const lines = await Promise.all(
    ctx.documents.map(async (d) => {
      const files = DOCUMENT_KIND_FILES[d.kind]
      const prose = files.prose === null && d.kind !== 'manuscript' ? '(no prose)' : await proseRel(ctx, d).catch(() => '(no prose)')
      const profile =
        d.profile === null
          ? `inherits ${ctx.activeProfileId ?? 'no profile'}`
          : `${d.profile.registry}:${d.profile.id}`
      const round = d.roundId === null ? '' : ` round=${d.roundId}`
      return `${d.id}  [${d.kind}]  ${d.title}  — ${prose}  (${profile})${round}${d.archived ? ' ARCHIVED' : ''}`
    })
  )
  return lines.join('\n')
}

export async function readDocument(ctx: ProjectContext, documentId: string): Promise<string> {
  const doc = documentOr404(ctx, documentId)
  const rel = await proseRel(ctx, doc)
  const path = resolveInside(ctx.root, ctx.dirs.manuscript, rel)
  try {
    return await readFile(path, 'utf8')
  } catch {
    throw new Error(`document "${documentId}" has no prose file at ${rel}`)
  }
}

export async function writeDocument(
  ctx: ProjectContext,
  documentId: string,
  content: string
): Promise<string> {
  const doc = documentOr404(ctx, documentId)
  const rel = await proseRel(ctx, doc)
  const path = resolveInside(ctx.root, ctx.dirs.manuscript, rel)
  const { writeFile } = await import('node:fs/promises')
  await writeFile(path, content, 'utf8')
  return `wrote ${content.length} characters to ${rel}`
}

/* ------------------------------------------------------------------ */
/* Letters                                                              */
/* ------------------------------------------------------------------ */

async function letterMeta(ctx: ProjectContext, doc: DocumentEntry): Promise<unknown> {
  if (doc.kind !== 'cover-letter' || doc.meta === null) {
    throw new Error(`document "${doc.id}" is not a cover letter`)
  }
  const raw = await readFile(resolveInside(ctx.root, ctx.dirs.manuscript, doc.meta), 'utf8')
  return JSON.parse(raw)
}

export async function readLetter(ctx: ProjectContext, documentId: string): Promise<string> {
  const doc = documentOr404(ctx, documentId)
  const meta = CoverLetterMetaSchema.parse(await letterMeta(ctx, doc))
  const profile = getBundledProfile(meta.targetProfileId)
  const lines: string[] = [
    `letter: ${doc.title}`,
    `kind: ${meta.letterKind}`,
    `addressed to: ${profile?.journalName ?? meta.targetProfileId}`,
    `covers: ${meta.covers.map((c) => c.title ?? c.documentId ?? '(unnamed)').join('; ')}`,
    ''
  ]
  if (meta.assertions.length === 0) {
    lines.push('assertions: none recorded')
  } else {
    lines.push('assertions (SUNA never writes these — only the author does):')
    for (const a of meta.assertions) {
      const answered =
        a.placement === 'not-applicable'
          ? a.reason !== null
          : a.placement !== 'directive' || a.text !== null
      lines.push(`  ${answered ? '✓' : '✗ UNANSWERED'}  ${a.id}  [${a.placement}]`)
    }
  }
  if (meta.dataLocations.length > 0) {
    lines.push('', 'data locations:')
    for (const d of meta.dataLocations) {
      lines.push(`  ${d.repository}${d.accession === null ? '' : ` (${d.accession})`} — ${d.availableAt}`)
    }
  }
  if (meta.priorSubmissions.length > 0) {
    lines.push('', 'prior submissions:')
    for (const p of meta.priorSubmissions) lines.push(`  ${p.journal} — ${p.outcome}`)
  }
  return lines.join('\n')
}

export async function checkLetterCompliance(
  ctx: ProjectContext,
  documentId: string
): Promise<string> {
  const doc = documentOr404(ctx, documentId)
  const meta = CoverLetterMetaSchema.parse(await letterMeta(ctx, doc))
  const profile = getBundledProfile(meta.targetProfileId)
  if (profile === null) throw new Error(`unknown publisher profile "${meta.targetProfileId}"`)
  const letterText = await readDocument(ctx, documentId)

  let authors: { corresponding?: boolean; email?: string | null }[] = []
  try {
    const raw = await readFile(resolveInside(ctx.root, ctx.dirs.manuscript, 'authors.json'), 'utf8')
    const parsed = JSON.parse(raw) as { authors?: unknown }
    if (Array.isArray(parsed.authors)) authors = parsed.authors as typeof authors
  } catch {
    // no authors.json — the corresponding-contact check reports that
  }

  const diagnostics = checkLetter({
    meta,
    letterText,
    profile,
    authors: authors as never,
    knownJournalNames: knownJournalNames()
  })
  if (diagnostics.length === 0) return `letter: compliant with ${profile.journalName}`
  return diagnostics.map((d) => `${d.severity} ${d.id}: ${d.message}`).join('\n')
}

function knownJournalNames(): string[] {
  const out: string[] = []
  for (const id of [
    'nature',
    'science',
    'pnas',
    'neuron',
    'jneurosci',
    'jne',
    'sleep',
    'sleep-advances',
    'brain-stimulation',
    'nature-astronomy',
    'apj-aas',
    'mnras'
  ]) {
    const p = getBundledProfile(id)
    if (p !== null) out.push(p.journalName)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Rounds                                                               */
/* ------------------------------------------------------------------ */

function roundsRoot(ctx: ProjectContext): string {
  // rounds/ is fixed at the project root and is not a ProjectDirKey (ADR-009).
  return resolveInside(ctx.root, 'rounds')
}

async function loadRound(ctx: ProjectContext, roundId: string): Promise<Round> {
  const raw = await readFile(join(roundsRoot(ctx), roundId, 'round.json'), 'utf8')
  return RoundSchema.parse(JSON.parse(raw))
}

async function loadReports(ctx: ProjectContext, roundId: string): Promise<ReviewerReport[]> {
  const dir = join(roundsRoot(ctx), roundId, 'reviewers')
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const out: ReviewerReport[] = []
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    try {
      out.push(ReviewerReportSchema.parse(JSON.parse(await readFile(join(dir, name), 'utf8'))))
    } catch {
      // skip a malformed reviewer file rather than failing the whole round
    }
  }
  return out.sort((a, b) => a.index - b.index)
}

export async function listRounds(ctx: ProjectContext): Promise<string> {
  let ids: string[] = []
  try {
    const raw = await readFile(join(roundsRoot(ctx), 'index.json'), 'utf8')
    ids = RoundsIndexSchema.parse(JSON.parse(raw)).rounds
  } catch {
    return 'no rounds in this project'
  }
  const lines: string[] = []
  for (const id of ids) {
    try {
      const round = await loadRound(ctx, id)
      const reports = await loadReports(ctx, id)
      const p = roundProgress(round, reports)
      const decision = round.decision === null ? '' : ` decision=${round.decision}`
      lines.push(
        `${round.id}  [${round.kind}]  ${round.label}  state=${round.state}${decision}  points ${p.addressed}/${p.total}`
      )
    } catch {
      lines.push(`${id}  (unreadable)`)
    }
  }
  return lines.length === 0 ? 'no rounds in this project' : lines.join('\n')
}

export async function readRound(ctx: ProjectContext, roundId: string): Promise<string> {
  const round = await loadRound(ctx, roundId)
  const reports = await loadReports(ctx, roundId)
  const p = roundProgress(round, reports)
  const lines: string[] = [
    `${round.label}  [${round.kind}]`,
    `state: ${round.state}${round.decision === null ? '' : `, decision ${round.decision}`}`,
    round.venue === null ? '' : `venue: ${round.venue}`,
    `points: ${p.addressed} of ${p.total} addressed`
  ].filter((l) => l !== '')
  if (round.freeze !== null) {
    lines.push(
      `freeze: ${round.freeze.tag ?? '(no tag)'} at ${round.freeze.at}${round.freeze.dirty ? ' — TREE WAS DIRTY' : ''}`
    )
  }
  for (const r of p.byReviewer) {
    lines.push(`  Reviewer ${r.index}: ${r.addressed}/${r.total}`)
  }
  return lines.join('\n')
}

export async function listReviewPoints(
  ctx: ProjectContext,
  input: z.infer<typeof listReviewPointsInput>
): Promise<string> {
  const round = await loadRound(ctx, input.roundId)
  const reports = await loadReports(ctx, input.roundId)
  const lines: string[] = []
  for (const report of reports) {
    for (const point of report.points) {
      const state = pointStateFor(round, point.id)
      if (input.status !== undefined && state.status !== input.status) continue
      if (input.assignee !== undefined && state.assignee !== input.assignee) continue
      const head = point.verbatim.replace(/\s+/g, ' ').trim()
      lines.push(
        `${point.id}  [${state.status}]${state.assignee === null ? '' : ` @${state.assignee}`}` +
          `${point.section === null ? '' : `  (${point.section})`}\n    ${head}`
      )
    }
  }
  return lines.length === 0 ? 'no matching review points' : lines.join('\n\n')
}

/**
 * Set an author's state on one point. This writes the author's OWN
 * bookkeeping — status, assignee — and never the reviewer's text, which has
 * no write path anywhere in this server.
 */
export async function setPointStatus(
  ctx: ProjectContext,
  input: z.infer<typeof setPointStatusInput>
): Promise<string> {
  const round = await loadRound(ctx, input.roundId)
  const reports = await loadReports(ctx, input.roundId)
  const known = reports.some((r) => r.points.some((p) => p.id === input.pointId))
  if (!known) throw new Error(`no point "${input.pointId}" in round "${input.roundId}"`)

  const existing = pointStateFor(round, input.pointId)
  const next = {
    ...existing,
    status: input.status,
    assignee: input.assignee === undefined ? existing.assignee : input.assignee
  }
  const states = [
    ...round.pointStates.filter((s) => s.pointId !== input.pointId),
    next
  ].sort((a, b) => a.pointId.localeCompare(b.pointId))

  const updated = RoundSchema.parse({ ...round, pointStates: states })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(
    join(roundsRoot(ctx), input.roundId, 'round.json'),
    `${JSON.stringify(updated, null, 2)}\n`,
    'utf8'
  )
  const p = roundProgress(updated, reports)
  return `${input.pointId} is now ${input.status}${
    next.assignee === null ? '' : ` (assigned to ${next.assignee})`
  } — ${p.addressed} of ${p.total} points addressed`
}

export async function checkResponseCompleteness(
  ctx: ProjectContext,
  input: z.infer<typeof checkResponseInput>
): Promise<string> {
  const round = await loadRound(ctx, input.roundId)
  const reports = await loadReports(ctx, input.roundId)
  let responseText = ''
  if (round.responseDocumentId !== null) {
    responseText = await readDocument(ctx, round.responseDocumentId).catch(() => '')
  }
  const diagnostics = checkResponse({
    round,
    reports,
    responseText,
    forExport: input.forExport ?? false
  })
  if (diagnostics.length === 0) {
    const p = roundProgress(round, reports)
    return `response: every one of the ${p.total} reviewer points is addressed`
  }
  return diagnostics.map((d) => `${d.severity} ${d.id}: ${d.message}`).join('\n')
}

/** Re-exported so the verb table can describe what counts as addressed. */
export { isAddressed }
