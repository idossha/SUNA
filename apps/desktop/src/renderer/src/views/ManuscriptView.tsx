import { useEffect, useMemo, useState, type JSX } from 'react'
import katex from 'katex'
import { outlineFromMarkdown, type OutlineSection } from '@suna/markdown'
import { useProjectStore } from '../state/project'
import { useManuscriptStore } from '../state/manuscript'
import { countWords, useManuscriptDocStore } from '../state/manuscriptDoc'
import { openManuscriptTab } from '../state/dock'
import { splitTexSpans } from '../manuscript/title-page'
import { activeRowKey, outlineRows, totalWords, visibleRows } from './outline'
import './views.css'
import './manuscript-view.css'

/**
 * Prose with $...$ spans rendered through KaTeX, matching how the title page
 * itself renders the manuscript title (manuscript/TitlePage's TexText) —
 * the sidebar summary is otherwise the one place still showing raw "$...$".
 */
function TexText({ text }: { text: string }): JSX.Element {
  const segments = useMemo(() => splitTexSpans(text), [text])
  return (
    <>
      {segments.map((segment, i) =>
        segment.kind === 'math' ? (
          <span
            key={i}
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(segment.value, { throwOnError: false })
            }}
          />
        ) : (
          <span key={i}>{segment.value}</span>
        )
      )}
    </>
  )
}

/**
 * Manuscript sidebar: title/authors/abstract summary plus the outline —
 * clicking a row opens (or focuses) the combined manuscript tab and scrolls
 * it to that heading (feature-plan-7 §2 — activating the Manuscript view
 * itself, via the activity bar, also opens the tab; see state/ui.ts).
 */
export function ManuscriptView(): JSX.Element {
  const rootDir = useProjectStore((s) => s.rootDir)
  const saveBump = useProjectStore((s) => s.saveBump)
  const manuscript = useManuscriptStore((s) => s.manuscript)
  const error = useManuscriptStore((s) => s.error)
  const authors = useManuscriptStore((s) => s.authors)
  const refresh = useManuscriptStore((s) => s.refresh)

  const liveOutline = useManuscriptDocStore((s) => s.outline)
  const activeSectionIndex = useManuscriptDocStore((s) => s.activeSectionIndex)
  const tabActive = useManuscriptDocStore((s) => s.tabActive)
  const tabMounted = useManuscriptDocStore((s) => s.tabMounted)

  const [diskOutline, setDiskOutline] = useState<OutlineSection[]>([])
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    void refresh()
  }, [refresh, rootDir, saveBump])

  // While the combined tab is closed, the outline comes from a disk read of
  // the manuscript file; once the tab is mounted, its live editor owns the
  // outline (state/manuscriptDoc) and tracks unsaved edits too.
  useEffect(() => {
    if (tabMounted || rootDir === null || manuscript === null) return
    let cancelled = false
    void (async () => {
      try {
        const { content } = await window.suna.invoke('fs:read-text', {
          path: `${rootDir}/manuscript/${manuscript.manuscriptFile}`
        })
        if (!cancelled) setDiskOutline(outlineFromMarkdown(content))
      } catch {
        // no prose file yet
        if (!cancelled) setDiskOutline([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tabMounted, rootDir, manuscript, saveBump])

  const sections = tabMounted ? liveOutline : diskOutline
  const rows = useMemo(() => outlineRows(sections), [sections])
  const visible = useMemo(() => visibleRows(rows, collapsed), [rows, collapsed])
  const total = useMemo(() => totalWords(sections), [sections])
  const activeKey = useMemo(
    () => activeRowKey(rows, visible, activeSectionIndex),
    [rows, visible, activeSectionIndex]
  )

  const toggle = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }

  if (error !== null) {
    return (
      <div className="view">
        <div className="view__error">{error}</div>
      </div>
    )
  }
  if (!manuscript) {
    return (
      <p className="sidebar__empty">
        This project has no manuscript/manuscript.json yet.
      </p>
    )
  }

  return (
    <div className="view">
      <div>
        <div className="ms__title">
          <TexText text={manuscript.title} />
        </div>
        <div className="ms__meta">
          <span>
            <strong>{authors.authors.length}</strong>{' '}
            {authors.authors.length === 1 ? 'author' : 'authors'}
          </span>
          <span>
            abstract <strong>{countWords(manuscript.abstract.content)}</strong> words
          </span>
        </div>
      </div>

      <div>
        <div className="view__section-title">Outline</div>
        <div className="ms__outline">
          {visible.map((row) => {
            const index = rows.indexOf(row)
            const active = tabActive && activeKey === row.key
            const isCollapsed = collapsed.has(row.key)
            return (
              <button
                key={row.key}
                className={active ? 'ms__row ms__row--active' : 'ms__row'}
                style={{ paddingLeft: `${6 + row.depth * 14}px` }}
                disabled={rootDir === null}
                onClick={() => {
                  if (rootDir === null) return
                  openManuscriptTab(rootDir)
                  useManuscriptDocStore.getState().requestScroll(index)
                }}
              >
                {row.hasChildren ? (
                  <span
                    className="ms__twisty"
                    role="button"
                    tabIndex={-1}
                    aria-label={isCollapsed ? 'Expand section' : 'Collapse section'}
                    aria-expanded={!isCollapsed}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggle(row.key)
                    }}
                  >
                    {isCollapsed ? '\u203a' : '\u2304'}
                  </span>
                ) : (
                  <span className="ms__twisty ms__twisty--empty" />
                )}
                {row.chip !== '' && <span className="chip">{row.chip}</span>}
                <span
                  className={
                    row.label === null
                      ? 'ms__row-label ms__row-label--untitled'
                      : 'ms__row-label'
                  }
                >
                  {row.label ?? 'untitled'}
                </span>
                <span className="ms__count">{row.words}</span>
              </button>
            )
          })}
          <div className="ms__row ms__row--total">
            <span className="ms__twisty ms__twisty--empty" />
            <span className="ms__row-label">Total</span>
            <span className="ms__count">{total}</span>
          </div>
        </div>
      </div>

      <div className="ms__meta">
        <span>
          <strong>{manuscript.figures.length}</strong>{' '}
          {manuscript.figures.length === 1 ? 'figure' : 'figures'}
        </span>
        <span>
          <strong>{manuscript.tables.length}</strong>{' '}
          {manuscript.tables.length === 1 ? 'table' : 'tables'}
        </span>
      </div>
    </div>
  )
}
