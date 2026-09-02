import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { CellType, CodeCell } from '@suna/notebook'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { editorSurfaceStyle, useEditorSettings } from '../editor/settings'
import { editorThemeClass } from '../editor/themes'
import { useProjectStore } from '../state/project'
import { selectedEnvPathFor } from '../state/envs'
import { useUiStore } from '../state/ui'
import { CellView } from './CellView'
import type { CellCommands } from './commands'
import { acquireNotebook, cellKey, useNotebookMeta, type NotebookSession } from './session'
// the `.editor-tab` class carries the --ed-* palette this tab reuses
import '../editor/editor.css'
import './notebook.css'

const STATUS_LABEL: Record<string, string> = {
  off: 'no kernel',
  starting: 'starting…',
  idle: 'idle',
  busy: 'busy',
  dead: 'not running'
}

function Toolbar({
  session,
  path,
  onInsert,
  onHelp
}: {
  session: NotebookSession
  path: string
  onInsert: (cellType: CellType) => void
  onHelp: () => void
}): JSX.Element {
  const meta = useNotebookMeta(path)
  const busy = meta.kernelStatus === 'busy'
  return (
    <div className="nb-toolbar">
      <button
        className="nb-toolbar__button"
        onClick={() => onInsert('code')}
        title="Insert a code cell below the selected one (b)"
      >
        + Code
      </button>
      <button
        className="nb-toolbar__button"
        onClick={() => onInsert('markdown')}
        title="Insert a markdown cell below the selected one (b, then m)"
      >
        + Markdown
      </button>
      <span className="nb-toolbar__divider" />
      <button
        className="nb-toolbar__button nb-toolbar__button--run"
        onClick={() => void session.runAll()}
        title="Run every cell, top to bottom"
      >
        Run all
      </button>
      <button
        className="nb-toolbar__button"
        onClick={() => void session.interrupt()}
        disabled={!busy}
        title="Interrupt the running cell"
      >
        Interrupt
      </button>
      <button
        className="nb-toolbar__button"
        onClick={() => void session.restart()}
        disabled={meta.kernelStatus === 'off'}
        title="Restart the kernel — every variable is lost"
      >
        Restart
      </button>
      <button
        className="nb-toolbar__button"
        onClick={() => session.clearAllOutputs()}
        title="Clear every cell's output; the kernel keeps its variables"
      >
        Clear outputs
      </button>
      <button
        className="nb-toolbar__button"
        onClick={() => void session.save()}
        disabled={!meta.dirty}
        title="Save the notebook"
      >
        {meta.dirty ? 'Save' : 'Saved'}
      </button>
      <span className="nb-toolbar__spacer" />
      <button
        className="nb-toolbar__button"
        onClick={onHelp}
        title="Keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts"
      >
        ⌨
      </button>
      <span className={`nb-toolbar__kernel nb-toolbar__kernel--${meta.kernelStatus}`}>
        <span className="nb-toolbar__dot" />
        {meta.kernelName ?? 'Kernel'} · {STATUS_LABEL[meta.kernelStatus] ?? meta.kernelStatus}
      </span>
    </div>
  )
}

/**
 * The kernel could not start, and it is nearly always the same fixable
 * thing: the selected environment has no `ipykernel` in it. Say which
 * environment, and say the command.
 *
 * The wizard offers to install this at project creation, but this panel is
 * NOT redundant with it (ROADMAP item 5): the interpreter is a per-project
 * pick the user can change at any time from the status bar, projects arrive
 * by clone and by DOCX import as well as through the wizard, and a wizard
 * install can fail on a machine with no network. So the kernel path degrades
 * on its own terms rather than assuming onboarding ran — it offers the same
 * one-click repair here, against whichever interpreter is selected NOW, and
 * where it cannot repair it says so and names the command.
 */
function KernelFault({ path, session }: { path: string; session: NotebookSession }): JSX.Element | null {
  const meta = useNotebookMeta(path)
  const rootDir = useProjectStore((s) => s.rootDir)
  const envPath = rootDir === null ? null : selectedEnvPathFor(rootDir)
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)

  const install = useCallback(async () => {
    if (envPath === null) return
    setInstalling(true)
    setInstallError(null)
    try {
      const res = await window.suna.invoke('env:install-kernel', { envPath })
      if (!res.ok) {
        // Honest failure: no network, no pip, a read-only interpreter. The
        // message names the command, and the panel stays put.
        setInstallError(res.error ?? 'Could not install ipykernel.')
        return
      }
      await session.ensureKernel()
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error))
    } finally {
      setInstalling(false)
    }
  }, [envPath, session])

  if (meta.kernelError === null) return null
  const installable =
    meta.kernelError.code === 'no-jupyter-client' || meta.kernelError.code === 'no-kernelspec'
  return (
    <div className="nb-fault">
      <strong className="nb-fault__title">No kernel</strong>
      <span className="nb-fault__message">{meta.kernelError.message}</span>
      {installable && envPath !== null && (
        <button
          className="nb-fault__action"
          onClick={() => void install()}
          disabled={installing}
        >
          {installing ? 'Installing ipykernel…' : `Install ipykernel into ${envPath}`}
        </button>
      )}
      {installable && envPath === null && (
        <span className="nb-fault__hint">
          No environment is selected, so there is nothing to install into. Pick one at the top
          right — SUNA runs the kernel under whichever interpreter that chip names.
        </span>
      )}
      {installError !== null && <span className="nb-fault__message">{installError}</span>}
    </div>
  )
}

