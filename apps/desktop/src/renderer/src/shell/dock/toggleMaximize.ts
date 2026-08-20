/**
 * Double-clicking a tab lip toggles that tab's group between the split
 * layout and filling the dock ("full mode"), the way a window title bar
 * zooms. A single group already fills the dock, so it is left alone.
 */

export interface MaximizableGroup {
  api: {
    isMaximized(): boolean
    maximize(): void
    exitMaximized(): void
  }
}

export interface MaximizableDock {
  groups: unknown[]
  activeGroup?: MaximizableGroup
  hasMaximizedGroup(): boolean
  exitMaximizedGroup(): void
}

export function toggleMaximize(dock: MaximizableDock): boolean {
  if (dock.hasMaximizedGroup()) {
    dock.exitMaximizedGroup()
    return true
  }
  const group = dock.activeGroup
  if (!group || dock.groups.length < 2) return false
  group.api.maximize()
  return true
}
