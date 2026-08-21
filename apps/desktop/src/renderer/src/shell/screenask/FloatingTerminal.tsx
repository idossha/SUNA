/**
 * The floating agent terminal: one draggable, resizable window hosting the
 * interactive `claude` session a screen-ask started.
 *
 * It floats rather than docking because of what it is for. The bottom strip
 * is the right home for a shell you glance at; this session is a conversation
 * ABOUT something on screen — a figure, a panel, a layout — and a strip
 * pinned to the bottom edge covers exactly the thing being discussed. Here
 * the user drags it off to the side and keeps looking at their work.
 *
 * The pty itself is an ordinary session in terminal/sessions.ts, tagged
 * `surface: 'float'` so the strip does not list it. Geometry is persisted so
 * the window comes back where it was left, and so is the pty id: ptys
 * outlive the renderer, so a reload used to leave a live agent running with
 * no window attached to it (see restoreFloatTerminal in screenask.ts). A
 * session that ends for any other reason leaves a note pointing at its
 * bundle rather than disappearing without a word.
 */
import { useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import {
  attachSession,
  closeTerminalTab,
  detachSession,
  fitSession,
  useTerminalTabsStore
} from '../../terminal/sessions'
import {
  forgetFloatTerminal,
  setFloatGeometryReset,
  useFloatTerminalStore
} from './screenask'
import './screenask.css'

interface Geometry {
  x: number
  y: number
  width: number
  height: number
}

const GEOMETRY_KEY = 'suna.floatTerminal'
const MIN_WIDTH = 360
const MIN_HEIGHT = 200

/** Bottom-right by default: out of the way of a left sidebar and a top tab bar. */
function defaultGeometry(): Geometry {
  const width = Math.min(620, Math.max(MIN_WIDTH, window.innerWidth - 120))
  const height = Math.min(420, Math.max(MIN_HEIGHT, window.innerHeight - 200))
  return { x: Math.max(20, window.innerWidth - width - 40), y: Math.max(20, window.innerHeight - height - 80), width, height }
}

/**
 * Keep the window on screen. Applied on load AND on every window resize:
 * geometry saved on a large display would otherwise put the whole thing past
 * the right edge of a laptop screen, with no way to drag it back.
 */
export function clampGeometry(geometry: Geometry, viewport: { width: number; height: number }): Geometry {
  const width = Math.min(Math.max(geometry.width, MIN_WIDTH), Math.max(MIN_WIDTH, viewport.width))
  const height = Math.min(Math.max(geometry.height, MIN_HEIGHT), Math.max(MIN_HEIGHT, viewport.height))
  return {
    width,
    height,
    x: Math.min(Math.max(geometry.x, 0), Math.max(0, viewport.width - width)),
    y: Math.min(Math.max(geometry.y, 0), Math.max(0, viewport.height - height))
  }
}

function loadGeometry(): Geometry {
  try {
    const raw = window.localStorage.getItem(GEOMETRY_KEY)
    if (raw === null) return defaultGeometry()
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      ['x', 'y', 'width', 'height'].some(
        (key) => typeof (parsed as Record<string, unknown>)[key] !== 'number'
      )
    ) {
      return defaultGeometry()
    }
    return clampGeometry(parsed as Geometry, {
      width: window.innerWidth,
      height: window.innerHeight
    })
  } catch {
    return defaultGeometry()
  }
}

function saveGeometry(geometry: Geometry): void {
  try {
    window.localStorage.setItem(GEOMETRY_KEY, JSON.stringify(geometry))
  } catch {
    // persistence is best-effort; the in-memory geometry still applies
  }
}

