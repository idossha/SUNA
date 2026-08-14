import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { createEditor, type EditorHandle } from '../editor/codemirror'
import { editorSurfaceStyle, useEditorSettings } from '../editor/settings'
import { EDITOR_THEME_CLASS } from '../editor/themes'
import { MAX_RENDERED_ROWS, parseDataFile, type DataTable } from './grid'
// the `.editor-tab` class carries the --ed-* palette and the column layout
// this tab reuses; dataview.css only adds the grid itself
import '../editor/editor.css'
import './dataview.css'

type DataView = 'grid' | 'text'

interface GridProps {
  table: DataTable
}

function Grid({ table }: GridProps): JSX.Element {
  if (table.header.length === 0) {
    return <div className="dataview__empty">No rows.</div>
  }
  return (
    <table className="dataview__table">
      <thead>
        <tr>
          <th className="dataview__gutter" scope="col">
            #
          </th>
          {table.header.map((name, index) => (
            <th
              key={`${name}-${index}`}
              scope="col"
              className={table.numericColumns[index] === true ? 'dataview__num' : undefined}
            >
              {name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            <td className="dataview__gutter">{rowIndex + 1}</td>
            {row.map((cell, colIndex) => (
              <td
                key={colIndex}
                className={table.numericColumns[colIndex] === true ? 'dataview__num' : undefined}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** CSV/TSV viewer: a read-only grid, with an escape hatch to the raw text. */
export function DataGridTab({ params }: DockPanelProps): JSX.Element {
  const path = String(params['path'] ?? '')
  const fileName = path.split('/').pop() ?? path

  const [content, setContent] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [view, setView] = useState<DataView>('grid')

  const editorSettings = useEditorSettings()
  const editorTheme = editorSettings.editorTheme
  const textHostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<EditorHandle | null>(null)

  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const file = await window.suna.invoke('fs:read-text', { path })
        if (!disposed) setContent(file.content)
      } catch (error) {
        if (!disposed) setLoadError(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => {
      disposed = true
    }
  }, [path])

  const table = useMemo(
    () => (content === null ? null : parseDataFile(content, fileName)),
    [content, fileName]
  )

  // the text view mounts its own CodeMirror; v1 is read-only either way
  useEffect(() => {
    if (view !== 'text' || content === null || !textHostRef.current) return
    handleRef.current = createEditor({
      parent: textHostRef.current,
      doc: content,
      fileName,
      theme: editorTheme,
      live: false,
      readOnly: true,
      onDocChanged: () => {},
      onSave: () => {}
    })
    return () => {
      handleRef.current?.destroy()
      handleRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, content, fileName])

  useEffect(() => {
    handleRef.current?.setTheme(editorTheme)
  }, [editorTheme])

  if (loadError !== null) {
    return (
      <div className="sidebar__empty">
        Could not open {fileName}: {loadError}
      </div>
    )
  }

  return (
    <div
      className={`editor-tab dataview ${EDITOR_THEME_CLASS[editorTheme]}`}
      style={editorSurfaceStyle(editorSettings)}
    >
      <div className="dataview__toolbar">
        {table !== null && (
          <span className="dataview__count">
            {table.totalRows.toLocaleString()} {table.totalRows === 1 ? 'row' : 'rows'} ·{' '}
            {table.header.length} {table.header.length === 1 ? 'column' : 'columns'}
          </span>
        )}
        <button
          className="dataview__toggle"
          onClick={() => setView(view === 'grid' ? 'text' : 'grid')}
          title="Switch between the data grid and the raw text"
        >
          {view === 'grid' ? 'Text' : 'Grid'}
        </button>
      </div>

      {table !== null && table.truncated && (
        <div className="dataview__notice">
          Showing first {MAX_RENDERED_ROWS.toLocaleString()} of{' '}
          {table.totalRows.toLocaleString()} rows.
        </div>
      )}
      {table !== null && table.errors.length > 0 && (
        <div className="dataview__notice dataview__notice--warn">
          {table.errors.length === 1
            ? table.errors[0]
            : `${table.errors.length} parse problems; first: ${table.errors[0] ?? ''}`}
        </div>
      )}

      {view === 'grid' ? (
        <div className="dataview__scroll">
          {table === null ? <div className="dataview__empty">Loading…</div> : <Grid table={table} />}
        </div>
      ) : (
        <div ref={textHostRef} className="dataview__text" />
      )}
    </div>
  )
}
