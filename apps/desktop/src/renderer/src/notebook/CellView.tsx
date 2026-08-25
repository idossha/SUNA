import { useEffect, useRef, type JSX } from 'react'
import { parseSciMark, renderHtml } from '@suna/markdown'
import type { Cell, CodeCell } from '@suna/notebook'
import { createEditor, type EditorHandle } from '../editor/codemirror'
import { useEditorSettings } from '../editor/settings'
import { cellKeymap, type CellCommands } from './commands'
import { OutputList } from './Outputs'
import type { NotebookSession } from './session'

/**
 * One cell. Code cells get a real CodeMirror — the same editor the rest of
 * the app uses, so highlighting, the theme and the keymap are the ones the
 * author already knows.
 *
 * Selection and the modal edit/command distinction belong to the notebook,
 * not to a cell: every keystroke that acts on the cell LIST (insert, delete,
 * move, change type) has to be able to see its neighbours. So a cell is told
 * whether it is selected and whether it is being edited, and reports back
 * gestures — it decides neither.
 */

export interface CellProps {
  cell: Cell
  session: NotebookSession
  running: boolean
  selected: boolean
  /** Selected AND in edit mode: the editor is live and holds focus. */
  editing: boolean
  onSelect: () => void
  onEdit: () => void
  /**
   * The notebook-level commands, read at keystroke time rather than passed
   * by value: the editor is built once per cell and would otherwise close
   * over the first render's callbacks forever.
   */
  commands: () => CellCommands
  onMove: (delta: number) => void
  onDelete: () => void
}

/** `[ ]` while never run, `[*]` while running, `[7]` once it has. */
function executionLabel(cell: CodeCell, running: boolean): string {
  if (running) return '[*]'
  return cell.execution_count === null ? '[ ]' : `[${cell.execution_count}]`
}

/** The per-cell controls: the mouse path to what the keyboard also does. */
function CellActions({ onMove, onDelete }: Pick<CellProps, 'onMove' | 'onDelete'>): JSX.Element {
  return (
    <div className="nb-cell__actions">
      <button className="nb-cell__action" title="Move up (⌘⇧↑)" onClick={() => onMove(-1)}>
        ↑
      </button>
      <button className="nb-cell__action" title="Move down (⌘⇧↓)" onClick={() => onMove(1)}>
        ↓
      </button>
      <button
        className="nb-cell__action nb-cell__action--delete"
        title="Delete this cell (dd)"
        onClick={onDelete}
      >
        ✕
      </button>
    </div>
  )
}

function CodeCellView(props: CellProps): JSX.Element {
  const { cell, session, running, selected, editing, onSelect, onEdit, onMove, onDelete, commands } =
    props
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
      extraKeys: cellKeymap(commands),
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

  // Edit mode IS "the editor has focus": Escape leaves it, Enter comes back.
  useEffect(() => {
    const handle = handleRef.current
    if (handle === null) return
    if (editing) {
      if (!handle.view.hasFocus) handle.view.focus()
    } else if (handle.view.hasFocus) {
      handle.view.contentDOM.blur()
    }
  }, [editing])

  return (
    <div
      className={`nb-cell nb-cell--code${selected ? ' nb-cell--selected' : ''}`}
      data-cell-body="1"
      onMouseDown={onSelect}
      onFocus={onEdit}
    >
      <div className="nb-cell__gutter">
        <button
          className="nb-cell__run"
          title="Run this cell (⇧↵)"
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
      <CellActions onMove={onMove} onDelete={onDelete} />
    </div>
  )
}

function MarkdownCellView(props: CellProps): JSX.Element {
  const { cell, session, selected, editing, onSelect, onEdit, onMove, onDelete, commands } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<EditorHandle | null>(null)
  const editorTheme = useEditorSettings().editorTheme
  const source = typeof cell.source === 'string' ? cell.source : cell.source.join('')

  useEffect(() => {
    const host = hostRef.current
    if (!editing || host === null) return
    const handle = createEditor({
      parent: host,
      doc: typeof cell.source === 'string' ? cell.source : cell.source.join(''),
      fileName: 'cell.md',
      theme: editorTheme,
      live: false,
      extraKeys: cellKeymap(commands),
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
        data-cell-body="1"
        onMouseDown={onSelect}
      >
        <div className="nb-cell__gutter" />
        <div className="nb-cell__body">
          <div ref={hostRef} className="nb-cell__editor" />
        </div>
        <CellActions onMove={onMove} onDelete={onDelete} />
      </div>
    )
  }

  return (
    <div
      className={`nb-cell nb-cell--markdown${selected ? ' nb-cell--selected' : ''}`}
      data-cell-body="1"
      onMouseDown={onSelect}
      // Double-click to edit, Shift-Enter to render again: Jupyter's gesture,
      // because that is the one every notebook author already has.
      onDoubleClick={onEdit}
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
      <CellActions onMove={onMove} onDelete={onDelete} />
    </div>
  )
}

export function CellView(props: CellProps): JSX.Element {
  if (props.cell.cell_type === 'code') return <CodeCellView {...props} />
  if (props.cell.cell_type === 'markdown') return <MarkdownCellView {...props} />
  const source =
    typeof props.cell.source === 'string' ? props.cell.source : props.cell.source.join('')
  return (
    <div
      className={`nb-cell nb-cell--raw${props.selected ? ' nb-cell--selected' : ''}`}
      data-cell-body="1"
      onMouseDown={props.onSelect}
    >
      <div className="nb-cell__gutter" />
      <div className="nb-cell__body">
        <pre className="nb-output__text">{source}</pre>
      </div>
      <CellActions onMove={props.onMove} onDelete={props.onDelete} />
    </div>
  )
}
