import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { EditorView } from '@codemirror/view'
import type { Comment } from '@suna/core'
import type { OutlineSection } from '@suna/markdown'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { openExportTab } from '../state/dock'
import { useProjectStore } from '../state/project'
import { useManuscriptStore } from '../state/manuscript'
import { useManuscriptDocStore } from '../state/manuscriptDoc'
import { useCommentsStore } from '../state/comments'
import { useEditorSettings } from '../editor/settings'
import { EDITOR_THEME_CLASS } from '../editor/themes'
import { SettingsPopover } from '../editor/SettingsPopover'
import '../editor/editor.css'
import { CommentGutter } from '../comments/CommentGutter'
import { anchorTopIn } from '../comments/anchorExtension'
import { useNarrowGutter } from '../comments/narrow'
import '../comments/comments.css'
import { manuscriptStyleVars } from './msdocStyle'
import { TitlePage } from './TitlePage'
import { ManuscriptEditor, type ManuscriptEditorHandle } from './ManuscriptEditor'
import { ReferencesBlock } from './ReferencesBlock'
import './manuscript.css'

const TAB_TITLE = 'Manuscript'
/** A heading is "active" once its top is within this band below the viewport top. */
const ACTIVE_BAND_PX = 96
/** manuscript.css's .msdoc__toolbar height — kept clear of the sticky toolbar when scrolling to a heading. */
const TOOLBAR_HEIGHT_PX = 40

/**
 * Local copy of EditorTab's gear glyph — EditorTab doesn't export its
 * (unexported) `GearIcon`, and the zone for this work item is manuscript/
 * only, so this is the "thin local equivalent" the plan allows for rather
 * than reaching into editor/EditorTab.tsx.
 */
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

/**
 * The combined manuscript document: one scrollable page with the rendered
 * title page, a single live-preview CodeMirror over the whole manuscript.md
 * (feature-plan-7 §1 — sections are Markdown headings, not files), and the
 * profile-driven reference list. The outline (@suna/markdown's
 * outlineFromMarkdown, via ManuscriptEditor) drives the sidebar's outline
 * list and this tab's scroll-spy/click-to-scroll, both keyed by document
 * offset (`OutlineSection.headingFrom`) rather than a DOM element per
 * section.
 */
