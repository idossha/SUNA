import { useEffect, useRef, useState, type JSX } from 'react'

/**
 * Interactive output: a plot that is still a plot — pan, zoom, hover, legend
 * clicks — rather than a picture of one.
 *
 * It renders in an iframe served over the `suna-output:` scheme (see
 * main/services/output-frame.ts) because that is the only place its scripts
 * are allowed to run: sandboxed, cross-origin, no preload, no `window.suna`.
 * The frame is handed HTML and hands back a height; nothing else crosses.
 */

/** Kept in step with the scheme the main process registers. */
const FRAME_URL = 'suna-output://frame/'

interface FrameMessage {
  type?: string
  height?: number
}

export function InteractiveOutput({ html }: { html: string }): JSX.Element {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(120)

  useEffect(() => {
    const post = (): void => {
      frameRef.current?.contentWindow?.postMessage(
        {
          type: 'suna-output-render',
          html,
          // The frame is a separate document and inherits no stylesheet, so
          // the one thing worth carrying across is the ink colour.
          color: getComputedStyle(document.body).getPropertyValue('--s-ink').trim()
        },
        '*'
      )
    }

    const onMessage = (event: MessageEvent): void => {
      if (event.source !== frameRef.current?.contentWindow) return
      const data = event.data as FrameMessage
      if (data?.type === 'suna-output-ready') post()
      // A little slack under the reported height: some libraries draw a
      // shadow or a hover toolbar just past their own box.
      else if (data?.type === 'suna-output-size' && typeof data.height === 'number') {
        setHeight(Math.max(40, Math.min(data.height + 8, 2400)))
      }
    }

    window.addEventListener('message', onMessage)
    // The frame may already have loaded and sent its ready before this
    // listener existed (a re-render with new html does exactly that).
    post()
    return () => window.removeEventListener('message', onMessage)
  }, [html])

  return (
    <iframe
      ref={frameRef}
      className="nb-output__frame"
      title="Interactive output"
      src={FRAME_URL}
      style={{ height: `${height}px` }}
      // No allow-same-origin: the frame stays in an opaque origin, so its
      // scripts can draw and can fetch their own library, and can reach
      // nothing of the app's.
      sandbox="allow-scripts allow-popups allow-downloads"
    />
  )
}
