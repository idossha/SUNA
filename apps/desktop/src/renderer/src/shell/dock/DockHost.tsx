import { useEffect, useRef, type ComponentType, type JSX } from 'react'
import {
  DockviewComponent,
  type DockviewApi,
  type DockviewTheme,
  type GroupPanelPartInitParameters,
  type IContentRenderer
} from 'dockview'
import { createRoot, type Root } from 'react-dom/client'
import 'dockview/dist/styles/dockview.css'
import { createMaximizeState, toggleMaximize } from './toggleMaximize'

/**
 * Minimal React adapter over dockview-core v8 (which ships no React binding).
 * Each dockview content renderer owns a div and mounts the mapped React
 * component into it with its own root.
 */

export interface DockPanelProps {
  api: GroupPanelPartInitParameters['api']
  containerApi: DockviewApi
  params: Record<string, unknown>
}

export type DockPanelComponent = ComponentType<DockPanelProps>

const sunaTheme: DockviewTheme = {
  name: 'suna',
  className: 'dockview-theme-suna',
  colorScheme: 'dark',
  gap: 0
}

class ReactContentRenderer implements IContentRenderer {
  readonly element = document.createElement('div')
  private root: Root | null = null

  constructor(private readonly Component: DockPanelComponent) {
    this.element.className = 'dock-panel'
  }

  init(parameters: GroupPanelPartInitParameters): void {
    const { Component } = this
    this.root = createRoot(this.element)
    this.root.render(
      <Component
        api={parameters.api}
        containerApi={parameters.containerApi}
        params={parameters.params ?? {}}
      />
    )
  }

  dispose(): void {
    // defer: dockview may dispose synchronously while React is rendering
    const root = this.root
    this.root = null
    queueMicrotask(() => root?.unmount())
  }
}

function MissingPanel(): JSX.Element {
  return <div className="sidebar__empty">Unknown panel component.</div>
}

interface DockHostProps {
  components: Record<string, DockPanelComponent>
  onReady: (api: DockviewApi) => void
}

export function DockHost({ components, onReady }: DockHostProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  // latest maps, without re-creating the dockview instance on re-render
  const componentsRef = useRef(components)
  componentsRef.current = components

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const dockview = new DockviewComponent(container, {
      theme: sunaTheme,
      createComponent: ({ name }) =>
        new ReactContentRenderer(componentsRef.current[name] ?? MissingPanel)
    })
    onReady(dockview.api)

    // double-clicking a tab lip zooms its group to fill the dock, and back
    const maximizeState = createMaximizeState()
    const onDoubleClick = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null
      const tab = target?.closest('.dv-tab')
      if (!tab) return
      if (toggleMaximize(dockview.api, maximizeState, tab as HTMLElement)) event.preventDefault()
    }
    container.addEventListener('dblclick', onDoubleClick)

    const observer = new ResizeObserver(() => {
      dockview.layout(container.clientWidth, container.clientHeight)
    })
    observer.observe(container)

    return () => {
      container.removeEventListener('dblclick', onDoubleClick)
      observer.disconnect()
      dockview.dispose()
    }
    // mount-once: the dockview instance must survive React re-renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={containerRef} className="dock-host" />
}
