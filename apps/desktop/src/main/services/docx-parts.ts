/**
 * What every .docx route in the app needs before it can do anything of its
 * own: the raw OOXML parts, and the mammoth style map that decides what the
 * conversion calls a heading.
 *
 * Two routes exist — import (docx-import.ts) turns a Word file into a SUNA
 * project, and the viewer (docx-preview.ts) renders one on screen — and they
 * disagree about almost everything downstream (images become project files
 * vs data URIs; the HTML becomes sections vs a printed page). What they must
 * NOT disagree about is what a "Heading 2" is, or how many equations the file
 * has, because that is a claim about the FILE. So those live here, once.
 *
 * Every function here is pure string-in/data-out apart from `readDocxParts`,
 * which only reads.
 */

import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'

/**
 * mammoth's default style map already sends "Heading 1..6" to h1..h6 and
 * direct bold/italic/superscript/subscript formatting to strong/em/sup/sub —
 * this makes the paragraph-style mapping explicit anyway (feature-plan-6
 * §2.1), and covers a couple of common non-default styles mammoth leaves
 * untouched.
 */
export const DOCX_STYLE_MAP = [
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "p[style-name='Title'] => p:fresh",
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote:fresh",
  'b => strong',
  'i => em'
]

/**
 * Word equations are OOXML `<m:oMath>` elements mammoth does not convert
 * (feature-plan-6 §2.3: "attempt only if you can do it reliably; otherwise
 * keep the text and add a warning — a broken \( \) is worse than a flagged
 * paragraph"). Rather than guess which output paragraph lost math, this
 * counts them straight from the part XML: import warns with the number, and
 * the viewer says that many equations are not on the page.
 */
export function countOmmlEquations(documentXml: string): number {
  const matches = documentXml.match(/<m:oMath[ >]/g)
  return matches === null ? 0 : matches.length
}

export interface DocxParts {
  /** word/document.xml — the body, its section properties, its equations. */
  documentXml: string
  /** word/styles.xml — docDefaults and the named styles. */
  stylesXml: string
}

/**
 * The two parts anything here reads, as text. A .docx missing either is
 * unusual but not fatal to a caller that treats an empty part as "states
 * nothing" — which both callers do — so this returns '' rather than throwing.
 */
export async function readDocxParts(docxPath: string): Promise<DocxParts> {
  const zip = await JSZip.loadAsync(await readFile(docxPath))
  return {
    documentXml: (await zip.file('word/document.xml')?.async('text')) ?? '',
    stylesXml: (await zip.file('word/styles.xml')?.async('text')) ?? ''
  }
}