/**
 * Jupyter notebook tab: cells rendered in place, executed by a real Jupyter
 * kernel (see python/suna_kernel/bridge.py), saved back as the .ipynb it came
 * from — byte for byte where nothing changed (see @suna/notebook).
 *
 * Editing is modal, as it is in Jupyter: the selected cell is either being
 * TYPED IN (edit mode — the CodeMirror inside it holds focus) or being ACTED
 * ON (command mode — the scroller holds focus, and single letters insert,
 * delete and re-type cells). Escape and Enter cross between them. Modal
 * editing is not decoration here: it is the only way `d`, `a` and `m` can be
 * bare keystrokes without eating the author's typing.
 */
export function NotebookTab({ params }: DockPanelProps): JSX.Element {
  const path = String(params['path'] ?? '')
  const fileName = path.split('/').pop() ?? path
  const meta = useNotebookMeta(path)
  const editorSettings = useEditorSettings()
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const sessionRef = useRef<NotebookSession | null>(null)
  const cellsRef = useRef<HTMLDivElement>(null)
  /** `d` waiting for its second `d`; cleared by any other key. */
  const pendingD = useRef(false)

  useEffect(() => {
    const { session, release } = acquireNotebook(path)
    sessionRef.current = session
    return () => {
      release()
      sessionRef.current = null
    }
  }, [path])

  /** Command mode: focus belongs to the scroller, so the keys land here. */
  const toCommandMode = useCallback((): void => {
    setEditing(false)
    cellsRef.current?.focus({ preventScroll: true })
  }, [])

  const select = useCallback((key: string | null, edit = false): void => {
    setSelected(key)
    setEditing(edit)
    if (key === null || edit) return
    cellsRef.current?.focus({ preventScroll: true })
    // Keep the selection on screen; a `j` that scrolls nothing looks broken.
    requestAnimationFrame(() => {
      cellsRef.current
        ?.querySelector(`[data-cell-key="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })
  }, [])

  const session = sessionRef.current
  const cells = session?.nb?.cells ?? []
  const selectedIndex = selected === null ? -1 : cells.findIndex((c) => cellKey(c) === selected)
  const index = selectedIndex === -1 ? 0 : selectedIndex

  const runSelected = useCallback(
    (after: 'stay' | 'next' | 'insert'): void => {
      const s = sessionRef.current
      if (s === null || s.nb === null) return
      const cell = s.nb.cells[index]
      if (cell === undefined) return
      if (cell.cell_type === 'code') void s.runCell(cell as CodeCell)
      // "Running" a markdown cell is rendering it, i.e. leaving edit mode.
      setEditing(false)

      if (after === 'stay') {
        select(cellKey(cell), cell.cell_type === 'code')
        return
      }
      if (after === 'insert' || index === s.nb.cells.length - 1) {
        if (after === 'insert' || s.nb.cells[index + 1] === undefined) {
          const key = s.insertCell(index + 1, 'code')
          if (key !== null) select(key, true)
          return
        }
      }
      const next = s.nb.cells[index + 1]
      if (next !== undefined) select(cellKey(next))
    },
    [index, select]
  )

  const moveSelected = useCallback(
    (delta: number): void => {
      const s = sessionRef.current
      if (s === null || s.nb === null) return
      if (!s.moveCell(index, delta)) return
      const moved = s.nb.cells[index + delta]
      if (moved !== undefined) setSelected(cellKey(moved))
    },
    [index]
  )

  // Handed to every cell as a getter (see CellView's `commands`), so the
  // editor built on a cell's first render still calls TODAY's callbacks.
  const commandsRef = useRef<CellCommands>({
    run: runSelected,
    move: moveSelected,
    toCommandMode,
    save: () => void sessionRef.current?.save()
  })
  commandsRef.current = {
    run: runSelected,
    move: moveSelected,
    toCommandMode,
    save: () => void sessionRef.current?.save()
  }
  const commands = useCallback((): CellCommands => commandsRef.current, [])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      const s = sessionRef.current
      if (s === null || s.nb === null) return
      const target = event.target as HTMLElement
      const inEditor = target.closest('.cm-editor') !== null
      const mod = event.metaKey || event.ctrlKey
      const stop = (): void => {
        event.preventDefault()
        event.stopPropagation()
      }

      // A focused editor has these same keys installed at the top of its own
      // keymap (commands.ts) and has already acted on them — including ⌘S,
      // which CodeMirror binds to the host's save. Handling them again here
      // would run the cell twice.
      if (inEditor) return

      // ---- the cell-execution keys, when no editor has focus ---------------
      if (event.key === 'Enter' && (event.shiftKey || mod || event.altKey)) {
        stop()
        runSelected(event.altKey ? 'insert' : event.shiftKey ? 'next' : 'stay')
        return
      }
      if (mod && event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        stop()
        moveSelected(event.key === 'ArrowUp' ? -1 : 1)
        return
      }
      if (mod && event.key.toLowerCase() === 's') {
        stop()
        void s.save()
        return
      }
      if (event.key === 'Escape') {
        if (!editing) return
        stop()
        toCommandMode()
        return
      }

      // ---- command mode ----------------------------------------------------
      if (mod || event.altKey) return
      const wasPendingD = pendingD.current
      pendingD.current = false

      switch (event.key) {
        case 'Enter':
          stop()
          if (selected !== null) select(selected, true)
          return
        case 'j':
        case 'ArrowDown': {
          stop()
          const next = s.nb.cells[Math.min(index + 1, s.nb.cells.length - 1)]
          if (next !== undefined) select(cellKey(next))
          return
        }
        case 'k':
        case 'ArrowUp': {
          stop()
          const prev = s.nb.cells[Math.max(index - 1, 0)]
          if (prev !== undefined) select(cellKey(prev))
          return
        }
        case 'a': {
          stop()
          const key = s.insertCell(index, 'code')
          if (key !== null) select(key)
          return
        }
        case 'b': {
          stop()
          const key = s.insertCell(index + 1, 'code')
          if (key !== null) select(key)
          return
        }
        case 'm':
        case 'y':
        case 'r':
          stop()
          s.setCellType(index, event.key === 'm' ? 'markdown' : event.key === 'y' ? 'code' : 'raw')
          {
            const same = s.nb.cells[index]
            if (same !== undefined) setSelected(cellKey(same))
          }
          return
        case 'd':
          stop()
          if (!wasPendingD) {
            pendingD.current = true
            // A lone `d` is not a command; forget it rather than arming a
            // delete that fires minutes later on an unrelated keystroke.
            window.setTimeout(() => {
              pendingD.current = false
            }, 900)
            return
          }
          select(s.deleteCell(index))
          return
        case 'z':
          stop()
          select(s.undoDelete())
          return
        case 'D':
          stop()
          select(s.duplicateCell(index))
          return
        default:
          return
      }
    },
    [editing, index, moveSelected, runSelected, select, selected, toCommandMode]
  )

  if (meta.loadError !== null) {
    return (
      <div className="sidebar__empty">
        Could not open {fileName}: {meta.loadError}
      </div>
    )
  }
  if (session === null || meta.loading || session.nb === null) {
    return <div className="sidebar__empty">Opening {fileName}…</div>
  }

  return (
    <div
      className={`editor-tab nb ${editorThemeClass(editorSettings.editorTheme)}`}
      style={editorSurfaceStyle(editorSettings)}
      // `version` is the whole re-render signal: the notebook is mutated in
      // place, so nothing below would change identity on its own.
      data-nb-version={meta.version}
      onKeyDown={onKeyDown}
    >
      <Toolbar
        session={session}
        path={path}
        onInsert={(cellType) => {
          const key = session.insertCell(index + 1, cellType)
          if (key !== null) select(key, true)
        }}
        onHelp={() => useUiStore.getState().setHelpOpen(true)}
      />
      <KernelFault path={path} session={session} />
      <div className="nb__cells" ref={cellsRef} tabIndex={0}>
        {session.nb.cells.map((cell, cellIndex) => {
          const key = cellKey(cell)
          return (
            <div key={key} data-cell-key={key}>
              <CellView
                cell={cell}
                session={session}
                running={meta.running.includes(key)}
                selected={selected === key}
                editing={selected === key && editing}
                onSelect={() => setSelected(key)}
                onEdit={() => {
                  setSelected(key)
                  setEditing(true)
                }}
                onMove={(delta) => {
                  if (session.moveCell(cellIndex, delta)) setSelected(key)
                }}
                onDelete={() => select(session.deleteCell(cellIndex))}
                commands={commands}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
