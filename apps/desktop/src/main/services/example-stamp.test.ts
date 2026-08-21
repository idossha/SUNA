import { describe, expect, it } from 'vitest'
import {
  archiveDirName,
  parseExampleStamp,
  serializeExampleStamp,
  slugifyProjectName
} from './example-stamp'

describe('example stamp', () => {
  it('round-trips a source id', () => {
    expect(parseExampleStamp(serializeExampleStamp('hello-suna'))).toBe('hello-suna')
  })

  it('reads pre-stamp copies as unknown', () => {
    // The case that matters: a copy made before stamps existed has no file at
    // all, and the caller passes whatever it managed to read.
    expect(parseExampleStamp('')).toBeNull()
    expect(parseExampleStamp('not json')).toBeNull()
    expect(parseExampleStamp('{}')).toBeNull()
    expect(parseExampleStamp('{"source": ""}')).toBeNull()
    expect(parseExampleStamp('{"source": 3}')).toBeNull()
    expect(parseExampleStamp('null')).toBeNull()
  })
})

describe('slugifyProjectName', () => {
  it('makes a legible directory name', () => {
    expect(slugifyProjectName('Ram-pressure stripping in a z=1.7 cluster (demo)')).toBe(
      'ram-pressure-stripping-in-a-z-1-7-cluste'
    )
    expect(slugifyProjectName('Hello SUNA')).toBe('hello-suna')
  })

  it('never returns an empty or trailing-hyphen name', () => {
    expect(slugifyProjectName('')).toBe('previous')
    expect(slugifyProjectName('!!!')).toBe('previous')
    expect(slugifyProjectName('   ')).toBe('previous')
    expect(slugifyProjectName('a'.repeat(80)).length).toBeLessThanOrEqual(40)
    expect(slugifyProjectName(`${'a'.repeat(39)} tail`)).not.toMatch(/-$/)
  })
})

describe('archiveDirName', () => {
  it('uses the plain name when it is free', () => {
    expect(archiveDirName('example-project', 'demo', [])).toBe('example-project-demo')
  })

  it('never reuses a name already on disk', () => {
    const taken = ['example-project', 'example-project-demo', 'example-project-demo-2']
    expect(archiveDirName('example-project', 'demo', taken)).toBe('example-project-demo-3')
  })
})
