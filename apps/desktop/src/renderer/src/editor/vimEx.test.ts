import { describe, expect, it, vi } from 'vitest'
import { createExRegistry, NO_WRITE_MESSAGE, NOT_CLOSABLE_MESSAGE } from './vimEx'

/**
 * The seam where `:w` was silently dead: the vim engine's own `write` is
 * `CM.commands.save ?? cm.save()` and the CM6 shim defines neither, so the
 * host has to supply the handler — and because `Vim.defineEx` is process-wide
 * it has to route by the calling view rather than by closure.
 *
 * A plain object stands in for the EditorView: the registry never touches
 * CodeMirror, which is what lets this run without a DOM.
 */
describe('createExRegistry', () => {
  it('runs the save of the view that issued the command, exactly once', () => {
    const registry = createExRegistry()
    const view = {}
    const save = vi.fn()
    registry.register(view, { save })
    registry.save({ cm6: view })
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('keeps two live editors apart', () => {
    const registry = createExRegistry()
    const first = {}
    const second = {}
    const saveFirst = vi.fn()
    const saveSecond = vi.fn()
    registry.register(first, { save: saveFirst })
    registry.register(second, { save: saveSecond })
    registry.save({ cm6: second })
    expect(saveFirst).not.toHaveBeenCalled()
    expect(saveSecond).toHaveBeenCalledTimes(1)
  })

  it('is a silent no-op for a view that never registered', () => {
    const registry = createExRegistry()
    const save = vi.fn()
    registry.register({}, { save })
    expect(() => registry.save({ cm6: {} })).not.toThrow()
    expect(save).not.toHaveBeenCalled()
  })

  it('stops routing to a destroyed editor', () => {
    const registry = createExRegistry()
    const view = {}
    const save = vi.fn()
    registry.register(view, { save })
    registry.unregister(view)
    registry.save({ cm6: view })
    expect(save).not.toHaveBeenCalled()
  })

  it('tolerates an adapter with no cm6 at all', () => {
    const registry = createExRegistry()
    expect(() => registry.save({})).not.toThrow()
    expect(() => registry.close({ cm6: undefined })).not.toThrow()
  })

  it('closes only when the host supplied an onClose, and says so when it did not', () => {
    const registry = createExRegistry()
    const notify = vi.fn()
    registry.setNotify(notify)
    const closeable = {}
    const manuscript = {}
    const close = vi.fn(() => true)
    registry.register(closeable, { save: vi.fn(), close })
    // the manuscript view deliberately omits onClose — `:q` cannot close it
    registry.register(manuscript, { save: vi.fn() })
    registry.close({ cm6: closeable })
    expect(() => registry.close({ cm6: manuscript })).not.toThrow()
    expect(close).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(NOT_CLOSABLE_MESSAGE)
  })

  /**
   * The destructive shape: `:q` used to be wired straight to `api.close()`, so
   * it threw away a buffer that had never been written — while `:wq`, the
   * keystroke that would have saved it, was not registered at all and errored
   * out with "Not an editor command".
   */
  describe('quitting a dirty buffer', () => {
    // A buffer with unsaved changes: it closes only when forced.
    const dirtyEditor = (): { view: object; close: (force: boolean) => boolean } => {
      const view = {}
      const close = vi.fn((force: boolean): boolean => force)
      return { view, close }
    }

    it('refuses `:q` and reports vim`s own message instead of closing', () => {
      const registry = createExRegistry()
      const notify = vi.fn()
      registry.setNotify(notify)
      const { view, close } = dirtyEditor()
      registry.register(view, { save: vi.fn(), close })

      registry.close({ cm6: view })

      expect(close).toHaveBeenCalledWith(false)
      expect(notify).toHaveBeenCalledWith(NO_WRITE_MESSAGE)
    })

    it('lets `:q!` through', () => {
      const registry = createExRegistry()
      const notify = vi.fn()
      registry.setNotify(notify)
      const { view, close } = dirtyEditor()
      registry.register(view, { save: vi.fn(), close })

      registry.close({ cm6: view }, true)

      expect(close).toHaveBeenCalledWith(true)
      expect(notify).not.toHaveBeenCalled()
    })

    it('`:wq` writes first, and only closes once the write has settled', async () => {
      const registry = createExRegistry()
      const order: string[] = []
      const view = {}
      let dirty = true
      registry.register(view, {
        save: async () => {
          await Promise.resolve()
          dirty = false
          order.push('save')
        },
        close: (force) => {
          order.push('close')
          if (dirty && !force) return false
          order.push('closed')
          return true
        }
      })

      registry.saveAndClose({ cm6: view })
      expect(order).toEqual([])
      await vi.waitFor(() => expect(order).toEqual(['save', 'close', 'closed']))
    })

    it('`:wq` does NOT close when the write failed — the buffer is still dirty', async () => {
      const registry = createExRegistry()
      const notify = vi.fn()
      registry.setNotify(notify)
      const { view, close } = dirtyEditor()
      // A host reports a failed write by leaving the buffer dirty; it surfaces
      // its own error, which must not be replaced by ours.
      registry.register(view, { save: async () => undefined, close })

      registry.saveAndClose({ cm6: view })
      await vi.waitFor(() => expect(close).toHaveBeenCalledWith(false))
      expect(notify).not.toHaveBeenCalled()
    })
  })
})