export function ManuscriptTab({ api, params }: DockPanelProps): JSX.Element {
  const rootDir = String(params['rootDir'] ?? '')

  const projectRoot = useProjectStore((s) => s.rootDir)
  const saveBump = useProjectStore((s) => s.saveBump)
  const manuscript = useManuscriptStore((s) => s.manuscript)
  const manuscriptError = useManuscriptStore((s) => s.error)
  const authors = useManuscriptStore((s) => s.authors)
  const refresh = useManuscriptStore((s) => s.refresh)

  // Subscribed field-by-field (not the whole store) so a change to any one
  // of these — width/size/font/line-height/theme — re-renders this tab and
  // reflows the title page, the editor, and the references block together,
  // live, the moment the popover below changes it.
  const contentWidthCh = useEditorSettings((s) => s.contentWidthCh)
  const fontSizePx = useEditorSettings((s) => s.fontSizePx)
  const fontFamily = useEditorSettings((s) => s.fontFamily)
  const lineHeight = useEditorSettings((s) => s.lineHeight)
  const editorTheme = useEditorSettings((s) => s.editorTheme)

  const rootRef = useRef<HTMLDivElement>(null)
  const [dirty, setDirty] = useState(false)
  const [settled, setSettled] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // ---- margin comment gutter (comments/CommentGutter) ----------------------
  const gutterTrackRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<ManuscriptEditorHandle>(null)
  const [anchorTops, setAnchorTops] = useState<ReadonlyMap<string, number>>(new Map())
  const [gutterHeight, setGutterHeight] = useState(0)
  const narrowGutter = useNarrowGutter()
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const comments = useCommentsStore((s) => s.comments)

  const outline = useManuscriptDocStore((s) => s.outline)

  const handlePositionsChange = useCallback((positions: ReadonlyMap<string, number>): void => {
    setAnchorTops(positions)
  }, [])

  const handleOutlineChange = useCallback((next: OutlineSection[]): void => {
    useManuscriptDocStore.getState().setOutline(next)
  }, [])

  // scroll-spy: which outline heading is currently at (or just above) the
  // active band, via coordsAtPos on the single editor. A heading whose
  // position hasn't rendered yet (outside CodeMirror's current viewport)
  // simply doesn't resolve this pass — the active index just holds at its
  // last known value until scrolling brings it (or a neighbor) into range.
  const recalcActive = useCallback((): void => {
    const view = editorRef.current?.getView()
    const container = rootRef.current
    if (!view || !container || outline.length === 0) return
    const containerRect = container.getBoundingClientRect()
    // hidden dock panel (display:none): every rect is 0 — skip the recalc
    if (containerRect.height === 0) return
    let active: number | null = null
    outline.forEach((section, i) => {
      const top = anchorTopIn(view, section.headingFrom, container)
      if (top !== null && top <= ACTIVE_BAND_PX) active = i
    })
    if (active !== null) useManuscriptDocStore.getState().setActiveSectionIndex(active)
  }, [outline])

  const recomputeAll = useCallback((): void => {
    editorRef.current?.recomputePositions()
    recalcActive()
  }, [recalcActive])

  // container geometry drives both the gutter's edge-badge math and the
  // narrow-mode breakpoint; scroll is rAF-throttled since it fires on every
  // frame of a drag-scroll, resize via ResizeObserver (layout-driven, cheap).
  useEffect(() => {
    const container = rootRef.current
    if (!container) return
    let scheduled = false
    const measure = (): void => {
      setGutterHeight(Math.max(0, container.clientHeight - TOOLBAR_HEIGHT_PX))
    }
    const onScroll = (): void => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        recomputeAll()
      })
    }
    measure()
    const resizeObserver = new ResizeObserver(() => {
      measure()
      recomputeAll()
    })
    resizeObserver.observe(container)
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      resizeObserver.disconnect()
      container.removeEventListener('scroll', onScroll)
    }
  }, [recomputeAll])

  // the outline shifts on every edit (debounced) — re-run the scroll-spy
  // against the new heading positions.
  useEffect(() => {
    recalcActive()
  }, [recalcActive])

  const handleActivateComment = useCallback((id: string): void => {
    setActiveCommentId(id)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, rootDir, saveBump])

  // announce mount + frontmost state to the sidebar outline
  useEffect(() => {
    const store = useManuscriptDocStore.getState()
    store.setTabMounted(true)
    store.setTabActive(api.isActive)
    const disposable = api.onDidActiveChange(({ isActive }) => {
      useManuscriptDocStore.getState().setTabActive(isActive)
    })
    return () => {
      disposable.dispose()
      const s = useManuscriptDocStore.getState()
      s.setTabMounted(false)
      s.setTabActive(false)
      s.setOutline([])
    }
  }, [api])

  // This document's comments: whole-manuscript comments plus every
  // section-target comment targeting the manuscript file (figure-target
  // comments belong to the canvas, not this gutter).
  const manuscriptFile = manuscript?.manuscriptFile ?? 'manuscript.md'
  const documentComments = useMemo(
    () =>
      comments.filter(
        (c) => c.target.kind === 'manuscript' || (c.target.kind === 'section' && c.target.path === manuscriptFile)
      ),
    [comments, manuscriptFile]
  )

  // A margin card was clicked: flash (and, via CodeMirror's own
  // scrollIntoView, scroll to) its anchor — there is only one editor now, so
  // no separate "scroll to the right section first" step is needed.
  const handleAnchorActivate = useCallback((comment: Comment): void => {
    useCommentsStore.getState().requestFlash(comment.id)
  }, [])

  const handleDirtyChange = useCallback(
    (nextDirty: boolean): void => {
      setDirty(nextDirty)
      try {
        api.setTitle(nextDirty ? `${TAB_TITLE} •` : TAB_TITLE)
      } catch {
        // panel already disposed (dock unmount is deferred) — nothing to retitle
      }
    },
    [api]
  )

  const handleSettled = useCallback((next: boolean): void => {
    setSettled(next)
  }, [])

  // outline clicks: scroll to the requested heading via CodeMirror's own
  // ancestor-aware scrollIntoView (comments/anchorExtension's flashAnchor
  // uses the same mechanism). Held (not consumed) until the editor has
  // settled — scrolling earlier would target a view that doesn't exist yet.
  const scrollRequest = useManuscriptDocStore((s) => s.scrollRequest)
  useEffect(() => {
    if (scrollRequest === null || !settled) return
    const view = editorRef.current?.getView()
    const section = outline[scrollRequest.index]
    if (view && section !== undefined) {
      view.dispatch({
        effects: EditorView.scrollIntoView(section.headingFrom, {
          y: 'start',
          yMargin: TOOLBAR_HEIGHT_PX + 16
        })
      })
    }
    useManuscriptDocStore.getState().consumeScrollRequest(scrollRequest.nonce)
  }, [scrollRequest, settled, outline])

  const settingsStyle = manuscriptStyleVars({
    contentWidthCh,
    fontSizePx,
    fontFamily,
    lineHeight,
    editorTheme
  })

  const stale = projectRoot !== null && projectRoot !== rootDir

  return (
    <div
      ref={rootRef}
      className={`msdoc editor-tab ${EDITOR_THEME_CLASS[editorTheme]}`}
      style={settingsStyle}
    >
      <div className="msdoc__toolbar">
        {dirty && <span className="msdoc__dirty" aria-hidden="true" />}
        <button
          className="msdoc__export-btn"
          onClick={() => !stale && openExportTab(rootDir)}
          disabled={stale}
          title="Export as Word or PDF"
        >
          Export…
        </button>
        <button
          className="editor-tab__gear"
          onClick={() => setSettingsOpen((open) => !open)}
          title="Manuscript appearance"
          aria-label="Manuscript appearance settings"
        >
          <GearIcon />
        </button>
        {settingsOpen && <SettingsPopover onClose={() => setSettingsOpen(false)} />}
      </div>
      <div className="msdoc__body">
        <div className="msdoc__page">
          {stale && (
            <p className="msdoc__hint">
              This manuscript belongs to a project that is no longer open.
            </p>
          )}
          {!stale && manuscriptError !== null && (
            <div className="msdoc__error">{manuscriptError}</div>
          )}
          {!stale && manuscriptError === null && manuscript === null && (
            <p className="msdoc__hint">This project has no manuscript/manuscript.json yet.</p>
          )}
          {!stale && manuscript !== null && (
            <>
              <TitlePage
                manuscript={manuscript}
                authors={authors.authors}
                affiliations={authors.affiliations}
                editable
                rootDir={rootDir}
              />
              <div className="msdoc__rule" />
              <ManuscriptEditor
                ref={editorRef}
                rootDir={rootDir}
                contentPath={manuscriptFile}
                onDirtyChange={handleDirtyChange}
                onSettled={handleSettled}
                onOutlineChange={handleOutlineChange}
                gutterRef={gutterTrackRef}
                onPositionsChange={handlePositionsChange}
                onActivateComment={handleActivateComment}
              />
              <div className="msdoc__rule" />
              <ReferencesBlock
                rootDir={rootDir}
                manuscriptFile={manuscriptFile}
                figures={manuscript.figures}
                tables={manuscript.tables}
                bibliography={manuscript.bibliography}
              />
            </>
          )}
        </div>
        {!stale && manuscript !== null && (
          <CommentGutter
            ref={gutterTrackRef}
            comments={documentComments}
            anchorTops={anchorTops}
            containerHeight={gutterHeight}
            narrow={narrowGutter}
            activeId={activeCommentId}
            onActiveIdChange={setActiveCommentId}
            onAnchorActivate={handleAnchorActivate}
            onTrackMoved={recomputeAll}
          />
        )}
      </div>
    </div>
  )
}
