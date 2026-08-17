import { describe, expect, it } from 'vitest'
import { formatShortcut } from '../../palette/shortcuts'
import { OS_ACTION_SHORTCUTS } from '../os-actions'
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

  /**
   * feature-plan-9 §1 and §6: the vim rows live in the `editor` section (which
   * `manuscript` shares), and the chord that reaches this dialog from inside a
   * buffer has to be findable from the Global tab too — a reader who is stuck
   * in NORMAL mode is not on the Editor tab by accident.
   */
  describe('the vim rows', () => {
    const rowsOf = (id: string, title: string): ReadonlyArray<readonly [string, string]> =>
      SECTIONS.find((s) => s.id === id)?.groups.find((g) => g.title.startsWith(title))?.items ?? []

    it('lists the ex commands the app actually registers, in the editor section', () => {
      const keys = rowsOf('editor', 'Vim').map(([k]) => k)
      expect(keys).toContain(':w')
      expect(keys).toContain(':q / :q!')
      expect(keys).toContain(':wq')
      expect(keys).toContain(':help / :h')
    })

    it('says out loud that ? is search-backward in a vim buffer, and names the way out', () => {
      const row = rowsOf('editor', 'Vim').find(([keys]) => keys === '?')
      expect(row).toBeDefined()
      expect(row?.[1]).toContain('⌘?')
      expect(row?.[1]).toContain(':help')
    })

    it('reaches the manuscript section too, since it shares the editor groups', () => {
      expect(rowsOf('manuscript', 'Vim').length).toBeGreaterThan(0)
    })

    it('names ⌘? in the Global tab as a way into this dialog', () => {
      const global = SECTIONS.find((s) => s.id === 'global')
      const keys = global?.groups.flatMap((g) => g.items.map(([k]) => k)) ?? []
      expect(keys.some((k) => k.includes('⌘?'))).toBe(true)
    })
  })

  /**
   * feature-plan-9 §3: the reveal / open-with chords are bound in ExplorerView
   * and shown in its context menu, so the overlay owes the reader the same
   * glyphs the menu's accelerator prints — derived here from the one spec the
   * view binds, so a rebinding cannot leave a stale key in this table.
   */
  it('lists the OS actions in the explorer section with the chords the tree binds', () => {
    const explorer = SECTIONS.find((s) => s.id === 'explorer')
    const rows = explorer?.groups.flatMap((g) => g.items) ?? []
    for (const action of ['reveal', 'open'] as const) {
      const row = rows.find(([keys]) => keys === formatShortcut(OS_ACTION_SHORTCUTS[action]))
      expect(row, `no row for ${OS_ACTION_SHORTCUTS[action]}`).toBeDefined()
      expect(row?.[1]).not.toBe('')
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
