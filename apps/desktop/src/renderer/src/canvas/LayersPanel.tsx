import { useEffect, useRef, useState, type JSX } from 'react'
import type { CanvasDocument } from '@suna/canvas'
import type { CanvasCommand } from '@suna/core'
import { styleValue } from './canvas-util'

/** Rendered rows are hard-capped (spec §6: virtualize above 500). */
const MAX_ROWS = 500

interface Row {
  el: Element
  id: string | null
  tag: string
  depth: number
  /** Engine target for the parent ('#root' for the artboard), null when unaddressable. */
  parentTarget: string | null
  key: string
}

interface LayersPanelProps {
  doc: CanvasDocument | null
  rev: number
  selectedIds: string[]
  open: boolean
  onToggle: () => void
  onSelect: (id: string, additive: boolean) => void
  apply: (command: CanvasCommand, label: string) => boolean
  rename: (oldId: string, newId: string) => void
  note: (text: string) => void
}

function buildRows(doc: CanvasDocument): { rows: Row[]; overflow: number } {
  const rows: Row[] = []
  let overflow = 0
  const walk = (parent: Element, parentTarget: string | null, depth: number, keyBase: string): void => {
    let i = 0
    for (const el of parent.children) {
      const key = `${keyBase}/${i}`
      if (rows.length >= MAX_ROWS) {
        overflow += 1 + el.querySelectorAll('*').length
        i++
        continue
      }
      const id = el.getAttribute('id')
      rows.push({ el, id, tag: el.localName, depth, parentTarget, key })
      walk(el, id ?? null, depth + 1, key)
      i++
    }
  }
  walk(doc.root, '#root', 0, 'r')
  return { rows, overflow }
}

/**
 * Layers panel (spec §6): depth-indented element tree of the ENGINE document.
 * Click selects, drag reorders within a parent (or reparents into a group),
 * double-click renames the id, the eye toggles `display` via set-style.
 */
export function LayersPanel(props: LayersPanelProps): JSX.Element {
  const { doc, selectedIds, open, onToggle, onSelect, apply, rename, note } = props
  const bodyRef = useRef<HTMLDivElement>(null)
  const dragRowRef = useRef<Row | null>(null)
  const [renaming, setRenaming] = useState<{ key: string; value: string } | null>(null)
  const [dropKey, setDropKey] = useState<string | null>(null)

  useEffect(() => {
    const row = bodyRef.current?.querySelector('.canvas-layers__row[aria-selected="true"]')
    row?.scrollIntoView({ block: 'nearest' })
  }, [selectedIds])

  if (!open) {
    return (
      <div className="canvas-side canvas-side--collapsed">
        <button className="canvas-side__expand" title="Show layers" onClick={onToggle}>
          ›
        </button>
        <span className="canvas-side__collapsed-label">Layers</span>
      </div>
    )
  }

  const built = doc ? buildRows(doc) : { rows: [], overflow: 0 }

  const commitRename = (row: Row): void => {
    const value = renaming?.value.trim() ?? ''
    setRenaming(null)
    if (!doc || value === '' || value === row.id) return
    if (/\s/.test(value)) {
      note('Ids cannot contain whitespace')
      return
    }
    if (doc.getById(value) !== null) {
      note(`Id "${value}" is already in use`)
      return
    }
    if (row.id) rename(row.id, value)
  }

  const onDrop = (target: Row): void => {
    const dragged = dragRowRef.current
    dragRowRef.current = null
    setDropKey(null)
    if (!doc || !dragged?.id || dragged.el === target.el) return
    if (dragged.el.contains(target.el)) return // no dropping into own subtree
    if (target.el.parentElement === dragged.el.parentElement) {
      // Reorder within the parent: index is the position AFTER the move.
      if (dragged.parentTarget === null) return
      const siblings = Array.from(dragged.el.parentElement?.children ?? []).filter(
        (el) => el !== dragged.el
      )
      const index = siblings.indexOf(target.el)
      if (index < 0) return
      apply(
        { kind: 'reparent', target: dragged.id, parent: dragged.parentTarget, index },
        'Reorder layer'
      )
    } else if (target.tag === 'g' && target.id) {
      apply({ kind: 'reparent', target: dragged.id, parent: target.id }, 'Reparent layer')
    }
  }

  return (
    <div className="canvas-side canvas-layers">
      <div className="canvas-side__header">
        <span>Layers</span>
        <button className="canvas-side__chevron" title="Hide layers" onClick={onToggle}>
          ‹
        </button>
      </div>
      <div className="canvas-layers__body" ref={bodyRef}>
        {built.rows.map((row) => {
          const hidden = styleValue(row.el, 'display') === 'none'
          const selected = row.id !== null && selectedIds.includes(row.id)
          return (
            <div
              key={row.key}
              className={`canvas-layers__row${dropKey === row.key ? ' canvas-layers__row--drop' : ''}`}
              aria-selected={selected}
              style={{ paddingLeft: 8 + row.depth * 12 }}
              draggable={row.id !== null}
              onDragStart={() => {
                dragRowRef.current = row
              }}
              onDragEnd={() => {
                dragRowRef.current = null
                setDropKey(null)
              }}
              onDragOver={(e) => {
                if (dragRowRef.current && dragRowRef.current.el !== row.el) {
                  e.preventDefault()
                  setDropKey(row.key)
                }
              }}
              onDragLeave={() => setDropKey((k) => (k === row.key ? null : k))}
              onDrop={(e) => {
                e.preventDefault()
                onDrop(row)
              }}
              onClick={(e) => {
                if (row.id) onSelect(row.id, e.shiftKey)
              }}
              onDoubleClick={() => {
                if (row.id) setRenaming({ key: row.key, value: row.id })
              }}
            >
              <span className="canvas-layers__tag">{row.tag}</span>
              {renaming?.key === row.key ? (
                <input
                  className="canvas-layers__rename"
                  value={renaming.value}
                  autoFocus
                  spellCheck={false}
                  onChange={(e) => setRenaming({ key: row.key, value: e.target.value })}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') commitRename(row)
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                  onBlur={() => commitRename(row)}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className={`canvas-layers__name${row.id ? '' : ' canvas-layers__name--anon'}`}>
                  {row.id ?? '—'}
                </span>
              )}
              <button
                className={`canvas-layers__eye${hidden ? ' canvas-layers__eye--off' : ''}`}
                title={hidden ? 'Show' : 'Hide'}
                onClick={(e) => {
                  e.stopPropagation()
                  const target = row.id
                  if (!target) return
                  apply(
                    { kind: 'set-style', target, props: { display: hidden ? null : 'none' } },
                    hidden ? 'Show layer' : 'Hide layer'
                  )
                }}
              >
                {hidden ? '◌' : '●'}
              </button>
            </div>
          )
        })}
        {built.overflow > 0 && (
          <div className="canvas-layers__more">…{built.overflow} more elements</div>
        )}
      </div>
    </div>
  )
}
