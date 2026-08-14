import { useEffect, type JSX } from 'react'
import { useProjectStore } from '../state/project'
import { useManuscriptStore } from '../state/manuscript'
import { openFileTab } from '../state/dock'
import { flattenBody } from './outline'
import './views.css'

function wordCount(text: string): number {
  const words = text.trim().split(/\s+/).filter((w) => w !== '')
  return words.length
}

export function ManuscriptView(): JSX.Element {
  const rootDir = useProjectStore((s) => s.rootDir)
  const saveBump = useProjectStore((s) => s.saveBump)
  const manuscript = useManuscriptStore((s) => s.manuscript)
  const error = useManuscriptStore((s) => s.error)
  const refresh = useManuscriptStore((s) => s.refresh)

  useEffect(() => {
    void refresh()
  }, [refresh, rootDir, saveBump])

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

  const rows = flattenBody(manuscript.body)

  return (
    <div className="view">
      <div>
        <div className="ms__title">{manuscript.title}</div>
        <div className="ms__meta">
          <span>
            <strong>{manuscript.authors.length}</strong>{' '}
            {manuscript.authors.length === 1 ? 'author' : 'authors'}
          </span>
          <span>
            abstract <strong>{wordCount(manuscript.abstract.content)}</strong> words
          </span>
        </div>
      </div>

      <div>
        <div className="view__section-title">Outline</div>
        <div className="ms__outline">
          {rows.map((row) => (
            <button
              key={row.key}
              className="ms__row"
              style={{ paddingLeft: `${6 + row.depth * 14}px` }}
              disabled={row.contentPath === null || rootDir === null}
              onClick={() => {
                if (row.contentPath !== null && rootDir !== null) {
                  openFileTab(`${rootDir}/manuscript/${row.contentPath}`)
                }
              }}
            >
              <span className="chip">{row.chip}</span>
              <span
                className={
                  row.label === null ? 'ms__row-label ms__row-label--untitled' : 'ms__row-label'
                }
              >
                {row.label ?? 'untitled'}
              </span>
            </button>
          ))}
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
