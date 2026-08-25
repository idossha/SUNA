/**
 * Choosing what to show for one output.
 *
 * A kernel sends the SAME result in several representations at once — a plot
 * arrives as `image/png` and as `<Figure size 640x480>` — and the renderer
 * picks the richest one it can actually display. Jupyter's own rule, and the
 * one used here: highest-priority supported type wins, and a type nothing can
 * render falls back down the list rather than showing nothing.
 */

export type Representation =
  /** A live plot: its own library, its own scripts, in a sandboxed frame. */
  | { kind: 'interactive'; mime: string; value: unknown }
  /** HTML that only means something once its scripts run — same frame. */
  | { kind: 'script-html'; html: string }
  | { kind: 'image'; mime: string; data: string }
  | { kind: 'svg'; svg: string }
  | { kind: 'html'; html: string }
  | { kind: 'markdown'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'json'; value: unknown }
  | { kind: 'none' }

/**
 * Richest first. `text/plain` is last on purpose: it is the representation
 * every kernel always includes, so anything above it is a deliberate upgrade.
 */
export const MIME_PRIORITY = [
  // Interactive plots first. A kernel that sends one ALSO sends a static
  // png and a text repr as fallbacks, and preferring the fallback would
  // silently turn every plotly figure in the notebook into a picture.
  'application/vnd.plotly.v1+json',
  'application/vnd.vegalite.v6+json',
  'application/vnd.vegalite.v5+json',
  'application/vnd.vegalite.v4+json',
  'application/vnd.vegalite.v3+json',
  'application/vnd.vega.v6+json',
  'application/vnd.vega.v5+json',
  'application/vnd.vega.v4+json',
  'application/vnd.vega.v3+json',
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/html',
  'text/markdown',
  'application/json',
  'text/plain'
] as const

/** The mime types rendered by loading a plotting library in the frame. */
export const INTERACTIVE_MIMES: ReadonlySet<string> = new Set<string>(
  MIME_PRIORITY.filter((mime) => mime.startsWith('application/vnd.'))
)

function asText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every((line) => typeof line === 'string')) {
    return (value as string[]).join('')
  }
  return null
}

/** The representation to render for a mime bundle. */
export function pickRepresentation(data: Record<string, unknown>): Representation {
  for (const mime of MIME_PRIORITY) {
    if (!(mime in data)) continue
    const value = data[mime]

    if (INTERACTIVE_MIMES.has(mime)) return { kind: 'interactive', mime, value }
    if (mime === 'application/json') return { kind: 'json', value }

    const text = asText(value)
    if (text === null) continue

    if (mime === 'image/svg+xml') return { kind: 'svg', svg: text }
    if (mime.startsWith('image/')) return { kind: 'image', mime, data: text }
    // Scripts never run in the app document (innerHTML does not execute
    // them, and the CSP forbids it anyway); HTML that carries any goes to
    // the sandboxed frame instead, which is what makes bokeh and a
    // `to_html()` plotly figure actually work.
    if (mime === 'text/html') {
      return /<script[\s>]/i.test(text) ? { kind: 'script-html', html: text } : { kind: 'html', html: text }
    }
    if (mime === 'text/markdown') return { kind: 'markdown', text }
    return { kind: 'text', text }
  }
  return { kind: 'none' }
}

/** `src` for an <img>: base64 from the kernel, inline, never a file. */
export function dataUri(mime: string, base64: string): string {
  // Kernels wrap base64 at 76 columns; whitespace is not valid in a data URI.
  return `data:${mime};base64,${base64.replace(/\s+/g, '')}`
}
