/**
 * SVG import pipeline (DECISIONS 2026-08-14): pure string transforms so the
 * riskiest part — id namespacing — is unit-testable without a DOM. The
 * engine's `insert` command wraps `cmd.svg` in a temporary
 * `<svg xmlns=".." xmlns:xlink="..">` context and requires exactly one root
 * element (packages/canvas/src/commands.ts parseFragment), which is why
 * every import — SVG or PNG — collapses to one wrapped root here.
 */

const ID_ATTR_RE = /(\s)id\s*=\s*(["'])([^"']*)\2/g
const URL_REF_RE = /url\(\s*#([^)'"]+?)\s*\)/g
const HREF_REF_RE = /((?:xlink:)?href\s*=\s*)(["'])#([^"']+)\2/g
const NS_DECL_RE = /\sxmlns(:[A-Za-z0-9_-]+)?\s*=\s*("[^"]*"|'[^']*')/g

/** Ids declared anywhere in an SVG fragment (attribute `id="…"` / `id='…'`). */
export function collectFragmentIds(svg: string): Set<string> {
  const ids = new Set<string>()
  ID_ATTR_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ID_ATTR_RE.exec(svg)) !== null) {
    const id = m[3]
    if (id) ids.add(id)
  }
  return ids
}

/**
 * Prefix every id definition in `svg` and rewrite the references that point
 * at them — `url(#id)` (fill/stroke/clip-path/filter/marker-*, inline or in
 * a style attribute) and `href="#id"` / `xlink:href="#id"`. References to
 * ids outside this fragment (not in the collected set) are left untouched.
 */
export function namespaceSvgIds(svg: string, prefix: string): string {
  const ids = collectFragmentIds(svg)
  if (ids.size === 0) return svg
  let out = svg.replace(ID_ATTR_RE, (match, ws: string, quote: string, id: string) =>
    ids.has(id) ? `${ws}id=${quote}${prefix}${id}${quote}` : match
  )
  out = out.replace(URL_REF_RE, (match, id: string) =>
    ids.has(id) ? `url(#${prefix}${id})` : match
  )
  out = out.replace(HREF_REF_RE, (match, lead: string, quote: string, id: string) =>
    ids.has(id) ? `${lead}${quote}#${prefix}${id}${quote}` : match
  )
  return out
}

/** Every `xmlns`/`xmlns:prefix` declaration on an element's open tag, verbatim. */
function namespaceDeclarations(openTag: string): string {
  let decls = ''
  NS_DECL_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = NS_DECL_RE.exec(openTag)) !== null) {
    decls += ` xmlns${m[1] ?? ''}=${m[2]}`
  }
  return decls
}

export class SvgImportError extends Error {}

/**
 * The imported file's root `<svg>` element's children, as raw markup, plus
 * every namespace declaration on its root (Inkscape/Illustrator/matplotlib
 * exports carry xmlns:dc/cc/rdf/sodipodi for their <metadata> — without
 * these the engine's strict XML parse rejects prefixed elements as unbound).
 * Pragmatic, not a general XML parser: assumes one top-level <svg>…</svg>
 * pair, true for every real-world figure export this feature targets.
 */
export function extractSvgContent(source: string): { inner: string; nsDecls: string } {
  const openMatch = /<svg\b[^>]*>/i.exec(source)
  if (!openMatch) throw new SvgImportError('not an SVG file (no <svg> root element)')
  const openTag = openMatch[0]
  const nsDecls = namespaceDeclarations(openTag)
  if (openTag.endsWith('/>')) return { inner: '', nsDecls }
  const openEnd = openMatch.index + openTag.length
  const closeIdx = source.lastIndexOf('</svg>')
  if (closeIdx < 0 || closeIdx < openEnd) {
    throw new SvgImportError('not an SVG file (no closing </svg>)')
  }
  return { inner: source.slice(openEnd, closeIdx).trim(), nsDecls }
}

/** `imported-1`, `imported-2`, … — first not already an id in the document. */
export function nextImportGroupId(hasId: (id: string) => boolean): string {
  let n = 1
  while (hasId(`imported-${n}`)) n += 1
  return `imported-${n}`
}

/** Placement offset for the Nth import (1-based), so repeated imports don't stack exactly. */
export function importOffset(n: number): { dx: number; dy: number } {
  const step = 24 + 16 * Math.max(n - 1, 0)
  return { dx: step, dy: step }
}

/**
 * Full pipeline: parse the dropped/opened SVG text, namespace its ids
 * (`imp{n}-` prefix) and references, and wrap the result in one
 * `<g id="imported-{n}">` translated to a sensible offset — a single
 * fragment the engine's `insert` command accepts as one undoable edit.
 */
export function prepareSvgImport(
  source: string,
  groupId: string,
  prefix: string,
  offset: { dx: number; dy: number }
): string {
  const { inner, nsDecls } = extractSvgContent(source)
  if (inner === '') throw new SvgImportError('the SVG has no content to import')
  const namespaced = namespaceSvgIds(inner, prefix)
  return (
    `<g id="${groupId}"${nsDecls} transform="translate(${offset.dx} ${offset.dy})">` +
    `${namespaced}</g>`
  )
}
