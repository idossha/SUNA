import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { devSeam } from '../state/devSeam'
import { useUiStore } from '../state/ui'
import { createEditor, type EditorHandle } from './codemirror'
import { FONT_FAMILY_STACKS, useEditorSettings } from './settings'
import { EDITOR_THEME_CLASS } from './themes'
import { SettingsPopover } from './SettingsPopover'
import './editor.css'

/**
 * Two surfaces on one editable CodeMirror instance: 'source' is plain
 * markdown, 'reading' adds live-preview decorations (widgets with
 * cursor-reveal) plus reading typography. There is no static render here —
 * renderHtml stays in @suna/markdown for other consumers.
 */
export type EditorViewMode = 'source' | 'reading'

export const EDITOR_VIEW_MODES: readonly EditorViewMode[] = ['source', 'reading']

const MODE_LABEL: Record<EditorViewMode, string> = {
  source: 'Source',
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
  const handleRef = useRef<EditorHandle | null>(null)
  const dirtyRef = useRef(false)
  const [mode, setMode] = useState<EditorViewMode>('source')
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

  const toggleMode = (): void => {
    const next: EditorViewMode = mode === 'source' ? 'reading' : 'source'
    handleRef.current?.setLive(next === 'reading')
    setMode(next)
  }

  // keep focus on the editor so ⌘E/⌘S keep working after a switch
  useEffect(() => {
    handleRef.current?.view.focus()
  }, [mode])

  // ⌘E toggles source ⇄ reading; ⌘S is handled inside CodeMirror's keymap
  // (the editable surface is mounted in both modes)
  useEffect(() => {
    const node = rootRef.current
    if (!node || !isMarkdown) return
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'e') return
      event.preventDefault()
      toggleMode()
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
            onClick={toggleMode}
            title="Toggle reading / source (⌘E)"
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
        className={`editor-tab__source${mode === 'reading' ? ' editor-tab__source--reading' : ''}`}
      />
    </div>
  )
}
