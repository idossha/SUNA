import { useEffect, useRef, useState, type JSX } from 'react'
import { parseSciMark, renderHtml } from '@suna/markdown'
import type { Cell, CodeCell } from '@suna/notebook'
import { createEditor, type EditorHandle } from '../editor/codemirror'
import { useEditorSettings } from '../editor/settings'
import { OutputList } from './Outputs'
import type { NotebookSession } from './session'

/**
 * One cell. Code cells get a real CodeMirror — the same editor the rest of
 * the app uses, so highlighting, the theme and the keymap are the ones the
 * author already knows — with the notebook convention layered on top:
 * Shift-Enter runs, Ctrl-Enter runs in place.
 */

interface CellProps {
  cell: Cell
  session: NotebookSession
  running: boolean
  selected: boolean
  onSelect: () => void
}

/** `[ ]` while never run, `[*]` while running, `[7]` once it has. */
function executionLabel(cell: CodeCell, running: boolean): string {
  if (running) return '[*]'
  return cell.execution_count === null ? '[ ]' : `[${cell.execution_count}]`
}

function CodeCellView({ cell, session, running, selected, onSelect }: CellProps): JSX.Element {
  const code = cell as CodeCell
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<EditorHandle | null>(null)
  const editorTheme = useEditorSettings().editorTheme

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const handle = createEditor({
      parent: host,
      doc: typeof code.source === 'string' ? code.source : code.source.join(''),
      // The cell's language comes from the notebook's kernel, but the editor
      // keys off a file name; .py covers every kernel SUNA can start today.
      fileName: 'cell.py',
      theme: editorTheme,
      live: false,
      onDocChanged: () => {
        code.source = handle.view.state.doc.toString()
        session.markDirty()
      },
      onSave: () => void session.save()
    })
    handleRef.current = handle
    return () => {
      handle.destroy()
      handleRef.current = null
    }
    // Mounted once per cell: re-running this would discard the author's
    // cursor and undo history on every keystroke-driven re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    handleRef.current?.setTheme(editorTheme)
  }, [editorTheme])

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Enter' || !(event.shiftKey || event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    event.stopPropagation()
    void session.runCell(code)
  }

  return (
    <div
      className={`nb-cell nb-cell--code${selected ? ' nb-cell--selected' : ''}`}
      onFocus={onSelect}
      onKeyDown={onKeyDown}
    >
      <div className="nb-cell__gutter">
        <button
          className="nb-cell__run"
          title="Run this cell (Shift-Enter)"
          aria-label="Run this cell"
          onClick={() => void session.runCell(code)}
        >
          <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 1.6 10 6l-7 4.4z" fill="currentColor" />
          </svg>
        </button>
        <span className={`nb-cell__count${running ? ' nb-cell__count--running' : ''}`}>
          {executionLabel(code, running)}
        </span>
      </div>
      <div className="nb-cell__body">
        <div ref={hostRef} className="nb-cell__editor" />
        <OutputList outputs={code.outputs} />
      </div>
    </div>
  )
}

function MarkdownCellView({ cell, session, selected, onSelect }: CellProps): JSX.Element {
  const [editing, setEditing] = useState(false)
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<EditorHandle | null>(null)
  const editorTheme = useEditorSettings().editorTheme
  const source = typeof cell.source === 'string' ? cell.source : cell.source.join('')

  useEffect(() => {
    const host = hostRef.current
    if (!editing || host === null) return
    const handle = createEditor({
      parent: host,
      doc: source,
      fileName: 'cell.md',
      theme: editorTheme,
      live: false,
      onDocChanged: () => {
        cell.source = handle.view.state.doc.toString()
        session.markDirty()
      },
      onSave: () => void session.save()
    })
    handleRef.current = handle
    handle.view.focus()
    return () => {
      handle.destroy()
      handleRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  if (editing) {
    return (
      <div
        className={`nb-cell nb-cell--markdown nb-cell--editing${selected ? ' nb-cell--selected' : ''}`}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.shiftKey || event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            setEditing(false)
          }
        }}
      >
        <div className="nb-cell__gutter" />
        <div className="nb-cell__body">
          <div ref={hostRef} className="nb-cell__editor" />
        </div>
      </div>
    )
  }

  return (
    <div
      className={`nb-cell nb-cell--markdown${selected ? ' nb-cell--selected' : ''}`}
      onClick={onSelect}
      // Double-click to edit, Shift-Enter to render again: Jupyter's gesture,
      // because that is the one every notebook author already has.
      onDoubleClick={() => setEditing(true)}
    >
      <div className="nb-cell__gutter" />
      <div className="nb-cell__body">
        {source.trim() === '' ? (
          <p className="nb-cell__empty">Empty markdown cell — double-click to write in it.</p>
        ) : (
          <div
            className="nb-cell__prose"
            dangerouslySetInnerHTML={{ __html: renderHtml(parseSciMark(source)) }}
          />
        )}
      </div>
    </div>
  )
}

export function CellView(props: CellProps): JSX.Element {
  if (props.cell.cell_type === 'code') return <CodeCellView {...props} />
  if (props.cell.cell_type === 'markdown') return <MarkdownCellView {...props} />
  const source = typeof props.cell.source === 'string' ? props.cell.source : props.cell.source.join('')
  return (
    <div className="nb-cell nb-cell--raw">
      <div className="nb-cell__gutter" />
      <div className="nb-cell__body">
        <pre className="nb-output__text">{source}</pre>
      </div>
    </div>
  )
}
