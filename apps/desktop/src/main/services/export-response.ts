import { join } from 'node:path'
import { Document, HeadingLevel, Packer, Paragraph, TextRun, convertMillimetersToTwip } from 'docx'
import type { ReplyBlock, ReplyRun, RequestOf, ReviewPointRecord, ReviewerReport, Round } from '@suna/core'
import { RESPONSE_ROLE_COLORS, pointStateFor, replyBlocks, unaddressedPoints } from '@suna/core'
import { writeFileAtomic } from './atomic'
import { escapeHtml, printHtmlToPdf } from './export-notes'
import { projectSubdir } from './paths'
import { readReviewerReports, readRound } from './round-new'
import { assertInsideAllowedRoot } from './roots'

/**
 * Response-to-reviewers export (document-kinds-ux.md §C).
 *
 * The response document is DERIVED, exactly as the schema says the reply is
 * ("the response document is derived from these at format time"): the
 * reviewer's words come verbatim out of `rounds/<id>/reviewers/*.json`, the
 * replies out of `round.json`'s point states. Nothing here is authored, so
 * nothing here can drift from the workspace the author actually worked in.
 *
 * Two rules make it safe to send:
 *
 * - A reviewer's text is quoted, never rewritten. It is copied out of the
 *   immutable record and escaped, and no code path in this file touches it.
 * - A point with no reply contributes NO reply text. SUNA does not answer a
 *   reviewer on the author's behalf, so the choice is an export with a gap
 *   the author knows about — the confirm names every one of them — or no
 *   export at all, never a fabricated answer.
 *
 * Statuses (`drafted`, `rebutted`, …) are deliberately absent from the
 * output. They are the author's own bookkeeping; an editor reading the
 * response has no business seeing which points the authors called rebuttals.
 *
 * **Colour** (`response.colorRoles`, feature-plan-12 §6c). With it on, the
 * three voices are painted in the values both real documents in
 * `examples/peer-review/` use — black comment, `#0432FF` reply, `#EE0000`
 * quoted manuscript text that is new — because the one thing a reader of a
 * response must never have to guess is who wrote which sentence. With it off
 * the document keeps the neutral typographic treatment it always had, which
 * is what a journal asking for a plain letter wants.
 */

export type ExportResponseRequest = RequestOf<'export:response'>
export interface ExportResponseResult {
  path: string
}

/** Responses land in their own folder, beside — not among — the manuscript exports. */
export const RESPONSES_OUTPUT_SUBDIR = 'responses'

/** One reviewer's section of the document: their points, in their order. */
export interface ResponseSection {
  /** "Reviewer 2", as the report labels itself. */
  label: string
  points: {
    /** "Reviewer 2, point 3" — derived from the record, never stored. */
    heading: string
    /** The reviewer's own words, untouched. */
    verbatim: string
    /** The author's reply, in role-tagged blocks. Empty when unwritten. */
    reply: ReplyBlock[]
  }[]
}

function pointHeading(point: ReviewPointRecord): string {
  const base = `Reviewer ${point.reviewerIndex}, point ${point.pointIndex}`
  return point.section === null ? base : `${base} · ${point.section}`
}

/** Reviewer reports plus the author's replies, in the shape the renderers take. */
export function responseSections(
  round: Round,
  reports: readonly ReviewerReport[]
): ResponseSection[] {
  return reports.map((report) => ({
    label: report.label,
    points: report.points.map((point) => ({
      heading: pointHeading(point),
      verbatim: point.verbatim,
      // The reply is Markdown prose plus the two response marks — a quoted
      // manuscript excerpt and the part of it that is new (reply-markup.ts).
      // A reply written before those existed parses as plain paragraphs.
      reply: replyBlocks(pointStateFor(round, point.id).reply)
    }))
  }))
}

/**
 * The points this round still cannot answer, named the way the author will
 * have to answer for them. Counts are useless here: "3 problems" says nothing
 * about which reviewer is going to be annoyed (§C.3).
 */
