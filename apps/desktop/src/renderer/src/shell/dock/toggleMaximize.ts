/**
 * Double-clicking a tab lip puts that tab in full mode, and double-clicking
 * again restores the split.
 *
 * dockview's own `maximize()` hides every other group outright, which takes
 * their tab lips with it — the only way back would be a second double-click
 * on the one tab still showing. Instead full mode *gathers*: every other
 * group's panels move into the double-clicked group, so all the lips stay in
 * one row and any of them is still one click away. Restoring sends them back
 * to a group on the side they came from.
 */

import type { DockviewApi, DockviewGroupPanel } from 'dockview'

export type SplitDirection = 'top' | 'bottom' | 'left' | 'right'

/** The slice of dockview's API full mode needs. */
export type MaximizableDock = Pick<
  DockviewApi,
  'groups' | 'activeGroup' | 'activePanel' | 'getPanel'
>

interface GatheredPanel {
  readonly panelId: string
  readonly sourceGroupId: string
  readonly direction: SplitDirection
}

export interface MaximizeState {
  gathered: GatheredPanel[]
  activePanelId?: string
}

export function createMaximizeState(): MaximizeState {
  return { gathered: [] }
}

/** Which side `source` sits on relative to `target`. */
function directionOf(source: DockviewGroupPanel, target: DockviewGroupPanel): SplitDirection {
  const a = source.element?.getBoundingClientRect()
  const b = target.element?.getBoundingClientRect()
  if (!a || !b) return 'right'
  const dx = a.left - b.left
  const dy = a.top - b.top
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right'
  return dy < 0 ? 'top' : 'bottom'
}

/** The group whose header the double-click landed in. */
function groupAt(dock: MaximizableDock, element: HTMLElement | null): DockviewGroupPanel | undefined {
  if (element) {
    const hit = dock.groups.find((group) => group.element?.contains(element))
    if (hit) return hit
  }
  return dock.activeGroup
}

export function toggleMaximize(
  dock: MaximizableDock,
  state: MaximizeState,
  origin?: HTMLElement | null
): boolean {
  if (state.gathered.length > 0) return restore(dock, state, origin)
  return gather(dock, state, origin)
}

function gather(
  dock: MaximizableDock,
  state: MaximizeState,
  origin?: HTMLElement | null
): boolean {
  const target = groupAt(dock, origin ?? null)
  if (!target || dock.groups.length < 2) return false

  // the tab that was double-clicked stays the one on top
  const active = target.activePanel ?? dock.activePanel
  const others = dock.groups.filter((group) => group.id !== target.id)
  const gathered: GatheredPanel[] = []

  for (const group of others) {
    const direction = directionOf(group, target)
    for (const panel of [...group.panels]) {
      gathered.push({ panelId: panel.id, sourceGroupId: group.id, direction })
      panel.api.moveTo({ group: target })
    }
  }

  if (gathered.length === 0) return false
  state.gathered = gathered
  state.activePanelId = active?.id
  active?.api.setActive()
  return true
}

function restore(
  dock: MaximizableDock,
  state: MaximizeState,
  origin?: HTMLElement | null
): boolean {
  const target = groupAt(dock, origin ?? null)
  const gathered = state.gathered
  state.gathered = []
  if (!target) return false

  // one new group per group the panels were gathered from
  const rebuilt = new Map<string, DockviewGroupPanel>()

  for (const entry of gathered) {
    const panel = dock.getPanel(entry.panelId)
    if (!panel) continue // moved or closed by hand since; skip it
    const existing = rebuilt.get(entry.sourceGroupId)
    if (existing) {
      panel.api.moveTo({ group: existing })
    } else {
      panel.api.moveTo({ group: target, position: entry.direction })
      rebuilt.set(entry.sourceGroupId, panel.api.group)
    }
  }

  const active = state.activePanelId ? dock.getPanel(state.activePanelId) : undefined
  state.activePanelId = undefined
  active?.api.setActive()
  return true
}
