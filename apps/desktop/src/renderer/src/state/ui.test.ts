import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolveSidebarDrag,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  useUiStore
} from './ui'

/**
 * A localStorage stand-in, the way state/explorer.test.ts stubs window.suna.
 * It is installed AFTER the import above runs, so the store is created with
 * the defaults and the persisted-load path is exercised separately, against a
 * freshly imported module.
 */
const stored = new Map<string, string>()
let setItemThrows = false

Object.defineProperty(globalThis, 'window', {
  value: {
    localStorage: {
      getItem: (key: string): string | null => stored.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        if (setItemThrows) throw new Error('quota exceeded')
        stored.set(key, value)
      }
    }
  },
  writable: true,
  configurable: true
})

beforeEach(() => {
  stored.clear()
  setItemThrows = false
  useUiStore.setState({ activeView: 'explorer', sidebarVisible: true, railVisible: true })
})

describe('resolveSidebarDrag', () => {
  it('collapses below the threshold, which the width clamp alone can never do', () => {
    expect(resolveSidebarDrag(119)).toEqual({ collapse: true })
    expect(resolveSidebarDrag(0)).toEqual({ collapse: true })
    expect(resolveSidebarDrag(-50)).toEqual({ collapse: true })
  })

  it('still clamps at the threshold — the collapse point sits below the minimum width', () => {
    expect(resolveSidebarDrag(120)).toEqual({ collapse: false, width: SIDEBAR_WIDTH_MIN })
  })

  it('passes a width through in range, and clamps a wide drag', () => {
    expect(resolveSidebarDrag(300)).toEqual({ collapse: false, width: 300 })
    expect(resolveSidebarDrag(900)).toEqual({ collapse: false, width: SIDEBAR_WIDTH_MAX })
  })

  it('falls back to the default width for a non-finite drag', () => {
    expect(resolveSidebarDrag(Number.NaN)).toEqual({ collapse: false, width: SIDEBAR_WIDTH_DEFAULT })
  })
})

describe('left nav visibility', () => {
  it('hides the panel along with the rail — a panel with no rail cannot pick a view', () => {
    useUiStore.getState().setRailVisible(false)
    expect(useUiStore.getState().railVisible).toBe(false)
    expect(useUiStore.getState().sidebarVisible).toBe(false)
  })

  it('brings the rail back whenever the panel is shown', () => {
    useUiStore.getState().setRailVisible(false)
    useUiStore.getState().setSidebarVisible(true)
    expect(useUiStore.getState().sidebarVisible).toBe(true)
    expect(useUiStore.getState().railVisible).toBe(true)
  })

  it('toggleSidebar leaves the rail alone on the way out and restores it on the way in', () => {
    useUiStore.getState().toggleSidebar()
    expect(useUiStore.getState()).toMatchObject({ sidebarVisible: false, railVisible: true })
    useUiStore.setState({ railVisible: false })
    useUiStore.getState().toggleSidebar()
    expect(useUiStore.getState()).toMatchObject({ sidebarVisible: true, railVisible: true })
  })

  it('toggleLeftNav walks full → hidden → full', () => {
    useUiStore.getState().toggleLeftNav()
    expect(useUiStore.getState()).toMatchObject({ sidebarVisible: false, railVisible: false })
    useUiStore.getState().toggleLeftNav()
    expect(useUiStore.getState()).toMatchObject({ sidebarVisible: true, railVisible: true })
  })

  it('reaches the rail-only state and no fourth state', () => {
    useUiStore.getState().setSidebarVisible(false)
    expect(useUiStore.getState()).toMatchObject({ sidebarVisible: false, railVisible: true })
    useUiStore.getState().setRailVisible(true)
    expect(useUiStore.getState()).toMatchObject({ sidebarVisible: false, railVisible: true })
  })
})

describe('setActiveView', () => {
  it('still toggles the panel when the active view is picked again', () => {
    useUiStore.getState().setActiveView('explorer')
    expect(useUiStore.getState().sidebarVisible).toBe(false)
    useUiStore.getState().setActiveView('explorer')
    expect(useUiStore.getState().sidebarVisible).toBe(true)
  })

  it('un-hides both rail and panel when a new view is activated', () => {
    useUiStore.getState().toggleLeftNav()
    useUiStore.getState().setActiveView('figures')
    expect(useUiStore.getState()).toMatchObject({
      activeView: 'figures',
      sidebarVisible: true,
      railVisible: true
    })
  })
})