export function unaddressedLabels(
  round: Round,
  reports: readonly ReviewerReport[]
): string[] {
  return unaddressedPoints(round, reports).map(
    (point) => `Reviewer ${point.reviewerIndex}, point ${point.pointIndex}`
  )
}

/**
 * One block's runs as HTML. Each run carries its voice as a class rather than
 * an inline style, so turning colour off is one stylesheet away and a reader
 * who copies a passage into their own document gets text, not markup.
 */
function replyRunsHtml(runs: readonly ReplyRun[]): string {
  return runs
    .map(
      (run) =>
        `<span class="rx-v-${run.role}">${escapeHtml(run.text).replace(/\n/g, '<br>')}</span>`
    )
    .join('')
}

export function buildResponseHtml(
  title: string,
  subtitle: string,
  sections: readonly ResponseSection[],
  colorRoles = true
): string {
  const out: string[] = []
  out.push('<!doctype html>')
  out.push('<html lang="en"><head><meta charset="utf-8">')
  out.push(`<title>${escapeHtml(title)}</title>`)
  out.push(`<style>${responseCss(colorRoles)}</style>`)
  out.push('</head><body>')
  out.push('<div class="rx-page">')
  out.push(`<h1 class="rx-title">${escapeHtml(title)}</h1>`)
  if (subtitle.trim() !== '') out.push(`<p class="rx-sub">${escapeHtml(subtitle)}</p>`)
  for (const section of sections) {
    out.push(`<h2 class="rx-rev">${escapeHtml(section.label)}</h2>`)
    for (const point of section.points) {
      out.push(`<h3 class="rx-point">${escapeHtml(point.heading)}</h3>`)
      out.push(
        `<blockquote class="rx-verbatim">${escapeHtml(point.verbatim).replace(/\n/g, '<br>')}</blockquote>`
      )
      // The reply is marked, not merely un-italic: an editor skimming a long
      // response needs to find our answer without reading a sentence first.
      if (point.reply.length === 0) continue
      out.push('<div class="rx-reply">')
      for (const block of point.reply) {
        if (block.kind === 'heading') {
          const level = Math.min(block.level + 3, 6)
          out.push(`<h${level}>${replyRunsHtml(block.runs)}</h${level}>`)
        } else if (block.kind === 'quote') {
          // A manuscript excerpt inside our reply. It stays INSIDE .rx-reply:
          // quoting the paper is something we are doing, and pulling it out
          // would put it back in the reviewer's column.
          out.push(`<blockquote class="rx-quote">${replyRunsHtml(block.runs)}</blockquote>`)
        } else {
          out.push(`<p class="rx-body">${replyRunsHtml(block.runs)}</p>`)
        }
      }
      out.push('</div>')
    }
  }
  out.push('</div>')
  out.push('</body></html>')
  return out.join('\n')
}

/**
 * Reviewer text is set apart typographically, because the one thing a reader
 * of a response must never have to guess is who wrote which sentence.
 *
 * Three things carry that. The reviewer's words are quoted; ours are marked
 * with a `↳` in the left margin; and, with `response.colorRoles` on, each
 * voice is painted in the values both real response documents use. The `↳`
 * and the rule stay either way, because a response printed in greyscale — or
 * read by somebody who cannot distinguish the two hues — must still be
 * legible as two voices.
 *
 * The marker is drawn by CSS rather than written into the text, so an editor
 * who copies a reply out of the page gets the reply and not a piece of our
 * furniture.
 *
 * The page is a page, not a wall of text against the window frame: on screen
 * it sits in a padded, measure-limited column. Print resets both, because
 * printToPDF already sets the paper margins and doubling them would leave the
 * text stranded in the middle of the sheet.
 */
function responseCss(colorRoles: boolean): string {
  return `${RESPONSE_CSS}${colorRoles ? ROLE_CSS : PLAIN_ROLE_CSS}`
}

