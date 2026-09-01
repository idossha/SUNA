import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ManuscriptSchema,
  baselineVersionFor,
  compareRefId,
  formatVersionId,
  manuscriptCompareFields,
  stageLabel,
  versionFilePath,
  workingVersion,
  type CompareDocument,
  type CompareRef,
  type CompareSide,
  type LoggedVersion,
  type Round
} from '@suna/core'
import { projectSubdir } from './paths'
import { listRounds, readRound, writeRound } from './round-new'
import { listVersions, versionDir } from './version-log'

/**
 * Reading the two sides of a comparison (DECISIONS 2026-08-21).
 *
 * All three side kinds resolve to the same three artefacts — the prose, the
 * manuscript.json fields a reviewer reads, and the bibliography — so the
 * renderer never learns where a side came from. A round resolves to its
 * baseline version here rather than in the UI, which is what makes "compare
 * against what Round 2 read" a single request.
 *
 * Nothing in this file writes, with one exception that is not a comparison at
 * all: `setRoundBaseline`, which records WHICH version a round's reviewers
 * read. Reading a version never modifies it; that is the whole point of the
 * archive being read-only.
 */

/** The working copy is offered first — it is the side you compare against. */
export async function listCompareSides(rootDir: string): Promise<CompareSide[]> {
  const [versions, rounds] = await Promise.all([
    listVersions(rootDir).catch(() => [] as LoggedVersion[]),
    listRounds(rootDir).catch(() => [] as Round[])
  ])

  const sides: CompareSide[] = [
    {
      ref: { kind: 'working' },
      id: 'working',
      label: 'Working copy',
      sublabel: `${formatVersionId(workingVersion(versions))} — not logged yet`,
      at: null,
      unavailable: false
    }
  ]

  // Newest version first: the one you want is nearly always the last one out.
  for (const version of [...versions].reverse()) {
    sides.push({
      ref: { kind: 'version', versionId: version.id },
      id: compareRefId({ kind: 'version', versionId: version.id }),
      label: version.id,
      sublabel:
        version.note.trim() === ''
          ? stageLabel(version.stage)
          : `${stageLabel(version.stage)} · ${version.note.trim()}`,
      at: version.createdAt,
      unavailable: false
    })
  }

  for (const round of rounds) {
    const baseline = baselineVersionFor(round, versions)
    sides.push({
      ref: { kind: 'round', roundId: round.id },
      id: compareRefId({ kind: 'round', roundId: round.id }),
      label: round.label,
      sublabel:
        baseline === null
          ? 'no version recorded for this round'
          : `reviewers read ${baseline.id}${round.baselineVersionId === null ? ' (inferred)' : ''}`,
      at: baseline?.createdAt ?? round.createdAt,
      unavailable: baseline === null
    })
  }
  return sides
}

/** Point a round at the version its reviewers read, or clear the pointer. */
export async function setRoundBaseline(
  rootDir: string,
  roundId: string,
  versionId: string | null
): Promise<Round> {
  const round = await readRound(rootDir, roundId)
  if (versionId !== null) {
    const versions = await listVersions(rootDir)
    if (!versions.some((v) => v.id === versionId)) {
      throw new Error(`no logged version ${versionId} in this project`)
    }
  }
  const next = { ...round, baselineVersionId: versionId }
  await writeRound(rootDir, next)
  return next
}

/**
 * Resolve a side to the version it names, and to the label the view shows.
 * A round with no baseline resolves to `null` with a reason rather than an
 * error: the comparison view has to be able to say "Round 2 has no version
 * recorded" and offer the picker that fixes it.
 */
async function resolveSide(
  rootDir: string,
  ref: CompareRef
): Promise<{ version: LoggedVersion | null; label: string; sublabel: string; at: string | null; problem: string | null }> {
  if (ref.kind === 'working') {
    const versions = await listVersions(rootDir).catch(() => [] as LoggedVersion[])
    return {
      version: null,
      label: 'Working copy',
      sublabel: `${formatVersionId(workingVersion(versions))} — not logged yet`,
      at: null,
      problem: null
    }
  }
  const versions = await listVersions(rootDir)
  if (ref.kind === 'version') {
    const version = versions.find((v) => v.id === ref.versionId) ?? null
    return {
      version,
      label: ref.versionId,
      sublabel: version === null ? '' : stageLabel(version.stage),
      at: version?.createdAt ?? null,
      problem: version === null ? `${ref.versionId} is not in this project's archive.` : null
    }
  }
  const round = await readRound(rootDir, ref.roundId)
  const version = baselineVersionFor(round, versions)
  return {
    version,
    label: round.label,
    sublabel: version === null ? '' : `reviewers read ${version.id}`,
    at: version?.createdAt ?? null,
    problem:
      version === null
        ? `${round.label} has no logged version recorded — choose which version its reviewers read.`
        : null
  }
}

export async function readCompareDocument(
  rootDir: string,
  ref: CompareRef
): Promise<CompareDocument> {
  const side = await resolveSide(rootDir, ref)
  const empty: CompareDocument = {
    ref,
    label: side.label,
    sublabel: side.sublabel,
    at: side.at,
    markdown: '',
    fields: [],
    bibliography: '',
    problem: side.problem
  }
  if (side.problem !== null) return empty

  // The working copy reads out of manuscript/; a version reads out of its own
  // folder, through `versionFilePath` so a schemaVersion 1 archive (which had
  // no area subdirectories) still resolves.
  const read =
    side.version === null
      ? await workingReader(rootDir)
      : await versionReader(rootDir, side.version)

  const metaRaw = await read('manuscript.json')
  if (metaRaw === null) {
    return { ...empty, problem: `${side.label} has no manuscript.json.` }
  }
  const parsed = ManuscriptSchema.safeParse(JSON.parse(metaRaw))
  if (!parsed.success) {
    return { ...empty, problem: `${side.label}'s manuscript.json does not match the schema.` }
  }
  const manuscript = parsed.data
  const markdown = (await read(manuscript.manuscriptFile)) ?? ''
  const bibliography = (await read(manuscript.bibliography)) ?? ''

  return {
    ref,
    label: side.label,
    sublabel: side.sublabel,
    at: side.at,
    markdown,
    fields: manuscriptCompareFields(manuscript),
    bibliography,
    problem: null
  }
}

type Reader = (rel: string) => Promise<string | null>

async function workingReader(rootDir: string): Promise<Reader> {
  const dir = await projectSubdir(rootDir, 'manuscript')
  return async (rel) => readFile(join(dir, ...rel.split('/')), 'utf8').catch(() => null)
}

async function versionReader(rootDir: string, version: LoggedVersion): Promise<Reader> {
  const dir = await versionDir(rootDir, version.id)
  return async (rel) => {
    const inside = versionFilePath(version, 'manuscript', rel)
    return readFile(join(dir, ...inside.split('/')), 'utf8').catch(() => null)
  }
}
