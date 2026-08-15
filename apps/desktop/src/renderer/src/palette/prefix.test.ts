import { describe, expect, it } from 'vitest'
import { parsePaletteInput } from './prefix'

describe('parsePaletteInput', () => {
  it('plain text with no marker is file-search mode over the whole string', () => {
    expect(parsePaletteInput('intro')).toEqual({ mode: 'files', query: 'intro' })
    expect(parsePaletteInput('manuscript/sections')).toEqual({
      mode: 'files',
      query: 'manuscript/sections'
    })
  })

  it('empty input is file-search mode with an empty query', () => {
    expect(parsePaletteInput('')).toEqual({ mode: 'files', query: '' })
  })

  it('">" selects command mode, with or without a space after the marker', () => {
    expect(parsePaletteInput('>split right')).toEqual({ mode: 'commands', query: 'split right' })
    expect(parsePaletteInput('> split right')).toEqual({ mode: 'commands', query: 'split right' })
  })

  it('a leading space before the marker is ignored', () => {
    expect(parsePaletteInput(' > cmd')).toEqual({ mode: 'commands', query: 'cmd' })
    expect(parsePaletteInput('  >cmd')).toEqual({ mode: 'commands', query: 'cmd' })
  })

  it('"$" selects terminal mode and preserves internal spacing after the first', () => {
    expect(parsePaletteInput('$ ls -la')).toEqual({ mode: 'terminal', query: 'ls -la' })
    expect(parsePaletteInput('$echo hi')).toEqual({ mode: 'terminal', query: 'echo hi' })
    expect(parsePaletteInput('$  echo   two')).toEqual({ mode: 'terminal', query: ' echo   two' })
  })

  it('"?" selects ai mode, with or without a space after the marker', () => {
    expect(parsePaletteInput('?why')).toEqual({ mode: 'ai', query: 'why' })
    expect(parsePaletteInput('? why is the sky blue')).toEqual({
      mode: 'ai',
      query: 'why is the sky blue'
    })
  })

  it('a bare marker with nothing after it yields an empty query in that mode', () => {
    expect(parsePaletteInput('>')).toEqual({ mode: 'commands', query: '' })
    expect(parsePaletteInput('$')).toEqual({ mode: 'terminal', query: '' })
    expect(parsePaletteInput('?')).toEqual({ mode: 'ai', query: '' })
  })
})