/**
 * The observed palette, plus one rule that is NOT about colour: a quoted
 * manuscript excerpt is italic in both documents, and stays italic whether or
 * not colour is on.
 *
 * `print-color-adjust` because the whole point is a coloured PDF, and Chrome
 * drops background and text colour from a print by default.
 */
const ROLE_CSS = `
  .rx-verbatim { color: ${RESPONSE_ROLE_COLORS.comment}; font-style: normal; }
  .rx-v-reply { color: ${RESPONSE_ROLE_COLORS.reply}; }
  .rx-v-quote { color: ${RESPONSE_ROLE_COLORS.quote}; }
  .rx-v-change { color: ${RESPONSE_ROLE_COLORS.change}; }
  .rx-quote, .rx-v-quote, .rx-v-change { font-style: italic; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`

/** Colour off: the neutral treatment this document always had. */
const PLAIN_ROLE_CSS = `
  .rx-quote, .rx-v-quote, .rx-v-change { font-style: italic; }
`

const RESPONSE_CSS = `
  :root { color-scheme: light; }
  body {
    margin: 0;
    font-family: "Iowan Old Style", Georgia, "Times New Roman", serif;
    font-size: 11pt;
    line-height: 1.55;
    color: #17181a;
    background: #fff;
  }
  .rx-page { max-width: 44em; margin: 0 auto; padding: 44px 44px 64px; }
  @media print {
    .rx-page { max-width: none; margin: 0; padding: 0; }
  }
  .rx-title { font-size: 18pt; margin: 0 0 2px; }
  .rx-sub { margin: 0 0 26px; font-size: 9.5pt; color: #6a6f76; }
  .rx-rev { font-size: 13pt; margin: 26px 0 4px; break-after: avoid; }
  .rx-point { font-size: 10pt; margin: 18px 0 6px; color: #6a6f76; break-after: avoid; }
  .rx-verbatim {
    margin: 0 0 10px;
    padding: 2px 0 2px 12px;
    border-left: 2px solid #c8ccd2;
    color: #3d434b;
    font-style: italic;
    break-inside: avoid;
  }
  .rx-reply { position: relative; padding-left: 24px; break-inside: avoid; }
  .rx-reply::before {
    content: "\\21B3";
    position: absolute;
    left: 0;
    top: 0;
    font-family: "Helvetica Neue", Arial, "DejaVu Sans", sans-serif;
    font-size: 15pt;
    line-height: 1.15;
    color: #6b727b;
  }
  .rx-quote {
    margin: 0 0 12px;
    padding: 0 0 0 12px;
    border-left: 1px solid #d7dade;
    break-inside: avoid;
  }
  h4, h5, h6 { margin: 14px 0 6px; break-after: avoid; }
  .rx-body { margin: 0 0 12px; }
`

const HEADING_LEVELS = [
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6
] as const

/**
 * One block's runs as Word runs.
 *
 * Real `w:color` on real runs, not a style — that is what both example
 * documents contain (reply-a: 847 runs at `#EE0000`, zero `w:ins`), and it is
 * what survives a co-author opening the file, editing a sentence, and sending
 * it back.
 */
function replyRunsDocx(runs: readonly ReplyRun[], colorRoles: boolean): TextRun[] {
  return runs.map((run) => {
    const italics = run.role !== 'reply'
    // Word has no <br> inside a run; a paragraph is a paragraph. Line breaks
    // inside one block become spaces, the same thing the letter export does.
    const text = run.text.replace(/\n/g, ' ')
    return colorRoles
      ? new TextRun({ text, italics, color: RESPONSE_ROLE_COLORS[run.role].slice(1) })
      : new TextRun({ text, italics })
  })
}

