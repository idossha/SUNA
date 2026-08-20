import type { BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Document, HeadingLevel, Packer, Paragraph, TextRun, convertMillimetersToTwip } from 'docx'
import type { CoverLetterMeta, RequestOf } from '@suna/core'
import { assertionAnswered, assertionFor, unansweredIn } from '@suna/core'
import type { LetterAssertionId } from '@suna/core'
import { getBundledProfile } from '@suna/formatter'
import { writeFileAtomic } from './atomic'
import { readLetterMeta } from './letter-new'
import { documentFile, projectDocument, projectSubdir } from './paths'
import { escapeHtml, printHtmlToPdf, renderHtmlToPdf } from './export-notes'
import { assertInsideAllowedRoot } from './roots'

/**
 * Cover-letter export (the "simple and constrained" sibling of the manuscript
 * pipeline, like export-notes).
 *
 * A letter is prose plus assertions. The prose is rendered as it is written —
 * paragraphs, headings, nothing else, because that is all a letter has. The
 * assertions are the part that needs work: `::assert{id}` marks WHERE the
 * author's sentence belongs, and the sentence itself lives in the sidecar.
 * This is where the two are put back together, and where a letter that still
 * carries an unanswered assertion is refused rather than sent to an editor
 * with ⟦ unanswered — competingInterests ⟧ in it.
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
 * Substitute every `::assert{id}` with what the author actually said, and
 * clear the ⟦ unanswered — id ⟧ markers.
 *
 * The marker is written into the prose once, when the letter is created, and
 * nothing ever takes it back out: answering an assertion writes the SIDECAR
 * (letter:write), not the Markdown. So the marker says only "this had no
 * answer at the moment the file was seeded", and the sidecar is the only
 * thing that knows whether it has one now.
 *
 * Placement decides what "answered" contributes. A directive or inline-prose
 * assertion contributes its text; one the author routed to the submission
 * form, or marked not-applicable, contributes nothing — the letter is not
 * where it lives, so it must not appear in the exported letter either.
 */
export function resolveAssertions(text: string, meta: CoverLetterMeta): string {
  // Every marker goes, answered or not. It is an editing aid — a note to the
  // author about their own file — and an editor reading the exported letter
  // should never meet SUNA's internal bookkeeping. Whether an unanswered
  // assertion is allowed to reach this point at all is the export gate's
  // decision (`unansweredForExport` + the caller's acknowledgement), not this
  // function's.
  const withoutMarkers = text.replace(/⟦ unanswered — [a-zA-Z]+ ⟧\s*/g, '')
  return withoutMarkers.replace(/::assert\{([a-zA-Z]+)\}/g, (_match, id: string) => {
    const answer = assertionFor(meta, id as LetterAssertionId)
    if (answer === null || !assertionAnswered(answer)) return ''
    if (answer.placement === 'submission-form' || answer.placement === 'not-applicable') return ''
    return answer.text ?? ''
  })
}

/**
 * The assertions this letter still cannot answer — the ones the export is
 * refused over.
 *
 * Read from the sidecar, for every id the letter mentions (a marker or an
 * `::assert{}` directive). Reading the markers alone was the bug this
 * replaces: every letter is seeded with one marker per required assertion,
 * so a letter whose assertions were all answered in the panel — the sidecar
 * full, the panel showing ✓ — was still refused, because the stale text in
 * the file said otherwise.
 */
export function unansweredForExport(
  markdown: string,
  meta: CoverLetterMeta
): LetterAssertionId[] {
  const mentioned = new Set<LetterAssertionId>(unansweredIn(markdown))
  for (const m of markdown.matchAll(/::assert\{([a-zA-Z]+)\}/g)) {
    if (m[1] !== undefined) mentioned.add(m[1] as LetterAssertionId)
  }
  return [...mentioned].filter((id) => !assertionAnswered(assertionFor(meta, id)))
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

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6
] as const

export function buildLetterHtml(title: string, subtitle: string, blocks: readonly LetterBlock[]): string {
  const out: string[] = []
  out.push('<!doctype html>')
  out.push('<html lang="en"><head><meta charset="utf-8">')
  out.push(`<title>${escapeHtml(title)}</title>`)
  out.push(`<style>${LETTER_CSS}</style>`)
  out.push('</head><body>')
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
  out.push('</body></html>')
  return out.join('\n')
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
  /** Assertion ids still unanswered — the export gate's business, not the preview's. */
  unanswered: LetterAssertionId[]
}

/**
 * Everything between "a document id" and "something to lay out": read the
 * prose, put the author's answers back where the `::assert{id}` markers are,
 * and derive the subtitle.
 *
 * Split out of exportLetter (feature-plan-13 §B5) so the page view can have
 * the same letter the export would produce WITHOUT writing a file. It does
 * not decide whether an unanswered assertion is allowed through — it reports
 * them and lets the caller decide, because a preview and an export answer
 * that question differently: a draft you are still writing should be
 * previewable, and a draft you are sending should not be silently shipped.
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
    blocks: letterBlocks(resolveAssertions(markdown, meta)),
    unanswered: unansweredForExport(markdown, meta)
  }
}

/**
 * The letter as PDF bytes, for the page view — the same HTML the export
 * prints, printed the same way, and never written to disk.
 *
 * Deliberately does NOT apply the unanswered-assertion gate: a page view is
 * for a letter you are still writing, and refusing to show it until every
 * assertion is answered would make the mode useless exactly when it is most
 * wanted. An unanswered directive contributes nothing to the text, here as in
 * the export, so what you see is what you would get if you sent it today.
 */
export async function renderLetterPdf(
  dir: string,
  documentId: string,
  win?: BrowserWindow
): Promise<Buffer> {
  const letter = await buildLetterDocument(dir, documentId)
  return renderHtmlToPdf(buildLetterHtml(letter.title, letter.subtitle, letter.blocks), win)
}

export async function exportLetter(req: ExportLetterRequest): Promise<ExportLetterResult> {
  const root = assertInsideAllowedRoot(req.dir)
  const { title, subtitle, blocks, unanswered } = await buildLetterDocument(root, req.documentId)

  // Stop once, by name. An author who has read that list and asks again gets
  // the file: an unanswered assertion may well belong in the submission
  // portal, or this may be a draft going to a co-author, and neither is
  // SUNA's call to make. What it will not do is invent the missing sentence —
  // the directive simply contributes nothing.
  if (unanswered.length > 0 && !req.acknowledgeUnanswered) {
    throw new Error(
      `this letter still has unanswered assertions (${unanswered.join(', ')}). ` +
        `Answer them in the Assertions panel — nobody else can write them for you.`
    )
  }

  const outputDir = join(await projectSubdir(root, 'output'), LETTERS_OUTPUT_SUBDIR)
  const target = join(outputDir, `${req.outputName}.${req.format}`)

  if (req.format === 'html') {
    await writeFileAtomic(target, buildLetterHtml(title, subtitle, blocks))
  } else if (req.format === 'docx') {
    await writeFileAtomic(target, await Packer.toBuffer(buildLetterDocx(title, subtitle, blocks)))
  } else {
    await printHtmlToPdf(buildLetterHtml(title, subtitle, blocks), target)
  }

  return { path: target }
}
