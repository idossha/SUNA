/**
 * Loads the actual image behind a figure so the live preview can SHOW it
 * rather than printing `fig:<id>` in a dashed box.
 *
 * Widgets are constructed synchronously by CodeMirror while reading a file is
 * asynchronous, so a widget asks for its asset here, paints whatever is
 * already cached (usually nothing on the first paint), and fills itself in
 * when the load resolves. That keeps the IPC out of the decoration builder
 * entirely, and means an image is read once per session no matter how many
 * times its embed is re-rendered.
 *
 * Two shapes of asset:
 * - `svg` — the file's own text, inlined into the DOM. Figures are SVG by
 *   design (the canvas edits the SVG DOM directly), and inlining keeps them
 *   crisp at any zoom and themable.
 * - `dataUri` — base64 for raster formats, which cannot be inlined as markup.
 *
 * The renderer never touches `file://`; both go through the same root-confined
 * IPC every other file read uses.
 */

export type FigureAsset =
  | { kind: 'svg'; svg: string }
  | { kind: 'raster'; dataUri: string }
  | { kind: 'missing'; reason: string }

const RASTER_MIME: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp'
}

/** The mime for a path's extension, or null when it is not a raster image we can inline. */
export function rasterMimeFor(path: string): string | null {
  const ext = path.toLowerCase().split('.').pop() ?? ''
  return RASTER_MIME[ext] ?? null
}

/**
 * Drop everything before the root `<svg` element.
 *
 * A matplotlib-exported figure — which is what `figures/<id>/figure.svg`
 * is — starts with an XML declaration and an SVG 1.1 DOCTYPE. Those are
 * legal in a standalone SVG document but not inside an HTML one: assigning
 * them through innerHTML makes the HTML parser treat the prolog as a bogus
 * comment and can leave the document without a root element at all. The file
 * on disk is untouched; this only affects what we hand the DOM.
 *
 * Returns the input unchanged when there is no `<svg` in it, so a malformed
 * file still reaches the caller and fails visibly rather than silently
 * becoming empty markup.
 */
export function stripXmlProlog(svg: string): string {
  const start = svg.search(/<svg[\s>]/i)
  return start <= 0 ? svg : svg.slice(start)
}

const cache = new Map<string, FigureAsset>()
const inFlight = new Map<string, Promise<FigureAsset>>()

/** Test-only: drop everything so one test's fixtures cannot leak into another. */
export function resetFigureAssetCache(): void {
  cache.clear()
  inFlight.clear()
}

/** Whatever is already loaded for `path`, without starting a load. */
export function cachedAsset(path: string): FigureAsset | undefined {
  return cache.get(path)
}

function bridgeReady(): boolean {
  return typeof window !== 'undefined' && typeof window.suna?.invoke === 'function'
}

/**
 * Load (or return the in-flight load of) the asset at an absolute path.
 * Never throws: a missing or unreadable file resolves to `missing`, which the
 * widget renders as a visible, explanatory placeholder rather than a blank.
 */
export async function loadAsset(path: string): Promise<FigureAsset> {
  const hit = cache.get(path)
  if (hit !== undefined) return hit
  const pending = inFlight.get(path)
  if (pending !== undefined) return pending

  const load = (async (): Promise<FigureAsset> => {
    if (!bridgeReady()) return { kind: 'missing', reason: 'no file bridge' }
    try {
      if (path.toLowerCase().endsWith('.svg')) {
        const { content } = await window.suna.invoke('fs:read-text', { path })
        return { kind: 'svg', svg: stripXmlProlog(content) }
      }
      const mime = rasterMimeFor(path)
      if (mime === null) return { kind: 'missing', reason: `unsupported image type: ${path}` }
      const { base64 } = await window.suna.invoke('fs:read-binary', { path })
      return { kind: 'raster', dataUri: `data:${mime};base64,${base64}` }
    } catch (error) {
      return { kind: 'missing', reason: error instanceof Error ? error.message : String(error) }
    }
  })()

  inFlight.set(path, load)
  const asset = await load
  inFlight.delete(path)
  cache.set(path, asset)
  return asset
}

/** Where a figure id's SVG lives: `<rootDir>/figures/<id>/figure.svg`. */
export function figureSvgPath(rootDir: string, figureId: string): string {
  return `${rootDir}/figures/${figureId}/figure.svg`
}

/**
 * Resolve a markdown image url against the file that contains it. Absolute
 * paths pass through; a remote url is refused rather than fetched, since the
 * renderer's CSP blocks external hosts and a silent broken image would be
 * worse than saying so.
 */
export function resolveImageUrl(url: string, containingFilePath: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('file:')) return null
  const clean = url.replace(/^file:\/\//, '').split('#')[0]?.split('?')[0] ?? ''
  if (clean === '') return null
  if (clean.startsWith('/')) return clean
  const dir = containingFilePath.slice(0, containingFilePath.lastIndexOf('/'))
  if (dir === '') return null
  const joined = `${dir}/${clean}`
  // collapse "a/b/../c" so the main process's root check sees a plain path
  const parts: string[] = []
  for (const segment of joined.split('/')) {
    if (segment === '.' || segment === '') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return `/${parts.join('/')}`
}
