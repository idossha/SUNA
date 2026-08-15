/**
 * Extension → MIME mapping for ImageTab (feature-plan-4 §2). Bytes arrive as
 * base64 from `fs:read-binary`; the viewer turns them into a `data:` URI
 * rather than a `file://` load (no CSP relaxation needed). Pure string logic.
 */

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

/** The image MIME type for `path`'s extension, or null when unrecognized. */
export function mimeForImagePath(path: string): string | null {
  const lower = path.toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot === -1) return null
  return MIME_BY_EXTENSION[lower.slice(dot)] ?? null
}

/**
 * Builds a `data:` URI from base64 bytes read via `fs:read-binary`. Falls
 * back to `application/octet-stream` for an unrecognized extension — dock
 * routing (`componentForFile`) only ever sends supported extensions to
 * ImageTab, so this path is defensive, not expected in practice.
 */
export function dataUriForImage(path: string, base64: string): string {
  const mime = mimeForImagePath(path) ?? 'application/octet-stream'
  return `data:${mime};base64,${base64}`
}
