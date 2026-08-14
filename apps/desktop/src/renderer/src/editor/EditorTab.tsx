import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { parseSciMark, renderHtml } from '@suna/markdown'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { devSeam } from '../state/devSeam'
import { useUiStore } from '../state/ui'
import { createEditor, type EditorHandle } from './codemirror'
import { FONT_FAMILY_STACKS, useEditorSettings } from './settings'
import { EDITOR_THEME_CLASS } from './themes'
import { SettingsPopover } from './SettingsPopover'
import './editor.css'

type ViewMode = 'source' | 'live' | 'reading'

const MODE_ORDER: readonly ViewMode[] = ['source', 'live', 'reading']
const MODE_LABEL: Record<ViewMode, string> = {
  source: 'Source',
  live: 'Live',
  reading: 'Reading'
}

function GearIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 5.25A2.75 2.75 0 1 0 8 10.75 2.75 2.75 0 0 0 8 5.25Zm0-3.75.9 1.9 2.05-.55.55 2.05 1.9.9-1.35 1.6 1.35 1.6-1.9.9-.55 2.05-2.05-.55-.9 1.9-.9-1.9-2.05.55-.55-2.05-1.9-.9L3.95 8 2.6 6.4l1.9-.9.55-2.05 2.05.55.9-1.9Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function EditorTab({ api, params }: DockPanelProps): JSX.Element {
  const path = String(params['path'] ?? '')
  const fileName = path.split('/').pop() ?? path
  const isMarkdown = /\.(md|markdown)$/.test(fileName)

  const rootRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const readingRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<EditorHandle | null>(null)
  const dirtyRef = useRef(false)
  const [mode, setMode] = useState<ViewMode>('source')
  const [renderedHtml, setRenderedHtml] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const contentWidthCh = useEditorSettings((s) => s.contentWidthCh)
  const fontSizePx = useEditorSettings((s) => s.fontSizePx)
  const fontFamily = useEditorSettings((s) => s.fontFamily)
  const lineHeight = useEditorSettings((s) => s.lineHeight)
  const editorTheme = useEditorSettings((s) => s.editorTheme)

  const markDirty = (dirty: boolean): void => {
    if (dirtyRef.current === dirty) return
    dirtyRef.current = dirty
    api.setTitle(dirty ? `${fileName} •` : fileName)
  }

  const save = async (): Promise<void> => {
    const view = handleRef.current?.view
    if (!view) return
    try {
      await window.suna.invoke('fs:write-text', {
        path,
        content: view.state.doc.toString()
      })
      markDirty(false)
      devSeam.noteFileSaved(path)
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
        handleRef.current = createEditor({
          parent: hostRef.current,
          doc: content,
          fileName,
          theme: useEditorSettings.getState().editorTheme,
          live: false,
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
      handleRef.current?.destroy()
      handleRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // theme changes apply to the live CM instance without losing state
  useEffect(() => {
    handleRef.current?.setTheme(editorTheme)
  }, [editorTheme])

  const applyMode = (next: ViewMode): void => {
    if (next === mode) return
    if (next === 'reading') {
      const doc = handleRef.current?.view.state.doc.toString() ?? ''
      try {
        setRenderedHtml(renderHtml(parseSciMark(doc)))
      } catch (error) {
        useUiStore
          .getState()
          .setStatusNote(
            `Render failed: ${error instanceof Error ? error.message : String(error)}`
          )
        return
      }
    }
    handleRef.current?.setLive(next === 'live')
    setMode(next)
  }

  const cycleMode = (): void => {
    const index = MODE_ORDER.indexOf(mode)
    applyMode(MODE_ORDER[(index + 1) % MODE_ORDER.length] ?? 'source')
  }

  // focus follows the visible surface so ⌘E/⌘S keep working after a switch
  useEffect(() => {
    if (mode === 'reading') readingRef.current?.focus()
    else handleRef.current?.view.focus()
  }, [mode])

  // ⌘E cycles source → live → reading; ⌘S saves from reading mode too
  // (source/live handle ⌘S inside CodeMirror's keymap)
  useEffect(() => {
    const node = rootRef.current
    if (!node) return
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key === 'e' && isMarkdown) {
        event.preventDefault()
        cycleMode()
      } else if (event.key === 's' && mode === 'reading') {
        event.preventDefault()
        void save()
      }
    }
    node.addEventListener('keydown', onKey)
    return () => node.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, isMarkdown])

  if (loadError) {
    return (
      <div className="sidebar__empty">
        Could not open {fileName}: {loadError}
      </div>
    )
  }

  const settingsStyle = {
    '--ed-content-width': `${contentWidthCh}ch`,
    '--ed-font-size': `${fontSizePx}px`,
    '--ed-line-height': String(lineHeight),
    '--ed-body-font': FONT_FAMILY_STACKS[fontFamily]
  } as CSSProperties

  return (
    <div
      ref={rootRef}
      className={`editor-tab ${EDITOR_THEME_CLASS[editorTheme]}`}
      style={settingsStyle}
    >
      <div className="editor-tab__toolbar editor-tab__toolbar--row">
        {isMarkdown && (
          <button
            className="editor-tab__mode"
            onClick={cycleMode}
            title="Cycle source / live / reading (⌘E)"
          >
            {MODE_LABEL[mode]}
          </button>
        )}
        <button
          className="editor-tab__gear"
          onClick={() => setSettingsOpen((open) => !open)}
          title="Editor appearance"
          aria-label="Editor appearance settings"
        >
          <GearIcon />
        </button>
        {settingsOpen && <SettingsPopover onClose={() => setSettingsOpen(false)} />}
      </div>
      <div
        ref={hostRef}
        className={`editor-tab__source${mode === 'live' ? ' editor-tab__source--live' : ''}`}
        style={{ display: mode === 'reading' ? 'none' : 'block' }}
      />
      {mode === 'reading' && (
        <div ref={readingRef} className="editor-tab__rendered" tabIndex={-1}>
          <article className="scimark" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
        </div>
      )}
    </div>
  )
}
