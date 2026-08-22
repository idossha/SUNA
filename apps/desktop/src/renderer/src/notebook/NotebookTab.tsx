import { useEffect, useRef, useState, type JSX } from 'react'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { editorSurfaceStyle, useEditorSettings } from '../editor/settings'
import { editorThemeClass } from '../editor/themes'
import { CellView } from './CellView'
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
  path
}: {
  session: NotebookSession
  path: string
}): JSX.Element {
  const meta = useNotebookMeta(path)
  const busy = meta.kernelStatus === 'busy'
  return (
    <div className="nb-toolbar">
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
        onClick={() => void session.save()}
        disabled={!meta.dirty}
        title="Save the notebook"
      >
        {meta.dirty ? 'Save' : 'Saved'}
      </button>
      <span className="nb-toolbar__spacer" />
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
 */
function KernelFault({ path }: { path: string }): JSX.Element | null {
  const meta = useNotebookMeta(path)
  if (meta.kernelError === null) return null
  const installable =
    meta.kernelError.code === 'no-jupyter-client' || meta.kernelError.code === 'no-kernelspec'
  return (
    <div className="nb-fault">
      <strong className="nb-fault__title">No kernel</strong>
      <span className="nb-fault__message">{meta.kernelError.message}</span>
      {installable && (
        <span className="nb-fault__hint">
          Pick the environment at the top right, then install it there — SUNA runs the kernel
          under whichever interpreter that chip names.
        </span>
      )}
    </div>
  )
}

/**
 * Jupyter notebook tab: cells rendered in place, executed by a real Jupyter
 * kernel (see python/suna_kernel/bridge.py), saved back as the .ipynb it came
 * from — byte for byte where nothing changed (see @suna/notebook).
 */
export function NotebookTab({ params }: DockPanelProps): JSX.Element {
  const path = String(params['path'] ?? '')
  const fileName = path.split('/').pop() ?? path
  const meta = useNotebookMeta(path)
  const editorSettings = useEditorSettings()
  const [selected, setSelected] = useState<string | null>(null)
  const sessionRef = useRef<NotebookSession | null>(null)

  useEffect(() => {
    const { session, release } = acquireNotebook(path)
    sessionRef.current = session
    return () => {
      release()
      sessionRef.current = null
    }
  }, [path])

  const session = sessionRef.current
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
    >
      <Toolbar session={session} path={path} />
      <KernelFault path={path} />
      <div className="nb__cells">
        {session.nb.cells.map((cell) => {
          const key = cellKey(cell)
          return (
            <CellView
              key={key}
              cell={cell}
              session={session}
              running={meta.running.includes(key)}
              selected={selected === key}
              onSelect={() => setSelected(key)}
            />
          )
        })}
      </div>
    </div>
  )
}
