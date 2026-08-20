import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { EditorView } from '@codemirror/view'
import type { OutlineSection } from '@suna/markdown'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { openExportTab } from '../state/dock'
import { useProjectStore } from '../state/project'
import { useManuscriptStore } from '../state/manuscript'
import { PRIMARY_DOC_SLICE, docSlice, useManuscriptDocStore } from '../state/manuscriptDoc'
import { useCommentsStore } from '../state/comments'
import { useDocSessionMeta } from '../state/docSessions'
import { useUiStore } from '../state/ui'
import { useEditorSettings } from '../editor/settings'
import { DivergenceBanner } from '../editor/DivergenceBanner'
import { ReviewBar } from '../editor/ReviewBar'
import type { EditorViewMode } from '../editor/EditorTab'
import { getResolved, useResolved } from '../state/settings'
import { EDITOR_THEME_CLASS } from '../editor/themes'
import { SettingsPopover } from '../editor/SettingsPopover'
import '../editor/editor.css'
import { cancelAnchorPin } from '../comments/anchorExtension'
import { CommentsRail } from '../comments/CommentsRail'
import { RailToggleButton } from '../comments/RailToggleButton'
import '../comments/comments.css'
import { manuscriptStyleVars } from './msdocStyle'
import { TitlePage } from './TitlePage'
import { ManuscriptEditor, type ManuscriptEditorHandle } from './ManuscriptEditor'
import { ReferencesBlock } from './ReferencesBlock'
import './manuscript.css'

