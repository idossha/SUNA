import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { Comment } from '@suna/core'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { useProjectStore } from '../state/project'
import { useManuscriptStore } from '../state/manuscript'
import { useManuscriptDocStore } from '../state/manuscriptDoc'
import { useCommentsStore } from '../state/comments'
import { useEditorSettings } from '../editor/settings'
import { EDITOR_THEME_CLASS } from '../editor/themes'
import { SettingsPopover } from '../editor/SettingsPopover'
import '../editor/editor.css'
import { CommentGutter } from '../comments/CommentGutter'
import { useNarrowGutter } from '../comments/narrow'
import '../comments/comments.css'
import { flattenBody, type OutlineRow } from '../views/outline'
import { manuscriptStyleVars } from './msdocStyle'
import { TitlePage } from './TitlePage'
import { SectionEditor, type SectionEditorHandle } from './SectionEditor'
import { ReferencesBlock } from './ReferencesBlock'
import './manuscript.css'

const TAB_TITLE = 'Manuscript'
/** A section is "active" once its top is within this band below the viewport top. */
const ACTIVE_BAND_PX = 96
/** manuscript.css's .msdoc__toolbar height — the gutter sticks just below it, so the visible strip below the toolbar is what the edge-badge math should use. */
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

function headingFor(row: OutlineRow, dirty: boolean): JSX.Element | null {
  if (row.label === null) {
    return dirty ? <span className="msdoc__dirty msdoc__dirty--floating" /> : null
  }
  const cls =
    row.chip === 'box'
      ? 'msdoc__h msdoc__h--box'
      : row.chip === 'A'
        ? 'msdoc__h msdoc__h--a'
        : row.chip === 'B'
          ? 'msdoc__h msdoc__h--b'
          : 'msdoc__h msdoc__h--c'
  const dot = dirty ? <span className="msdoc__dirty" /> : null
  if (row.chip === 'A' || row.chip === 'box') {
    return (
      <h2 className={cls}>
        {row.label}
        {dot}
      </h2>
    )
  }
  if (row.chip === 'B') {
    return (
      <h3 className={cls}>
        {row.label}
        {dot}
      </h3>
    )
  }
  return (
    <h4 className={cls}>
      {row.label}
      {dot}
    </h4>
  )
}

/**
 * The combined manuscript document: one scrollable page with the rendered
 * title page, one live-preview CodeMirror per body section (each saving its
 * own sections/*.md), and the profile-driven reference list. Scroll position
 * drives the sidebar outline's active row via state/manuscriptDoc.
 */
