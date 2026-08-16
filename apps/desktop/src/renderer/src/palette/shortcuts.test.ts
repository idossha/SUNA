import { describe, expect, it } from 'vitest'
import { formatShortcut, matchesShortcut, parseShortcut, type ShortcutEvent } from './shortcuts'

function event(overrides: Partial<ShortcutEvent>): ShortcutEvent {
  return { code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...overrides }
}

describe('parseShortcut', () => {
  it('parses a bare code with no modifiers', () => {
    expect(parseShortcut('Backslash')).toEqual({ mod: false, shift: false, alt: false, code: 'Backslash' })
  })

  it('parses Mod/Shift/Alt in any combination', () => {
    expect(parseShortcut('Mod-Backslash')).toEqual({ mod: true, shift: false, alt: false, code: 'Backslash' })
    expect(parseShortcut('Mod-Shift-Backslash')).toEqual({
      mod: true,
      shift: true,
      alt: false,
      code: 'Backslash'
    })
    expect(parseShortcut('Mod-Shift-Alt-KeyK')).toEqual({
      mod: true,
      shift: true,
      alt: true,
      code: 'KeyK'
    })
  })
})

describe('matchesShortcut', () => {
  it('matches metaKey (macOS) as Mod', () => {
    expect(matchesShortcut(event({ code: 'Backslash', metaKey: true }), 'Mod-Backslash')).toBe(true)
  })

  it('matches ctrlKey (non-macOS) as Mod too', () => {
    expect(matchesShortcut(event({ code: 'Backslash', ctrlKey: true }), 'Mod-Backslash')).toBe(true)
  })

  it('requires the exact modifier set — Shift held or not held both matter', () => {
    expect(
      matchesShortcut(event({ code: 'Backslash', metaKey: true, shiftKey: true }), 'Mod-Backslash')
    ).toBe(false)
    expect(
      matchesShortcut(event({ code: 'Backslash', metaKey: true, shiftKey: true }), 'Mod-Shift-Backslash')
    ).toBe(true)
  })

  it('requires Mod to be held — an unmodified key never matches a Mod- spec', () => {
    expect(matchesShortcut(event({ code: 'Backslash' }), 'Mod-Backslash')).toBe(false)
  })

  it('matches by .code, not .key — Shift changes .key but never .code', () => {
    // Cmd+Shift+\ on a US layout: browsers report event.key as "|", but
    // event.code stays "Backslash" — the spec must match on the latter.
    expect(
      matchesShortcut(event({ code: 'Backslash', metaKey: true, shiftKey: true }), 'Mod-Shift-Backslash')
    ).toBe(true)
  })

  it('rejects a different physical key entirely', () => {
    expect(matchesShortcut(event({ code: 'KeyK', metaKey: true }), 'Mod-Backslash')).toBe(false)
  })

  it('keeps ⌘B (bold) clear of the left-nav toggles', () => {
    expect(matchesShortcut(event({ code: 'KeyB', metaKey: true }), 'Mod-Shift-KeyB')).toBe(false)
    expect(matchesShortcut(event({ code: 'KeyB', metaKey: true }), 'Mod-Alt-KeyB')).toBe(false)
    expect(
      matchesShortcut(event({ code: 'KeyB', metaKey: true, shiftKey: true }), 'Mod-Shift-KeyB')
    ).toBe(true)
    expect(
      matchesShortcut(event({ code: 'KeyB', metaKey: true, altKey: true }), 'Mod-Alt-KeyB')
    ).toBe(true)
  })
})

describe('formatShortcut', () => {
  it('renders modifiers as macOS glyphs in a fixed order', () => {
    expect(formatShortcut('Mod-Backslash')).toBe('⌘\\')
    expect(formatShortcut('Mod-Shift-Backslash')).toBe('⌘⇧\\')
    expect(formatShortcut('Mod-KeyK')).toBe('⌘K')
    expect(formatShortcut('Mod-Shift-KeyP')).toBe('⌘⇧P')
    expect(formatShortcut('Mod-Shift-KeyB')).toBe('⌘⇧B')
    expect(formatShortcut('Mod-Alt-KeyB')).toBe('⌘⌥B')
  })

  it('falls back to the bare code for anything unrecognized', () => {
    expect(formatShortcut('Mod-F1')).toBe('⌘F1')
  })
})
