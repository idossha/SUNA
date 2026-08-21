/**
 * Profile-driven export is the point of the feature (feature-plan-6 §3): the
 * SAME project must come out differently under a numeric-citation profile and
 * an author-year one. export-docx.test.ts covers the fixture's structure and
 * jneurosci's alphabetical reference list; this file covers the CONTRAST, on the
 * shipped examples/hello-suna, end to end through `exportDocx` — and asserts
 * the HTML the PDF path prints, which is everything about export:pdf that is
 * reachable without an Electron runtime (printToPDF itself needs one).
 *
 * Since the SUNA house style became the always-on default, the contrast is
 * conventions-only: both profiles now SHARE the full SUNA typography (page,
 * fonts, sizes, back matter) and still genuinely differ in citation mode,
 * reference ordering and any stated documentStyle deltas.
 *
 * The repo's hello-suna is copied to a temp dir first: `exportDocx` writes
 * into `<dir>/output/`, and the shipped example must stay pristine.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { getBundledProfile } from '@suna/formatter'
import { buildExportContent } from './export-content'
import { exportDocx } from './export-docx'
import { buildManuscriptHtml } from './export-html'
import { allowRoot } from './roots'

const OPTIONS = { doubleSpacing: true, lineNumbers: true, pageNumbers: true }

// valid 1x1 transparent PNG — docx's ImageRun needs real PNG bytes
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

/** Strips XML tags so assertions match text that Word splits across <w:t> runs. */
function visibleText(xml: string): string {
  return xml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')
}

describe('profile-driven export contrast (examples/hello-suna)', () => {
  let base: string
  let work: string
  let figurePngPaths: Record<string, string>
  const docxText: Record<string, string> = {}
  const docxXml: Record<string, string> = {}

  beforeAll(async () => {
    const demoDir = resolve(import.meta.dirname, '..', '..', '..', '..', '..', 'examples', 'hello-suna')
    base = await mkdtemp(join(tmpdir(), 'suna-export-contrast-'))
    work = join(base, 'hello-suna')
    await cp(demoDir, work, { recursive: true })
    allowRoot(work)

    // figure PNGs must live inside the project: export-content validates every
    // supplied path against the allowed roots
    figurePngPaths = {}
    for (const id of ['hello', 'timesheet']) {
      const p = join(work, 'figures', id, 'figure.png')
      await writeFile(p, TINY_PNG)
      figurePngPaths[id] = p
    }

    for (const profileId of ['nature', 'jneurosci']) {
      const res = await exportDocx({
        dir: work,
        profileId,
        outputName: `hello-${profileId}`,
        figurePngPaths,
        options: OPTIONS
      })
      const zip = await JSZip.loadAsync(await readFile(res.path))
      const xml = (await zip.file('word/document.xml')?.async('string')) ?? ''
      docxXml[profileId] = xml
      docxText[profileId] = visibleText(xml)
    }
  }, 120_000)

  afterAll(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('the two profiles genuinely differ in the rules being exercised', () => {
    expect(getBundledProfile('nature')?.citations.mode).toBe('numeric-superscript')
    expect(getBundledProfile('jneurosci')?.citations.mode).toBe('author-year')
    expect(getBundledProfile('nature')?.citations.referenceList.sortOrder).toBe('appearance')
    expect(getBundledProfile('jneurosci')?.citations.referenceList.sortOrder).toBe('alphabetical')
  })

  it('both exports carry the manuscript title, authors, headings and a reference', () => {
    for (const profileId of ['nature', 'jneurosci']) {
      const text = docxText[profileId] as string
      expect(text).toContain('Hello SUNA')
      expect(text).toContain('Ada Author')
      expect(text).toContain('Ben Coauthor')
      expect(text).toContain('Results')
      expect(text).toContain('Methods')
      expect(text).toMatch(/Knuth/)
      expect(text).toMatch(/1984/)
    }
  })

  it('renders author-year in-text citations for jneurosci but not for nature', () => {
    const authorYear = /\(Knuth[^)]*1984[^)]*\)/g
    expect((docxText['jneurosci'] as string).match(authorYear) ?? []).not.toHaveLength(0)
    expect((docxText['nature'] as string).match(authorYear) ?? []).toHaveLength(0)
  })

  it('numbers the nature reference list by order of appearance', () => {
    expect(/(^|\s)1\.\s/.test(docxText['nature'] as string)).toBe(true)
  })

  it('produces different bytes for the two profiles', () => {
    expect(docxText['nature']).not.toBe(docxText['jneurosci'])
  })

  it('both profiles now share the full SUNA typography (the always-on house default)', () => {
    for (const profileId of ['nature', 'jneurosci']) {
      const xml = docxXml[profileId] as string
      // US Letter with 0.5 in margins, docx-tools front matter shape.
      expect(xml).toContain('w:w="12240"')
      expect(xml).toContain('w:h="15840"')
      expect(xml).toMatch(/w:top="720"/)
      expect(xml).toContain('* Corresponding author:')
      // Neither profile states a documentStyle, so both spell out "Figure".
      expect(xml).not.toContain('Fig. 1')
    }
  })

  it('both exports carry the back matter in the ground-truth order, before the references', () => {
    for (const profileId of ['nature', 'jneurosci']) {
      const text = docxText[profileId] as string
      const order = [
        'Acknowledgments',
        'Funding',
        'Competing Interests',
        'Data and Code Availability',
        'Author Contributions',
        'References'
      ]
      // Scanned forward rather than by bare indexOf: the example's own prose
      // contains the word "References" in a table, and a back-matter ORDER
      // assertion must not be satisfiable — or broken — by body text.
      let from = 0
      for (const title of order) {
        const at = text.indexOf(title, from)
        expect(at, `${profileId}: "${title}" missing after position ${from}`).toBeGreaterThan(-1)
        from = at + title.length
      }
      expect(text).toContain('Example Science Foundation (ESF-2026-0042); No One')
    }
  })

  /**
   * export:pdf loads this HTML in a hidden BrowserWindow and calls
   * printToPDF. The print step needs Electron, but the document it prints is
   * pure and asserted here — including the `ms-body` anchor export-pdf.ts's
   * line-number injector queries.
   */
  it('builds printable HTML for the PDF path under both profiles', async () => {
    for (const profileId of ['nature', 'jneurosci']) {
      const content = await buildExportContent({ dir: work, profileId, figurePngPaths })
      const html = await buildManuscriptHtml(content, {
        doubleSpacing: OPTIONS.doubleSpacing,
        lineNumbers: OPTIONS.lineNumbers
      })
      expect(html.toLowerCase()).toContain('<html')
      expect(html).toContain('Hello SUNA')
      expect(html).toContain('Ada Author')
      expect(html).toContain('ms-body')
    }
  })
})
