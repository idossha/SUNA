import { describe, expect, it } from 'vitest'
import { assertBranchName, parseBranchRefs, parseTrackShort } from './git-branch'

const SEP = '\u001f'

/** One `for-each-ref` line in the format gitBranches asks for. */
function refLine(fields: {
  name: string
  head?: string
  upstream?: string
  track?: string
  subject?: string
  date?: string
}): string {
  return [
    fields.name,
    fields.head ?? ' ',
    fields.upstream ?? '',
    fields.track ?? '',
    fields.subject ?? '',
    fields.date ?? '2026-01-01T00:00:00+00:00'
  ].join(SEP)
}

describe('parseTrackShort', () => {
  it('reads both directions of drift', () => {
    expect(parseTrackShort('[ahead 2, behind 1]')).toEqual({ ahead: 2, behind: 1 })
  })

  it('reads one direction on its own', () => {
    expect(parseTrackShort('[ahead 3]')).toEqual({ ahead: 3, behind: 0 })
    expect(parseTrackShort('[behind 7]')).toEqual({ ahead: 0, behind: 7 })
  })

  it('treats an in-step branch and an unparseable one alike as zero', () => {
    expect(parseTrackShort('')).toEqual({ ahead: 0, behind: 0 })
    expect(parseTrackShort('[gone]')).toEqual({ ahead: 0, behind: 0 })
  })
})

describe('parseBranchRefs', () => {
  it('marks the checked-out branch from the HEAD column', () => {
    const out = parseBranchRefs(
      [refLine({ name: 'main', head: '*' }), refLine({ name: 'draft' })].join('\n'),
      false
    )
    expect(out.map((b) => [b.name, b.current])).toEqual([
      ['main', true],
      ['draft', false]
    ])
  })

  it('carries upstream, drift, subject and date through', () => {
    const [branch] = parseBranchRefs(
      refLine({
        name: 'main',
        head: '*',
        upstream: 'origin/main',
        track: '[ahead 2]',
        subject: 'Tighten the abstract',
        date: '2026-08-01T09:30:00+00:00'
      }),
      false
    )
    expect(branch?.upstream).toBe('origin/main')
    expect(branch?.ahead).toBe(2)
    expect(branch?.subject).toBe('Tighten the abstract')
    expect(branch?.date).toBe('2026-08-01T09:30:00+00:00')
  })

  it('reports no upstream as null rather than an empty string', () => {
    expect(parseBranchRefs(refLine({ name: 'solo' }), false)[0]?.upstream).toBeNull()
  })

  it('drops origin/HEAD, which is a pointer and not a branch', () => {
    const out = parseBranchRefs(
      [refLine({ name: 'origin/HEAD' }), refLine({ name: 'origin/main' })].join('\n'),
      true
    )
    expect(out.map((b) => b.name)).toEqual(['origin/main'])
    expect(out[0]?.remote).toBe(true)
  })

  it('ignores blank lines', () => {
    expect(parseBranchRefs('\n\n', false)).toEqual([])
  })
})

describe('assertBranchName', () => {
  it('accepts ordinary and namespaced names', () => {
    expect(assertBranchName('revision-2')).toBe('revision-2')
    expect(assertBranchName('  reviewer/3-response  ')).toBe('reviewer/3-response')
  })

  it('refuses anything git would read as an option', () => {
    expect(() => assertBranchName('--force')).toThrow(/cannot start with/)
  })

  it('refuses the characters git itself rejects', () => {
    for (const bad of ['has space', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b']) {
      expect(() => assertBranchName(bad)).toThrow(/cannot contain/)
    }
  })

  it('refuses the shapes git rejects for other reasons', () => {
    expect(() => assertBranchName('a..b')).toThrow(/will not accept/)
    expect(() => assertBranchName('trailing/')).toThrow(/will not accept/)
    expect(() => assertBranchName('branch.lock')).toThrow(/will not accept/)
  })

  it('refuses an empty name with a sentence, not a crash', () => {
    expect(() => assertBranchName('   ')).toThrow(/Enter a branch name/)
  })
})
