import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type JSX
} from 'react'
import { StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { Comment } from '@suna/core'
import { outlineFromMarkdown, type OutlineSection } from '@suna/markdown'
import { createEditor, type EditorHandle } from '../editor/codemirror'
import { openCitationPicker } from '../editor/CitationPicker'
import { openFigurePicker } from '../editor/FigurePicker'
import { useEditorSettings } from '../editor/settings'
import { makeAnchor } from '../comments/anchor'
import {
  applySectionComments,
  commentHighlightExtension,
  liveAnchors,
  registerLiveAnchorSource
} from '../comments/anchorExtension'
import '../comments/comments.css'
import { commentsByPath, useCommentsStore } from '../state/comments'
import { acquireDocSession } from '../state/docSessions'
import { getResolved, useResolved, useSettingsStore } from '../state/settings'
import { useVimModeStore } from '../state/vimMode'
import {
  applyCiteChips,
  applyCrossRefChips,
  applyEquationLabels,
  applyFigureCaptions
} from './citeChips'
import { useManuscriptDocStore } from '../state/manuscriptDoc'
import { useRevision } from '../state/revisions'
import { revisionDiffExtension } from '../editor/revisionDiff'
import { revisionReviewKeymap, syncRevisionBase } from '../editor/revisionReview'

const NO_COMMENTS: Comment[] = []

export interface ManuscriptEditorHandle {
  /** The live CodeMirror view, once mounted — for the tab's coordsAtPos-driven scroll-spy and click-to-scroll. */
  getView: () => EditorView | null
  /** Swap reading ⇄ source. A compartment reconfigure, so document state, scroll and comment anchors survive. */
  setLive: (on: boolean) => void
}

interface ManuscriptEditorProps {
  rootDir: string
  /** Path relative to manuscript/ — the manuscript.json `manuscriptFile`, e.g. "manuscript.md". */
  contentPath: string
  /** Reading mode (live-preview decorations). Read once at mount; use the handle's `setLive` to change it after. */
  live: boolean
  /** Fired once the editor has mounted (or failed to load) and again with false on unmount. */
  onSettled: (settled: boolean) => void
  /** Fired (debounced) with the outline of the editor's CURRENT buffer, on mount and on every edit. */
  onOutlineChange: (outline: OutlineSection[]) => void
}

const OUTLINE_DEBOUNCE_MS = 500

/**
 * The combined manuscript document's single CodeMirror editor, in live-
 * preview mode, over the whole prose file (feature-plan-7 §1 — one file,
 * headings are Markdown, no more one-editor-per-section). Sizes to content —
 * the outer document (manuscript/ManuscriptTab) scrolls, never the editor.
 * ⌘S saves the whole file.
 */
export const ManuscriptEditor = forwardRef<ManuscriptEditorHandle, ManuscriptEditorProps>(
  function ManuscriptEditor({ rootDir, contentPath, live, onSettled, onOutlineChange }, ref) {
    const hostRef = useRef<HTMLDivElement>(null)
    const handleRef = useRef<EditorHandle | null>(null)
    const outlineTimerRef = useRef<number | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)

    const editorTheme = useEditorSettings((s) => s.editorTheme)
    // Resolved through the two-level hierarchy (project ?? global ?? default),
    // and read through a ref by the async create effect below, which settles
    // after mount.
    const vimMotions = useResolved('editor.vimMotions').value
    const vimRef = useRef(vimMotions)
    vimRef.current = vimMotions
    // Same ref treatment as vim: the create effect is async, so it must read
    // the value that is current when it finally runs, not when it was queued.
    const liveRef = useRef(live)
    liveRef.current = live

    // The AI baseline reaches this live editor the same way it reaches the raw
    // tab: a run finishing changes the store, toggling the setting changes the
    // resolution, and either must repaint without reopening the document.
    const revision = useRevision(contentPath)
    const aiDiffs = useResolved('review.aiDiffs').value
    useEffect(() => {
      const view = handleRef.current?.view
      if (view === undefined) return
      syncRevisionBase(view, contentPath, aiDiffs === 'inline')
    }, [revision?.base, revision?.id, aiDiffs, contentPath])

    // latest callbacks without re-creating the editor
    const onSettledRef = useRef(onSettled)
    onSettledRef.current = onSettled
    const onOutlineChangeRef = useRef(onOutlineChange)
    onOutlineChangeRef.current = onOutlineChange

    // Comments targeting this document. This editor is also what triggers
    // the initial comments:read load — the anchor highlight/gutter dot
    // should appear whether or not the human has ever opened the Comments
    // sidebar view.
    const allComments = useCommentsStore((s) => s.comments)
    // Resolved threads live in the rail's History, not in the text — only
    // open comments get an anchor highlight.
    const commentsForPath = useMemo(
      () =>
        (commentsByPath(allComments).get(contentPath) ?? NO_COMMENTS).filter((c) => !c.resolved),
      [allComments, contentPath]
    )
    const commentsForPathRef = useRef(commentsForPath)
    commentsForPathRef.current = commentsForPath

    useImperativeHandle(
      ref,
      () => ({
        getView: () => handleRef.current?.view ?? null,
        setLive: (on: boolean) => handleRef.current?.setLive(on)
      }),
      []
    )

    useEffect(() => {
      const state = useCommentsStore.getState()
      if (state.rootDir !== rootDir || (!state.loaded && !state.loading)) {
        void useCommentsStore.getState().load(rootDir)
      }
    }, [rootDir])

    useEffect(() => {
      const fileName = contentPath.split('/').pop() ?? contentPath
      const absPath = `${rootDir}/manuscript/${contentPath}`
      // idempotent; a project opens straight onto this tab, so this editor can
      // mount before the status bar's own load has settled
      void useSettingsStore.getState().load()

      const reportOutline = (): void => {
        const view = handleRef.current?.view
        if (!view) return
        onOutlineChangeRef.current(outlineFromMarkdown(view.state.doc.toString()))
      }

      const scheduleOutline = (): void => {
        if (outlineTimerRef.current !== null) window.clearTimeout(outlineTimerRef.current)
        outlineTimerRef.current = window.setTimeout(() => {
          outlineTimerRef.current = null
          reportOutline()
        }, OUTLINE_DEBOUNCE_MS)
      }

      let disposed = false
      let detach: (() => void) | null = null
      let unregisterAnchors: (() => void) | null = null
      const { session, release } = acquireDocSession(absPath)
      void (async () => {
        try {
          const content = await session.ready()
          if (disposed || !hostRef.current) return
          handleRef.current = createEditor({
            parent: hostRef.current,
            doc: content,
            fileName,
            // Lets the live preview find figures/<id>/figure.svg and resolve
            // relative image urls against the prose file itself.
            filePath: absPath,
            rootDir,
            theme: useEditorSettings.getState().editorTheme,
            live: liveRef.current,
            vim: vimRef.current,
            onVimMode: useVimModeStore.getState().setMode,
            // No onClose: this view IS the tab, so there is no file for `:q`
            // to close. The registry says so in the status bar rather than
            // doing nothing at all, which read as "vim is half-broken here".
            // Dirty tracking lives in the shared session; the outline follows
            // every doc change, including edits forwarded from another tab.
            onDocChanged: () => {
              scheduleOutline()
            },
            // Returns the promise, so vim's `:wq` can wait for the write.
            onSave: () =>
              session.save().then((ok) => {
                if (ok) reportOutline()
              }),
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
            onInsertCitation: (view) => openCitationPicker(view),
            // ⌘⇧F / context-menu "Insert figure…".
            onInsertFigure: (view) => openFigurePicker(view)
          })
          const view = handleRef.current.view
          detach = session.attach(view)

          view.dispatch({
            effects: StateEffect.appendConfig.of([
              // highlight decorations + click-to-activate; the rail owns the
              // reverse direction (card click -> reveal) and the reveal watcher
              commentHighlightExtension((commentId) =>
                useCommentsStore.getState().setActive(commentId)
              ),
              // AI-change review, same as the raw editor tab: this is the
              // surface most manuscript prose is actually read on.
              revisionDiffExtension(),
              revisionReviewKeymap(contentPath)
            ])
          })
          applySectionComments(view, commentsForPathRef.current)
          syncRevisionBase(view, contentPath, getResolved('review.aiDiffs').value === 'inline')
          // save-time re-anchoring prefers the editor's mapped ranges
          unregisterAnchors = registerLiveAnchorSource(contentPath, () => liveAnchors(view.state))
          reportOutline()
          onSettledRef.current(true)
        } catch (error) {
          if (!disposed) {
            setLoadError(error instanceof Error ? error.message : String(error))
            // a failed load still "settles" — its height is final
            onSettledRef.current(true)
          }
        }
      })()

      return () => {
        disposed = true
        onSettledRef.current(false)
        onOutlineChangeRef.current([])
        if (outlineTimerRef.current !== null) {
          window.clearTimeout(outlineTimerRef.current)
          outlineTimerRef.current = null
        }
        unregisterAnchors?.()
        detach?.()
        handleRef.current?.destroy()
        handleRef.current = null
        release()
      }
    }, [rootDir, contentPath])

    // theme changes apply to the live CM instance without losing state
    useEffect(() => {
      handleRef.current?.setTheme(editorTheme)
    }, [editorTheme])

    // Toggling vim swaps a compartment rather than rebuilding the view, so
    // scroll position, comment anchors and the outline all survive — which is
    // why vimMotions is deliberately NOT in the create effect's deps.
    //
    // Known limitation on this surface: Ctrl-d/Ctrl-u/Ctrl-f/Ctrl-b and
    // zz/zt/zb do nothing, because the vim shim scrolls by writing
    // view.scrollDOM.scrollTop while manuscript.css gives .cm-scroller
    // `overflow: visible` and lets the outer .msdoc scroll instead. Cursor
    // motions (G, gg, }) still scroll, since those go through
    // EditorView.scrollIntoView, which walks ancestor scrollers.
    useEffect(() => {
      handleRef.current?.setVim(vimMotions)
    }, [vimMotions])

    // push comment-list changes (new/resolved/deleted comments anywhere) into
    // this editor's live anchor decorations — resolving/adding/removing a
    // comment changes the set even when the document itself hasn't changed.
    // (The rail owns the reveal watcher and the active-thread mirror.)
    useEffect(() => {
      const view = handleRef.current?.view
      if (view) applySectionComments(view, commentsForPath)
    }, [commentsForPath])

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
      applyFigureCaptions(host, citationRender)
      let scheduled = false
      const observer = new MutationObserver(() => {
        if (scheduled) return
        scheduled = true
        queueMicrotask(() => {
          scheduled = false
          const latest = useManuscriptDocStore.getState().citationRender
          applyCiteChips(host, latest)
          applyCrossRefChips(host, latest)
          applyFigureCaptions(host, latest)
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
  }
)
