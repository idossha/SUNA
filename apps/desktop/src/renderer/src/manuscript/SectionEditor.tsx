import { useEffect, useRef, useState, type JSX } from 'react'
import { createEditor, type EditorHandle } from '../editor/codemirror'
import { useEditorSettings } from '../editor/settings'
import { devSeam } from '../state/devSeam'
import { countWords, useManuscriptDocStore } from '../state/manuscriptDoc'
import { useUiStore } from '../state/ui'
import { applyCiteChips } from './citeChips'

interface SectionEditorProps {
  rootDir: string
  /** Path relative to manuscript/, e.g. "sections/02-results.md". */
  contentPath: string
  onDirtyChange: (contentPath: string, dirty: boolean) => void
  /**
   * Fired once this section has settled at its content height (editor mounted
   * or load failed) and again with false on unmount. The combined tab defers
   * outline-click scrolling until every section has settled — scrolling while
   * earlier editors are still empty lands at a stale offset.
   */
  onSettled: (contentPath: string, settled: boolean) => void
}

const WORD_COUNT_DEBOUNCE_MS = 500

/**
 * One EditorTab-grade CodeMirror in live-preview mode for a single body
 * section of the combined manuscript document. Sizes to content — the outer
 * document scrolls, never the editor. ⌘S saves this section's file only.
 */
export function SectionEditor({
  rootDir,
  contentPath,
  onDirtyChange,
  onSettled
}: SectionEditorProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<EditorHandle | null>(null)
  const dirtyRef = useRef(false)
  const countTimerRef = useRef<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const editorTheme = useEditorSettings((s) => s.editorTheme)

  // latest callbacks without re-creating the editor
  const onDirtyChangeRef = useRef(onDirtyChange)
  onDirtyChangeRef.current = onDirtyChange
  const onSettledRef = useRef(onSettled)
  onSettledRef.current = onSettled

  useEffect(() => {
    const fileName = contentPath.split('/').pop() ?? contentPath
    const absPath = `${rootDir}/manuscript/${contentPath}`

    const markDirty = (dirty: boolean): void => {
      if (dirtyRef.current === dirty) return
      dirtyRef.current = dirty
      onDirtyChangeRef.current(contentPath, dirty)
    }

    const reportCount = (): void => {
      const view = handleRef.current?.view
      if (!view) return
      useManuscriptDocStore
        .getState()
        .setWordCount(contentPath, countWords(view.state.doc.toString()))
    }

    const scheduleCount = (): void => {
      if (countTimerRef.current !== null) window.clearTimeout(countTimerRef.current)
      countTimerRef.current = window.setTimeout(() => {
        countTimerRef.current = null
        reportCount()
      }, WORD_COUNT_DEBOUNCE_MS)
    }

    const save = async (): Promise<void> => {
      const view = handleRef.current?.view
      if (!view) return
      try {
        await window.suna.invoke('fs:write-text', {
          path: absPath,
          content: view.state.doc.toString()
        })
        markDirty(false)
        reportCount()
        devSeam.noteFileSaved(absPath)
        useUiStore.getState().setStatusNote(`Saved ${fileName}`)
      } catch (error) {
        useUiStore
          .getState()
          .setStatusNote(
            `Could not save ${fileName}: ${error instanceof Error ? error.message : String(error)}`
          )
      }
    }

    let disposed = false
    void (async () => {
      try {
        const { content } = await window.suna.invoke('fs:read-text', { path: absPath })
        if (disposed || !hostRef.current) return
        handleRef.current = createEditor({
          parent: hostRef.current,
          doc: content,
          fileName,
          theme: useEditorSettings.getState().editorTheme,
          live: true,
          onDocChanged: () => {
            markDirty(true)
            scheduleCount()
          },
          onSave: () => void save()
        })
        reportCount()
        onSettledRef.current(contentPath, true)
      } catch (error) {
        if (!disposed) {
          setLoadError(error instanceof Error ? error.message : String(error))
          // a failed section still "settles" — its height is final
          onSettledRef.current(contentPath, true)
        }
      }
    })()

    return () => {
      disposed = true
      onSettledRef.current(contentPath, false)
      if (countTimerRef.current !== null) {
        window.clearTimeout(countTimerRef.current)
        countTimerRef.current = null
      }
      if (dirtyRef.current) {
        dirtyRef.current = false
        onDirtyChangeRef.current(contentPath, false)
      }
      handleRef.current?.destroy()
      handleRef.current = null
    }
  }, [rootDir, contentPath])

  // theme changes apply to the live CM instance without losing state
  useEffect(() => {
    handleRef.current?.setTheme(editorTheme)
  }, [editorTheme])

  // Resolve reading-mode citation chips against the citation render data the
  // References block publishes (numbers + preview-profile style). A mutation
  // observer re-applies the pass whenever CodeMirror re-creates widget DOM;
  // applyCiteChips is idempotent per serial, so its own mutations converge.
  const citationRender = useManuscriptDocStore((s) => s.citationRender)
  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    applyCiteChips(host, citationRender)
    let scheduled = false
    const observer = new MutationObserver(() => {
      if (scheduled) return
      scheduled = true
      queueMicrotask(() => {
        scheduled = false
        applyCiteChips(host, useManuscriptDocStore.getState().citationRender)
      })
    })
    observer.observe(host, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [citationRender])

  if (loadError !== null) {
    return (
      <div className="msdoc__hint">
        Could not open {contentPath}: {loadError}
      </div>
    )
  }

  return <div ref={hostRef} className="msdoc__editor" />
}
