import { useEffect, useRef, useState, type JSX } from 'react'
import type { EditorView } from '@codemirror/view'
import { parseSciMark, renderHtml } from '@suna/markdown'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { useUiStore } from '../state/ui'
import { createEditor } from './codemirror'

type ViewMode = 'source' | 'rendered'

export function EditorTab({ api, params }: DockPanelProps): JSX.Element {
  const path = String(params['path'] ?? '')
  const fileName = path.split('/').pop() ?? path
  const isMarkdown = /\.(md|markdown)$/.test(fileName)

  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const dirtyRef = useRef(false)
  const [mode, setMode] = useState<ViewMode>('source')
  const [renderedHtml, setRenderedHtml] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)

  const markDirty = (dirty: boolean): void => {
    if (dirtyRef.current === dirty) return
    dirtyRef.current = dirty
    api.setTitle(dirty ? `${fileName} •` : fileName)
  }

  const save = async (): Promise<void> => {
    const view = viewRef.current
    if (!view) return
    try {
      await window.suna.invoke('fs:write-text', {
        path,
        content: view.state.doc.toString()
      })
      markDirty(false)
      useUiStore.getState().setStatusNote(`Saved ${fileName}`)
    } catch (error) {
      useUiStore
        .getState()
        .setStatusNote(
          `Could not save ${fileName}: ${error instanceof Error ? error.message : String(error)}`
        )
    }
  }

  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const { content } = await window.suna.invoke('fs:read-text', { path })
        if (disposed || !hostRef.current) return
        viewRef.current = createEditor({
          parent: hostRef.current,
          doc: content,
          isMarkdown,
          onDocChanged: () => markDirty(true),
          onSave: () => void save()
        })
      } catch (error) {
        if (!disposed) {
          setLoadError(error instanceof Error ? error.message : String(error))
        }
      }
    })()
    return () => {
      disposed = true
      viewRef.current?.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  const toggleMode = (): void => {
    if (mode === 'source') {
      const doc = viewRef.current?.state.doc.toString() ?? ''
      try {
        setRenderedHtml(renderHtml(parseSciMark(doc)))
        setMode('rendered')
      } catch (error) {
        useUiStore
          .getState()
          .setStatusNote(
            `Render failed: ${error instanceof Error ? error.message : String(error)}`
          )
      }
    } else {
      setMode('source')
    }
  }

  // ⌘E toggles source/rendered while this tab's content has focus
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'e' && (event.metaKey || event.ctrlKey) && isMarkdown) {
        event.preventDefault()
        toggleMode()
      }
    }
    const node = hostRef.current?.parentElement
    node?.addEventListener('keydown', onKey)
    return () => node?.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, isMarkdown])

  if (loadError) {
    return <div className="sidebar__empty">Could not open {fileName}: {loadError}</div>
  }

  return (
    <div className="editor-tab">
      {isMarkdown && (
        <div className="editor-tab__toolbar">
          <button
            className="editor-tab__mode"
            onClick={toggleMode}
            title="Toggle source / rendered (⌘E)"
          >
            {mode === 'source' ? 'Rendered' : 'Source'}
          </button>
        </div>
      )}
      <div
        ref={hostRef}
        className="editor-tab__source"
        style={{ display: mode === 'source' ? 'block' : 'none' }}
      />
      {mode === 'rendered' && (
        <div className="editor-tab__rendered">
          <article
            className="scimark"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        </div>
      )}
    </div>
  )
}
