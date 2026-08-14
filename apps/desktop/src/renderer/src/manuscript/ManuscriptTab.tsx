import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { useProjectStore } from '../state/project'
import { useManuscriptStore } from '../state/manuscript'
import { useManuscriptDocStore } from '../state/manuscriptDoc'
import { useEditorSettings } from '../editor/settings'
import { EDITOR_THEME_CLASS } from '../editor/themes'
import { SettingsPopover } from '../editor/SettingsPopover'
import '../editor/editor.css'
import { flattenBody, type OutlineRow } from '../views/outline'
import { manuscriptStyleVars } from './msdocStyle'
import { TitlePage } from './TitlePage'
import { SectionEditor } from './SectionEditor'
import { ReferencesBlock } from './ReferencesBlock'
import './manuscript.css'

const TAB_TITLE = 'Manuscript'
/** A section is "active" once its top is within this band below the viewport top. */
const ACTIVE_BAND_PX = 96

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
            <TitlePage manuscript={manuscript} />
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
                    rootDir={rootDir}
                    contentPath={row.contentPath}
                    onDirtyChange={handleDirtyChange}
                    onSettled={handleSettled}
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
    </div>
  )
}
