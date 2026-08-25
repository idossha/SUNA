import { BrowserWindow, app } from 'electron'
import { existsSync } from 'node:fs'
import { cp, mkdir, unlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { ExportOptions, OversizedBlock } from '@suna/core'
import { writeFileAtomic } from './atomic'
import { exportOutputPath, prepareManuscriptExport, type ExportContent } from './export-content'
import { buildManuscriptHtml, buildSupplementHtml } from './export-html'
import { exportPalette, resolveDocumentStyle } from './export-style'

/**
 * PDF export (feature-plan-6 §4): the same profile-styled content model as
 * export-docx.ts, rendered to HTML (export-html.ts) and printed via a
 * hidden BrowserWindow's `printToPDF` — no LaTeX, no Tectonic, no external
 * binary (mirrors figure-export.ts's own PDF path for one figure).
 *
 * Page size/margins come from the resolved document style (export-style.ts):
 * the always-on SUNA house default (US Letter, 0.5 in margins), which a
 * profile's partial documentStyle may shift — though journal guidelines
 * almost never state submitted-manuscript page geometry (ADR-002), so in
 * practice every profile prints on the SUNA page.
 *
 * Line numbers are the one thing `printToPDF` has no native primitive for
 * (unlike page numbers, which are a real Chromium header/footer feature —
 * see `displayHeaderFooter`/`footerTemplate` below). They are approximated
 * by measuring each body paragraph's actually-wrapped visual lines in the
 * live page (via `Range.getClientRects()`, one rect per wrapped line) and
 * writing a number into a fixed left gutter at each rect's offset, BEFORE
 * `printToPDF` paginates the continuous flow. This tracks the real rendered
 * line breaks (not a per-paragraph or per-sentence guess), but it is a
 * measurement of on-screen layout that Chromium's print pass then slices
 * into pages — not a typesetting-grade continuous line-number gutter a word
 * processor gives you natively. Good enough to satisfy "line numbers are
 * present and roughly track the text"; not pixel-perfect across every page
 * break.
 */

/** Copies katex's dist/ (css + the woff2 fonts it references by relative url()) into a stable temp dir, once. */
export async function ensureKatexAssets(): Promise<string> {
  const target = join(app.getPath('temp'), 'suna-katex-assets')
  if (existsSync(join(target, 'katex.min.css'))) return target
  const require = createRequire(import.meta.url)
  const cssPath = require.resolve('katex/dist/katex.min.css')
  await mkdir(target, { recursive: true })
  await cp(dirname(cssPath), target, { recursive: true })
  return target
}

const LINE_NUMBER_SCRIPT = `
(function () {
  var container = document.getElementById('ms-body');
  if (!container) return;
  var containerRect = container.getBoundingClientRect();
  container.style.position = 'relative';
  var gutter = document.createElement('div');
  gutter.id = 'ms-line-gutter';
  var n = 0;
  var blocks = container.querySelectorAll('p, li');
  blocks.forEach(function (el) {
    var range = document.createRange();
    range.selectNodeContents(el);
    var rects = range.getClientRects();
    var seenTops = [];
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (r.width === 0 && r.height === 0) continue;
      var top = Math.round(r.top - containerRect.top);
      if (seenTops.indexOf(top) !== -1) continue;
      seenTops.push(top);
      n += 1;
      var label = document.createElement('span');
      label.className = 'ms-line-num';
      label.style.position = 'absolute';
      label.style.left = '-2.4em';
      label.style.top = top + 'px';
      label.style.fontSize = '8pt';
      label.style.color = '#888';
      label.textContent = String(n);
      gutter.appendChild(label);
    }
  });
  container.style.marginLeft = '2.4em';
  container.appendChild(gutter);
})();
`

async function injectLineNumbers(win: BrowserWindow): Promise<void> {
  await win.webContents.executeJavaScript(LINE_NUMBER_SCRIPT)
}

/**
 * Measures every table and figure against the printable box, in the live DOM,
 * before `printToPDF` paginates it.
 *
 * The measurement is only worth anything if the page is laid out at the width
 * it will PRINT at, which is why sizePrintViewport runs first — a default
 * 800 px window wraps text ~11% wider than a US Letter text column, and every
 * height measured off it would be wrong in the direction that hides overruns.
 */
const MEASURE_SCRIPT = (printableHeightPx: number): string => `
(function () {
  var limit = ${printableHeightPx};
  var out = [];
  // A managed table or figure carries its derived label in a <strong>
  // ("Table 3."). A bare markdown table has none, so fall back to the text it
  // STARTS with — the author is being asked to go and find this block, and
  // its first header cell is a far better handle than "the second table".
  function label(el, fallback) {
    var strong = el.querySelector('strong');
    var text = strong && strong.textContent ? strong.textContent.trim() : '';
    text = text.replace(/[.:]\s*$/, '');
    if (text !== '') return text;
    // textContent runs adjacent cells together ("giant keygiant value"), so
    // the header row is read cell by cell instead.
    var cells = el.querySelectorAll('tr:first-child th, tr:first-child td');
    var parts = [];
    for (var c = 0; c < cells.length && parts.length < 3; c++) {
      var cellText = (cells[c].textContent || '').replace(/\s+/g, ' ').trim();
      if (cellText !== '') parts.push(cellText);
    }
    var lead = parts.join(' / ').slice(0, 40).trim();
    if (lead === '') lead = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
    return lead !== '' ? fallback + ' headed \u201c' + lead + '\u201d' : fallback;
  }
  var tables = document.querySelectorAll('.table-block, .ms-table-entry, table');
  var seen = [];
  for (var i = 0; i < tables.length; i++) {
    var el = tables[i];
    // A bare <table> inside a .table-block is already covered by the block.
    if (el.tagName === 'TABLE' && el.closest('.table-block, .ms-table-entry')) continue;
    var h = el.getBoundingClientRect().height;
    if (h <= limit) continue;
    seen.push({ kind: 'table', label: label(el, 'A table'), heightRatio: h / limit });
  }
  out = out.concat(seen);
  var figures = document.querySelectorAll('figure.figure');
  for (var j = 0; j < figures.length; j++) {
    var f = figures[j];
    var fh = f.getBoundingClientRect().height;
    if (fh <= limit) continue;
    out.push({ kind: 'figure', label: label(f, 'A figure'), heightRatio: fh / limit });
  }
  return JSON.stringify(out);
})();
`

async function measureOversizedBlocks(
  win: BrowserWindow,
  printableHeightPx: number
): Promise<OversizedBlock[]> {
  const raw: unknown = await win.webContents.executeJavaScript(MEASURE_SCRIPT(printableHeightPx))
  if (typeof raw !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((b: OversizedBlock) => ({
      kind: b.kind,
      label: b.label,
      heightRatio: Math.round(b.heightRatio * 10) / 10
    }))
  } catch {
    // A measurement is a diagnostic, never a reason to fail an export.
    return []
  }
}

/**
 * Lays the hidden window out at the width the page will print at.
 *
 * `printToPDF` re-lays the document out at the requested page size, so the
 * window's own size never reaches the PDF. It does reach everything measured
 * from the live DOM BEFORE the print — the line-number gutter and the
 * oversized-block measurement — and a default 800 px window is a different
 * text column from a 7.5 in one, so both were reading a layout that would
 * never be printed. Sizing the viewport to the real printable width makes
 * them measure the document that comes out.
 */
async function sizePrintViewport(win: BrowserWindow, widthPx: number, heightPx: number): Promise<void> {
  win.setContentSize(Math.max(1, Math.round(widthPx)), Math.max(1, Math.round(heightPx)))
  // Let the resize reach layout before anything measures it.
  await win.webContents.executeJavaScript('new Promise(function (r) { requestAnimationFrame(function () { r(0) }) })')
}

export interface ExportPdfRequest {
  dir: string
  profileId: string
  outputName: string
  figurePngPaths: Readonly<Record<string, string>>
  options: ExportOptions
  /** Export this LOGGED version instead of the working copy. */
  versionId?: string
  /** 'manuscript' (default) or the Supplementary Information document. */
  target?: 'manuscript' | 'supplement'
}

export interface ExportPdfResult {
  path: string
  /** Tables/figures that could not fit the page — surfaced by the export toast. */
  oversized: OversizedBlock[]
}

export interface RenderPdfOptions {
  options: ExportOptions
  supplement: boolean
  /**
   * Print in THIS window instead of a freshly created one, and leave it
   * alive afterwards. The live preview passes its long-lived window here:
   * creating and destroying a BrowserWindow is the single largest fixed cost
   * in this path, and a preview pays it on every keystroke otherwise.
   */
  win?: BrowserWindow
}

/** What one render produced: the bytes, and what did not fit on the page. */
export interface RenderedPdf {
  pdf: Buffer
  /** Tables and figures taller than the printable box — empty in the good case. */
  oversized: OversizedBlock[]
}

/**
 * The whole HTML -> PDF pass, with no opinion about where the bytes go: the
 * real export writes them to output/, the live preview hands them straight
 * back to the renderer. Everything that decides how the page LOOKS — page
 * geometry, themed margin bands, line-number injection, the page-number
 * footer — lives here, so a preview cannot drift from the exported file.
 */
export async function renderContentPdf(content: ExportContent, opts: RenderPdfOptions): Promise<RenderedPdf> {
  const { options, supplement } = opts
  const htmlOptions = {
    doubleSpacing: options.doubleSpacing,
    lineNumbers: options.lineNumbers,
    theme: options.theme
  }
  const html = supplement
    ? await buildSupplementHtml(content, htmlOptions)
    : await buildManuscriptHtml(content, htmlOptions)

  const assetsDir = await ensureKatexAssets()
  const hostPath = join(assetsDir, `suna-manuscript-${process.pid}-${Date.now()}.html`)
  await writeFileAtomic(hostPath, html)

  const own = opts.win === undefined
  const win =
    opts.win ?? new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
  try {
    await win.loadFile(hostPath)
    // Page geometry comes from the same resolved style the DOCX writer uses
    // (export-style.ts) — the always-on SUNA default plus the profile's
    // stated deltas — so a manuscript exported as PDF and as DOCX has the
    // same page and margins rather than only the same text.
    const style = resolveDocumentStyle(content.profile)
    const palette = exportPalette(options.theme)
    const themed = palette !== undefined
    const marginIn = style.page.marginMm / 25.4
    const mmToPx = (mm: number): number => (mm / 25.4) * 96
    // A themed page carries its horizontal margins as body padding (printToPDF
    // zeroes them, since Chromium will not paint a page margin), so its layout
    // viewport is the whole page; an untinted one is the text column alone.
    const viewportWidthPx = mmToPx(themed ? style.page.widthMm : style.page.widthMm - 2 * style.page.marginMm)
    const printableHeightPx = mmToPx(style.page.heightMm - 2 * style.page.marginMm)
    await sizePrintViewport(win, viewportWidthPx, printableHeightPx)

    const oversized = await measureOversizedBlocks(win, printableHeightPx)
    if (options.lineNumbers) await injectLineNumbers(win)
    // Supplement ground truth: the page-number footer is ALWAYS on,
    // right-aligned in the body face — whatever options.pageNumbers says.
    const pageNumbers = supplement || options.pageNumbers

    // Chromium NEVER paints page margins — printBackground and the root
    // element's background both stop at the content box (verified against
    // headless Chrome; CSS @page margins behave the same). A themed export
    // therefore moves the horizontal margins INTO the body (pageCss pads the
    // body when a palette is active) and fills the top/bottom margin bands
    // with theme-coloured header/footer templates, which are the only things
    // Chromium will draw in the margin area.
    // A `position:fixed` element inside a header/footer template positions
    // against the WHOLE page tile (verified: `inset:0` painted the full
    // page), so each band is pinned to its own page edge at exactly the
    // margin's height — flush to the paper edge, never over the body text.
    const bandPx = marginIn * 96
    const bandBase = themed
      ? `-webkit-print-color-adjust:exact;background:${palette.bg};position:fixed;left:0;right:0;height:${bandPx}px;margin:0;padding:0;`
      : ''
    const headerTemplate = themed ? `<div style="${bandBase}top:0;"></div>` : pageNumbers ? '<span></span>' : undefined
    const numberSpan = `<span class="pageNumber"></span>`
    const footerTemplate = themed
      ? `<div style="${bandBase}bottom:0;font-size:9px;text-align:center;color:${palette.inkMuted};line-height:${bandPx}px;">${pageNumbers ? numberSpan : ''}</div>`
      : pageNumbers
        ? supplement
          ? `<div style="font-size:9px;font-family:'Times New Roman',serif;width:100%;text-align:right;padding-right:12mm;color:#000;">${numberSpan}</div>`
          : `<div style="font-size:9px;width:100%;text-align:center;color:#555;">${numberSpan}</div>`
        : undefined
    const pdf = await win.webContents.printToPDF({
      pageSize: { width: style.page.widthMm / 25.4, height: style.page.heightMm / 25.4 },
      margins: themed
        ? { top: marginIn, bottom: marginIn, left: 0, right: 0 }
        : { top: marginIn, bottom: marginIn, left: marginIn, right: marginIn },
      printBackground: true,
      displayHeaderFooter: themed || pageNumbers,
      headerTemplate,
      footerTemplate
    })
    return { pdf, oversized }
  } finally {
    if (own) win.destroy()
    await unlink(hostPath).catch(() => undefined)
  }
}

export async function exportPdf(req: ExportPdfRequest): Promise<ExportPdfResult> {
  const { root, supplement, content } = await prepareManuscriptExport(req)
  const { pdf, oversized } = await renderContentPdf(content, { options: req.options, supplement })

  const target = await exportOutputPath(root, req.outputName, 'pdf')
  await writeFileAtomic(target, pdf)

  return { path: target, oversized }
}