function buildResponseDocx(
  title: string,
  subtitle: string,
  sections: readonly ResponseSection[],
  colorRoles: boolean
): Document {
  const children: Paragraph[] = [new Paragraph({ text: title, heading: HeadingLevel.TITLE })]
  if (subtitle.trim() !== '') {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: subtitle, italics: true, color: '6A6F76', size: 19 })],
        spacing: { after: 240 }
      })
    )
  }
  for (const section of sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 320, after: 80 },
        children: [new TextRun({ text: section.label })]
      })
    )
    for (const point of section.points) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 60 },
          children: [new TextRun({ text: point.heading })]
        })
      )
      // The reviewer's words, indented — Word's own quotation shape. With
      // colour on they are upright black, which is what both real documents
      // do; with it off they keep the grey italic that used to be the only
      // thing separating their voice from ours.
      for (const line of point.verbatim.split(/\n{2,}/)) {
        if (line.trim() === '') continue
        children.push(
          new Paragraph({
            indent: { left: convertMillimetersToTwip(8) },
            spacing: { after: 120 },
            children: [
              colorRoles
                ? new TextRun({
                    text: line.replace(/\n/g, ' '),
                    color: RESPONSE_ROLE_COLORS.comment.slice(1)
                  })
                : new TextRun({ text: line.replace(/\n/g, ' '), italics: true, color: '3D434B' })
            ]
          })
        )
      }
      for (const block of point.reply) {
        if (block.kind === 'heading') {
          children.push(
            new Paragraph({
              heading: HEADING_LEVELS[Math.min(block.level, HEADING_LEVELS.length) - 1],
              spacing: { before: 200, after: 60 },
              children: replyRunsDocx(block.runs, colorRoles)
            })
          )
          continue
        }
        children.push(
          new Paragraph({
            // A quoted manuscript excerpt is indented like the reviewer's
            // words are, one step further in: it is the paper speaking inside
            // our reply, and a reader scanning the left edge should see that.
            ...(block.kind === 'quote'
              ? { indent: { left: convertMillimetersToTwip(8) } }
              : {}),
            spacing: { after: 160 },
            children: replyRunsDocx(block.runs, colorRoles)
          })
        )
      }
    }
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

/** "Round 2 — Nature Astronomy" -> the line under the title. */
export function responseSubtitle(round: Round, pointCount: number): string {
  const parts = [round.kind === 'external' ? 'External review' : 'Internal review']
  if (round.venue !== null) parts.push(round.venue)
  parts.push(`${pointCount} point${pointCount === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

export async function exportResponse(req: ExportResponseRequest): Promise<ExportResponseResult> {
  const root = assertInsideAllowedRoot(req.dir)
  const round = await readRound(root, req.roundId)
  const reports = await readReviewerReports(root, req.roundId)

  const pointCount = reports.reduce((n, r) => n + r.points.length, 0)
  if (pointCount === 0) {
    throw new Error(`round "${req.roundId}" has no imported reviewer points to respond to`)
  }

  // Stop once, by name. An author who has read that list and asks again gets
  // the file: a response circulated to co-authors mid-revision is a normal
  // thing to want, and a half-written one is a normal state to be in.
  const unaddressed = unaddressedLabels(round, reports)
  if (unaddressed.length > 0 && !req.acknowledgeUnaddressed) {
    throw new Error(
      `this round still has unaddressed points (${unaddressed.join('; ')}). ` +
        `Answer them, or export again to get the response as it stands.`
    )
  }

  const sections = responseSections(round, reports)
  const title = `Response to reviewers — ${round.label}`
  const subtitle = responseSubtitle(round, pointCount)

  const outputDir = join(await projectSubdir(root, 'output'), RESPONSES_OUTPUT_SUBDIR)
  const target = join(outputDir, `${req.outputName}.${req.format}`)

  if (req.format === 'html') {
    await writeFileAtomic(target, buildResponseHtml(title, subtitle, sections, req.colorRoles))
  } else if (req.format === 'docx') {
    await writeFileAtomic(
      target,
      await Packer.toBuffer(buildResponseDocx(title, subtitle, sections, req.colorRoles))
    )
  } else {
    await printHtmlToPdf(buildResponseHtml(title, subtitle, sections, req.colorRoles), target)
  }

  return { path: target }
}
