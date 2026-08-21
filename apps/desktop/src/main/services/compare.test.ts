import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listCompareSides, readCompareDocument, setRoundBaseline } from './compare'
import { createRound } from './round-new'
import { logVersion } from './version-log'

/**
 * The two sides of a comparison, read off a real project directory. The
 * contract: a round resolves to the version its reviewers read, a version
 * reads out of the archive rather than out of the working copy, and a side
 * that cannot be resolved says why instead of throwing.
 */

let dir: string

const META = {
  title: 'A paper',
  articleType: 'article',
  doi: null,
  openAccess: null,
  history: { received: null, accepted: null, publishedOnline: null },
  abstract: { content: 'We find X.' },
  manuscriptFile: 'manuscript.md',
  figures: [],
  tables: [],
  availability: { data: 'Available on request.', code: 'On GitHub.' },
  backMatter: {
    acknowledgements: null,
    authorContributions: null,
    funding: [],
    competingInterests: null,
    peerReview: null,
    supplementaryInfo: null
  },
  bibliography: 'references.bib'
}

async function writeManuscript(over: Record<string, unknown> = {}, prose = '# Methods\n\nA t-test.\n'): Promise<void> {
  await writeFile(
    join(dir, 'manuscript', 'manuscript.json'),
    `${JSON.stringify({ ...META, ...over }, null, 2)}\n`
  )
  await writeFile(join(dir, 'manuscript', 'manuscript.md'), prose)
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suna-compare-'))
  await mkdir(join(dir, 'manuscript'), { recursive: true })
  await writeManuscript()
  await writeFile(join(dir, 'manuscript', 'references.bib'), '@article{a2020,\n  year = {2020}\n}\n')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('listCompareSides', () => {
  it('always offers the working copy, with the number a log would give it', async () => {
    const sides = await listCompareSides(dir)
    expect(sides[0]!.ref).toEqual({ kind: 'working' })
    expect(sides[0]!.sublabel).toContain('v0.1')
  })

  it('lists logged versions newest first', async () => {
    await logVersion({ rootDir: dir, stage: 1, note: 'submitted' })
    await logVersion({ rootDir: dir, stage: 1 })
    const labels = (await listCompareSides(dir)).map((s) => s.label)
    expect(labels.slice(0, 3)).toEqual(['Working copy', 'v1.2', 'v1.1'])
  })

  it('offers a round, and says which version its reviewers read', async () => {
    await logVersion({ rootDir: dir, stage: 1, note: 'submitted' })
    await createRound({ rootDir: dir, id: 'round-1', kind: 'external', label: 'Round 1' })
    const round = (await listCompareSides(dir)).find((s) => s.label === 'Round 1')!
    expect(round.sublabel).toContain('v1.1')
    expect(round.unavailable).toBe(false)
  })

  it('offers a round with no version anyway, marked unavailable', async () => {
    await createRound({ rootDir: dir, id: 'round-1', kind: 'external', label: 'Round 1' })
    const round = (await listCompareSides(dir)).find((s) => s.label === 'Round 1')!
    expect(round.unavailable).toBe(true)
    expect(round.sublabel).toContain('no version')
  })
})

describe('readCompareDocument', () => {
  it('reads the working copy as it stands', async () => {
    const doc = await readCompareDocument(dir, { kind: 'working' })
    expect(doc.markdown).toContain('t-test')
    expect(doc.fields.find((f) => f.id === 'abstract')?.text).toBe('We find X.')
    expect(doc.bibliography).toContain('a2020')
    expect(doc.problem).toBeNull()
  })

  it('reads a version out of the archive, not out of the working copy', async () => {
    await logVersion({ rootDir: dir, stage: 1 })
    await writeManuscript({ abstract: { content: 'We find Y.' } }, '# Methods\n\nA mixed model.\n')

    const frozen = await readCompareDocument(dir, { kind: 'version', versionId: 'v1.1' })
    expect(frozen.markdown).toContain('t-test')
    expect(frozen.fields.find((f) => f.id === 'abstract')?.text).toBe('We find X.')

    const now = await readCompareDocument(dir, { kind: 'working' })
    expect(now.markdown).toContain('mixed model')
  })

  it('resolves a round to the version its reviewers read', async () => {
    await logVersion({ rootDir: dir, stage: 1 })
    await createRound({ rootDir: dir, id: 'round-1', kind: 'external', label: 'Round 1' })
    await writeManuscript({}, '# Methods\n\nA mixed model.\n')

    const doc = await readCompareDocument(dir, { kind: 'round', roundId: 'round-1' })
    expect(doc.markdown).toContain('t-test')
    expect(doc.sublabel).toContain('v1.1')
  })

  it('explains a round with no version instead of throwing', async () => {
    await createRound({ rootDir: dir, id: 'round-1', kind: 'external', label: 'Round 1' })
    const doc = await readCompareDocument(dir, { kind: 'round', roundId: 'round-1' })
    expect(doc.problem).toContain('no logged version')
    expect(doc.markdown).toBe('')
  })

  it('explains a version that is not in the archive', async () => {
    const doc = await readCompareDocument(dir, { kind: 'version', versionId: 'v9.9' })
    expect(doc.problem).toContain('v9.9')
  })
})

describe('setRoundBaseline', () => {
  it('records the pointer, and it wins over the date guess', async () => {
    await logVersion({ rootDir: dir, stage: 1 })
    await writeManuscript({}, '# Methods\n\nSecond draft.\n')
    await logVersion({ rootDir: dir, stage: 1 })
    await createRound({ rootDir: dir, id: 'round-1', kind: 'external', label: 'Round 1' })

    // Without a pointer the round infers the newest version before it: v1.2.
    expect((await readCompareDocument(dir, { kind: 'round', roundId: 'round-1' })).sublabel).toContain('v1.2')

    const round = await setRoundBaseline(dir, 'round-1', 'v1.1')
    expect(round.baselineVersionId).toBe('v1.1')
    const doc = await readCompareDocument(dir, { kind: 'round', roundId: 'round-1' })
    expect(doc.markdown).toContain('t-test')
    expect(doc.sublabel).toContain('v1.1')
  })

  it('refuses a version the project does not have', async () => {
    await createRound({ rootDir: dir, id: 'round-1', kind: 'external', label: 'Round 1' })
    await expect(setRoundBaseline(dir, 'round-1', 'v4.2')).rejects.toThrow('v4.2')
  })

  it('clearing the pointer puts the round back on the inferred version', async () => {
    await logVersion({ rootDir: dir, stage: 1 })
    await createRound({ rootDir: dir, id: 'round-1', kind: 'external', label: 'Round 1' })
    await setRoundBaseline(dir, 'round-1', 'v1.1')
    const cleared = await setRoundBaseline(dir, 'round-1', null)
    expect(cleared.baselineVersionId).toBeNull()
    expect((await readCompareDocument(dir, { kind: 'round', roundId: 'round-1' })).problem).toBeNull()
  })
})
