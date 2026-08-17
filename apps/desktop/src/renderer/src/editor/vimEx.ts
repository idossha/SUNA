/**
 * Per-view handlers for vim's `:` ex commands.
 *
 * `Vim.defineEx` registers ONE handler for the whole process, so it cannot
 * close over a single editor — a module-global `:w` must never save some other
 * tab's file. The engine hands the handler its CM5 adapter, whose `cm6` field
 * is the EditorView that adapter wraps; this maps that view back to the host's
 * callbacks. A miss (an unregistered or already-destroyed view) is silent,
 * because throwing out of an ex command leaves the vim engine mid-command.
 *
 * Deliberately free of any CodeMirror import: the seam where `:w` was dead is
 * then testable in node, and apps/desktop has no jsdom to build a view in.
 * The same goes for the status channel — `notify` is injected by the app so
 * this module does not have to reach into a store — and for `:help`'s
 * destination, which is a store away for exactly the same reason.
 */
export interface ExHandlers {
  save: () => void | Promise<void>
  /**
   * `:q` / `:q!`. Returns true when the surface actually closed, false when it
   * refused — an unsaved buffer, the way real vim answers `:q` with "E37: No
   * write since last change". Omitted by a host that owns its own surface (the
   * combined manuscript view IS the tab), which is reported as such rather
   * than being silently inert.
   */
  close?: (force: boolean) => boolean
}

/** The part of the vim engine's CM5 adapter this module reads. */
interface ExCaller {
  cm6?: unknown
}

export interface ExRegistry {
  register: (view: object, handlers: ExHandlers) => void
  unregister: (view: object) => void
  /** Where a refusal or an explanation is shown. Wired once, by the app. */
  setNotify: (notify: (message: string) => void) => void
  /**
   * What `:help` opens. Wired once, by the app, beside setNotify — the same
   * module that calls `Vim.defineEx('help', …)`, so the command and its
   * destination arrive together.
   */
  setShowHelp: (showHelp: () => void) => void
  /** `:w` — a no-op unless the calling view registered an onSave. */
  save: (cm: ExCaller) => void
  /** `:q` (force = false) and `:q!` (force = true). */
  close: (cm: ExCaller, force?: boolean) => void
  /** `:wq` / `:x` — write, then close once the write has settled. */
  saveAndClose: (cm: ExCaller) => void
  /**
   * `:help` / `:h`. Takes no caller: the shortcut overlay is one app-wide
   * dialog, so unlike `:w` there is nothing to route per view — and a buffer
   * that never registered handlers can still ask for help.
   */
  help: () => void
}

/** Vim's own wording, so the message means the same thing it does in vim. */
export const NO_WRITE_MESSAGE = 'No write since last change — :w to save, or :q! to discard'
export const NOT_CLOSABLE_MESSAGE = ':q — this tab is not a file, so there is nothing to close'

export function createExRegistry(): ExRegistry {
  const byView = new WeakMap<object, ExHandlers>()
  let notify: (message: string) => void = () => undefined
  let showHelp: () => void = () => undefined
  const lookup = (cm: ExCaller): ExHandlers | undefined => {
    const view = cm.cm6
    return typeof view === 'object' && view !== null ? byView.get(view) : undefined
  }
  const quit = (handlers: ExHandlers, force: boolean): void => {
    if (handlers.close === undefined) {
      notify(NOT_CLOSABLE_MESSAGE)
      return
    }
    if (!handlers.close(force)) notify(NO_WRITE_MESSAGE)
  }
  return {
    register: (view, handlers) => {
      byView.set(view, handlers)
    },
    unregister: (view) => {
      byView.delete(view)
    },
    setNotify: (next) => {
      notify = next
    },
    setShowHelp: (next) => {
      showHelp = next
    },
    save: (cm) => {
      void lookup(cm)?.save()
    },
    close: (cm, force = false) => {
      const handlers = lookup(cm)
      if (handlers !== undefined) quit(handlers, force)
    },
    saveAndClose: (cm) => {
      const handlers = lookup(cm)
      if (handlers === undefined) return
      // Awaited, not fired-and-forgotten: closing the panel first would unmount
      // the view whose document the write is still reading.
      //
      // And NOT forced. A host's `save` reports failure by leaving the buffer
      // dirty (it surfaces its own error), so an unforced close is what stops
      // `:wq` from discarding a buffer whose write did not land — real vim
      // refuses to quit there too. No notify on that path: the save's own
      // "Could not save …" message is the better one to leave on screen.
      void Promise.resolve(handlers.save())
        .then(() => {
          if (handlers.close === undefined) notify(NOT_CLOSABLE_MESSAGE)
          else handlers.close(false)
        })
        .catch(() => undefined)
    },
    help: () => {
      showHelp()
    }
  }
}

/** Shared by every editor in the renderer, since `defineEx` is process-wide. */
export const exRegistry = createExRegistry()
