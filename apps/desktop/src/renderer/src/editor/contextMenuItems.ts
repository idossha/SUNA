/**
 * Pure content/layout logic for the editor's right-click context menu
 * (ContextMenu.tsx). Kept in its own JSX-free module so it's directly
 * importable from a plain `.test.ts` file — the repo has no jsdom/React
 * test harness set up, so nothing that touches JSX belongs on this side of
 * the split.
 */

export type ContextMenuActionId =
  | 'comment'
  | 'bold'
  | 'italic'
  | 'code'
  | 'strikethrough'
  | 'link'
  | 'insertCitation'
  | 'insertCrossReference'
  | 'cut'
  | 'copy'
  | 'paste'

export interface ContextMenuItem {
  kind: 'item'
  id: ContextMenuActionId
  label: string
  shortcut?: string
  enabled: boolean
}

export interface ContextMenuSeparator {
  kind: 'separator'
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator

export interface ContextMenuAvailability {
  comment: boolean
  insertCitation: boolean
  insertCrossReference: boolean
}

/**
 * The menu's contents and per-item enabled state — pure, so it's the unit
 * boundary for tests. Formatting items (Comment/Bold/Italic/Code/
 * Strikethrough) need a non-empty selection; the Insert group and Paste
 * don't ("Right-click with no selection gives the plain Cut/Copy/Paste +
 * Insert group" — feature-plan-3.md §1). An item whose behaviour the host
 * didn't supply (see `ContextMenuAvailability`) is left out of the list
 * entirely rather than shown disabled.
 */
export function buildContextMenuItems(
  hasSelection: boolean,
  available: ContextMenuAvailability
): ContextMenuEntry[] {
  const entries: ContextMenuEntry[] = []
  if (available.comment) {
    entries.push({ kind: 'item', id: 'comment', label: 'Comment', shortcut: '⌘⇧M', enabled: hasSelection })
    entries.push({ kind: 'separator' })
  }
  entries.push(
    { kind: 'item', id: 'bold', label: 'Bold', shortcut: '⌘B', enabled: hasSelection },
    { kind: 'item', id: 'italic', label: 'Italic', shortcut: '⌘I', enabled: hasSelection },
    { kind: 'item', id: 'code', label: 'Code', shortcut: '⌘⇧C', enabled: hasSelection },
    { kind: 'item', id: 'strikethrough', label: 'Strikethrough', shortcut: '⌘⇧X', enabled: hasSelection },
    { kind: 'separator' },
    { kind: 'item', id: 'link', label: 'Link…', shortcut: '⌘K', enabled: true }
  )
  if (available.insertCitation) {
    entries.push({
      kind: 'item',
      id: 'insertCitation',
      label: 'Insert citation…',
      shortcut: '⌘⇧K',
      enabled: true
    })
  }
  if (available.insertCrossReference) {
    entries.push({
      kind: 'item',
      id: 'insertCrossReference',
      label: 'Insert cross-reference…',
      enabled: true
    })
  }
  entries.push(
    { kind: 'separator' },
    { kind: 'item', id: 'cut', label: 'Cut', enabled: hasSelection },
    { kind: 'item', id: 'copy', label: 'Copy', enabled: hasSelection },
    { kind: 'item', id: 'paste', label: 'Paste', enabled: true }
  )
  return entries
}

/** Enabled item ids in menu order — the sequence arrow-key navigation
 *  cycles through (disabled items and separators are skipped). */
export function enabledActionIds(entries: readonly ContextMenuEntry[]): ContextMenuActionId[] {
  return entries.filter((e): e is ContextMenuItem => e.kind === 'item' && e.enabled).map((e) => e.id)
}

export interface MenuPositionInput {
  x: number
  y: number
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  margin?: number
}

/** Clamps/flips a pointer-anchored popup so it stays fully on-screen. */
export function clampMenuPosition({
  x,
  y,
  width,
  height,
  viewportWidth,
  viewportHeight,
  margin = 8
}: MenuPositionInput): { left: number; top: number } {
  const maxLeft = Math.max(margin, viewportWidth - width - margin)
  const maxTop = Math.max(margin, viewportHeight - height - margin)
  return { left: Math.min(Math.max(margin, x), maxLeft), top: Math.min(Math.max(margin, y), maxTop) }
}
