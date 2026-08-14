import { useEffect, useRef, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import { useTerminalPanelStore } from '../state/terminal'
import {
  attachSession,
  closeTerminalTab,
  createTerminalTab,
  detachSession,
  fitSession,
  setActiveTerminalTab,
  useTerminalTabsStore
} from './sessions'
import './terminal.css'

/**
 * Bottom terminal strip. Always mounted (it owns the app-wide Ctrl-` toggle);
 * renders nothing while closed. Sessions live in ./sessions.ts and survive
 * close/reopen — this component only mounts the active session's host div.
 */
export function TerminalPanel(): JSX.Element | null {
  const open = useTerminalPanelStore((s) => s.open)
  const heightPx = useTerminalPanelStore((s) => s.heightPx)
  const toggle = useTerminalPanelStore((s) => s.toggle)
  const setHeight = useTerminalPanelStore((s) => s.setHeight)
  const tabs = useTerminalTabsStore((s) => s.tabs)
  const activeId = useTerminalTabsStore((s) => s.activeId)
  const mountRef = useRef<HTMLDivElement | null>(null)

  // Ctrl-` toggles the panel from anywhere (xterm passes it through).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.metaKey || event.altKey) return
      if (event.code !== 'Backquote' && event.key !== '`') return
      event.preventDefault()
      useTerminalPanelStore.getState().toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // opening an empty panel spawns the first shell
  useEffect(() => {
    if (open && tabs.length === 0) createTerminalTab()
  }, [open, tabs.length])

  // mount the active session's host; refit on any panel/window resize
  useEffect(() => {
    const mount = mountRef.current
    if (!open || !mount || activeId === null) return
    attachSession(activeId, mount)
    const observer = new ResizeObserver(() => fitSession(activeId))
    observer.observe(mount)
    return () => {
      observer.disconnect()
      detachSession(activeId, mount)
    }
  }, [open, activeId])

  const startResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = heightPx
    const onMove = (ev: PointerEvent): void => {
      setHeight(startHeight + (startY - ev.clientY))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  if (!open) return null

  return (
    <section className="termpanel" style={{ height: heightPx }} aria-label="Terminal panel">
      <div
        className="termpanel__resizer"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal panel"
        onPointerDown={startResize}
      />
      <div className="termpanel__bar">
        <span className="termpanel__caption">Terminal</span>
        <div className="termpanel__tabs" role="tablist" aria-label="Terminals">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={
                tab.id === activeId
                  ? 'termpanel__tab termpanel__tab--active'
                  : 'termpanel__tab'
              }
            >
              <button
                className="termpanel__tab-name"
                role="tab"
                aria-selected={tab.id === activeId}
                onClick={() => setActiveTerminalTab(tab.id)}
              >
                {tab.title}
                {tab.status === 'exited' && (
                  <span className="termpanel__tab-note"> · exited</span>
                )}
                {tab.status === 'failed' && (
                  <span className="termpanel__tab-note"> · failed</span>
                )}
              </button>
              <button
                className="termpanel__tab-close"
                aria-label={`Close ${tab.title}`}
                onClick={() => closeTerminalTab(tab.id)}
              >
                ×
              </button>
            </div>
          ))}
          <button
            className="termpanel__new"
            title="New terminal"
            aria-label="New terminal"
            onClick={() => createTerminalTab()}
          >
            +
          </button>
        </div>
        <button
          className="termpanel__hide"
          title="Hide terminal (⌃`)"
          aria-label="Hide terminal panel"
          onClick={toggle}
        >
          –
        </button>
      </div>
      <div ref={mountRef} className="termpanel__mount" />
    </section>
  )
}
