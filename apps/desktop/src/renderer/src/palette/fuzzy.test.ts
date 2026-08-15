import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyScore } from './fuzzy'

describe('fuzzyScore', () => {
  it('matches a non-contiguous subsequence', () => {
    expect(fuzzyScore('introduction', 'intro')).not.toBeNull()
    expect(fuzzyScore('manuscript.json', 'mscjson')).not.toBeNull()
    expect(fuzzyScore('Split Right', 'splrt')).not.toBeNull()
  })

  it('is case-insensitive', () => {
    expect(fuzzyScore('Split Right', 'SPLIT')).not.toBeNull()
    expect(fuzzyScore('SPLIT RIGHT', 'split')).not.toBeNull()
  })

  it('returns null when the query is not a subsequence at all', () => {
    expect(fuzzyScore('introduction', 'zzz')).toBeNull()
    expect(fuzzyScore('abc', 'acb')).toBeNull() // out of order
    expect(fuzzyScore('short', 'shortest')).toBeNull() // query longer than text
  })

  it('an empty query matches everything at score 0', () => {
    expect(fuzzyScore('anything', '')).toBe(0)
    expect(fuzzyScore('', '')).toBe(0)
  })

  it('scores a basename-start match higher than the same letters matched mid-path', () => {
    const basenameHit = fuzzyScore('manuscript/sections/introduction.md', 'intro')
    const midPathHit = fuzzyScore('manuscript/xintroy/other.md', 'intro')
    expect(basenameHit).not.toBeNull()
    expect(midPathHit).not.toBeNull()
    expect(basenameHit as number).toBeGreaterThan(midPathHit as number)
  })

  it('scores a segment-start match (after - or _) higher than a mid-word match', () => {
    const afterDash = fuzzyScore('01-introduction.md', 'intro')
    const midWord = fuzzyScore('reintroducing.md', 'intro')
    expect(afterDash as number).toBeGreaterThan(midWord as number)
  })

  it('rewards consecutive runs over the same letters scattered apart mid-word', () => {
    const consecutive = fuzzyScore('splitpane.ts', 'split')
    // 'x' padding keeps every match away from a segment/word boundary, so
    // only the consecutive-run bonus is in play, not the boundary bonus.
    const scattered = fuzzyScore('xsxpxlxixtx.ts', 'split')
    expect(consecutive as number).toBeGreaterThan(scattered as number)
  })

  it('breaks ties toward the shorter/tighter overall match', () => {
    const tight = fuzzyScore('split.ts', 'split')
    const loose = fuzzyScore('split-right-and-then-some-more-padding.ts', 'split')
    expect(tight as number).toBeGreaterThan(loose as number)
  })
})

describe('fuzzyFilter', () => {
  interface File {
    path: string
  }
  const files: File[] = [
    { path: 'manuscript/sections/01-introduction.md' },
    { path: 'manuscript/xintroy/other.md' },
    { path: 'references/gunn1972.pdf' },
    { path: 'output/fig-spectrum.png' }
  ]

  it('drops non-matches and sorts best score first', () => {
    const results = fuzzyFilter(files, 'intro', (f) => f.path)
    expect(results.map((r) => r.item.path)).toEqual([
      'manuscript/sections/01-introduction.md',
      'manuscript/xintroy/other.md'
    ])
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? Infinity)
  })

  it('an empty query returns every item, unscored and in original order', () => {
    const results = fuzzyFilter(files, '', (f) => f.path)
    expect(results.map((r) => r.item.path)).toEqual(files.map((f) => f.path))
    expect(results.every((r) => r.score === 0)).toBe(true)
  })

  it('returns an empty list when nothing matches', () => {
    expect(fuzzyFilter(files, 'zzzzz', (f) => f.path)).toEqual([])
  })

  it('scores commands over their title + category text', () => {
    interface Command {
      title: string
      category: string
    }
    const commands: Command[] = [
      { title: 'Split Right', category: 'View' },
      { title: 'Open Settings', category: 'App' },
      { title: 'Run Compliance Check', category: 'Figures' }
    ]
    const results = fuzzyFilter(commands, 'view', (c) => `${c.title} ${c.category}`)
    expect(results).toHaveLength(1)
    expect(results[0]?.item.title).toBe('Split Right')
  })
})
