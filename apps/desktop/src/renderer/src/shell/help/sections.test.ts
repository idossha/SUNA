import { describe, expect, it } from 'vitest'
import { SECTIONS, sectionForSurface } from './sections'

describe('SECTIONS', () => {
  it('has exactly the six surface ids the plan names, unique', () => {
    const ids = SECTIONS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual(
      ['canvas', 'editor', 'explorer', 'global', 'manuscript', 'viewers'].sort()
    )
  })

  it('every section has a label and at least one group', () => {
    for (const section of SECTIONS) {
      expect(section.label).not.toBe('')
      expect(section.groups.length).toBeGreaterThan(0)
    }
  })

  it('every group is titled and non-empty, and every row has keys + description', () => {
    for (const section of SECTIONS) {
      for (const group of section.groups) {
        expect(group.title).not.toBe('')
        expect(group.items.length).toBeGreaterThan(0)
        for (const [keys, description] of group.items) {
          expect(keys).not.toBe('')
          expect(description).not.toBe('')
        }
      }
    }
  })

  it('manuscript is a superset of editor — "everything in editor, plus"', () => {
    const editor = SECTIONS.find((s) => s.id === 'editor')
    const manuscript = SECTIONS.find((s) => s.id === 'manuscript')
    expect(editor).toBeDefined()
    expect(manuscript).toBeDefined()
    for (const group of editor?.groups ?? []) {
      expect(manuscript?.groups).toContain(group)
    }
    expect(manuscript?.groups.length).toBeGreaterThan(editor?.groups.length ?? 0)
  })
})

describe('sectionForSurface', () => {
  it('maps each dock component kind to its section', () => {
    expect(sectionForSurface('canvas', false)).toBe('canvas')
    expect(sectionForSurface('manuscript', false)).toBe('manuscript')
    expect(sectionForSurface('editor', false)).toBe('editor')
    expect(sectionForSurface('pdf', false)).toBe('viewers')
    expect(sectionForSurface('image', false)).toBe('viewers')
    expect(sectionForSurface('dataview', false)).toBe('viewers')
  })

  it('sends unknown kinds and the no-panel case to global', () => {
    expect(sectionForSurface('welcome', false)).toBe('global')
    expect(sectionForSurface('settings', false)).toBe('global')
    expect(sectionForSurface('export', false)).toBe('global')
    expect(sectionForSurface('onboarding', false)).toBe('global')
    expect(sectionForSurface('docx-import', false)).toBe('global')
    expect(sectionForSurface('', false)).toBe('global')
    expect(sectionForSurface(null, false)).toBe('global')
  })

  it('explorer focus wins over any active panel — the dock panel does not change while the tree is worked', () => {
    expect(sectionForSurface('canvas', true)).toBe('explorer')
    expect(sectionForSurface('editor', true)).toBe('explorer')
    expect(sectionForSurface(null, true)).toBe('explorer')
  })

  it('only ever returns an id that exists in SECTIONS', () => {
    const ids = new Set(SECTIONS.map((s) => s.id))
    const surfaces = ['canvas', 'manuscript', 'editor', 'pdf', 'image', 'dataview', 'welcome', null]
    for (const surface of surfaces) {
      for (const focused of [true, false]) {
        expect(ids.has(sectionForSurface(surface, focused))).toBe(true)
      }
    }
  })
})