export function ManuscriptTab({ api, params }: DockPanelProps): JSX.Element {
  const rootDir = String(params['rootDir'] ?? '')

  const projectRoot = useProjectStore((s) => s.rootDir)
  const saveBump = useProjectStore((s) => s.saveBump)
  const manuscript = useManuscriptStore((s) => s.manuscript)
  const manuscriptError = useManuscriptStore((s) => s.error)
  const refresh = useManuscriptStore((s) => s.refresh)

  // Subscribed field-by-field (not the whole store) so a change to any one
  // of these — width/size/font/line-height/theme — re-renders this tab and
  // reflows the title page + every section editor + the references block
  // together, live, the moment the popover below changes it.
  const contentWidthCh = useEditorSettings((s) => s.contentWidthCh)
  const fontSizePx = useEditorSettings((s) => s.fontSizePx)
  const fontFamily = useEditorSettings((s) => s.fontFamily)
  const lineHeight = useEditorSettings((s) => s.lineHeight)
  const editorTheme = useEditorSettings((s) => s.editorTheme)

  const rootRef = useRef<HTMLDivElement>(null)
  const sectionEls = useRef(new Map<number, HTMLElement>())
  const dirtySet = useRef(new Set<string>())
  const [dirtyPaths, setDirtyPaths] = useState<ReadonlySet<string>>(new Set())
  const settledSet = useRef(new Set<string>())
  const [settledCount, setSettledCount] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // ---- margin comment gutter (comments/CommentGutter) ----------------------
  const gutterTrackRef = useRef<HTMLDivElement>(null)
  const sectionEditorRefs = useRef(new Map<number, SectionEditorHandle>())
  const sectionPositions = useRef(new Map<string, ReadonlyMap<string, number>>())
  const [anchorTops, setAnchorTops] = useState<ReadonlyMap<string, number>>(new Map())
  const [gutterHeight, setGutterHeight] = useState(0)
  const narrowGutter = useNarrowGutter()
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const comments = useCommentsStore((s) => s.comments)

  const handlePositionsChange = useCallback(
    (contentPath: string, positions: ReadonlyMap<string, number>): void => {
      sectionPositions.current.set(contentPath, positions)
      const merged = new Map<string, number>()
      for (const map of sectionPositions.current.values()) {
        for (const [id, top] of map) merged.set(id, top)
      }
      setAnchorTops(merged)
    },
    []
  )

  const recomputeAllPositions = useCallback((): void => {
    sectionEditorRefs.current.forEach((handle) => handle.recomputePositions())
  }, [])

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
        recomputeAllPositions()
      })
    }
    measure()
    const resizeObserver = new ResizeObserver(() => {
      measure()
      recomputeAllPositions()
    })
    resizeObserver.observe(container)
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      resizeObserver.disconnect()
      container.removeEventListener('scroll', onScroll)
    }
  }, [recomputeAllPositions])

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
    }
  }, [api])

  const rows = useMemo(
    () => (manuscript === null ? [] : flattenBody(manuscript.body)),
    [manuscript]
  )
  const contentPaths = useMemo(
    () => rows.flatMap((row) => (row.contentPath !== null ? [row.contentPath] : [])),
    [rows]
  )

  // This document's comments: whole-manuscript comments plus every
  // section-target comment whose path is one of this document's sections
  // (figure-target comments belong to the canvas, not this gutter).
  const contentPathSet = useMemo(() => new Set(contentPaths), [contentPaths])
  const documentComments = useMemo(
    () =>
      comments.filter(
        (c) => c.target.kind === 'manuscript' || (c.target.kind === 'section' && contentPathSet.has(c.target.path))
      ),
    [comments, contentPathSet]
  )

  const handleAnchorActivate = useCallback(
    (comment: Comment): void => {
      if (comment.target.kind === 'section') {
        const path = comment.target.path
        const index = rows.findIndex((row) => row.contentPath === path)
        if (index >= 0) useManuscriptDocStore.getState().requestScroll(index)
      }
      useCommentsStore.getState().requestFlash(comment.id)
    },
    [rows]
  )

  const handleDirtyChange = useCallback(
    (contentPath: string, dirty: boolean): void => {
      if (dirty) dirtySet.current.add(contentPath)
      else dirtySet.current.delete(contentPath)
      setDirtyPaths(new Set(dirtySet.current))
      try {
        api.setTitle(dirtySet.current.size > 0 ? `${TAB_TITLE} •` : TAB_TITLE)
      } catch {
        // panel already disposed (dock unmount is deferred) — nothing to retitle
      }
    },
    [api]
  )

  const handleSettled = useCallback((contentPath: string, settled: boolean): void => {
    if (settled) settledSet.current.add(contentPath)
    else settledSet.current.delete(contentPath)
    setSettledCount(settledSet.current.size)
  }, [])

  // scroll-spy: section boundaries observed relative to the document scroller
  const recalcActive = useCallback((): void => {
    const container = rootRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    // hidden dock panel (display:none): every rect is 0 — skip the recalc
    if (containerRect.height === 0) return
    const containerTop = containerRect.top
    let active = 0
    const indices = [...sectionEls.current.keys()].sort((a, b) => a - b)
    for (const index of indices) {
      const el = sectionEls.current.get(index)
      if (el === undefined) continue
      if (el.getBoundingClientRect().top <= containerTop + ACTIVE_BAND_PX) active = index
    }
    useManuscriptDocStore.getState().setActiveSectionIndex(active)
  }, [])

  useEffect(() => {
    const container = rootRef.current
    if (!container || rows.length === 0) return
    const observer = new IntersectionObserver(() => recalcActive(), {
      root: container,
      threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]
    })
    sectionEls.current.forEach((el) => observer.observe(el))
    recalcActive()
    return () => observer.disconnect()
  }, [recalcActive, rows])

  // outline clicks: smooth-scroll to the requested section. Held (not
  // consumed) until every section editor has settled at its content height —
  // scrolling earlier would target a stale offset that shifts as editors load.
  const scrollRequest = useManuscriptDocStore((s) => s.scrollRequest)
  useEffect(() => {
    if (scrollRequest === null) return
    if (rows.length === 0 || settledCount < contentPaths.length) return
    const el = sectionEls.current.get(scrollRequest.index)
    if (el === undefined) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    useManuscriptDocStore.getState().consumeScrollRequest(scrollRequest.nonce)
  }, [scrollRequest, rows, settledCount, contentPaths.length])

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
              <TitlePage manuscript={manuscript} editable rootDir={rootDir} />
              <div className="msdoc__rule" />
              {rows.map((row, index) => (
                <section
                  key={row.key}
                  className="msdoc__section"
                  ref={(el) => {
                    if (el !== null) sectionEls.current.set(index, el)
                    else sectionEls.current.delete(index)
                  }}
                >
                  {headingFor(
                    row,
                    row.contentPath !== null && dirtyPaths.has(row.contentPath)
                  )}
                  {row.contentPath !== null && (
                    <SectionEditor
                      ref={(handle) => {
                        if (handle !== null) sectionEditorRefs.current.set(index, handle)
                        else sectionEditorRefs.current.delete(index)
                      }}
                      rootDir={rootDir}
                      contentPath={row.contentPath}
                      onDirtyChange={handleDirtyChange}
                      onSettled={handleSettled}
                      gutterRef={gutterTrackRef}
                      onPositionsChange={handlePositionsChange}
                      onActivateComment={handleActivateComment}
                    />
                  )}
                </section>
              ))}
              <div className="msdoc__rule" />
              <ReferencesBlock
                rootDir={rootDir}
                contentPaths={contentPaths}
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
            onTrackMoved={recomputeAllPositions}
          />
        )}
      </div>
    </div>
  )
}
