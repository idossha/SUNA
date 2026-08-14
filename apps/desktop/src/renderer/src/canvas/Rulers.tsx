import { forwardRef, useImperativeHandle, useRef, type JSX } from 'react'
import type { RulerTick } from './ruler-ticks'

/**
 * Horizontal + vertical rulers around the viewport (canvas parity spec §2):
 * ticks in mm (1mm minor / 10mm major, labeled), origin at the artboard's
 * top-left.
 *
 * React owns only *which* ticks exist (mm + major, from rulerTicks); their
 * screen positions and the live cursor marker are pushed in imperatively.
 * That is not just a perf choice: a tick's px position comes from the
 * artboard's live CTM, which is only correct AFTER React has committed the
 * new world transform, so the host sets it from a layout effect (see
 * CanvasTab's `useLayoutEffect`). Computing px during render reads the
 * *previous* transform and leaves the ruler a frame behind the canvas.
 */

export interface RulersHandle {
  setCursorPx: (x: number | null, y: number | null) => void
  /** Position ticks, index-aligned with the `hTicks` / `vTicks` props. */
  setTickPx: (hPx: readonly number[], vPx: readonly number[]) => void
}

interface RulersProps {
  hTicks: RulerTick[]
  vTicks: RulerTick[]
}

export const Rulers = forwardRef<RulersHandle, RulersProps>(function Rulers(
  { hTicks, vTicks },
  ref
): JSX.Element {
  const hCursorRef = useRef<HTMLDivElement>(null)
  const vCursorRef = useRef<HTMLDivElement>(null)
  const hTickRefs = useRef<(HTMLDivElement | null)[]>([])
  const vTickRefs = useRef<(HTMLDivElement | null)[]>([])

  useImperativeHandle(
    ref,
    () => ({
      setCursorPx: (x, y) => {
        const h = hCursorRef.current
        if (h) h.style.display = x === null ? 'none' : 'block'
        if (h && x !== null) h.style.left = `${x}px`
        const v = vCursorRef.current
        if (v) v.style.display = y === null ? 'none' : 'block'
        if (v && y !== null) v.style.top = `${y}px`
      },
      setTickPx: (hPx, vPx) => {
        hTickRefs.current.forEach((el, i) => {
          const px = hPx[i]
          if (!el || px === undefined) return
          el.style.left = `${px}px`
          // Ticks outside the visible ruler would otherwise stretch it.
          el.style.display = px < -40 ? 'none' : 'block'
        })
        vTickRefs.current.forEach((el, i) => {
          const px = vPx[i]
          if (!el || px === undefined) return
          el.style.top = `${px}px`
          el.style.display = px < -40 ? 'none' : 'block'
        })
      }
    }),
    []
  )

  return (
    <>
      <div className="canvas-ruler canvas-ruler--h">
        {hTicks.map((t, i) => (
          <div
            key={t.mm}
            ref={(el) => {
              hTickRefs.current[i] = el
            }}
            className={`canvas-ruler__tick${t.major ? ' canvas-ruler__tick--major' : ''}`}
            data-mm={t.mm}
          >
            {t.major && <span className="canvas-ruler__label">{t.mm}</span>}
          </div>
        ))}
        <div ref={hCursorRef} className="canvas-ruler__cursor canvas-ruler__cursor--h" />
      </div>
      <div className="canvas-ruler canvas-ruler--v">
        {vTicks.map((t, i) => (
          <div
            key={t.mm}
            ref={(el) => {
              vTickRefs.current[i] = el
            }}
            className={`canvas-ruler__tick canvas-ruler__tick--v${t.major ? ' canvas-ruler__tick--major' : ''}`}
            data-mm={t.mm}
          >
            {t.major && <span className="canvas-ruler__label">{t.mm}</span>}
          </div>
        ))}
        <div ref={vCursorRef} className="canvas-ruler__cursor canvas-ruler__cursor--v" />
      </div>
    </>
  )
})
