import { BrowserWindow, app } from 'electron'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  convertMillimetersToTwip
} from 'docx'
import type { RequestOf } from '@suna/core'
import { writeFileAtomic } from './atomic'
import { projectSubdir } from './paths'
import { assertInsideAllowedRoot } from './roots'

/**
 * Reading-notes export: the literature note as a PDF, Word file or web page.
 *
 * Deliberately NOT the manuscript pipeline (export-content/docx/pdf/html).
 * That one exists to satisfy a journal: it resolves a profile, rasterizes
 * every figure, numbers cross-references and carries submission options. A
 * literature note has none of those obligations — it is reading, not a
 * submission — and routing it through that pipeline would mean answering
 * questions ("which profile? double spaced? line numbers?") that have no
 * answer here.
 *
 * So this module owns one small document model instead: title, then a section
 * per paper, then quote + written note per highlight. The renderer sends the
 * strings it is already showing on screen (page labels included, so the
 * printed-page offset is applied once, where it is known); this only lays
 * them out. Three formats, one layout — the PDF is the HTML printed, so a
 * note exported twice reads the same both times.
 */

export type ExportNotesRequest = RequestOf<'export:notes'>
export interface ExportNotesResult {
  path: string
}

type NotesPaper = ExportNotesRequest['papers'][number]
type NotesNote = NotesPaper['notes'][number]

/** The highlight palette, matching viewer.css's swatches so an exported note
 *  carries the same colour coding the reader used while reading. */
const COLOR_HEX: Record<NotesNote['color'], string> = {
  yellow: '#ffd400',
  red: '#ff6666',
  green: '#5fb236',
  blue: '#2ea8e5',
  purple: '#a28ae5',
  magenta: '#e56eee',
  orange: '#f19837',
  gray: '#aaaaaa'
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** A written note is plain text: blank lines separate paragraphs, and every
 *  other newline is a line break the reader typed on purpose. */
function bodyParagraphsOf(body: string): string[] {
  return body
    .trim()
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== '')
}

/**
 * One self-contained page — no external stylesheet, no font download, no
 * script. Exported for tests, and used verbatim as the PDF's print source.
 */
