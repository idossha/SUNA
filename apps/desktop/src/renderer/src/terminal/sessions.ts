import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { create } from 'zustand'
import { useProjectStore } from '../state/project'
import { useEnvsStore } from '../state/envs'
import { useSettingsStore } from '../state/settings'
import { useTerminalPanelStore } from '../state/terminal'
import '@xterm/xterm/css/xterm.css'

/**
 * Terminal sessions live at MODULE scope (flux pattern): each session owns a
 * detached host <div> with its xterm opened into it once. The panel merely
 * appends the active session's host on mount and removes it on unmount, so
 * shells and scrollback survive panel toggles and tab switches. React sees
 * only the lightweight tab metadata below.
 */
export type TermStatus = 'starting' | 'running' | 'exited' | 'failed'

/**
 * Which chrome hosts a session. 'panel' tabs are the bottom strip's; 'float'
 * ones belong to a floating window that owns exactly one session (the
 * screen-ask terminal) and must not appear in — or steal focus from — the
 * strip's tab row. Both kinds are real ptys in the same map, so every
 * attach/fit/close path below is shared.
 */
export type TermSurface = 'panel' | 'float'

export interface TermTab {
  id: string
  title: string
  status: TermStatus
  surface: TermSurface
}

/** The strip's own tabs. `activeId` only ever names one of these. */
export function panelTabs(tabs: readonly TermTab[]): TermTab[] {
  return tabs.filter((tab) => tab.surface === 'panel')
}

interface TerminalTabsState {
  tabs: TermTab[]
  activeId: string | null
}

export const useTerminalTabsStore = create<TerminalTabsState>(() => ({
  tabs: [],
  activeId: null
}))

interface Session {
  id: string
  ptyId: string | null
  term: Terminal
  fit: FitAddon
  host: HTMLDivElement
  opened: boolean
  startRequested: boolean
  /** Typed into the pty (with a newline) right after the shell starts. */
  pendingCommand: string | null
  disposers: Array<() => void>
}

const sessions = new Map<string, Session>()
let seq = 0

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value === '' ? fallback : value
}

/** xterm theme from the SUNA tokens: chrome bg, ink fg, gold cursor. */
function buildTheme(): { background: string; foreground: string; cursor: string; cursorAccent: string; selectionBackground: string } {
  return {
    background: token('--s-bg-chrome', '#101014'),
    foreground: token('--s-ink', '#e8e6e1'),
    cursor: token('--s-accent', '#e8b45c'),
    cursorAccent: token('--s-bg-chrome', '#101014'),
    selectionBackground: 'rgba(232, 180, 92, 0.25)'
  }
}

function patchTab(id: string, patch: Partial<TermTab>): void {
  useTerminalTabsStore.setState((s) => ({
    tabs: s.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab))
  }))
}

function defaultTitle(): string {
  const override = useSettingsStore.getState().settings['terminal.shell'].trim()
  if (override === '') return 'shell'
  const base = override.split('/').pop()
  return base === undefined || base === '' ? 'shell' : base
}

async function resolveEnvPath(rootDir: string | null): Promise<string | null> {
  if (rootDir === null) return null
  const envState = useEnvsStore.getState()
  if (envState.dir === rootDir) return envState.selectedPath
  try {
    const { envPath } = await window.suna.invoke('env:selected', { dir: rootDir })
    return envPath
  } catch {
    return null
  }
}

async function startPty(session: Session): Promise<void> {
  const rootDir = useProjectStore.getState().rootDir
  // '~' is the no-project sentinel; the main process expands it to the home dir.
  const cwd = rootDir ?? '~'
  const envPath = await resolveEnvPath(rootDir)
  try {
    const { id: ptyId } = await window.suna.invoke('term:create', {
      cwd,
      cols: session.term.cols,
      rows: session.term.rows,
      envPath
    })
    session.ptyId = ptyId
    patchTab(session.id, { status: 'running' })

    session.disposers.push(
      window.suna.onTermData(ptyId, (data) => session.term.write(data)),
      window.suna.onTermExit(ptyId, (exit) => {
        session.ptyId = null
        patchTab(session.id, { status: 'exited' })
        session.term.write(
          `\r\n\u001b[90m[process exited · code ${exit.exitCode ?? 0}] — close the tab or open a new one\u001b[0m\r\n`
        )
      })
    )
    const input = session.term.onData((data) => {
      if (session.ptyId !== null) {
        void window.suna.invoke('term:write', { id: session.ptyId, data }).catch(() => {})
      }
    })
    session.disposers.push(() => input.dispose())

    if (session.pendingCommand !== null) {
      const command = session.pendingCommand
      session.pendingCommand = null
      void window.suna.invoke('term:write', { id: ptyId, data: `${command}\r` }).catch(() => {})
    }
  } catch (error) {
    patchTab(session.id, { status: 'failed' })
    const message = error instanceof Error ? error.message : String(error)
    session.term.write(`\r\n\u001b[31mTerminal backend unavailable: ${message}\u001b[0m\r\n`)
  }
}

