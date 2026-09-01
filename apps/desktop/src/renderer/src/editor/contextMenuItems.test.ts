import { describe, expect, it } from 'vitest'
import {
  buildContextMenuItems,
  clampMenuPosition,
  enabledActionIds,
  type ContextMenuActionId
} from './contextMenuItems'

const ALL_AVAILABLE = {
  comment: true,
  insertCitation: true,
  insertFigure: true,
  insertCrossReference: true
}
const NONE_AVAILABLE = {
  comment: false,
  insertCitation: false,
  insertFigure: false,
  insertCrossReference: false
}

const SELECTION_DEPENDENT: ContextMenuActionId[] = ['comment', 'bold', 'italic', 'code', 'strikethrough', 'cut', 'copy']
const SELECTION_INDEPENDENT: ContextMenuActionId[] = [
  'link',
  'insertCitation',
  'insertFigure',
  'insertCrossReference',
  'paste'
]

describe('buildContextMenuItems', () => {
  it('enables selection-dependent items (Comment, Bold, Italic, Code, Strikethrough, Cut, Copy) with a selection', () => {
    const items = buildContextMenuItems(true, ALL_AVAILABLE)
    const enabled = enabledActionIds(items)
    for (const id of SELECTION_DEPENDENT) {
      expect(enabled).toContain(id)
    }
  })

  it('disables selection-dependent items with no selection, per the spec\'s "plain Cut/Copy/Paste + Insert group" rule', () => {
    const items = buildContextMenuItems(false, ALL_AVAILABLE)
    const enabled = new Set(enabledActionIds(items))
    for (const id of SELECTION_DEPENDENT) {
      expect(enabled.has(id)).toBe(false)
    }
    // the "plain" group stays usable regardless of selection
    for (const id of SELECTION_INDEPENDENT) {
      expect(enabled.has(id)).toBe(true)
    }
  })

  it('Link, Insert citation, Insert cross-reference, and Paste never depend on selection', () => {
    const withSel = new Set(enabledActionIds(buildContextMenuItems(true, ALL_AVAILABLE)))
    const withoutSel = new Set(enabledActionIds(buildContextMenuItems(false, ALL_AVAILABLE)))
    for (const id of SELECTION_INDEPENDENT) {
      expect(withSel.has(id)).toBe(true)
      expect(withoutSel.has(id)).toBe(true)
    }
  })

  it('omits Comment/Insert citation/Insert cross-reference entirely when the host supplied no callback', () => {
    const items = buildContextMenuItems(true, NONE_AVAILABLE)
    const ids = items.filter((e) => e.kind === 'item').map((e) => e.id)
    expect(ids).not.toContain('comment')
    expect(ids).not.toContain('insertCitation')
    expect(ids).not.toContain('insertFigure')
    expect(ids).not.toContain('insertCrossReference')
    // the rest of the menu is unaffected
    expect(ids).toEqual(expect.arrayContaining(['bold', 'italic', 'code', 'strikethrough', 'link', 'cut', 'copy', 'paste']))
  })

  it('always includes Bold/Italic/Code/Strikethrough/Link/Cut/Copy/Paste regardless of availability', () => {
    const items = buildContextMenuItems(true, NONE_AVAILABLE)
    const ids = items.filter((e) => e.kind === 'item').map((e) => e.id)
    for (const id of ['bold', 'italic', 'code', 'strikethrough', 'link', 'cut', 'copy', 'paste']) {
      expect(ids).toContain(id)
    }
  })
})

describe('buildContextMenuItems — "Open reference PDF" (DECISIONS 2026-08-14)', () => {
  it('omits the item entirely when the click did not land on a citation', () => {
    const items = buildContextMenuItems(false, { ...ALL_AVAILABLE, openReferencePdf: null })
    expect(items.filter((e) => e.kind === 'item').map((e) => e.id)).not.toContain('openReferencePdf')
  })

  it('omits the item when the host supplies no availability at all (back-compat)', () => {
    const items = buildContextMenuItems(false, ALL_AVAILABLE)
    expect(items.filter((e) => e.kind === 'item').map((e) => e.id)).not.toContain('openReferencePdf')
  })

  it('shows it enabled with "Open reference PDF" when a PDF resolves', () => {
    const items = buildContextMenuItems(false, {
      ...ALL_AVAILABLE,
      openReferencePdf: { key: 'Gunn1972', path: '/proj/references/Gunn1972.pdf' }
    })
    const item = items.find((e) => e.kind === 'item' && e.id === 'openReferencePdf')
    expect(item).toMatchObject({ label: 'Open reference PDF', enabled: true })
  })

  it('shows it disabled, naming the key, when no PDF resolves', () => {
    const items = buildContextMenuItems(false, {
      ...ALL_AVAILABLE,
      openReferencePdf: { key: 'Nobody2099', path: null }
    })
    const item = items.find((e) => e.kind === 'item' && e.id === 'openReferencePdf')
    expect(item).toMatchObject({ label: 'No PDF found for @Nobody2099', enabled: false })
  })

  it('never depends on text selection', () => {
    const availability = { ...ALL_AVAILABLE, openReferencePdf: { key: 'K', path: '/x.pdf' } }
    expect(enabledActionIds(buildContextMenuItems(true, availability))).toContain('openReferencePdf')
    expect(enabledActionIds(buildContextMenuItems(false, availability))).toContain('openReferencePdf')
  })
})

describe('enabledActionIds', () => {
  it('skips disabled items and separators, preserving menu order', () => {
    const items = buildContextMenuItems(false, ALL_AVAILABLE)
    const ids = enabledActionIds(items)
    expect(ids).toEqual(['link', 'insertCitation', 'insertFigure', 'insertCrossReference', 'paste'])
  })
})

describe('clampMenuPosition', () => {
  it('keeps a position that already fits unchanged', () => {
    const pos = clampMenuPosition({ x: 100, y: 100, width: 200, height: 150, viewportWidth: 1000, viewportHeight: 800 })
    expect(pos).toEqual({ left: 100, top: 100 })
  })

  it('flips left when the menu would overflow the right edge', () => {
    const pos = clampMenuPosition({ x: 950, y: 100, width: 200, height: 150, viewportWidth: 1000, viewportHeight: 800 })
    expect(pos.left).toBeLessThanOrEqual(1000 - 200 - 8)
    expect(pos.left + 200).toBeLessThanOrEqual(1000 - 8 + 0.001)
  })

  it('flips up when the menu would overflow the bottom edge', () => {
    const pos = clampMenuPosition({ x: 100, y: 780, width: 200, height: 150, viewportWidth: 1000, viewportHeight: 800 })
    expect(pos.top + 150).toBeLessThanOrEqual(800 - 8 + 0.001)
  })

  it('never places the menu off the top/left edge even in a tiny viewport', () => {
    const pos = clampMenuPosition({ x: -50, y: -50, width: 200, height: 150, viewportWidth: 180, viewportHeight: 140 })
    expect(pos.left).toBeGreaterThanOrEqual(8)
    expect(pos.top).toBeGreaterThanOrEqual(8)
  })
})
