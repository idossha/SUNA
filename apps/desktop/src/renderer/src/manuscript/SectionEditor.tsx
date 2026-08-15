import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type JSX,
  type RefObject
} from 'react'
import { StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { Comment } from '@suna/core'
import { createEditor, type EditorHandle } from '../editor/codemirror'
import { openCitationPicker } from '../editor/CitationPicker'
import { useEditorSettings } from '../editor/settings'
import { locate, makeAnchor } from '../comments/anchor'
import {
  anchorTopsFor,
  applySectionComments,
  commentAnchorExtension,
  flashAnchor
} from '../comments/anchorExtension'
import '../comments/comments.css'
import { commentsByPath, useCommentsStore } from '../state/comments'
import { devSeam } from '../state/devSeam'
import { countWords, useManuscriptDocStore } from '../state/manuscriptDoc'
import { useUiStore } from '../state/ui'
import { applyCiteChips, applyCrossRefChips, applyEquationLabels } from './citeChips'

const NO_COMMENTS: Comment[] = []

export interface SectionEditorHandle {
  /** Re-diff this section's comment anchors against the gutter track and report them — called by the manuscript tab on scroll/resize, since the gutter track's own rect only changes then. */
  recomputePositions: () => void
}

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
  /** The margin gutter's track element (comments/CommentGutter's forwarded ref) — the coordinate origin comment anchor positions are diffed against. Positions are withheld until this is available. */
  gutterRef: RefObject<HTMLElement | null>
  /** This section's current comment anchor positions (commentId -> px, diffed against gutterRef), reported after every recompute. */
  onPositionsChange: (contentPath: string, positions: ReadonlyMap<string, number>) => void
  /** A click landed directly on an anchored highlight in this section. */
  onActivateComment: (commentId: string) => void
}

const WORD_COUNT_DEBOUNCE_MS = 500

/**
 * One EditorTab-grade CodeMirror in live-preview mode for a single body
 * section of the combined manuscript document. Sizes to content — the outer
 * document scrolls, never the editor. ⌘S saves this section's file only.
 */
