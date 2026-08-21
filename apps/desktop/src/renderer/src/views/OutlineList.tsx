import { useMemo, useState, type JSX } from 'react'
import type { OutlineSection } from '@suna/markdown'
import { activeRowKey, outlineRows, totalWords, visibleRows } from './outline'
import './views.css'
import './manuscript-view.css'

/**
 * The document outline, shared by every document that has one — the
 * manuscript (views/ManuscriptView) and the Supplementary Information
 * (documents/DocumentOutline) today, any structured kind that grows a tab
 * tomorrow.
 *
 * It was two lists before, and they had drifted: only one had collapse
 * twisties, only one rolled child word counts up into their parent, and only
 * one brought its document's tab to the front when a row was clicked. Since
 * both project the SAME `outlineFromMarkdown` sections through the SAME
 * `outlineRows`/`visibleRows`/`activeRowKey` helpers, the difference was
 * accident rather than design — so the rendering lives here once and the
 * callers supply only what actually differs: the heading, and what "go to
 * this section" means for their document.
 *
 * Two independent toggles, both local to the panel (nothing about which
 * headings you folded belongs in a file):
 *  - the header disclosure hides the whole outline;
 *  - a row's twisty folds its branch, and the active highlight then rolls up
 *    to the nearest visible ancestor so a collapsed parent still lights.
 */
export function OutlineList({
  title,
  sections,
  activeIndex,
  highlightActive,
  disabled = false,
  emptyLabel,
  onPick
}: {
  /** Heading over the list — "Outline" for the manuscript, the title otherwise. */
  title: string
  sections: readonly OutlineSection[]
  /** Index into `sections` of the heading the document is scrolled to. */
  activeIndex: number
  /** Light the active row — false when this document's tab is not frontmost. */
  highlightActive: boolean
  disabled?: boolean
  /** Shown in place of the rows when there are no headings. */
  emptyLabel: string
  /** Go to section `index` of this document. */
  onPick: (index: number) => void
}): JSX.Element {
  const [open, setOpen] = useState(true)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())

  const rows = useMemo(() => outlineRows(sections), [sections])
  const visible = useMemo(() => visibleRows(rows, collapsed), [rows, collapsed])
  const total = useMemo(() => totalWords(sections), [sections])
  const activeKey = useMemo(
    () => activeRowKey(rows, visible, activeIndex),
    [rows, visible, activeIndex]
  )

  const toggle = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }

  return (
    <div className="ms__outline-block">
      <button
        className="view__section-title ms__outline-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={open ? 'Hide the outline' : 'Show the outline'}
      >
        <span className={`ms__twisty${open ? ' is-open' : ''}`} aria-hidden="true">
          {'›'}
        </span>
        <span className="ms__outline-head-label">{title}</span>
      </button>

      {open &&
        (rows.length === 0 ? (
          <p className="view__hint ms__outline-empty">{emptyLabel}</p>
        ) : (
          <div className="ms__outline">
            {visible.map((row) => {
              const index = rows.indexOf(row)
              const active = highlightActive && activeKey === row.key
              const isCollapsed = collapsed.has(row.key)
              return (
                <button
                  key={row.key}
                  className={active ? 'ms__row ms__row--active' : 'ms__row'}
                  style={{ paddingLeft: `${6 + row.depth * 14}px` }}
                  disabled={disabled}
                  onClick={() => onPick(index)}
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
                      {isCollapsed ? '›' : '⌄'}
                    </span>
                  ) : (
                    <span className="ms__twisty ms__twisty--empty" />
                  )}
                  {row.chip !== '' && <span className="chip">{row.chip}</span>}
                  <span
                    className={
                      row.label === null ? 'ms__row-label ms__row-label--untitled' : 'ms__row-label'
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
        ))}
    </div>
  )
}
