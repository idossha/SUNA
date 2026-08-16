import { BrowserWindow, app } from 'electron'
import { existsSync } from 'node:fs'
import { cp, mkdir, unlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { ExportOptions } from '@suna/core'
import { writeFileAtomic } from './atomic'
import { buildExportContent } from './export-content'
import { buildManuscriptHtml } from './export-html'
import { documentStyleFor } from './export-style'
import { projectSubdir } from './paths'
import { assertInsideAllowedRoot } from './roots'

/**
 * PDF export (feature-plan-6 §4): the same profile-styled content model as
 * export-docx.ts, rendered to HTML (export-html.ts) and printed via a
 * hidden BrowserWindow's `printToPDF` — no LaTeX, no Tectonic, no external
 * binary (mirrors figure-export.ts's own PDF path for one figure).
 *
 * Known, deliberate simplification (ADR-002, same as export-html.ts's
 * module doc): the profile schema has no page-geometry fields, so page
 * size/margins come from the profile's DocumentStyle (export-style.ts): a
 * journal profile states none and keeps the generic A4/1in defaults, while a
 * house style like SUNA style sets its own page.
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
async function ensureKatexAssets(): Promise<string> {
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

export interface ExportPdfRequest {
  dir: string
  profileId: string
  outputName: string
  figurePngPaths: Readonly<Record<string, string>>
  options: ExportOptions
}

export interface ExportPdfResult {
  path: string
}

export async function exportPdf(req: ExportPdfRequest): Promise<ExportPdfResult> {
  const root = assertInsideAllowedRoot(req.dir)
  const content = await buildExportContent({
    dir: root,
    profileId: req.profileId,
    figurePngPaths: req.figurePngPaths
  })
  const html = await buildManuscriptHtml(content, {
    doubleSpacing: req.options.doubleSpacing,
    lineNumbers: req.options.lineNumbers
  })

  const assetsDir = await ensureKatexAssets()
  const hostPath = join(assetsDir, `suna-manuscript-${process.pid}-${Date.now()}.html`)
  await writeFileAtomic(hostPath, html)

  const outputDir = await projectSubdir(root, 'output')
  const target = join(outputDir, `${req.outputName}.pdf`)

  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
  try {
    await win.loadFile(hostPath)
    if (req.options.lineNumbers) await injectLineNumbers(win)
    const footerTemplate = req.options.pageNumbers
      ? '<div style="font-size:9px;width:100%;text-align:center;color:#555;"><span class="pageNumber"></span></div>'
      : undefined
    // Page geometry comes from the same DocumentStyle the DOCX writer uses
    // (export-style.ts), so a manuscript exported as PDF and as DOCX has the
    // same page and margins rather than only the same text.
    const style = documentStyleFor(content.profile)
    const marginIn = style.page.marginMm / 25.4
    const pdf = await win.webContents.printToPDF({
      pageSize: { width: style.page.widthMm / 25.4, height: style.page.heightMm / 25.4 },
      margins: { top: marginIn, bottom: marginIn, left: marginIn, right: marginIn },
      printBackground: true,
      displayHeaderFooter: req.options.pageNumbers,
      headerTemplate: req.options.pageNumbers ? '<span></span>' : undefined,
      footerTemplate
    })
    await writeFileAtomic(target, pdf)
  } finally {
    win.destroy()
    await unlink(hostPath).catch(() => undefined)
  }

  return { path: target }
}
