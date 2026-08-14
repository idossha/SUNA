import { useEffect, useMemo, type JSX } from 'react'
import { useProjectStore } from '../state/project'
import { useManuscriptStore } from '../state/manuscript'
import { countWords, useManuscriptDocStore } from '../state/manuscriptDoc'
import { openManuscriptTab } from '../state/dock'
import { flattenBody } from './outline'
import './views.css'
import './manuscript-view.css'

export function ManuscriptView(): JSX.Element {
  const rootDir = useProjectStore((s) => s.rootDir)
  const saveBump = useProjectStore((s) => s.saveBump)
  const manuscript = useManuscriptStore((s) => s.manuscript)
  const error = useManuscriptStore((s) => s.error)
  const refresh = useManuscriptStore((s) => s.refresh)

  const wordCounts = useManuscriptDocStore((s) => s.wordCounts)
  const activeSectionIndex = useManuscriptDocStore((s) => s.activeSectionIndex)
  const tabActive = useManuscriptDocStore((s) => s.tabActive)
  const tabMounted = useManuscriptDocStore((s) => s.tabMounted)

  useEffect(() => {
    void refresh()
  }, [refresh, rootDir, saveBump])

  const rows = useMemo(
    () => (manuscript === null ? [] : flattenBody(manuscript.body)),
    [manuscript]
  )

  // While the combined tab is closed, word counts come from disk; when it is
  // mounted, its live editors own the counts (they recount on edit + save).
  useEffect(() => {
    if (tabMounted || rootDir === null || manuscript === null) return
    let cancelled = false
    void (async () => {
      const counts: Record<string, number> = {}
      await Promise.all(
        rows.map(async (row) => {
          const contentPath = row.contentPath
          if (contentPath === null) return
          try {
            const { content } = await window.suna.invoke('fs:read-text', {
              path: `${rootDir}/manuscript/${contentPath}`
            })
            counts[contentPath] = countWords(content)
          } catch {
            // missing section file — leave the count blank
          }
        })
      )
      if (!cancelled) useManuscriptDocStore.getState().replaceWordCounts(counts)
    })()
    return () => {
      cancelled = true
    }
  }, [tabMounted, rootDir, manuscript, rows, saveBump])

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
      <button
        className="ms__open"
        disabled={rootDir === null}
        onClick={() => {
          if (rootDir !== null) openManuscriptTab(rootDir)
        }}
      >
        Open full manuscript
      </button>

      <div>
        <div className="ms__title">{manuscript.title}</div>
        <div className="ms__meta">
          <span>
            <strong>{manuscript.authors.length}</strong>{' '}
            {manuscript.authors.length === 1 ? 'author' : 'authors'}
          </span>
          <span>
            abstract <strong>{countWords(manuscript.abstract.content)}</strong> words
          </span>
        </div>
      </div>

      <div>
        <div className="view__section-title">Outline</div>
        <div className="ms__outline">
          {rows.map((row, index) => {
            const active = tabActive && activeSectionIndex === index
            const count =
              row.contentPath !== null ? wordCounts[row.contentPath] : undefined
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
                <span className="chip">{row.chip}</span>
                <span
                  className={
                    row.label === null
                      ? 'ms__row-label ms__row-label--untitled'
                      : 'ms__row-label'
                  }
                >
                  {row.label ?? 'untitled'}
                </span>
                {count !== undefined && <span className="ms__count">{count}</span>}
              </button>
            )
          })}
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
