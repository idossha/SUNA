/**
 * Insert-figure palette (⌘⇧F / context-menu "Insert figure…") — the figure
 * counterpart of CitationPicker.tsx, mounted the same imperative way (its own
 * React root on `document.body`, positioned from `view.coordsAtPos`) so the
 * host needs no state of its own.
 *
 * It offers BOTH ways a figure appears in prose, because a manuscript needs
 * both and the two are one keystroke apart:
 *
 * - Enter inserts `![[fig:id]]` — the embed, which PLACES the figure. It goes
 *   on a line of its own with the blank lines the parser requires (see
 *   markdownCommands `insertFigureEmbedEffect`).
 * - ⇧Enter inserts `@fig:id` — the in-prose reference, the exact analogue of
 *   `[@key]`, which is what you want mid-sentence ("as shown in @fig:x").
 *
 * Thumbnails come through editor/figureAssets, the same cache the live
 * preview paints from: usually already warm, and invalidated on save, so the
 * picker never shows a figure as it looked two edits ago.
 *
 * Selectors for e2e drivers: `.md-figpicker` (the palette),
 * `.md-figpicker__input` (the filter field), `.md-figpicker__item` (one per
 * matching figure, `data-figure-id` holds the id), `.md-figpicker__item--active`
 * (keyboard-highlighted), `.md-figpicker__empty` (loading/error/no-match state).
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { EditorView } from '@codemirror/view'
import { useManuscriptStore } from '../state/manuscript'
import { useProjectStore } from '../state/project'
import { scanFigures, svgDataUrl } from '../views/figures-scan'
import { loadAsset } from './figureAssets'
import { figureChoices, filterFigureChoices, type FigureChoice } from './figureChoices'
import { insertCrossReference, insertFigureEmbed } from './markdownCommands'
import './formatting.css'

export { figureChoices, filterFigureChoices, type FigureChoice } from './figureChoices'

const PICKER_WIDTH = 340
const PICKER_HEIGHT = 360

/**
 * Data URLs for thumbnails, keyed by SVG path. Separate from the asset cache
 * itself: that one holds the file's text (shared with the live preview, which
 * inlines it), and percent-encoding a 200 kB matplotlib figure on every render
 * would be the picker's whole cost. Cleared with the asset cache's own
 * invalidation via `loadAsset` returning fresh text under a fresh key.
 */
const thumbUrls = new Map<string, string>()

interface FigurePickerProps {
  view: EditorView
  onClose: () => void
}

/** One row's thumbnail: painted from cache if warm, else filled in on load. */
function Thumbnail({ path, alt }: { path: string | null; alt: string }): JSX.Element {
  const [url, setUrl] = useState<string | null>(() => (path === null ? null : thumbUrls.get(path) ?? null))

  useEffect(() => {
    if (path === null || thumbUrls.has(path)) return
    let cancelled = false
    void loadAsset(path).then((asset) => {
      if (cancelled) return
      const next = asset.kind === 'svg' ? svgDataUrl(asset.svg) : asset.kind === 'raster' ? asset.dataUri : null
      if (next === null) return
      thumbUrls.set(path, next)
      setUrl(next)
    })
    return () => {
      cancelled = true
    }
  }, [path])

  if (url === null) return <span className="md-figpicker__thumb md-figpicker__thumb--empty" />
  return <img className="md-figpicker__thumb" src={url} alt={alt} />
}

export function FigurePicker({ view, onClose }: FigurePickerProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootDir = useProjectStore((s) => s.rootDir)
  const tree = useProjectStore((s) => s.tree)
  const manuscript = useManuscriptStore((s) => s.manuscript)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const choices = useMemo(
    () => figureChoices(rootDir, manuscript?.figures ?? [], scanFigures(tree)),
    [rootDir, manuscript, tree]
  )
  const filtered = useMemo(() => filterFigureChoices(choices, query), [choices, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [filtered.length, query])

  /** Enter places the figure; ⇧Enter references it mid-sentence. */
  const insert = (choice: FigureChoice, asReference: boolean): void => {
    if (asReference) insertCrossReference(choice.id)(view)
    else insertFigureEmbed(choice.id)(view)
    onClose()
    view.focus()
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

  const empty =
    rootDir === null
      ? 'No project is open.'
      : choices.length === 0
        ? 'No figures in this project yet.'
        : 'No matching figures.'

  return (
    <>
      <div className="md-ctxmenu-scrim" onMouseDown={onClose} />
      <div
        className="md-figpicker"
        style={{ left: pos.left, top: pos.top }}
        role="dialog"
        aria-label="Insert figure"
      >
        <input
          ref={inputRef}
          className="md-figpicker__input"
          placeholder="Search figures…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
              return
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((i) => Math.max(i - 1, 0))
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              const chosen = filtered[activeIndex]
              if (chosen !== undefined) insert(chosen, event.shiftKey)
            }
          }}
        />
        <div className="md-figpicker__list">
          {filtered.length === 0 && <div className="md-figpicker__empty">{empty}</div>}
          {filtered.map((choice, i) => (
            <button
              key={choice.id}
              type="button"
              data-figure-id={choice.id}
              className={
                'md-figpicker__item' + (i === activeIndex ? ' md-figpicker__item--active' : '')
              }
              onMouseEnter={() => setActiveIndex(i)}
              // ⇧-click matches ⇧Enter: reference instead of place.
              onClick={(event) => insert(choice, event.shiftKey)}
            >
              <Thumbnail path={choice.svgPath} alt={choice.id} />
              <span className="md-figpicker__item-text">
                <span className="md-figpicker__item-id">fig:{choice.id}</span>
                <span className="md-figpicker__item-title">
                  {choice.title ??
                    (choice.inManuscript ? 'Untitled' : 'not in manuscript.json — no caption or number')}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="md-figpicker__hint">
          <span>
            <kbd>↵</kbd> place figure
          </span>
          <span>
            <kbd>⇧↵</kbd> reference it
          </span>
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

/** Imperative entry point: mounts a FigurePicker anchored to `view`'s cursor,
 *  closing any picker (or context menu) already open. Called from the ⌘⇧F
 *  keymap binding and the context menu's "Insert figure…" item — no host
 *  component state required. */
export function openFigurePicker(view: EditorView): void {
  closeActiveMount()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  activeMount = { root, container }
  root.render(<FigurePicker view={view} onClose={closeActiveMount} />)
}
