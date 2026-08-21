import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as sessions from '../../terminal/sessions'
import {
  restoreFloatTerminal,
  screenAskCommand,
  screenAskTarget,
  shellQuote,
  useFloatTerminalStore
} from './screenask'

describe('screenAskTarget', () => {
  it('sends a dev run at the SUNA checkout, even with a project open', () => {
    expect(screenAskTarget({ isDev: true, repoRoot: '/src/SUNA', rootDir: '/w/paper' })).toEqual({
      target: 'repo',
      cwd: '/src/SUNA'
    })
  })

  it('sends a packaged run at the open project', () => {
    expect(screenAskTarget({ isDev: false, repoRoot: null, rootDir: '/w/paper' })).toEqual({
      target: 'project',
      cwd: '/w/paper'
    })
  })

  it('falls back to the project when a dev run has no checkout to point at', () => {
    expect(screenAskTarget({ isDev: true, repoRoot: null, rootDir: '/w/paper' })).toEqual({
      target: 'project',
      cwd: '/w/paper'
    })
  })

  it('refuses rather than running an agent in an arbitrary directory', () => {
    expect(screenAskTarget({ isDev: false, repoRoot: null, rootDir: null })).toBeNull()
  })
})

describe('shellQuote', () => {
  it('quotes an ordinary path', () => {
    expect(shellQuote('/w/paper')).toBe("'/w/paper'")
  })

  it('survives an apostrophe in a directory name', () => {
    expect(shellQuote("/w/ido's papers")).toBe(`'/w/ido'\\''s papers'`)
  })

  it('leaves spaces and $ inert inside the quotes', () => {
    expect(shellQuote('/w/my $HOME/x')).toBe("'/w/my $HOME/x'")
  })
})

describe('screenAskCommand', () => {
  it('cds to the target root and feeds the prompt file in as the first turn', () => {
    expect(screenAskCommand('/w/paper', '/w/paper/.suna/screen-asks/x/prompt.md', 'claude')).toBe(
      `cd '/w/paper' && claude "$(cat '/w/paper/.suna/screen-asks/x/prompt.md')"`
    )
  })

  it('keeps the substitution double-quoted, so newlines in the prompt survive', () => {
    const command = screenAskCommand('/w/p', '/w/p/prompt.md', 'claude')
    expect(command).toContain('"$(cat')
    expect(command.endsWith('")')).toBe(false)
  })
})

/**
 * The reload path. These cover the actual regression: ptys outlive the
 * renderer, so a remembered session must come back — and one main has
 * forgotten must be forgotten here too, loudly enough to leave a note.
 */
describe('restoreFloatTerminal', () => {
  // These renderer tests run without a DOM, and the reload path is defined
  // by what survives in localStorage — so stub exactly that much of `window`.
  beforeEach(() => {
    const store = new Map<string, string>()
    ;(globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key)
      }
    }
    useFloatTerminalStore.setState({
      termId: null,
      bundleDir: null,
      minimized: false,
      lostBundleDir: null
    })
    vi.restoreAllMocks()
  })

  it('does nothing when no session was remembered', async () => {
    const adopt = vi.spyOn(sessions, 'adoptTerminalTab')
    await restoreFloatTerminal()
    expect(adopt).not.toHaveBeenCalled()
    expect(useFloatTerminalStore.getState().termId).toBeNull()
  })

  it('reattaches a pty that survived the reload', async () => {
    window.localStorage.setItem(
      'suna.floatTerminal.session',
      JSON.stringify({ ptyId: 'term-3', bundleDir: '/w/paper/.suna/screen-asks/x' })
    )
    vi.spyOn(sessions, 'adoptTerminalTab').mockResolvedValue('term7')
    await restoreFloatTerminal()
    expect(useFloatTerminalStore.getState()).toMatchObject({
      termId: 'term7',
      bundleDir: '/w/paper/.suna/screen-asks/x',
      minimized: false
    })
  })

  it('forgets a dead pty and keeps a pointer to its bundle', async () => {
    window.localStorage.setItem(
      'suna.floatTerminal.session',
      JSON.stringify({ ptyId: 'term-3', bundleDir: '/w/paper/.suna/screen-asks/x' })
    )
    vi.spyOn(sessions, 'adoptTerminalTab').mockResolvedValue(null)
    await restoreFloatTerminal()
    expect(useFloatTerminalStore.getState().termId).toBeNull()
    expect(useFloatTerminalStore.getState().lostBundleDir).toBe('/w/paper/.suna/screen-asks/x')
    expect(window.localStorage.getItem('suna.floatTerminal.session')).toBeNull()
  })
})
