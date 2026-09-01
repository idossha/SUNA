import { afterEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '../state/ui'
import {
  OS_ACTION_SHORTCUTS,
  openWithOs,
  osActionFailureNote,
  osActionLabels,
  revealInOs
} from './os-actions'

/**
 * These tests stop at the IPC boundary on purpose (ARCHITECTURE §5.3): a real
 * `shell:reveal` would pop a Finder window onto the developer's screen, which
 * is exactly what the hidden-driver work exists to prevent. The stub below
 * stands in for the preload bridge, so what is asserted here is the channel
 * name, the payload, and what the user is told when main says no.
 */
function stubInvoke(reply: (channel: string) => Promise<{ error: string | null }>): {
  calls: { channel: string; request: unknown }[]
} {
  const calls: { channel: string; request: unknown }[] = []
  vi.stubGlobal('window', {
    suna: {
      invoke: (channel: string, request: unknown) => {
        calls.push({ channel, request })
        return reply(channel)
      }
    }
  })
  return { calls }
}

afterEach(() => {
  vi.unstubAllGlobals()
  useUiStore.setState({ statusNote: null })
})

describe('osActionLabels', () => {
  it('names the actual file manager on macOS', () => {
    expect(osActionLabels('darwin').reveal).toBe('Reveal in Finder')
  })

  it('falls back to neutral wording rather than guessing at a Linux file manager', () => {
    expect(osActionLabels('linux').reveal).toBe('Show in File Manager')
    expect(osActionLabels('freebsd').reveal).toBe('Show in File Manager')
    expect(osActionLabels('').reveal).toBe('Show in File Manager')
  })

  it('keeps the open label platform-neutral — it names what the OS does', () => {
    for (const platform of ['darwin', 'linux']) {
      expect(osActionLabels(platform).open).toBe('Open with Default App')
    }
  })
})

describe('OS_ACTION_SHORTCUTS', () => {
  it('are the two chords the plan binds, as shortcut specs', () => {
    expect(OS_ACTION_SHORTCUTS.reveal).toBe('Mod-Alt-KeyR')
    expect(OS_ACTION_SHORTCUTS.open).toBe('Mod-Alt-KeyO')
  })
})

describe('osActionFailureNote', () => {
  it('names the file, not the whole path', () => {
    expect(osActionFailureNote('open', '/a/b/c/fig.svg', 'refusing to open an executable file')).toBe(
      'Could not open fig.svg: refusing to open an executable file'
    )
    expect(osActionFailureNote('reveal', '/a/b/c/fig.svg', 'outside the project')).toBe(
      'Could not reveal fig.svg: outside the project'
    )
  })

  it('handles a trailing separator', () => {
    expect(osActionFailureNote('reveal', '/a/b/data/', 'nope')).toBe('Could not reveal data: nope')
  })

  it('leaves a bare name alone', () => {
    expect(osActionFailureNote('open', 'notes.md', 'nope')).toBe('Could not open notes.md: nope')
  })
})

describe('revealInOs / openWithOs', () => {
  it('call their own channel with the path, and report success', async () => {
    const { calls } = stubInvoke(() => Promise.resolve({ error: null }))

    expect(await revealInOs('/root/data/fig.svg')).toBe(true)
    expect(await openWithOs('/root/data/fig.svg')).toBe(true)

    expect(calls).toEqual([
      { channel: 'shell:reveal', request: { path: '/root/data/fig.svg' } },
      { channel: 'shell:open-path', request: { path: '/root/data/fig.svg' } }
    ])
    expect(useUiStore.getState().statusNote).toBeNull()
  })

  it("surfaces main's refusal as a status note naming the file", async () => {
    stubInvoke(() => Promise.resolve({ error: 'refusing to open an executable file' }))

    expect(await openWithOs('/root/scripts/cleanup.command')).toBe(false)
    expect(useUiStore.getState().statusNote).toBe(
      'Could not open cleanup.command: refusing to open an executable file'
    )
  })

  // main throws on a path outside the project root; the invoke rejects rather
  // than resolving with an `error`, and it is the same "no" to the user.
  it('reports a rejected invoke the same way', async () => {
    stubInvoke(() => Promise.reject(new Error('path escapes the project root')))

    expect(await revealInOs('/elsewhere/secrets.txt')).toBe(false)
    expect(useUiStore.getState().statusNote).toBe(
      'Could not reveal secrets.txt: path escapes the project root'
    )
  })
})
