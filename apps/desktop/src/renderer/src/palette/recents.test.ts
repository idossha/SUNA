import { describe, expect, it } from 'vitest'
import { pushRecent, parseStoredRecents, RECENTS_CAP, type RecentEntry } from './recents'

function entry(kind: RecentEntry['kind'], value: string, at = 0): RecentEntry {
  return { kind, value, label: value, at }
}

describe('pushRecent', () => {
  it('prepends the new entry', () => {
    const result = pushRecent([entry('file', 'a.md')], entry('file', 'b.md'))
    expect(result.map((e) => e.value)).toEqual(['b.md', 'a.md'])
  })

  it('dedupes by (kind, value), moving the existing entry to the top instead of duplicating it', () => {
    const existing = [entry('file', 'a.md'), entry('command', 'split.right'), entry('file', 'b.md')]
    const result = pushRecent(existing, entry('file', 'b.md', 99))
    expect(result.map((e) => `${e.kind}:${e.value}`)).toEqual([
      'file:b.md',
      'file:a.md',
      'command:split.right'
    ])
    expect(result).toHaveLength(3)
    expect(result[0]?.at).toBe(99)
  })

  it('does not dedupe across different kinds sharing the same value string', () => {
    const existing = [entry('command', 'split.right')]
    const result = pushRecent(existing, entry('file', 'split.right'))
    expect(result).toHaveLength(2)
  })

  it('caps at RECENTS_CAP, dropping the oldest', () => {
    let list: RecentEntry[] = []
    for (let i = 0; i < RECENTS_CAP + 5; i += 1) {
      list = pushRecent(list, entry('file', `file-${i}.md`, i))
    }
    expect(list).toHaveLength(RECENTS_CAP)
    expect(list[0]?.value).toBe(`file-${RECENTS_CAP + 4}.md`)
    expect(list[list.length - 1]?.value).toBe('file-5.md')
  })
})

describe('parseStoredRecents', () => {
  it('reads a well-formed stored array', () => {
    const stored = [entry('file', 'a.md'), entry('ai', 'why is the sky blue')]
    expect(parseStoredRecents(stored)).toEqual(stored)
  })

  it('treats missing/garbled storage as no recents rather than throwing', () => {
    expect(parseStoredRecents(undefined)).toEqual([])
    expect(parseStoredRecents(null)).toEqual([])
    expect(parseStoredRecents('not an array')).toEqual([])
    expect(parseStoredRecents(42)).toEqual([])
  })

  it('drops malformed entries but keeps well-formed ones in a mixed array', () => {
    const good = entry('command', 'split.right')
    const stored = [good, { kind: 'file' }, { kind: 'bogus-kind', value: 'x', label: 'x', at: 1 }, null]
    expect(parseStoredRecents(stored)).toEqual([good])
  })

  it('caps a stored array longer than RECENTS_CAP', () => {
    const stored = Array.from({ length: RECENTS_CAP + 10 }, (_, i) => entry('file', `f${i}.md`, i))
    expect(parseStoredRecents(stored)).toHaveLength(RECENTS_CAP)
  })
})