describe('persistence', () => {
  it('writes both flags on every visibility change', () => {
    useUiStore.getState().setSidebarVisible(false)
    expect(stored.get('suna.sidebarVisible')).toBe('false')
    expect(stored.get('suna.activityBarVisible')).toBe('true')

    useUiStore.getState().toggleLeftNav()
    expect(stored.get('suna.sidebarVisible')).toBe('false')
    expect(stored.get('suna.activityBarVisible')).toBe('false')
  })

  it('is best-effort: a throwing localStorage does not break the toggle', () => {
    setItemThrows = true
    expect(() => useUiStore.getState().toggleLeftNav()).not.toThrow()
    expect(useUiStore.getState().railVisible).toBe(false)
  })

  it('restores a hidden nav on the next launch', async () => {
    stored.set('suna.sidebarVisible', 'false')
    stored.set('suna.activityBarVisible', 'false')
    vi.resetModules()
    const fresh = await import('./ui')
    expect(fresh.useUiStore.getState()).toMatchObject({
      sidebarVisible: false,
      railVisible: false
    })
  })

  it('degrades a malformed flag to the fallback, not to hidden', async () => {
    // The trap: `raw === 'true'` sends anything unparseable to FALSE, and the
    // app comes up with no rail, no panel, and one 15px button as the way back.
    // Storage is read when a project is adopted (restoreChrome), not at boot:
    // the welcome screen starts collapsed because it has nothing to show.
    stored.set('suna.sidebarVisible', 'True')
    stored.set('suna.activityBarVisible', '1')
    vi.resetModules()
    const fresh = await import('./ui')
    expect(fresh.useUiStore.getState()).toMatchObject({
      sidebarVisible: false,
      railVisible: false
    })
    fresh.useUiStore.getState().restoreChrome()
    expect(fresh.useUiStore.getState()).toMatchObject({
      sidebarVisible: true,
      railVisible: true
    })
  })

  it('never restores a panel with no rail, whatever is in storage', async () => {
    stored.set('suna.sidebarVisible', 'true')
    stored.set('suna.activityBarVisible', 'false')
    vi.resetModules()
    const fresh = await import('./ui')
    fresh.useUiStore.getState().restoreChrome()
    expect(fresh.useUiStore.getState().railVisible).toBe(true)
  })

  it('starts the welcome screen collapsed, without overwriting the preference', async () => {
    stored.set('suna.sidebarVisible', 'true')
    stored.set('suna.activityBarVisible', 'true')
    vi.resetModules()
    const fresh = await import('./ui')
    expect(fresh.useUiStore.getState().sidebarVisible).toBe(false)
    // The collapsed start is a default, never a choice: storage is untouched,
    // so opening a project restores what the user actually set.
    expect(stored.get('suna.sidebarVisible')).toBe('true')
    fresh.useUiStore.getState().restoreChrome()
    expect(fresh.useUiStore.getState().sidebarVisible).toBe(true)
  })
})

describe('toasts', () => {
  it('pushes with the default ttl and dismisses by id', async () => {
    const { useUiStore, TOAST_TTL_DEFAULT_MS } = await import('./ui')
    const id = useUiStore.getState().pushToast('Comment deleted')
    const toast = useUiStore.getState().toasts.find((t) => t.id === id)
    expect(toast).toMatchObject({ message: 'Comment deleted', ttlMs: TOAST_TTL_DEFAULT_MS })
    useUiStore.getState().dismissToast(id)
    expect(useUiStore.getState().toasts.some((t) => t.id === id)).toBe(false)
  })

  it('carries an action and distinct ids', async () => {
    const { useUiStore } = await import('./ui')
    let ran = 0
    const a = useUiStore.getState().pushToast('a', { action: { label: 'Undo', run: () => { ran += 1 } } })
    const b = useUiStore.getState().pushToast('b')
    expect(a).not.toBe(b)
    useUiStore.getState().toasts.find((t) => t.id === a)?.action?.run()
    expect(ran).toBe(1)
    useUiStore.getState().dismissToast(a)
    useUiStore.getState().dismissToast(b)
  })
})

describe('comments rail state', () => {
  it('clamps the width to its bounds and persists it', async () => {
    const { useUiStore, clampCommentsRailWidth } = await import('./ui')
    expect(clampCommentsRailWidth(100)).toBe(260)
    expect(clampCommentsRailWidth(9999)).toBe(520)
    expect(clampCommentsRailWidth(Number.NaN)).toBe(300)
    useUiStore.getState().setCommentsRailWidth(333)
    expect(useUiStore.getState().commentsRailWidth).toBe(333)
  })

  it('toggles visibility and round-trips through storage', async () => {
    const { useUiStore } = await import('./ui')
    const before = useUiStore.getState().commentsRailVisible
    useUiStore.getState().toggleCommentsRail()
    expect(useUiStore.getState().commentsRailVisible).toBe(!before)
    useUiStore.getState().setCommentsRailVisible(true)
    expect(useUiStore.getState().commentsRailVisible).toBe(true)
  })
})
