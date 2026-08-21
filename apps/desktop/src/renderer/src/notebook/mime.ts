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

    if (mime === 'application/json') return { kind: 'json', value }

    const text = asText(value)
    if (text === null) continue

    if (mime === 'image/svg+xml') return { kind: 'svg', svg: text }
    if (mime.startsWith('image/')) return { kind: 'image', mime, data: text }
    if (mime === 'text/html') return { kind: 'html', html: text }
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