export function buildNotesHtml(req: ExportNotesRequest): string {
  const out: string[] = []
  out.push('<!doctype html>')
  out.push('<html lang="en"><head><meta charset="utf-8">')
  out.push(`<title>${escapeHtml(req.title)}</title>`)
  out.push(`<style>${NOTES_CSS}</style>`)
  out.push('</head><body>')
  out.push(`<h1 class="nx-title">${escapeHtml(req.title)}</h1>`)
  if (req.subtitle.trim() !== '') {
    out.push(`<p class="nx-sub">${escapeHtml(req.subtitle)}</p>`)
  }

  for (const paper of req.papers) {
    out.push('<section class="nx-paper">')
    const heading = paper.label.trim() === '' ? paper.citekey : paper.label
    out.push(
      `<h2 class="nx-paperhead">${escapeHtml(heading)} <code class="nx-key">[@${escapeHtml(paper.citekey)}]</code></h2>`
    )
    if (paper.title.trim() !== '') {
      out.push(`<p class="nx-papertitle">${escapeHtml(paper.title.trim())}</p>`)
    }
    for (const note of paper.notes) {
      out.push('<article class="nx-note">')
      out.push('<div class="nx-meta">')
      out.push(
        `<span class="nx-dot" style="background:${COLOR_HEX[note.color]}"></span>`,
        `<span class="nx-page">p. ${escapeHtml(note.page)}</span>`
      )
      for (const tag of note.tags) out.push(`<span class="nx-tag">${escapeHtml(tag)}</span>`)
      if (note.detached) out.push('<span class="nx-detached">detached</span>')
      out.push('</div>')
      out.push(
        `<blockquote class="nx-quote" style="border-left-color:${COLOR_HEX[note.color]}">${escapeHtml(note.quote)}</blockquote>`
      )
      for (const para of bodyParagraphsOf(note.body)) {
        out.push(`<p class="nx-body">${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
      }
      out.push('</article>')
    }
    out.push('</section>')
  }

  if (req.papers.length === 0) {
    out.push('<p class="nx-empty">No reading notes.</p>')
  }
  out.push('</body></html>')
  return out.join('\n')
}

/** Print-first typography: a serif reading face, generous quote indent, and
 *  page breaks that never orphan a paper's heading from its first note. */
const NOTES_CSS = `
  :root { color-scheme: light; }
  body {
    margin: 0;
    font-family: "Iowan Old Style", Georgia, "Times New Roman", serif;
    font-size: 11pt;
    line-height: 1.5;
    color: #17181a;
    background: #fff;
  }
  .nx-title { font-size: 20pt; margin: 0 0 2px; }
  .nx-sub { margin: 0 0 24px; font-size: 9.5pt; color: #6a6f76; }
  .nx-paper { margin: 0 0 22px; break-inside: auto; }
  .nx-paperhead {
    font-size: 13pt;
    margin: 0 0 2px;
    padding-bottom: 3px;
    border-bottom: 1px solid #d8dade;
    break-after: avoid;
  }
  .nx-key { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 9pt; color: #6a6f76; }
  .nx-papertitle { margin: 0 0 10px; font-style: italic; color: #43474d; break-after: avoid; }
  .nx-note { margin: 0 0 12px; break-inside: avoid; }
  .nx-meta { display: flex; align-items: center; gap: 6px; font-size: 8.5pt; color: #6a6f76; }
  .nx-dot {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 2px;
    border: 1px solid rgba(0, 0, 0, 0.3);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .nx-tag {
    border: 1px solid #d8dade;
    border-radius: 8px;
    padding: 0 6px;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
  }
  .nx-detached { color: #9a6b00; }
  .nx-quote {
    margin: 3px 0 0;
    padding: 0 0 0 10px;
    border-left: 3px solid #ccc;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .nx-body { margin: 6px 0 0 13px; color: #43474d; }
  .nx-empty { color: #6a6f76; font-style: italic; }
`

/** The same document as Word paragraphs. */
function buildNotesDocx(req: ExportNotesRequest): Document {
  const children: Paragraph[] = [
    new Paragraph({ text: req.title, heading: HeadingLevel.TITLE })
  ]
  if (req.subtitle.trim() !== '') {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: req.subtitle, italics: true, color: '6A6F76', size: 19 })],
        spacing: { after: 240 }
      })
    )
  }

  for (const paper of req.papers) {
    const heading = paper.label.trim() === '' ? paper.citekey : paper.label
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 0 },
        children: [
          new TextRun({ text: heading }),
          new TextRun({ text: `  [@${paper.citekey}]`, color: '6A6F76', size: 18 })
        ]
      })
    )
    if (paper.title.trim() !== '') {
      children.push(
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: paper.title.trim(), italics: true })]
        })
      )
    }
    for (const note of paper.notes) {
      const meta = [`p. ${note.page}`, note.color, ...note.tags]
      if (note.detached) meta.push('detached')
      children.push(
        new Paragraph({
          spacing: { before: 120, after: 0 },
          children: [new TextRun({ text: meta.join(' · '), color: '6A6F76', size: 17 })]
        })
      )
      // The quote is indented rather than colour-boxed: Word has no cheap
      // equivalent of the HTML rule, and an indent survives every template a
      // co-author might reapply.
      children.push(
        new Paragraph({
          indent: { left: convertMillimetersToTwip(6) },
          alignment: AlignmentType.LEFT,
          children: [new TextRun({ text: note.quote })]
        })
      )
      for (const para of bodyParagraphsOf(note.body)) {
        children.push(
          new Paragraph({
            indent: { left: convertMillimetersToTwip(10) },
            children: [new TextRun({ text: para })]
          })
        )
      }
    }
  }

  if (req.papers.length === 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'No reading notes.', italics: true })] }))
  }

  return new Document({
    creator: 'SUNA',
    title: req.title,
    styles: {
      default: {
        document: { run: { font: 'Georgia', size: 22 }, paragraph: { spacing: { line: 300 } } }
      }
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertMillimetersToTwip(20),
              bottom: convertMillimetersToTwip(20),
              left: convertMillimetersToTwip(20),
              right: convertMillimetersToTwip(20)
            }
          }
        },
        children
      }
    ]
  })
}

/** Print the built HTML through a hidden window, the same way export-pdf.ts
 *  prints a manuscript — no LaTeX, no external binary. */
async function printNotesPdf(html: string, target: string): Promise<void> {
  const hostPath = join(app.getPath('temp'), `suna-notes-${process.pid}-${Date.now()}.html`)
  await writeFileAtomic(hostPath, html)
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
  try {
    await win.loadFile(hostPath)
    const pdf = await win.webContents.printToPDF({
      pageSize: { width: 8.5, height: 11 },
      margins: { top: 0.75, bottom: 0.75, left: 0.75, right: 0.75 },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="font-size:9px;width:100%;text-align:center;color:#666;"><span class="pageNumber"></span></div>'
    })
    await writeFileAtomic(target, pdf)
  } finally {
    win.destroy()
    await unlink(hostPath).catch(() => undefined)
  }
}

/** Notes land in their OWN folder under output/. A literature note is not a
 *  draft of the paper, and three files called reading-notes.* sitting beside
 *  the manuscript exports read as versions of the manuscript. */
export const NOTES_OUTPUT_SUBDIR = 'notes'

export async function exportNotes(req: ExportNotesRequest): Promise<ExportNotesResult> {
  const root = assertInsideAllowedRoot(req.dir)
  const outputDir = join(await projectSubdir(root, 'output'), NOTES_OUTPUT_SUBDIR)
  // The directory is created by writeFileAtomic on the way past; the PDF path
  // writes through it too.
  const target = join(outputDir, `${req.outputName}.${req.format}`)

  if (req.format === 'html') {
    await writeFileAtomic(target, buildNotesHtml(req))
  } else if (req.format === 'docx') {
    await writeFileAtomic(target, await Packer.toBuffer(buildNotesDocx(req)))
  } else {
    await printNotesPdf(buildNotesHtml(req), target)
  }

  return { path: target }
}
