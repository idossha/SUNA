/**
 * Profile-driven export is the point of the feature (feature-plan-6 §3): the
 * SAME project must come out differently under a numeric-citation profile and
 * an author-year one. export-docx.test.ts covers the fixture's structure and
 * apj-aas's alphabetical reference list; this file covers the CONTRAST, on the
 * shipped examples/demo-paper, end to end through `exportDocx` — and asserts
 * the HTML the PDF path prints, which is everything about export:pdf that is
 * reachable without an Electron runtime (printToPDF itself needs one).
 *
 * The repo's demo-paper is copied to a temp dir first: `exportDocx` writes
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

describe('profile-driven export contrast (examples/demo-paper)', () => {
  let base: string
  let work: string
  let figurePngPaths: Record<string, string>
  const docxText: Record<string, string> = {}

  beforeAll(async () => {
    const demoDir = resolve(import.meta.dirname, '..', '..', '..', '..', '..', 'examples', 'demo-paper')
    base = await mkdtemp(join(tmpdir(), 'suna-export-contrast-'))
    work = join(base, 'demo-paper')
    await cp(demoDir, work, { recursive: true })
    allowRoot(work)

    // figure PNGs must live inside the project: export-content validates every
    // supplied path against the allowed roots
    figurePngPaths = {}
    for (const id of ['fig-spectrum', 'fig-velocity-map']) {
      const p = join(work, 'figures', id, 'figure.png')
      await writeFile(p, TINY_PNG)
      figurePngPaths[id] = p
    }

    for (const profileId of ['nature', 'jneurosci']) {
      const res = await exportDocx({
        dir: work,
        profileId,
        outputName: `demo-${profileId}`,
        figurePngPaths,
        options: OPTIONS,
        useDocxTools: false
      })
      const zip = await JSZip.loadAsync(await readFile(res.path))
      docxText[profileId] = visibleText((await zip.file('word/document.xml')?.async('string')) ?? '')
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
      expect(text).toContain('Rapid quenching by ram-pressure stripping')
      expect(text).toContain('Ada Researcher')
      expect(text).toContain('Ben Collaborator')
      expect(text).toContain('Results')
      expect(text).toContain('Discussion')
      expect(text).toContain('Methods')
      expect(text).toMatch(/Gunn/)
      expect(text).toMatch(/1972/)
    }
  })

  it('renders author-year in-text citations for jneurosci but not for nature', () => {
    const authorYear = /\(Gunn[^)]*1972[^)]*\)/g
    expect((docxText['jneurosci'] as string).match(authorYear) ?? []).not.toHaveLength(0)
    expect((docxText['nature'] as string).match(authorYear) ?? []).toHaveLength(0)
  })

  it('numbers the nature reference list by order of appearance', () => {
    expect(/(^|\s)1\.\s/.test(docxText['nature'] as string)).toBe(true)
  })

  it('produces different bytes for the two profiles', () => {
    expect(docxText['nature']).not.toBe(docxText['jneurosci'])
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
      expect(html).toContain('Rapid quenching by ram-pressure stripping')
      expect(html).toContain('Ada Researcher')
      expect(html).toContain('ms-body')
    }
  })
})
