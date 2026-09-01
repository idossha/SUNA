import type { BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Document, Paragraph, TextRun, HeadingLevel, convertMillimetersToTwip } from 'docx'
import type { CoverLetterMeta, RequestOf } from '@suna/core'
import { assertionAnswered, assertionFor } from '@suna/core'
import type { LetterAssertionId } from '@suna/core'
import { getBundledProfile } from '@suna/formatter'
import { readLetterMeta } from './letter-new'
import { documentFile, projectDocument, projectSubdir } from './paths'
import {
  HEADING_LEVELS,
  escapeHtml,
  htmlDocument,
  renderHtmlToPdf,
  simpleDocStyles,
  writeSimpleExport
} from './print-html'
import { assertInsideAllowedRoot } from './roots'

/**
 * Cover-letter export (the "simple and constrained" sibling of the manuscript
 * pipeline, like export-notes).
 *
 * A letter is prose. It exports UNCONDITIONALLY: whether it satisfies the
 * venue's letter requirements is advisory — the letter checker reports it in
 * the export page — never an export gate. Letters written before assertions
 * were retired may still carry `::assert{id}` directives and ⟦ unanswered ⟧
 * markers; those are legacy markup, cleaned by `stripLetterDirectives` so an
 * authored sidecar answer still lands where its directive stood.
 */

export type ExportLetterRequest = RequestOf<'export:letter'>
export interface ExportLetterResult {
  path: string
}

/** Letters land in their own folder, beside — not among — the manuscript exports. */
export const LETTERS_OUTPUT_SUBDIR = 'letters'

interface LetterBlock {
  kind: 'heading' | 'paragraph'
  level: number
  text: string
}

/**
 * LEGACY-content cleaner. Assertions are no longer a gate — this exists only
 * so a letter file written under the old seeding does not leak SUNA's
 * bookkeeping into an exported document:
 *
 * - every `⟦ unanswered — id ⟧` marker is stripped (it was an editing aid, a
 *   note to the author about their own file);
 * - every `::assert{id}` directive is substituted with the author's sidecar
 *   answer when one exists — existing letters on disk must not lose authored
 *   answers — and stripped otherwise. An answer the author routed to the
 *   submission form, or marked not-applicable, contributes nothing: the
 *   letter is not where it lives.
 *
 * New letters are seeded as plain prose and never hit either branch.
 */
export function stripLetterDirectives(text: string, meta: CoverLetterMeta): string {
  const withoutMarkers = text.replace(/⟦ unanswered — [a-zA-Z]+ ⟧\s*/g, '')
  return withoutMarkers.replace(/::assert\{([a-zA-Z]+)\}/g, (_match, id: string) => {
    const answer = assertionFor(meta, id as LetterAssertionId)
    if (answer === null || !assertionAnswered(answer)) return ''
    if (answer.placement === 'submission-form' || answer.placement === 'not-applicable') return ''
    return answer.text ?? ''
  })
}

/**
 * Markdown, as far as a letter uses it: ATX headings and blank-line-separated
 * paragraphs. HTML comments (the seeded "write the case for the paper here"
 * prompt) are stripped — they are notes to the author, not to the editor.
 */
export function letterBlocks(markdown: string): LetterBlock[] {
  const withoutComments = markdown.replace(/<!--[\s\S]*?-->/g, '')
  const blocks: LetterBlock[] = []
  for (const chunk of withoutComments.split(/\n{2,}/)) {
    const trimmed = chunk.trim()
    if (trimmed === '') continue
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading !== null) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]!.trim() })
      continue
    }
    blocks.push({ kind: 'paragraph', level: 0, text: trimmed })
  }
  return blocks
}

export function buildLetterHtml(title: string, subtitle: string, blocks: readonly LetterBlock[]): string {
  const out: string[] = []
  out.push(`<h1 class="lx-title">${escapeHtml(title)}</h1>`)
  if (subtitle.trim() !== '') out.push(`<p class="lx-sub">${escapeHtml(subtitle)}</p>`)
  for (const block of blocks) {
    if (block.kind === 'heading') {
      const level = Math.min(block.level + 1, 6)
      out.push(`<h${level}>${escapeHtml(block.text)}</h${level}>`)
    } else {
      out.push(`<p class="lx-body">${escapeHtml(block.text).replace(/\n/g, '<br>')}</p>`)
    }
  }
  return htmlDocument({ title, css: LETTER_CSS, body: out.join('\n') })
}

