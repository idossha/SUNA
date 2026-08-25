import { BrowserWindow } from 'electron'
import type { ExportOptions, OversizedBlock } from '@suna/core'
import { prepareManuscriptExport } from './export-content'
import { buildStandaloneHtml } from './export-html'
import { renderContentPdf } from './export-pdf'

/**
 * Live export preview ('export:preview'): the SAME build the real exporters
 * run, returned as bytes instead of written to <dir>/output/.
 *
 * The point is that there is no second renderer. A preview that drew the
 * page its own way would be a promise the export does not keep, so this
 * calls straight into `renderContentPdf` / `buildStandaloneHtml` — the very
 * functions 'export:pdf' and 'export:html' call — and simply declines to
 * touch the disk. What you see is what the file will contain, because it is
 * what the file would have contained.
 *
 * The one format that cannot be shown natively is DOCX: nothing in an
 * Electron app renders a Word document. It previews as the PDF render of the
 * same resolved document style the DOCX writer uses (export-style.ts is
 * shared by both), which makes page size, margins, point sizes and spacing
 * genuinely the Word document's — but Word breaks lines itself, so a page
 * count near a boundary can differ by one. That is flagged (`approximate`)
 * rather than glossed over.
 *
 * Cost control, since this runs on every styling change:
 *  - ONE hidden BrowserWindow, created once and reused. Creating and
 *    destroying a window per render is the largest fixed cost in the PDF
 *    path; a preview would otherwise pay it on every checkbox.
 *  - Renders are serialized. Two previews cannot print in the same window at
 *    once, and the renderer drops stale results by generation, so a queue is
 *    all the coordination this needs.
 * Figure resolution is the caller's business: the renderer passes compressed
 * rasters here and full-resolution ones to the real export.
 */

/** The one hidden window every preview prints in — created on first use, never shown. */
let previewWin: BrowserWindow | null = null
let idleTimer: NodeJS.Timeout | null = null

/**
 * How long the shared window outlives the last preview. Long enough that a
 * session of tweaking never pays to rebuild it, short enough that a window
 * nobody is looking at does not sit there holding a renderer process — and
 * hidden windows are not free: they hold memory, they count in
 * `app.getAllWindows()`, and they show up as CDP page targets.
 */
const IDLE_RELEASE_MS = 60_000

function previewWindow(): BrowserWindow {
  if (previewWin === null || previewWin.isDestroyed()) {
    previewWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
  }
  return previewWin
}

function touchIdleTimer(): void {
  if (idleTimer !== null) clearTimeout(idleTimer)
  idleTimer = setTimeout(disposePreviewWindow, IDLE_RELEASE_MS)
  // Never hold the event loop open on the app's behalf.
  idleTimer.unref?.()
}

/** Releases the reused window (idle, app shutdown, or the app window closing). */
export function disposePreviewWindow(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (previewWin !== null && !previewWin.isDestroyed()) previewWin.destroy()
  previewWin = null
}

/** Serializes renders: one print at a time in the shared window. */
let chain: Promise<unknown> = Promise.resolve()

function queued<T>(run: () => Promise<T>): Promise<T> {
  const next = chain.then(run, run)
  // Keep the chain alive after a rejection — a failed preview must not
  // wedge every later one.
  chain = next.catch(() => undefined)
  return next
}

/**
 * Run something in the shared hidden window, serialized, keeping it alive.
 *
 * Exposed so the letter preview prints in the SAME window the manuscript
 * preview uses. A letter goes through its own simpler pipeline
 * (export-letter.ts), but the cost it would otherwise pay is identical —
 * creating and destroying a BrowserWindow per render — and there is no reason
 * for the app to hold two hidden windows to show one document at a time.
 */
export function withPreviewWindow<T>(run: (win: BrowserWindow) => Promise<T>): Promise<T> {
  return queued(async () => {
    const out = await run(previewWindow())
    touchIdleTimer()
    return out
  })
}

export interface ExportPreviewRequest {
  dir: string
  profileId: string
  format: 'docx' | 'pdf' | 'html'
  figurePngPaths: Readonly<Record<string, string>>
  options: ExportOptions
  /** Preview this LOGGED version instead of the working copy. */
  versionId?: string
  target?: 'manuscript' | 'supplement'
}

export interface ExportPreviewResult {
  kind: 'pdf' | 'html'
  data: string
  approximate: boolean
  ms: number
  oversized: OversizedBlock[]
}

export async function exportPreview(req: ExportPreviewRequest): Promise<ExportPreviewResult> {
  const started = Date.now()
  const { supplement, content } = await prepareManuscriptExport(req)

  if (req.format === 'html') {
    const html = await buildStandaloneHtml(content, supplement, req.options.theme)
    // A web page has no pages, so nothing in it can overrun one.
    return { kind: 'html', data: html, approximate: false, ms: Date.now() - started, oversized: [] }
  }

  // A Word preview is the PDF page render of the DOCX's own document style;
  // the submission options that only exist on paper still apply to it.
  const rendered = await queued(async () => {
    const out = await renderContentPdf(content, {
      options: req.options,
      supplement,
      win: previewWindow()
    })
    touchIdleTimer()
    return out
  })
  return {
    kind: 'pdf',
    data: rendered.pdf.toString('base64'),
    approximate: req.format === 'docx',
    ms: Date.now() - started,
    oversized: rendered.oversized
  }
}