/** Create a terminal tab (and make it active). The pty starts on first attach. */
export function createTerminalTab(
  options: { command?: string; title?: string; surface?: TermSurface } = {}
): string {
  const id = `term${++seq}`
  const host = document.createElement('div')
  host.className = 'termpanel__host'

  const term = new Terminal({
    fontFamily: token('--s-font-mono', "'SF Mono', Menlo, Consolas, monospace"),
    fontSize: 12,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 5000,
    macOptionIsMeta: true,
    theme: buildTheme()
  })
  // Ctrl-` is the app-level panel toggle; keep xterm from swallowing it.
  term.attachCustomKeyEventHandler((event) => {
    if (event.ctrlKey && !event.metaKey && !event.altKey && event.code === 'Backquote') {
      return false
    }
    return true
  })
  const fit = new FitAddon()
  term.loadAddon(fit)

  const session: Session = {
    id,
    ptyId: null,
    term,
    fit,
    host,
    opened: false,
    startRequested: false,
    pendingCommand: options.command ?? null,
    disposers: []
  }
  sessions.set(id, session)
  const surface = options.surface ?? 'panel'
  useTerminalTabsStore.setState((s) => ({
    tabs: [
      ...s.tabs,
      { id, title: options.title ?? options.command ?? defaultTitle(), status: 'starting', surface }
    ],
    // A float session has its own window and never becomes the strip's front
    // tab — making it active would leave the strip trying to mount a host
    // that is already parented to the floating window.
    activeId: surface === 'panel' ? id : s.activeId
  }))
  return id
}

/** Open the panel and start a terminal that immediately runs `command`. */
export function openTerminalWithCommand(command: string, title?: string): string {
  useTerminalPanelStore.getState().setOpen(true)
  return createTerminalTab({ command, title: title ?? command })
}

export function setActiveTerminalTab(id: string): void {
  if (sessions.has(id)) useTerminalTabsStore.setState({ activeId: id })
}

/** Mount a session's host into `container` (moves it if mounted elsewhere). */
export function attachSession(id: string, container: HTMLElement): void {
  const session = sessions.get(id)
  if (!session) return
  if (session.host.parentElement !== container) container.appendChild(session.host)
  if (!session.opened) {
    session.opened = true
    session.term.open(session.host)
  }
  requestAnimationFrame(() => {
    fitSession(id)
    session.term.focus()
    if (!session.startRequested) {
      session.startRequested = true
      void startPty(session)
    }
  })
}

export function detachSession(id: string, container: HTMLElement): void {
  const session = sessions.get(id)
  if (!session) return
  if (session.host.parentElement === container) container.removeChild(session.host)
}

/** Renderer-computed fit, pushed to the pty via term:resize. */
export function fitSession(id: string): void {
  const session = sessions.get(id)
  if (!session || !session.opened || session.host.parentElement === null) return
  if (session.host.clientWidth === 0 || session.host.clientHeight === 0) return
  session.fit.fit()
  if (session.ptyId !== null) {
    void window.suna
      .invoke('term:resize', {
        id: session.ptyId,
        cols: session.term.cols,
        rows: session.term.rows
      })
      .catch(() => {})
  }
}

export function closeTerminalTab(id: string): void {
  const session = sessions.get(id)
  if (session) {
    if (session.ptyId !== null) {
      void window.suna.invoke('term:kill', { id: session.ptyId }).catch(() => {})
      session.ptyId = null
    }
    for (const dispose of session.disposers) dispose()
    session.disposers = []
    session.term.dispose()
    session.host.remove()
    sessions.delete(id)
  }
  useTerminalTabsStore.setState((s) => {
    const tabs = s.tabs.filter((tab) => tab.id !== id)
    // Successor is the strip's last tab, never a float one — `activeId` is
    // the strip's cursor and nothing else reads it.
    const remaining = panelTabs(tabs)
    const activeId =
      s.activeId === id ? (remaining[remaining.length - 1]?.id ?? null) : s.activeId
    return { tabs, activeId }
  })
  // closing the last STRIP tab closes the strip (reopening spawns a fresh
  // shell); a floating terminal closing leaves it exactly as it was.
  if (panelTabs(useTerminalTabsStore.getState().tabs).length === 0) {
    useTerminalPanelStore.getState().setOpen(false)
  }
}
