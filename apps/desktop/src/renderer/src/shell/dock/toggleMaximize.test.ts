import { describe, expect, it } from 'vitest'
import {
  createMaximizeState,
  toggleMaximize,
  type MaximizableDock,
  type SplitDirection
} from './toggleMaximize'

/** A dock model just real enough to watch panels move between groups. */
class FakeDock {
  groups: FakeGroup[] = []
  activeGroup?: FakeGroup
  activePanel?: FakePanel
  private nextGroupId = 1

  addGroup(rect: { left: number; top: number }, panelIds: string[]): FakeGroup {
    const group = new FakeGroup(this, `g${this.nextGroupId++}`, rect)
    for (const id of panelIds) group.panels.push(new FakePanel(id, group))
    this.groups.push(group)
    this.activeGroup ??= group
    this.activePanel ??= group.panels[0]
    return group
  }

  createGroupBeside(origin: FakeGroup, direction: SplitDirection): FakeGroup {
    const offset = { left: 0, top: 0 }
    if (direction === 'left') offset.left = -1
    if (direction === 'right') offset.left = 1
    if (direction === 'top') offset.top = -1
    if (direction === 'bottom') offset.top = 1
    return this.addGroup(
      { left: origin.rect.left + offset.left, top: origin.rect.top + offset.top },
      []
    )
  }

  dropIfEmpty(group: FakeGroup): void {
    if (group.panels.length > 0) return
    this.groups = this.groups.filter((g) => g !== group)
    if (this.activeGroup === group) this.activeGroup = this.groups[0]
  }

  getPanel(id: string): FakePanel | undefined {
    return this.groups.flatMap((g) => g.panels).find((p) => p.id === id)
  }

  layout(): Record<string, string[]> {
    return Object.fromEntries(this.groups.map((g) => [g.id, g.panels.map((p) => p.id)]))
  }

  api(): MaximizableDock {
    return this as unknown as MaximizableDock
  }
}

class FakeGroup {
  panels: FakePanel[] = []
  constructor(
    readonly dock: FakeDock,
    readonly id: string,
    readonly rect: { left: number; top: number }
  ) {}
  get element(): HTMLElement {
    return {
      getBoundingClientRect: () => ({ left: this.rect.left, top: this.rect.top }),
      contains: () => false
    } as unknown as HTMLElement
  }

  get activePanel(): FakePanel | undefined {
    return this.dock.activePanel && this.panels.includes(this.dock.activePanel)
      ? this.dock.activePanel
      : this.panels[0]
  }
}

class FakePanel {
  constructor(
    readonly id: string,
    private owner: FakeGroup
  ) {}

  get api(): {
    group: FakeGroup
    moveTo(options: { group: FakeGroup; position?: SplitDirection }): void
    setActive(): void
  } {
    const panel = this
    return {
      get group() {
        return panel.owner
      },
      moveTo: ({ group, position }) => {
        const from = panel.owner
        const dock = from.dock
        from.panels = from.panels.filter((p) => p !== panel)
        const destination = position ? dock.createGroupBeside(group, position) : group
        destination.panels.push(panel)
        panel.owner = destination
        dock.activeGroup = destination
        dock.activePanel = panel
        dock.dropIfEmpty(from)
      },
      setActive: () => {
        panel.owner.dock.activeGroup = panel.owner
        panel.owner.dock.activePanel = panel
      }
    }
  }
}

function splitDock(): FakeDock {
  const dock = new FakeDock()
  const left = dock.addGroup({ left: 0, top: 0 }, ['welcome'])
  const right = dock.addGroup({ left: 100, top: 0 }, ['manuscript', 'notes'])
  dock.activeGroup = right
  dock.activePanel = right.panels[0]
  void left
  return dock
}

describe('toggleMaximize', () => {
  it('gathers every panel into the double-clicked group, keeping the other lips', () => {
    const dock = splitDock()
    const state = createMaximizeState()

    expect(toggleMaximize(dock.api(), state)).toBe(true)

    expect(dock.groups).toHaveLength(1)
    // the welcome lip is still there, alongside the maximized tab
    expect(dock.groups[0]!.panels.map((p) => p.id).sort()).toEqual([
      'manuscript',
      'notes',
      'welcome'
    ])
    expect(dock.activePanel?.id).toBe('manuscript')
  })

  it('restores the split, on the side each panel came from', () => {
    const dock = splitDock()
    const before = dock.layout()
    const state = createMaximizeState()

    toggleMaximize(dock.api(), state)
    expect(toggleMaximize(dock.api(), state)).toBe(true)

    expect(dock.groups).toHaveLength(2)
    const restored = Object.values(dock.layout()).map((ids) => ids.sort())
    expect(restored).toContainEqual(['welcome'])
    expect(restored).toContainEqual(['manuscript', 'notes'])
    expect(Object.values(before).map((ids) => ids.sort())).toEqual(
      expect.arrayContaining(restored)
    )
    expect(dock.activePanel?.id).toBe('manuscript')
  })

  it('puts a left-hand group back on the left', () => {
    const dock = splitDock()
    const state = createMaximizeState()
    toggleMaximize(dock.api(), state)
    toggleMaximize(dock.api(), state)

    const welcomeGroup = dock.groups.find((g) => g.panels.some((p) => p.id === 'welcome'))!
    const mainGroup = dock.groups.find((g) => g.panels.some((p) => p.id === 'manuscript'))!
    expect(welcomeGroup.rect.left).toBeLessThan(mainGroup.rect.left)
  })

  it('does nothing when there is only one group', () => {
    const dock = new FakeDock()
    dock.addGroup({ left: 0, top: 0 }, ['manuscript'])
    const state = createMaximizeState()

    expect(toggleMaximize(dock.api(), state)).toBe(false)
    expect(dock.groups).toHaveLength(1)
  })

  it('skips panels closed by hand while maximized', () => {
    const dock = splitDock()
    const state = createMaximizeState()
    toggleMaximize(dock.api(), state)

    const group = dock.groups[0]!
    group.panels = group.panels.filter((p) => p.id !== 'welcome')

    expect(toggleMaximize(dock.api(), state)).toBe(true)
    expect(dock.groups).toHaveLength(1)
    expect(dock.groups[0]!.panels.map((p) => p.id)).toEqual(['manuscript', 'notes'])
  })
})
