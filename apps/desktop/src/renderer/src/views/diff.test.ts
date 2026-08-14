import { describe, expect, it } from 'vitest'
import { classifyDiffLine, relativeToRoot, STATUS_LETTERS } from './diff'

describe('classifyDiffLine', () => {
  it('classifies added and deleted lines', () => {
    expect(classifyDiffLine('+new line')).toBe('add')
    expect(classifyDiffLine('-old line')).toBe('del')
  })

  it('keeps headers out of the add/del buckets', () => {
    expect(classifyDiffLine('+++ b/file.md')).toBe('meta')
    expect(classifyDiffLine('--- a/file.md')).toBe('meta')
    expect(classifyDiffLine('diff --git a/x b/x')).toBe('meta')
    expect(classifyDiffLine('index 3f2a1b..9c0d2e 100644')).toBe('meta')
    expect(classifyDiffLine('\\ No newline at end of file')).toBe('meta')
  })

  it('marks hunks and context', () => {
    expect(classifyDiffLine('@@ -1,4 +1,6 @@')).toBe('hunk')
    expect(classifyDiffLine(' unchanged')).toBe('ctx')
    expect(classifyDiffLine('')).toBe('ctx')
  })
})

describe('relativeToRoot', () => {
  it('strips the project root prefix', () => {
    expect(relativeToRoot('/p/demo/manuscript/a.md', '/p/demo')).toBe('manuscript/a.md')
    expect(relativeToRoot('/p/demo/manuscript/a.md', '/p/demo/')).toBe('manuscript/a.md')
  })

  it('passes through already-relative paths', () => {
    expect(relativeToRoot('manuscript/a.md', '/p/demo')).toBe('manuscript/a.md')
  })
})

describe('STATUS_LETTERS', () => {
  it('covers every git:status change kind', () => {
    for (const kind of ['modified', 'added', 'deleted', 'renamed', 'untracked', 'conflicted']) {
      expect(STATUS_LETTERS[kind], kind).toMatch(/^[A-Z]$/)
    }
  })
})
