/**
 * Right-click context menu for prose editors (feature-plan-3.md §1).
 *
 * `openContextMenu` is the entry point used by codemirror.ts: it mounts this
 * component imperatively (its own React root appended to `document.body`),
 * so it needs no host component state — the host just forwards a native
 * `contextmenu` DOM event. At most one instance is open at a time; opening a
 * second one closes the first.
 *
 * Selectors for e2e drivers: `.md-ctxmenu` (the menu), `.md-ctxmenu-scrim`
 * (outside-click dismiss layer), `.md-ctxmenu__item` (one per action,
 * `data-action` holds the ContextMenuActionId, `.md-ctxmenu__item--disabled`
 * when inapplicable, `.md-ctxmenu__item--active` on the keyboard-focused
 * item), `.md-ctxmenu__sep` (separators).
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { EditorView } from '@codemirror/view'
import { insertLink, toggleWrap } from './markdownCommands'
import {
  buildContextMenuItems,
  clampMenuPosition,
  enabledActionIds,
  type ContextMenuActionId,
  type ContextMenuAvailability,
  type OpenReferencePdfHit
} from './contextMenuItems'
import { openInSplit } from '../state/dock'
import './formatting.css'

export type {
  ContextMenuActionId,
  ContextMenuAvailability,
  ContextMenuEntry,
  ContextMenuItem,
  ContextMenuSeparator,
  MenuPositionInput,
  OpenReferencePdfHit
} from './contextMenuItems'
export { buildContextMenuItems, clampMenuPosition, enabledActionIds } from './contextMenuItems'

export interface ContextMenuCallbacks {
  onComment?: (view: EditorView) => void
  onInsertCitation?: (view: EditorView) => void
  onInsertFigure?: (view: EditorView) => void
  onInsertCrossReference?: (view: EditorView) => void
}

function runAction(
  id: ContextMenuActionId,
  view: EditorView,
  callbacks: ContextMenuCallbacks,
  citationHit: OpenReferencePdfHit | null
): void {
  switch (id) {
    case 'comment':
      callbacks.onComment?.(view)
      break
    case 'bold':
      toggleWrap('**')(view)
      break
    case 'italic':
      toggleWrap('*')(view)
      break
    case 'code':
      toggleWrap('`')(view)
      break
    case 'strikethrough':
      toggleWrap('~~')(view)
      break
    case 'link':
      insertLink()(view)
      break
    case 'insertCitation':
      callbacks.onInsertCitation?.(view)
      break
    case 'insertFigure':
      callbacks.onInsertFigure?.(view)
      break
    case 'insertCrossReference':
      callbacks.onInsertCrossReference?.(view)
      break
    case 'openReferencePdf':
      // The item only shows enabled when citationHit.path resolved, so a
      // click always has a path here — no per-host callback needed, unlike
      // Comment/Insert citation, which need caller-specific context (a
      // section path, a comments store) this action never does.
      if (citationHit?.path !== null && citationHit?.path !== undefined) {
        openInSplit(citationHit.path, 'right')
      }
      break
    case 'cut':
      view.focus()
      document.execCommand('cut')
      break
    case 'copy':
      view.focus()
      document.execCommand('copy')
      break
    case 'paste':
      view.focus()
      document.execCommand('paste')
      break
  }
}

interface ContextMenuProps {
  view: EditorView
  x: number
  y: number
  callbacks: ContextMenuCallbacks
  /** The citation (if any) under the click, computed by codemirror.ts's
   *  contextmenu handler from the click position — see editor/citationHit.ts. */
  citationHit?: OpenReferencePdfHit | null
  onClose: () => void
}

export function ContextMenu({ view, x, y, callbacks, citationHit, onClose }: ContextMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const hasSelection = !view.state.selection.main.empty

  const items = useMemo(
    () =>
      buildContextMenuItems(hasSelection, {
        comment: callbacks.onComment !== undefined,
        insertCitation: callbacks.onInsertCitation !== undefined,
        insertFigure: callbacks.onInsertFigure !== undefined,
        insertCrossReference: callbacks.onInsertCrossReference !== undefined,
        openReferencePdf: citationHit ?? null
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      hasSelection,
      callbacks.onComment,
      callbacks.onInsertCitation,
      callbacks.onInsertFigure,
      callbacks.onInsertCrossReference,
      citationHit
    ]
  )
  const enabledIds = useMemo(() => enabledActionIds(items), [items])
  const [activeId, setActiveId] = useState<ContextMenuActionId | null>(enabledIds[0] ?? null)
  const [pos, setPos] = useState({ left: x, top: y })

  // measure after mount, then clamp to the viewport
  useEffect(() => {
    const el = menuRef.current
    if (el === null) return
    const rect = el.getBoundingClientRect()
    setPos(
      clampMenuPosition({
        x,
        y,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (enabledIds.length === 0) return
        const current = activeId === null ? -1 : enabledIds.indexOf(activeId)
        const step = event.key === 'ArrowDown' ? 1 : -1
        const next = enabledIds[(current + step + enabledIds.length) % enabledIds.length]
        setActiveId(next ?? null)
        return
      }
      if (event.key === 'Enter') {
        if (activeId === null) return
        event.preventDefault()
        runAction(activeId, view, callbacks, citationHit ?? null)
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeId, enabledIds, view, callbacks, citationHit, onClose])

  // scrolling anywhere invalidates the anchor position — dismiss rather
  // than chase it. Capture phase: the editor's own scroller doesn't bubble
  // 'scroll' to window, but a capturing listener still sees it on the way down.
  useEffect(() => {
    const onScroll = (): void => onClose()
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [onClose])

  return (
    <>
      <div
        className="md-ctxmenu-scrim"
        onMouseDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault()
          onClose()
        }}
      />
      <div ref={menuRef} className="md-ctxmenu" style={{ left: pos.left, top: pos.top }} role="menu">
        {items.map((entry, i) =>
          entry.kind === 'separator' ? (
            <div key={`sep-${i}`} className="md-ctxmenu__sep" role="separator" />
          ) : (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              data-action={entry.id}
              disabled={!entry.enabled}
              className={
                'md-ctxmenu__item' +
                (entry.enabled ? '' : ' md-ctxmenu__item--disabled') +
                (entry.id === activeId ? ' md-ctxmenu__item--active' : '')
              }
              onMouseEnter={() => entry.enabled && setActiveId(entry.id)}
              onClick={() => {
                runAction(entry.id, view, callbacks, citationHit ?? null)
                onClose()
              }}
            >
              <span>{entry.label}</span>
              {entry.shortcut !== undefined && (
                <span className="md-ctxmenu__shortcut">{entry.shortcut}</span>
              )}
            </button>
          )
        )}
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

/** Imperative entry point: mounts a ContextMenu at (x, y) for `view`,
 *  closing any menu already open. Called from codemirror.ts's native
 *  `contextmenu` DOM handler — no host component state required.
 *  `citationHit` is the citation (if any) codemirror.ts found under the
 *  click, resolved against the project's reference PDFs. */
export function openContextMenu(
  view: EditorView,
  x: number,
  y: number,
  callbacks: ContextMenuCallbacks,
  citationHit?: OpenReferencePdfHit | null
): void {
  closeActiveMount()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  activeMount = { root, container }
  root.render(
    <ContextMenu
      view={view}
      x={x}
      y={y}
      callbacks={callbacks}
      citationHit={citationHit ?? null}
      onClose={closeActiveMount}
    />
  )
}
