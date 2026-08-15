/**
 * Command palette (feature-plan-4 §5): one popup over everything, opened
 * with Mod-K (Mod-Shift-P opens it straight into '>' command mode). Modes by
 * prefix — none: fuzzy file search; `>`: app commands; `$`: run a line in the
 * integrated terminal; `?`: ask the agent CLI — are decided by
 * `palette/prefix.ts`. This component owns rendering, keyboard handling, and
 * the mode-specific side effects (opening files, running commands, driving
 * the terminal, driving 'ai:ask'); the pure decision logic it calls into
 * (fuzzy.ts, prefix.ts, recents.ts, shortcuts.ts) is unit-tested separately —
 * the repo has no jsdom/React test harness, so this file itself is verified
 * by type-checking plus the selectors below for a smoke/e2e driver.
 *
 * Selectors: `.palette-backdrop` (click to close), `.palette` (the dialog),
 * `.palette__input`, `.palette__hint`, `.palette__list`, `.palette__item`
 * (one row; `.palette__item--active` is the keyboard-highlighted one),
 * `.palette__empty` (no matches / loading), `.palette__status` (terminal/ai
 * mode message area), `.palette__answer` (the ai answer text),
 * `.palette__actions` (Cancel/Dismiss row).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react'
import { isCommandEnabled, listCommands, runCommand, type Command } from '../state/commands'
import { useAgentChatStore } from '../state/agentChat'
import { openFileTab, openInSplit } from '../state/dock'
import { useProjectStore } from '../state/project'
import { useUiStore } from '../state/ui'
import { openTerminalWithCommand } from '../terminal/sessions'
import { startAiAsk, type AiAskHandle } from './aiAsk'
import { collectFiles, type PaletteFileEntry } from './files'
import { fuzzyFilter } from './fuzzy'
import { PALETTE_HINT, parsePaletteInput, type PaletteMode } from './prefix'
import { loadRecents, pushRecent, saveRecents, type RecentEntry } from './recents'
import { formatShortcut, matchesShortcut } from './shortcuts'
import './palette.css'

const FILE_RESULTS_CAP = 50

interface Row {
  key: string
  label: string
  sublabel: string | null
  shortcut: string | null
  activate: (side: boolean) => void
}

type AiPhase =
  | { kind: 'idle' }
  | { kind: 'busy'; prompt: string; status: string; handle: AiAskHandle }
  | { kind: 'done'; prompt: string; text: string | null; error: string | null }

function truncate(text: string, n: number): string {
  const trimmed = text.trim()
  return trimmed.length <= n ? trimmed : `${trimmed.slice(0, n - 1)}…`
}

export function CommandPalette(): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [files, setFiles] = useState<PaletteFileEntry[]>([])
  const [recents, setRecents] = useState<RecentEntry[]>([])
  const [ai, setAi] = useState<AiPhase>({ kind: 'idle' })

  const inputRef = useRef<HTMLInputElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  /** Whichever of the Cancel/Dismiss buttons is currently rendered (never both at once). */
  const actionButtonRef = useRef<HTMLButtonElement | null>(null)
  const aiRef = useRef<AiPhase>(ai)
  aiRef.current = ai

  const rootDir = useProjectStore((s) => s.rootDir)
  const tree = useProjectStore((s) => s.tree)

  const reset = useCallback(() => {
    setRaw('')
    setActiveIndex(0)
    setAi({ kind: 'idle' })
  }, [])

  const close = useCallback(() => {
    if (aiRef.current.kind === 'busy') aiRef.current.handle.cancel()
    setOpen(false)
    reset()
  }, [reset])

  const openWith = useCallback(
    (initialRaw: string) => {
      reset()
      setRaw(initialRaw)
      setFiles(collectFiles(tree, rootDir))
      if (rootDir !== null) void loadRecents(rootDir).then(setRecents)
      else setRecents([])
      setOpen(true)
    },
    [reset, tree, rootDir]
  )

  // Global shortcuts: Mod-K opens (files/recents), Mod-Shift-P opens straight
  // into '>' command mode. `defaultPrevented` lets a focused editor's own
  // keymap (e.g. ⌘K = Insert Link) win the race — it calls preventDefault
  // before this bubbles to window, so the palette only opens when nothing
  // more specific already claimed the key. Only armed while CLOSED; while
  // open the palette's own input handles every key itself.
  useEffect(() => {
    if (open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      if (matchesShortcut(event, 'Mod-KeyK')) {
        event.preventDefault()
        openWith('')
        return
      }
      if (matchesShortcut(event, 'Mod-Shift-KeyP')) {
        event.preventDefault()
        openWith('>')
        return
      }
      for (const command of listCommands()) {
        if (command.shortcut === undefined) continue
        if (!matchesShortcut(event, command.shortcut)) continue
        if (!isCommandEnabled(command)) continue
        event.preventDefault()
        void command.run()
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, openWith])

  // Keep DOM focus INSIDE the dialog at every phase transition. Disabling
  // the input (ai busy/done) auto-blurs it to `document.body` — a keydown
  // fired there would never bubble into `.palette`'s onKeyDown (body isn't a
  // descendant of the dialog), silently breaking Escape/Enter — so focus
  // moves to the action button instead; dismissing back to idle returns it
  // to the input.
  useEffect(() => {
    if (!open) return
    if (ai.kind === 'idle') inputRef.current?.focus()
    else actionButtonRef.current?.focus()
  }, [open, ai.kind])

  // Minimal focus trap: Tab cycles only among elements marked focusable
  // inside the dialog, never escaping to the app behind it.
  useEffect(() => {
    if (!open) return
    const container = containerRef.current
    if (!container) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>('[data-palette-focusable]')
      )
      event.preventDefault()
      if (focusables.length === 0) return
      const current = focusables.indexOf(document.activeElement as HTMLElement)
      const next = event.shiftKey
        ? (current - 1 + focusables.length) % focusables.length
        : (current + 1) % focusables.length
      focusables[next]?.focus()
    }
    container.addEventListener('keydown', onKeyDown)
    return () => container.removeEventListener('keydown', onKeyDown)
  }, [open])

  const parsed = useMemo(() => parsePaletteInput(raw), [raw])
  const showingRecents = raw === ''

  const recordRecent = useCallback(
    (entry: RecentEntry) => {
      setRecents((prev) => {
        const next = pushRecent(prev, entry)
        if (rootDir !== null) void saveRecents(rootDir, next)
        return next
      })
    },
    [rootDir]
  )

  const activateFile = useCallback(
    (path: string, side: boolean, remember: boolean) => {
      if (side) openInSplit(path, 'right')
      else openFileTab(path)
      if (remember) {
        const name = path.split('/').pop() ?? path
        recordRecent({ kind: 'file', value: path, label: name, at: Date.now() })
      }
      close()
    },
    [close, recordRecent]
  )

  const activateCommand = useCallback(
    (command: Command) => {
      void runCommand(command.id)
      recordRecent({ kind: 'command', value: command.id, label: command.title, at: Date.now() })
      close()
    },
    [close, recordRecent]
  )

  const activateTerminal = useCallback(
    (line: string) => {
      const trimmed = line.trim()
      if (trimmed === '') return
      // "create-or-reuse a tab" (feature-plan-4 §5): sessions.ts exposes no
      // way to write into an already-running session from outside itself, so
      // this reuses the PANEL (never re-toggles it shut) and always starts a
      // fresh tab+pty for the command, via sessions.ts's own exported
      // `openTerminalWithCommand` — the strongest reuse available without
      // editing that file.
      openTerminalWithCommand(trimmed)
      recordRecent({ kind: 'terminal', value: trimmed, label: `$ ${trimmed}`, at: Date.now() })
      close()
    },
    [close, recordRecent]
  )

  const startAi = useCallback(
    (prompt: string) => {
      const trimmed = prompt.trim()
      if (trimmed === '' || rootDir === null) return
      recordRecent({ kind: 'ai', value: trimmed, label: `? ${truncate(trimmed, 60)}`, at: Date.now() })
      // The real cancel handle only exists once 'ai:ask' round-trips back
      // with an askId; a Cancel click in that brief window must still kill
      // the child once it arrives, rather than silently no-op-ing, so the
      // placeholder handle just records the request for the `.then` below.
      let cancelRequested = false
      setAi({
        kind: 'busy',
        prompt: trimmed,
        status: 'Starting…',
        handle: {
          cancel: () => {
            cancelRequested = true
          }
        }
      })
      void startAiAsk(
        trimmed,
        rootDir,
        (status) => {
          setAi((s) => (s.kind === 'busy' ? { ...s, status } : s))
        },
        (outcome) => {
          setAi((s) => (s.kind === 'busy' ? { kind: 'done', prompt: s.prompt, ...outcome } : s))
          if (outcome.text !== null) {
            useAgentChatStore.getState().pushExternalExchange(trimmed, outcome.text)
          }
        }
      ).then((handle) => {
        if (cancelRequested) {
          handle.cancel()
          return
        }
        setAi((s) => (s.kind === 'busy' ? { ...s, handle } : s))
      })
    },
    [rootDir, recordRecent]
  )

  const relOf = (absolute: string): string => {
    if (rootDir === null) return absolute
    const prefix = rootDir.endsWith('/') ? rootDir : `${rootDir}/`
    return absolute.startsWith(prefix) ? absolute.slice(prefix.length) : absolute
  }

  const recentRows: Row[] = recents.map((entry) => ({
    key: `recent:${entry.kind}:${entry.value}`,
    label: entry.label,
    sublabel: entry.kind === 'file' ? relOf(entry.value) : null,
    shortcut: null,
    activate: (side) => {
      if (entry.kind === 'file') {
        activateFile(entry.value, side, false)
        return
      }
      if (entry.kind === 'command') {
        const command = listCommands().find((c) => c.id === entry.value)
        if (command && isCommandEnabled(command)) activateCommand(command)
        else close()
        return
      }
      if (entry.kind === 'terminal') {
        activateTerminal(entry.value)
        return
      }
      // ai: re-running a paid agent call from a single click on history would
      // be surprising, so this only re-opens ai mode with the prompt
      // prefilled — Enter re-submits it explicitly. The clicked row is about
      // to unmount (ai mode shows no list), so reclaim focus onto the input
      // rather than leaving it to fall back to `document.body`.
      setRaw(`?${entry.value}`)
      inputRef.current?.focus()
    }
  }))

  // Matched and shown by PROJECT-RELATIVE path: every file shares the same
  // absolute prefix, so scoring absolute paths lets a short query match the
  // prefix and return the whole project (see palette/files.ts).
  const fileRows: Row[] = fuzzyFilter(files, parsed.query, (f) => f.rel)
    .slice(0, FILE_RESULTS_CAP)
    .map(({ item }) => ({
      key: item.path,
      label: item.name,
      sublabel: item.rel,
      shortcut: null,
      activate: (side) => activateFile(item.path, side, true)
    }))

  const commandRows: Row[] = fuzzyFilter(
    listCommands().filter(isCommandEnabled),
    parsed.query,
    (c) => `${c.title} ${c.category}`
  ).map(({ item }) => ({
    key: item.id,
    label: item.title,
    sublabel: item.category,
    shortcut: item.shortcut ?? null,
    activate: () => activateCommand(item)
  }))

  const rows: Row[] = showingRecents
    ? recentRows
    : parsed.mode === 'files'
      ? fileRows
      : parsed.mode === 'commands'
        ? commandRows
        : []

  useEffect(() => {
    setActiveIndex(0)
  }, [raw])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (ai.kind !== 'idle') {
      if (event.key === 'Enter' && ai.kind === 'done') {
        event.preventDefault()
        reset()
      }
      return
    }
    if (event.key === 'ArrowDown' && rows.length > 0) {
      event.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, rows.length - 1))
      return
    }
    if (event.key === 'ArrowUp' && rows.length > 0) {
      event.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (parsed.mode === 'terminal') {
        activateTerminal(parsed.query)
        return
      }
      if (parsed.mode === 'ai') {
        startAi(parsed.query)
        return
      }
      const row = rows[activeIndex]
      if (row) row.activate(event.metaKey || event.ctrlKey)
    }
  }

  if (!open) return null

  const modeLabel: Record<PaletteMode, string> = {
    files: 'Files',
    commands: 'Commands',
    terminal: 'Terminal',
    ai: 'Ask'
  }

  return (
    <div className="palette-backdrop" onMouseDown={close}>
      <div
        ref={containerRef}
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e: ReactMouseEvent) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          data-palette-focusable
          className="palette__input"
          placeholder="Search files… (> commands, $ terminal, ? ask)"
          value={raw}
          disabled={ai.kind !== 'idle'}
          onChange={(e) => setRaw(e.target.value)}
        />
        <div className="palette__hint">
          {showingRecents ? 'Recent' : modeLabel[parsed.mode]} · {PALETTE_HINT}
        </div>

        {ai.kind === 'idle' && (
          <>
            {parsed.mode === 'terminal' && (
              <div className="palette__status">
                Press Enter to run <code>{parsed.query || '…'}</code> in the terminal.
              </div>
            )}
            {parsed.mode === 'ai' && (
              <div className="palette__status">
                Press Enter to ask the agent CLI: <code>{parsed.query || '…'}</code>
              </div>
            )}
            {(parsed.mode === 'files' || parsed.mode === 'commands' || showingRecents) && (
              <div className="palette__list">
                {rows.length === 0 && (
                  <div className="palette__empty">
                    {showingRecents ? 'No recent activity yet.' : 'No matches.'}
                  </div>
                )}
                {rows.map((row, i) => (
                  <button
                    key={row.key}
                    type="button"
                    className={
                      i === activeIndex ? 'palette__item palette__item--active' : 'palette__item'
                    }
                    tabIndex={-1}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={(e) => row.activate(e.metaKey || e.ctrlKey)}
                  >
                    <span className="palette__item-label">{row.label}</span>
                    {row.sublabel !== null && (
                      <span className="palette__item-sub">{row.sublabel}</span>
                    )}
                    {row.shortcut !== null && (
                      <span className="palette__item-shortcut">{formatShortcut(row.shortcut)}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {ai.kind === 'busy' && (
          <div className="palette__status">
            <div>{ai.status}</div>
            <div className="palette__actions">
              <button
                ref={actionButtonRef}
                type="button"
                data-palette-focusable
                className="palette__button"
                onClick={() => {
                  ai.handle.cancel()
                  reset()
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {ai.kind === 'done' && (
          <div className="palette__status">
            {ai.error !== null && <div className="palette__answer palette__answer--error">{ai.error}</div>}
            {ai.error === null && <div className="palette__answer">{ai.text}</div>}
            <div className="palette__actions">
              <button
                ref={actionButtonRef}
                type="button"
                data-palette-focusable
                className="palette__button"
                onClick={() => reset()}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