/** A letter is read on one page: serif, single column, no ornament. */
const LETTER_CSS = `
  :root { color-scheme: light; }
  body {
    margin: 0;
    font-family: "Iowan Old Style", Georgia, "Times New Roman", serif;
    font-size: 11pt;
    line-height: 1.55;
    color: #17181a;
    background: #fff;
  }
  .lx-title { font-size: 18pt; margin: 0 0 2px; }
  .lx-sub { margin: 0 0 26px; font-size: 9.5pt; color: #6a6f76; }
  h2, h3, h4, h5, h6 { margin: 18px 0 6px; break-after: avoid; }
  .lx-body { margin: 0 0 12px; }
`

function buildLetterDocx(title: string, subtitle: string, blocks: readonly LetterBlock[]): Document {
  const children: Paragraph[] = [new Paragraph({ text: title, heading: HeadingLevel.TITLE })]
  if (subtitle.trim() !== '') {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: subtitle, italics: true, color: '6A6F76', size: 19 })],
        spacing: { after: 240 }
      })
    )
  }
  for (const block of blocks) {
    if (block.kind === 'heading') {
      children.push(
        new Paragraph({
          heading: HEADING_LEVELS[Math.min(block.level, HEADING_LEVELS.length) - 1],
          spacing: { before: 240, after: 60 },
          children: [new TextRun({ text: block.text })]
        })
      )
      continue
    }
    children.push(
      new Paragraph({
        spacing: { after: 160 },
        children: [new TextRun({ text: block.text.replace(/\n/g, ' ') })]
      })
    )
  }
  return new Document({
    creator: 'SUNA',
    title,
    // LETTER_CSS, restated: an 18pt near-black title, and every heading level
    // at body size (the helper's fallback) — a letter's headings are bold
    // lines of prose, not display type, and never Word-theme blue.
    styles: simpleDocStyles({ bodySizePt: 11, title: { sizePt: 18 }, headings: {} }),
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertMillimetersToTwip(25),
              bottom: convertMillimetersToTwip(25),
              left: convertMillimetersToTwip(25),
              right: convertMillimetersToTwip(25)
            }
          }
        },
        children
      }
    ]
  })
}

/** A letter resolved into the three things every output format needs. */
interface LetterDocument {
  title: string
  subtitle: string
  blocks: LetterBlock[]
}

/**
 * Everything between "a document id" and "something to lay out": read the
 * prose, clean any legacy assertion markup (substituting the author's sidecar
 * answers), and derive the subtitle.
 *
 * Split out of exportLetter (ARCHITECTURE §13) so the page view can have
 * the same letter the export would produce WITHOUT writing a file. Preview
 * and export now see the identical document: there is no gate on either.
 */
async function buildLetterDocument(dir: string, documentId: string): Promise<LetterDocument> {
  const root = assertInsideAllowedRoot(dir)
  const doc = await projectDocument(root, documentId)
  if (doc === null) throw new Error(`no document "${documentId}" in this project`)
  if (doc.kind !== 'cover-letter' || doc.meta === null) {
    throw new Error(`document "${documentId}" is not a cover letter`)
  }

  const prosePath = await documentFile(root, doc, 'prose')
  if (prosePath === null) throw new Error(`document "${documentId}" has no prose file`)
  const markdown = await readFile(assertInsideAllowedRoot(prosePath), 'utf8')

  const meta = await readLetterMeta(root, doc.meta)
  const profile = getBundledProfile(meta.targetProfileId)
  const journalName = profile?.journalName ?? meta.targetProfileId
  return {
    title: doc.title,
    subtitle: `${meta.letterKind} · addressed to ${journalName}`,
    blocks: letterBlocks(stripLetterDirectives(markdown, meta))
  }
}

/**
 * The letter as PDF bytes, for the page view — the same HTML the export
 * prints, printed the same way, and never written to disk.
 */
export async function renderLetterPdf(
  dir: string,
  documentId: string,
  win?: BrowserWindow
): Promise<Buffer> {
  const letter = await buildLetterDocument(dir, documentId)
  return renderHtmlToPdf(buildLetterHtml(letter.title, letter.subtitle, letter.blocks), { win })
}

export async function exportLetter(req: ExportLetterRequest): Promise<ExportLetterResult> {
  const root = assertInsideAllowedRoot(req.dir)
  const { title, subtitle, blocks } = await buildLetterDocument(root, req.documentId)

  const outputDir = join(await projectSubdir(root, 'output'), LETTERS_OUTPUT_SUBDIR)
  const path = await writeSimpleExport({
    outputDir,
    name: req.outputName,
    format: req.format,
    html: buildLetterHtml(title, subtitle, blocks),
    docx: () => buildLetterDocx(title, subtitle, blocks)
  })
  return { path }
}