export const SectionEditor = forwardRef<SectionEditorHandle, SectionEditorProps>(function SectionEditor(
  { rootDir, contentPath, onDirtyChange, onSettled, gutterRef, onPositionsChange, onActivateComment },
  ref
) {
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

  // Comments targeting this section, for the anchor decorations below. This
  // section editor is also what triggers the initial comments:read load —
  // the anchor highlight/gutter dot should appear whether or not the human
  // has ever opened the Comments sidebar view.
  const allComments = useCommentsStore((s) => s.comments)
  const commentsForPath = useMemo(
    () => commentsByPath(allComments).get(contentPath) ?? NO_COMMENTS,
    [allComments, contentPath]
  )
  const commentsForPathRef = useRef(commentsForPath)
  commentsForPathRef.current = commentsForPath
  const flashRequest = useCommentsStore((s) => s.flashRequest)

  const onPositionsChangeRef = useRef(onPositionsChange)
  onPositionsChangeRef.current = onPositionsChange
  const onActivateCommentRef = useRef(onActivateComment)
  onActivateCommentRef.current = onActivateComment
  // Set once the view mounts; recomputes this section's comment anchor
  // positions and reports them up. Read through a ref so both this editor's
  // own updateListener and the manuscript tab's imperative handle (driven by
  // its scroll/resize observers, since only it knows when the gutter track's
  // rect has actually moved) call the same up-to-date closure.
  const recomputeRef = useRef<() => void>(() => {})
  useImperativeHandle(ref, () => ({ recomputePositions: () => recomputeRef.current() }), [])

  useEffect(() => {
    const state = useCommentsStore.getState()
    if (state.rootDir !== rootDir || (!state.loaded && !state.loading)) {
      void useCommentsStore.getState().load(rootDir)
    }
  }, [rootDir])

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
          onSave: () => void save(),
          // ⌘⇧M / context-menu "Comment": same anchored-comment flow as the
          // gutter's own drag-to-comment gesture dispatched below.
          onComment: (view) => {
            const { from, to } = view.state.selection.main
            if (from === to) return
            const anchor = makeAnchor(view.state.doc.toString(), from, to)
            useCommentsStore
              .getState()
              .startDraft({ kind: 'section', path: contentPath, anchor }, anchor.quote)
          },
          // ⌘⇧K / context-menu "Insert citation…".
          onInsertCitation: (view) => openCitationPicker(view)
        })
        const view = handleRef.current.view

        let recomputeScheduled = false
        const recompute = (): void => {
          const gutterEl = gutterRef.current
          if (gutterEl === null) return
          const positions = anchorTopsFor(view, commentsForPathRef.current, gutterEl)
          onPositionsChangeRef.current(contentPath, positions)
        }
        const scheduleRecompute = (): void => {
          if (recomputeScheduled) return
          recomputeScheduled = true
          requestAnimationFrame(() => {
            recomputeScheduled = false
            recompute()
          })
        }
        recomputeRef.current = recompute

        view.dispatch({
          effects: StateEffect.appendConfig.of([
            commentAnchorExtension(
              (from, to) => {
                const anchor = makeAnchor(view.state.doc.toString(), from, to)
                useCommentsStore
                  .getState()
                  .startDraft({ kind: 'section', path: contentPath, anchor }, anchor.quote)
              },
              (commentId) => onActivateCommentRef.current(commentId)
            ),
            EditorView.updateListener.of((u) => {
              if (u.docChanged || u.viewportChanged || u.geometryChanged) scheduleRecompute()
            })
          ])
        })
        applySectionComments(view, commentsForPathRef.current)
        reportCount()
        scheduleRecompute()
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
      recomputeRef.current = () => {}
      onPositionsChangeRef.current(contentPath, new Map())
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

  // push comment-list changes (new/resolved/deleted comments anywhere) into
  // this editor's live anchor decorations, and re-diff their positions —
  // resolving/adding/removing a comment changes the set the gutter tracks
  // even when the document itself hasn't changed.
  useEffect(() => {
    const view = handleRef.current?.view
    if (view) applySectionComments(view, commentsForPath)
    recomputeRef.current()
  }, [commentsForPath])

  // "scroll to and flash the anchor" requests from the margin gutter
  // (comments/CommentGutter.tsx, via manuscript/ManuscriptTab); a no-op
  // unless the flashed comment targets this section and its quote still
  // resolves in the live document.
  useEffect(() => {
    if (flashRequest === null) return
    const view = handleRef.current?.view
    const comment = commentsForPathRef.current.find((c) => c.id === flashRequest.commentId)
    if (!view || comment === undefined || comment.target.kind !== 'section') return
    const range = locate(view.state.doc.toString(), comment.target.anchor)
    if (range === null) return
    flashAnchor(view, range.from, range.to)
  }, [flashRequest])

  // Resolve reading-mode citation and cross-reference chips against the
  // render data the References block publishes (numbers + preview-profile
  // style + label map). A mutation observer re-applies the pass whenever
  // CodeMirror re-creates widget DOM; both passes are idempotent per serial,
  // so their own mutations converge instead of looping the observer.
  const citationRender = useManuscriptDocStore((s) => s.citationRender)
  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    applyCiteChips(host, citationRender)
    applyCrossRefChips(host, citationRender)
    applyEquationLabels(host, citationRender)
    let scheduled = false
    const observer = new MutationObserver(() => {
      if (scheduled) return
      scheduled = true
      queueMicrotask(() => {
        scheduled = false
        const latest = useManuscriptDocStore.getState().citationRender
        applyCiteChips(host, latest)
        applyCrossRefChips(host, latest)
        applyEquationLabels(host, latest)
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
})
