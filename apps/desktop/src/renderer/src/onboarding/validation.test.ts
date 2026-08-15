import { describe, expect, it } from 'vitest'
import { validateProjectName, validateTarget } from './validation'

describe('validateProjectName', () => {
  it('accepts an ordinary name', () => {
    expect(validateProjectName('ram-pressure-paper')).toEqual({ valid: true, reason: null })
  })

  it('accepts spaces and unicode inside the name', () => {
    expect(validateProjectName('Ram Pressure Stripping — Draft')).toEqual({
      valid: true,
      reason: null
    })
  })

  it('rejects an empty name', () => {
    const result = validateProjectName('')
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/enter a project name/i)
  })

  it('rejects leading/trailing whitespace', () => {
    expect(validateProjectName(' paper').valid).toBe(false)
    expect(validateProjectName('paper ').valid).toBe(false)
  })

  it('rejects "." and ".."', () => {
    expect(validateProjectName('.').valid).toBe(false)
    expect(validateProjectName('..').valid).toBe(false)
  })

  it.each(['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b'])(
    'rejects the illegal character in %s',
    (name) => {
      const result = validateProjectName(name)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/cannot contain/i)
    }
  )

  it('rejects control characters', () => {
    expect(validateProjectName(`paper${String.fromCharCode(1)}`).valid).toBe(false)
  })
})

describe('validateTarget', () => {
  it('is invalid with no parent chosen yet', () => {
    expect(validateTarget(null, 'paper', null)).toEqual({
      valid: false,
      reason: 'Choose a parent folder.'
    })
  })

  it('surfaces the name error before ever checking the filesystem', () => {
    const result = validateTarget('/work', '', null)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/enter a project name/i)
  })

  it('is invalid with no reason while the filesystem check is in flight', () => {
    expect(validateTarget('/work', 'paper', null)).toEqual({ valid: false, reason: null })
  })

  it('rejects a parent that is not writable', () => {
    const result = validateTarget('/work', 'paper', { exists: false, parentWritable: false })
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/cannot be written to/i)
  })

  it('rejects a target that already exists', () => {
    const result = validateTarget('/work', 'paper', { exists: true, parentWritable: true })
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/already exists/i)
  })

  it('is valid once the name is clean and the filesystem check passes', () => {
    expect(validateTarget('/work', 'paper', { exists: false, parentWritable: true })).toEqual({
      valid: true,
      reason: null
    })
  })
})