export function FloatingTerminal(): JSX.Element | null {
  const termId = useFloatTerminalStore((s) => s.termId)
  const bundleDir = useFloatTerminalStore((s) => s.bundleDir)
  const minimized = useFloatTerminalStore((s) => s.minimized)
  const lostBundleDir = useFloatTerminalStore((s) => s.lostBundleDir)
  const tab = useTerminalTabsStore((s) => s.tabs.find((entry) => entry.id === termId) ?? null)
  const [geometry, setGeometry] = useState<Geometry>(loadGeometry)
  const mountRef = useRef<HTMLDivElement | null>(null)

  // A session the user closed from the strip's side of the world (or one that
  // never made it into the store) leaves a window with nothing in it. It
  // vanishing silently is what made this feature feel haunted, so the bundle
  // dir survives as a note the user can act on.
  useEffect(() => {
    if (termId !== null && tab === null) forgetFloatTerminal(bundleDir)
  }, [termId, tab, bundleDir])

  // Let `AI: Show the agent terminal` drag a window back from wherever a
  // stale saved geometry put it.
  useEffect(() => {
    setFloatGeometryReset(() => {
      const fresh = defaultGeometry()
      saveGeometry(fresh)
      setGeometry(fresh)
    })
    return () => setFloatGeometryReset(null)
  }, [])

  useEffect(() => {
    const onResize = (): void => {
      setGeometry((current) =>
        clampGeometry(current, { width: window.innerWidth, height: window.innerHeight })
      )
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Mount the pty's host; refit whenever the window is dragged or resized.
  useEffect(() => {
    const mount = mountRef.current
    if (termId === null || mount === null || minimized) return
    attachSession(termId, mount)
    const observer = new ResizeObserver(() => fitSession(termId))
    observer.observe(mount)
    return () => {
      observer.disconnect()
      detachSession(termId, mount)
    }
  }, [termId, minimized])

  if (termId === null || tab === null) {
    return lostBundleDir === null ? null : (
      <div className="floatterm__lost" role="status">
        <span>The agent terminal closed. Its screenshot and prompt are saved.</span>
        <button
          onClick={() => {
            void window.suna.invoke('shell:reveal', { path: lostBundleDir }).catch(() => {})
          }}
        >
          Show bundle
        </button>
        <button
          aria-label="Dismiss"
          onClick={() => useFloatTerminalStore.setState({ lostBundleDir: null })}
        >
          ×
        </button>
      </div>
    )
  }

  /** One pointer-drag helper for both the title bar and the resize grip. */
  const startGesture = (
    event: ReactPointerEvent<HTMLElement>,
    apply: (dx: number, dy: number, start: Geometry) => Geometry
  ): void => {
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const start = geometry
    const onMove = (move: PointerEvent): void => {
      setGeometry(
        clampGeometry(apply(move.clientX - startX, move.clientY - startY, start), {
          width: window.innerWidth,
          height: window.innerHeight
        })
      )
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setGeometry((current) => {
        saveGeometry(current)
        return current
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const close = (): void => {
    closeTerminalTab(termId)
    // An explicit close leaves no note: the user knows where it went.
    forgetFloatTerminal(null)
  }

  const status =
    tab.status === 'exited'
      ? ' · exited'
      : tab.status === 'failed'
        ? ' · failed'
        : tab.status === 'starting'
          ? ' · starting'
          : ''

  return (
    <section
      className="floatterm"
      aria-label="Agent terminal"
      style={{
        left: geometry.x,
        top: geometry.y,
        width: geometry.width,
        height: minimized ? undefined : geometry.height
      }}
    >
      <header
        className="floatterm__bar"
        onPointerDown={(event) =>
          startGesture(event, (dx, dy, start) => ({ ...start, x: start.x + dx, y: start.y + dy }))
        }
      >
        <span className="floatterm__title">
          ✦ {tab.title}
          <span className="floatterm__status">{status}</span>
        </span>
        {bundleDir !== null && (
          <button
            className="floatterm__reveal"
            title={`Show the bundle: ${bundleDir}`}
            aria-label="Show this ask's bundle in the file manager"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              void window.suna.invoke('shell:reveal', { path: bundleDir }).catch(() => {})
            }}
          >
            ⤓
          </button>
        )}
        <button
          className="floatterm__min"
          title={minimized ? 'Expand' : 'Collapse'}
          aria-label={minimized ? 'Expand agent terminal' : 'Collapse agent terminal'}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => useFloatTerminalStore.setState({ minimized: !minimized })}
        >
          {minimized ? '▣' : '–'}
        </button>
        <button
          className="floatterm__close"
          title="Close (ends the session)"
          aria-label="Close agent terminal"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={close}
        >
          ×
        </button>
      </header>
      {!minimized && (
        <>
          <div ref={mountRef} className="floatterm__mount" />
          <div
            className="floatterm__grip"
            role="separator"
            aria-label="Resize agent terminal"
            onPointerDown={(event) =>
              startGesture(event, (dx, dy, start) => ({
                ...start,
                width: start.width + dx,
                height: start.height + dy
              }))
            }
          />
        </>
      )}
    </section>
  )
}
