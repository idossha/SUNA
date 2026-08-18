/**
 * Caption metadata for the live preview's figure and table blocks — the text
 * that renders as "**Figure N.** *title* *body*" under an embed and as the
 * caption / "Note." lines around a `![[tbl:id]]` table.
 *
 * Figure captions live in `figures/<id>/figure.json` (`caption`); table
 * captions live in `manuscript/manuscript.json` (`tables[].caption` +
 * `tables[].footnotes`). Both are read over the same root-confined IPC the
 * asset loader uses, and cached with a short TTL rather than a save-driven
 * invalidation: caption edits land through app views this module has no hook
 * into, and a few seconds of staleness in an editor preview is acceptable
 * where a stale figure image would not be.
 */

export interface FigureCaptionMeta {
  title: string
  /**
   * The rest of the caption (figure.json's `caption.body`) — panel
   * descriptions and detail. Rendered after the title, exactly as the
   * exporters do; empty when the figure has none.
   */
  body: string
}

export interface TableCaptionMeta {
  title: string
  /** The editable "Note." body (manuscript.json's caption.body). Empty when absent. */
  body: string
  /** Footnote marks + texts, already joined for display after the body. Empty when none. */
  footnotesText: string
}

const TTL_MS = 5000

interface CacheEntry<T> {
  at: number
  value: T
}

const figureCache = new Map<string, CacheEntry<FigureCaptionMeta | null>>()
const tableCache = new Map<string, CacheEntry<ReadonlyMap<string, TableCaptionMeta>>>()

/** Test-only: drop everything so one test's fixtures cannot leak into another. */
export function resetCaptionMetaCache(): void {
  figureCache.clear()
  tableCache.clear()
}

function bridgeReady(): boolean {
  return typeof window !== 'undefined' && typeof window.suna?.invoke === 'function'
}

async function readJson(path: string): Promise<unknown | null> {
  if (!bridgeReady()) return null
  try {
    const { content } = await window.suna.invoke('fs:read-text', { path })
    return JSON.parse(content) as unknown
  } catch {
    return null
  }
}

/** The whole caption from `figures/<id>/figure.json`, or null when unreadable. */
export async function loadFigureCaption(rootDir: string, figureId: string): Promise<FigureCaptionMeta | null> {
  const path = `${rootDir}/figures/${figureId}/figure.json`
  const hit = figureCache.get(path)
  if (hit !== undefined && Date.now() - hit.at < TTL_MS) return hit.value
  const parsed = await readJson(path)
  const caption = (parsed as { caption?: { title?: unknown; body?: unknown } } | null)?.caption
  const value =
    typeof caption?.title === 'string'
      ? { title: caption.title, body: typeof caption.body === 'string' ? caption.body.trim() : '' }
      : null
  figureCache.set(path, { at: Date.now(), value })
  return value
}

interface RawTable {
  id?: unknown
  caption?: { title?: unknown; body?: unknown }
  footnotes?: unknown
}

function tableMetaOf(raw: RawTable): TableCaptionMeta | null {
  if (typeof raw.caption?.title !== 'string') return null
  const body = typeof raw.caption.body === 'string' ? raw.caption.body.trim() : ''
  const notes: string[] = []
  if (Array.isArray(raw.footnotes)) {
    for (const f of raw.footnotes as { mark?: unknown; text?: unknown }[]) {
      if (typeof f.mark === 'string' && typeof f.text === 'string') notes.push(`${f.mark} ${f.text}`)
    }
  }
  return { title: raw.caption.title, body, footnotesText: notes.join(' ') }
}

/** The managed-table caption for one id from `manuscript/manuscript.json`, or null when absent. */
export async function loadTableCaption(rootDir: string, tableId: string): Promise<TableCaptionMeta | null> {
  const path = `${rootDir}/manuscript/manuscript.json`
  const hit = tableCache.get(path)
  if (hit !== undefined && Date.now() - hit.at < TTL_MS) return hit.value.get(tableId) ?? null
  const parsed = await readJson(path)
  const map = new Map<string, TableCaptionMeta>()
  const tables = (parsed as { tables?: unknown } | null)?.tables
  if (Array.isArray(tables)) {
    for (const raw of tables as RawTable[]) {
      if (typeof raw.id !== 'string') continue
      const meta = tableMetaOf(raw)
      if (meta !== null) map.set(raw.id, meta)
    }
  }
  tableCache.set(path, { at: Date.now(), value: map })
  return map.get(tableId) ?? null
}

/* ---- write-back: inline caption editing in the live preview ------------- */

async function writeJson(path: string, value: unknown): Promise<boolean> {
  if (!bridgeReady()) return false
  try {
    // Matches the app's own JSON writers (figure-create.ts): 2-space indent,
    // trailing newline — a caption edit must not reformat the whole file.
    await window.suna.invoke('fs:write-text', { path, content: `${JSON.stringify(value, null, 2)}\n` })
    return true
  } catch {
    return false
  }
}

/**
 * Patch a figure's caption in `figures/<id>/figure.json` — the title, the
 * body, or both. Read-fresh → patch → write, so every other field (panels,
 * provenance, widthPreset) survives untouched. Returns false (and writes
 * nothing) when the file cannot be read or parsed.
 */
export async function saveFigureCaption(
  rootDir: string,
  figureId: string,
  patch: { title?: string; body?: string }
): Promise<boolean> {
  const path = `${rootDir}/figures/${figureId}/figure.json`
  const parsed = await readJson(path)
  if (parsed === null || typeof parsed !== 'object') return false
  const doc = parsed as { caption?: Record<string, unknown> }
  if (typeof doc.caption !== 'object' || doc.caption === null) return false
  // `body` is a required string in the figure schema (unlike a table's
  // optional one), so an emptied body is written as "" rather than deleted.
  const caption: Record<string, unknown> = { ...doc.caption }
  if (patch.title !== undefined) caption['title'] = patch.title
  if (patch.body !== undefined) caption['body'] = patch.body
  doc.caption = caption
  const ok = await writeJson(path, doc)
  if (ok) figureCache.delete(path)
  return ok
}

/**
 * Patch one managed table's caption in `manuscript/manuscript.json` — the
 * title, the "Note." body, or both. Same read-fresh → patch → write shape as
 * the figure writer; an empty body deletes the optional field rather than
 * storing "".
 */
export async function saveTableCaption(
  rootDir: string,
  tableId: string,
  patch: { title?: string; body?: string }
): Promise<boolean> {
  const path = `${rootDir}/manuscript/manuscript.json`
  const parsed = await readJson(path)
  if (parsed === null || typeof parsed !== 'object') return false
  const doc = parsed as { tables?: unknown }
  if (!Array.isArray(doc.tables)) return false
  const entry = (doc.tables as RawTable[]).find((t) => t.id === tableId)
  if (entry === undefined || typeof entry.caption?.title !== 'string') return false
  const caption = entry.caption as Record<string, unknown>
  if (patch.title !== undefined) caption['title'] = patch.title
  if (patch.body !== undefined) {
    if (patch.body === '') delete caption['body']
    else caption['body'] = patch.body
  }
  const ok = await writeJson(path, parsed)
  if (ok) tableCache.delete(path)
  return ok
}
