/**
 * Insert-citation palette (ARCHITECTURE §17.3, ⌘⇧K / context-menu "Insert
 * citation…"). Reads `<rootDir>/manuscript/<bibliography>` (defaulting to
 * "references.bib" when manuscript.json doesn't specify one — same
 * resolution manuscript/ReferencesBlock.tsx uses), lists its entries,
 * filters as you type, and inserts `[@key]` at the cursor on Enter/click.
 *
 * `openCitationPicker` mounts this imperatively next to the cursor (its own
 * React root on `document.body`, positioned from `view.coordsAtPos`, the
 * same technique Flux's selection toolbar uses — see the dissection notes)
 * so the host needs no state of its own, just a callback reference.
 *
 * Selectors for e2e drivers: `.md-citepicker` (the palette),
 * `.md-citepicker__input` (the filter field), `.md-citepicker__item` (one
 * per matching entry, `data-key` holds the bib key), `.md-citepicker__item--active`
 * (keyboard-highlighted), `.md-citepicker__empty` (loading/error/no-match state).
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { EditorView } from '@codemirror/view'
import { parseBibtex, type BibEntry } from '@suna/bib'
import { useManuscriptStore } from '../state/manuscript'
import { useProjectStore } from '../state/project'
import { insertCitation } from './markdownCommands'
import { authorSummary, filterBibEntries } from './bibFilter'
import {
  nextActiveIndex,
  pickerNavDirection,
  scrollActiveIntoView
} from './pickerNavigation'
import './formatting.css'

export { authorSummary, filterBibEntries } from './bibFilter'

const PICKER_WIDTH = 320
const PICKER_HEIGHT = 320

interface CitationPickerProps {
  view: EditorView
  onClose: () => void
}

export function CitationPicker({ view, onClose }: CitationPickerProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<BibEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const rootDir = useProjectStore((s) => s.rootDir)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    let cancelled = false
    const bibliography = useManuscriptStore.getState().manuscript?.bibliography ?? 'references.bib'
    if (rootDir === null) {
      setError('No project is open.')
      return
    }
    void (async () => {
      try {
        const { content } = await window.suna.invoke('fs:read-text', {
          path: `${rootDir}/manuscript/${bibliography}`
        })
        if (!cancelled) setEntries(parseBibtex(content).entries)
      } catch {
        if (!cancelled) setError(`No manuscript/${bibliography} in this project.`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [rootDir])

  const filtered = useMemo(() => filterBibEntries(entries ?? [], query), [entries, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [filtered.length, query])

  // keep the highlighted row on screen — the list scrolls, the arrow keys
  // walk past its bottom edge, and an off-screen highlight reads as "nothing
  // is selected"
  useEffect(() => {
    scrollActiveIntoView(listRef.current, activeIndex)
  }, [activeIndex, filtered])

  const insert = (key: string): void => {
    insertCitation(key)(view)
    onClose()
  }

  // position once, next to the cursor — coordsAtPos gives viewport
  // coordinates, so `position: fixed` needs no host-offset math
  const [pos] = useState(() => {
    const coords = view.coordsAtPos(view.state.selection.main.head)
    const x = coords?.left ?? window.innerWidth / 2
    const y = coords?.bottom ?? window.innerHeight / 2
    return {
      left: Math.min(Math.max(8, x), window.innerWidth - PICKER_WIDTH - 8),
      top: Math.min(Math.max(8, y + 6), window.innerHeight - PICKER_HEIGHT - 8)
    }
  })

  return (
    <>
      <div className="md-ctxmenu-scrim" onMouseDown={onClose} />
      <div
        className="md-citepicker"
        style={{ left: pos.left, top: pos.top }}
        role="dialog"
        aria-label="Insert citation"
      >
        <input
          ref={inputRef}
          className="md-citepicker__input"
          placeholder="Search references…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
              return
            }
            const direction = pickerNavDirection(event)
            if (direction !== null) {
              event.preventDefault()
              setActiveIndex((i) => nextActiveIndex(i, direction, filtered.length))
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              const chosen = filtered[activeIndex]
              if (chosen !== undefined) insert(chosen.key)
            }
          }}
        />
        <div className="md-citepicker__list" ref={listRef}>
          {error !== null && <div className="md-citepicker__empty">{error}</div>}
          {error === null && entries === null && <div className="md-citepicker__empty">Loading…</div>}
          {error === null && entries !== null && filtered.length === 0 && (
            <div className="md-citepicker__empty">No matching references.</div>
          )}
          {filtered.map((entry, i) => (
            <button
              key={entry.key}
              type="button"
              data-key={entry.key}
              data-picker-item=""
              className={
                'md-citepicker__item' + (i === activeIndex ? ' md-citepicker__item--active' : '')
              }
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => insert(entry.key)}
            >
              <span className="md-citepicker__item-key">@{entry.key}</span>
              <span className="md-citepicker__item-title">{entry.title || authorSummary(entry)}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

let activeMount: { root: Root; container: HTMLDivElement } | null = null

function closeActiveMount(): void {
  if (activeMount === null) return
  const { root, container } = activeMount
  activeMount = null
  root.unmount()
  container.remove()
}

/** Imperative entry point: mounts a CitationPicker anchored to `view`'s
 *  cursor, closing any picker (or context menu) already open. Called from
 *  the ⌘⇧K keymap binding and the context menu's "Insert citation…" item —
 *  no host component state required. */
export function openCitationPicker(view: EditorView): void {
  closeActiveMount()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  activeMount = { root, container }
  root.render(<CitationPicker view={view} onClose={closeActiveMount} />)
}
