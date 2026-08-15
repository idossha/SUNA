import { describe, expect, it } from 'vitest'
import type { FsNode } from '@suna/core'
import {
  getCommand,
  isCommandEnabled,
  listCommands,
  nextFigureName,
  nextProfileId,
  registerCommand,
  runCommand,
  type Command
} from './commands'

/**
 * The built-ins register themselves as a side effect of importing this
 * module (by design — see the module doc). These tests exercise the
 * REGISTRY mechanics with ad hoc commands under unique ids, so they never
 * collide with (or depend on) the built-ins' own app-store wiring.
 */

function makeCommand(overrides: Partial<Command> & { id: string }): Command {
  return {
    title: overrides.title ?? overrides.id,
    category: overrides.category ?? 'Test',
    run: overrides.run ?? (() => {}),
    ...overrides
  }
}

describe('registerCommand / listCommands / getCommand', () => {
  it('registers a command and makes it findable by id and in the full list', () => {
    const unregister = registerCommand(makeCommand({ id: 'test.one', title: 'Test One' }))
    try {
      expect(getCommand('test.one')?.title).toBe('Test One')
      expect(listCommands().some((c) => c.id === 'test.one')).toBe(true)
    } finally {
      unregister()
    }
  })

  it('unregister removes exactly the command it was returned for', () => {
    const unregister = registerCommand(makeCommand({ id: 'test.two' }))
    unregister()
    expect(getCommand('test.two')).toBeUndefined()
  })

  it('re-registering the same id replaces the earlier command', () => {
    const unregisterFirst = registerCommand(makeCommand({ id: 'test.three', title: 'First' }))
    const unregisterSecond = registerCommand(makeCommand({ id: 'test.three', title: 'Second' }))
    try {
      expect(getCommand('test.three')?.title).toBe('Second')
      // the first unregister call is stale (a different object is now registered) and must not evict the second
      unregisterFirst()
      expect(getCommand('test.three')?.title).toBe('Second')
    } finally {
      unregisterSecond()
    }
  })

  it('includes the built-in app commands registered by this module', () => {
    const ids = listCommands().map((c) => c.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'split.right',
        'split.down',
        'figure.new',
        'terminal.toggle',
        'terminal.focus',
        'settings.open',
        'figure.compliance',
        'figure.export.png',
        'figure.export.pdf',
        'manuscript.open',
        'profile.switch'
      ])
    )
  })

  it('gives the split commands their documented shortcuts and no others double-book them', () => {
    expect(getCommand('split.right')?.shortcut).toBe('Mod-Backslash')
    expect(getCommand('split.down')?.shortcut).toBe('Mod-Shift-Backslash')
    // terminal.toggle deliberately has none — TerminalPanel owns Ctrl-` itself
    expect(getCommand('terminal.toggle')?.shortcut).toBeUndefined()
  })
})

describe('isCommandEnabled', () => {
  it('defaults to enabled when `enabled` is omitted', () => {
    expect(isCommandEnabled(makeCommand({ id: 'test.four' }))).toBe(true)
  })

  it('defers to `enabled()` when present', () => {
    expect(isCommandEnabled(makeCommand({ id: 'test.five', enabled: () => false }))).toBe(false)
    expect(isCommandEnabled(makeCommand({ id: 'test.six', enabled: () => true }))).toBe(true)
  })
})

describe('runCommand', () => {
  it('runs a registered, enabled command and reports that it ran', async () => {
    let ran = false
    const unregister = registerCommand(makeCommand({ id: 'test.seven', run: () => { ran = true } }))
    try {
      expect(await runCommand('test.seven')).toBe(true)
      expect(ran).toBe(true)
    } finally {
      unregister()
    }
  })

  it('awaits an async run()', async () => {
    let ran = false
    const unregister = registerCommand(
      makeCommand({
        id: 'test.eight',
        run: async () => {
          await Promise.resolve()
          ran = true
        }
      })
    )
    try {
      await runCommand('test.eight')
      expect(ran).toBe(true)
    } finally {
      unregister()
    }
  })

  it('does not run a disabled command, and reports that it did not run', async () => {
    let ran = false
    const unregister = registerCommand(
      makeCommand({ id: 'test.nine', enabled: () => false, run: () => { ran = true } })
    )
    try {
      expect(await runCommand('test.nine')).toBe(false)
      expect(ran).toBe(false)
    } finally {
      unregister()
    }
  })

  it('is false for an unknown id, without throwing', async () => {
    expect(await runCommand('test.does-not-exist')).toBe(false)
  })
})

describe('nextFigureName', () => {
  it('numbers the next figure by how many already exist', () => {
    const empty: FsNode = { kind: 'dir', name: 'root', path: '/p', children: [] }
    expect(nextFigureName(empty)).toBe('Figure 1')
    expect(nextFigureName(null)).toBe('Figure 1')

    const withOne: FsNode = {
      kind: 'dir',
      name: 'root',
      path: '/p',
      children: [
        {
          kind: 'dir',
          name: 'figures',
          path: '/p/figures',
          children: [
            {
              kind: 'dir',
              name: 'fig-spectrum',
              path: '/p/figures/fig-spectrum',
              children: [{ kind: 'file', name: 'figure.svg', path: '/p/figures/fig-spectrum/figure.svg' }]
            }
          ]
        }
      ]
    }
    expect(nextFigureName(withOne)).toBe('Figure 2')
  })
})

describe('nextProfileId', () => {
  it('cycles forward through the bundled profiles and wraps around', () => {
    expect(nextProfileId('nature-astronomy')).toBe('science')
    expect(nextProfileId('science')).toBe('apj-aas')
    expect(nextProfileId('apj-aas')).toBe('mnras')
    expect(nextProfileId('mnras')).toBe('nature-astronomy')
  })
})