const TAB_TITLE = 'Manuscript'
/** EditorTab keeps its own copy unexported; same labels, so the two toolbars read alike. */
const MODE_LABEL: Record<EditorViewMode, string> = {
  source: 'Source',
  reading: 'Reading'
}
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

  const wrapRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [settled, setSettled] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // The shared doc session's dirty flag (state/docSessions) — one source of
  // truth with the Explorer's raw editor tab on the same file.
  const manuscriptFile = manuscript?.manuscriptFile ?? 'manuscript.md'
  const absPath = `${rootDir}/manuscript/${manuscriptFile}`
  const dirty = useDocSessionMeta(absPath)?.dirty ?? false
  useEffect(() => {
    try {
      api.setTitle(dirty ? `${TAB_TITLE} •` : TAB_TITLE)
    } catch {
      // panel already disposed (dock unmount is deferred) — nothing to retitle
    }
  }, [dirty, api])

  // Same contract as EditorTab: open in the resolved default mode, and once
  // the user has picked one with ⌘E or the button, stop following the setting.
  const defaultMode = useResolved('editor.defaultMode').value as EditorViewMode
  const [mode, setMode] = useState<EditorViewMode>(() => getResolved('editor.defaultMode').value)
  const userPickedModeRef = useRef(false)

  const editorRef = useRef<ManuscriptEditorHandle>(null)
  /** Stable identity: the rail's effects key on it (a fresh inline arrow per
   *  render would re-fire them all). The ref makes the empty deps safe. */
  const getEditorView = useCallback((): EditorView | null => editorRef.current?.getView() ?? null, [])
  /** The document's scroll element — the rail's aligned track syncs to it. */
  const getScrollElement = useCallback((): HTMLElement | null => rootRef.current, [])
  const comments = useCommentsStore((s) => s.comments)

  // This tab shows the primary manuscript. When other document kinds get
  // their own tabs (feature-plan-12 §2, §6) this becomes a panel param.
  const documentId = PRIMARY_DOC_SLICE
  const outline = useManuscriptDocStore((s) => docSlice(s, documentId).outline)

  const handleOutlineChange = useCallback((next: OutlineSection[]): void => {
    useManuscriptDocStore.getState().setOutline(documentId, next)
  }, [])

  /** Viewport-relative top of a document position, diffed against the scroll
   *  container's rect — the scroll-spy's only geometry read (the old
   *  comment-positioning machinery that shared this helper is gone). */
  const headingTopIn = (view: EditorView, pos: number, container: Element): number | null => {
    const coords = view.coordsAtPos(pos)
    if (coords === null) return null
    return coords.top - container.getBoundingClientRect().top
  }

  // scroll-spy: which outline heading is currently at (or just above) the
  // active band. Only positions inside CodeMirror's rendered viewport have
  // trustworthy coordinates, so headings BEFORE that range are taken as
  // above the band by definition (the rendered range always covers what the
  // user can see) and headings after it as below. Measuring those with
  // coordsAtPos was the old bug: an unrendered heading could resolve to a
  // bogus small top — or to null while section 0 resolved — and the
  // indicator snapped back to the first section mid-document.
  const recalcActive = useCallback((): void => {
    const view = editorRef.current?.getView()
    const container = rootRef.current
    if (!view || !container || outline.length === 0) return
    const containerRect = container.getBoundingClientRect()
    // hidden dock panel (display:none): every rect is 0 — skip the recalc
    if (containerRect.height === 0) return
    const { from, to } = view.viewport
    let active: number | null = null
    for (let i = 0; i < outline.length; i++) {
      const pos = outline[i]!.headingFrom
      if (pos < from) {
        active = i
        continue
      }
      if (pos > to) break
      const top = headingTopIn(view, pos, container)
      if (top === null) continue
      if (top > ACTIVE_BAND_PX) break
      active = i
    }
    if (active !== null) useManuscriptDocStore.getState().setActiveSectionIndex(documentId, active)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outline])

  const toggleMode = useCallback((): void => {
    userPickedModeRef.current = true
    setMode((current) => {
      const next: EditorViewMode = current === 'source' ? 'reading' : 'source'
      editorRef.current?.setLive(next === 'reading')
      return next
    })
  }, [])

  // adopt the persisted default once settings arrive, unless ⌘E already ran
  useEffect(() => {
    if (userPickedModeRef.current) return
    setMode(defaultMode)
    editorRef.current?.setLive(defaultMode === 'reading')
  }, [defaultMode])

  // Swapping the live compartment changes every block widget's height, so the
  // scroll-spy has to be re-measured against the new geometry.
  useEffect(() => {
    editorRef.current?.getView()?.requestMeasure()
    recalcActive()
  }, [mode, recalcActive])

  // ⌘E toggles reading ⇄ source (matching EditorTab); ⌘⌥M toggles the rail.
  // Listens on the OUTER wrapper so the shortcuts fire with focus in the rail.
  useEffect(() => {
    const node = wrapRef.current
    if (!node) return
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key === 'e') {
        event.preventDefault()
        toggleMode()
      }
      if (event.altKey && (event.key === 'm' || event.code === 'KeyM')) {
        event.preventDefault()
        useUiStore.getState().toggleCommentsRail()
      }
    }
    node.addEventListener('keydown', onKey)
    return () => node.removeEventListener('keydown', onKey)
  }, [toggleMode])

  // The scroll-spy tracks the scroll container; rAF-throttled since scroll
  // fires every frame of a drag. This was never the comments' lag source —
  // the per-frame CARD layout is gone; only the active-heading check remains.
  useEffect(() => {
    const container = rootRef.current
    if (!container) return
    let scheduled = false
    const onScroll = (): void => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        recalcActive()
      })
    }
    const resizeObserver = new ResizeObserver(() => {
      recalcActive()
    })
    resizeObserver.observe(container)
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      resizeObserver.disconnect()
      container.removeEventListener('scroll', onScroll)
    }
  }, [recalcActive])

  // the outline shifts on every edit (debounced) — re-run the scroll-spy
  // against the new heading positions.
  useEffect(() => {
    recalcActive()
  }, [recalcActive])

  useEffect(() => {
    void refresh()
  }, [refresh, rootDir, saveBump])

  // announce mount + frontmost state to the sidebar outline
  useEffect(() => {
    const store = useManuscriptDocStore.getState()
    store.setTabMounted(documentId, true)
    store.setTabActive(documentId, api.isActive)
    const disposable = api.onDidActiveChange(({ isActive }) => {
      useManuscriptDocStore.getState().setTabActive(documentId, isActive)
    })
    return () => {
      disposable.dispose()
      // Drop the whole slice rather than blanking its fields: a closed tab
      // owns no outline, and leaving an empty one behind would make the
      // sidebar's "tab is mounted" test lie.
      useManuscriptDocStore.getState().forgetDocument(documentId)
    }
  }, [api, documentId])

  // This document's comments: whole-manuscript comments plus every
  // section-target comment targeting the manuscript file (figure-target
  // comments belong to the canvas, not this gutter).
  const documentComments = useMemo(
    () =>
      comments.filter(
        (c) => c.target.kind === 'manuscript' || (c.target.kind === 'section' && c.target.path === manuscriptFile)
      ),
    [comments, manuscriptFile]
  )

  const handleSettled = useCallback((next: boolean): void => {
    setSettled(next)
  }, [])

  // outline clicks: scroll to the requested heading via CodeMirror's own
  // ancestor-aware scrollIntoView (comments/anchorExtension's revealAnchor
  // uses the same mechanism). Held (not consumed) until the editor has
  // settled — scrolling earlier would target a view that doesn't exist yet.
  const scrollRequest = useManuscriptDocStore((s) => docSlice(s, documentId).scrollRequest)
  useEffect(() => {
    if (scrollRequest === null || !settled) return
    const view = editorRef.current?.getView()
    const section = outline[scrollRequest.index]
    if (view && section !== undefined) {
      // a comment jump may still be holding the document at its anchor —
      // release it before scrolling somewhere else entirely
      cancelAnchorPin()
      view.dispatch({
        effects: EditorView.scrollIntoView(section.headingFrom, {
          y: 'start',
          yMargin: TOOLBAR_HEIGHT_PX + 16
        })
      })
    }
    useManuscriptDocStore.getState().consumeScrollRequest(documentId, scrollRequest.nonce)
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
    <div ref={wrapRef} className="mstab">
      <div
        ref={rootRef}
        className={`msdoc msdoc--${mode} editor-tab ${EDITOR_THEME_CLASS[editorTheme]}`}
        style={settingsStyle}
      >
        <div className="msdoc__toolbar">
          {dirty && <span className="msdoc__dirty" aria-hidden="true" />}
          <button
            className="editor-tab__mode"
            onClick={toggleMode}
            title="Toggle reading / source (⌘E)"
          >
            {MODE_LABEL[mode]}
          </button>
          <RailToggleButton docPath={manuscriptFile} includeWholeManuscript />
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
        <DivergenceBanner path={absPath} />
        <ReviewBar
          sectionPath={manuscript?.manuscriptFile ?? null}
          getView={getEditorView}
        />
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
                  documentId={documentId}
                  ref={editorRef}
                  rootDir={rootDir}
                  contentPath={manuscriptFile}
                  live={mode === 'reading'}
                  onSettled={handleSettled}
                  onOutlineChange={handleOutlineChange}
                />
                <div className="msdoc__rule" />
                <ReferencesBlock
                  documentId={documentId}
                  rootDir={rootDir}
                  manuscriptFile={manuscriptFile}
                  figures={manuscript.figures}
                  tables={manuscript.tables}
                  bibliography={manuscript.bibliography}
                />
              </>
            )}
          </div>
        </div>
      </div>
      {!stale && manuscript !== null && (
        <CommentsRail
          comments={documentComments}
          docPath={manuscriptFile}
          getView={getEditorView}
          getScrollElement={getScrollElement}
        />
      )}
    </div>
  )
}
