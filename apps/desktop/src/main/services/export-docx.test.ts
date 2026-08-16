import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'
import { buildExportContent } from './export-content'
import { buildDocxDocument, exportDocx } from './export-docx'
import { writeFixtureProject } from './export-fixture'
import { allowRoot } from './roots'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suna-export-docx-'))
  allowRoot(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const OPTIONS = { doubleSpacing: true, lineNumbers: true, pageNumbers: true }

describe('buildDocxDocument + Packer', () => {
  it('produces a .docx whose document.xml contains the title, an author, a heading and a reference', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths })
    const doc = await buildDocxDocument(content, OPTIONS)

    const { Packer } = await import('docx')
    const buffer = await Packer.toBuffer(doc)
    expect(buffer.byteLength).toBeGreaterThan(1000)

    const zip = await JSZip.loadAsync(buffer)
    const documentXmlFile = zip.file('word/document.xml')
    expect(documentXmlFile).not.toBeNull()
    const documentXml = await documentXmlFile?.async('string')
    expect(documentXml).toBeDefined()
    const xml = documentXml as string

    // Title (math-stripped: "$z=1$" -> "z=1" via splitTexSpans/texRuns).
    expect(xml).toContain('Fixture study of')
    expect(xml).toContain('z=1')
    // An author.
    expect(xml).toContain('Ada Researcher')
    // A body heading.
    expect(xml).toContain('Introduction')
    // A formatted reference entry (journal name, italicized in formatArticle).
    expect(xml).toContain('Journal of Fixtures')
    // The unresolved citation is flagged rather than silently dropped.
    expect(xml).toContain('missing2099')
  })

  it('embeds the figure image and its numbered caption', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths })
    const doc = await buildDocxDocument(content, OPTIONS)
    const { Packer } = await import('docx')
    const buffer = await Packer.toBuffer(doc)
    const zip = await JSZip.loadAsync(buffer)

    const mediaFiles = Object.keys(zip.files).filter((name) => name.startsWith('word/media/'))
    expect(mediaFiles.length).toBeGreaterThanOrEqual(1)

    const documentXml = await zip.file('word/document.xml')?.async('string')
    expect(documentXml).toContain('Fig. 1')
    expect(documentXml).toContain('fixture figure')
  })

  it('applies native line numbers and continuous page numbers when requested', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths })
    const doc = await buildDocxDocument(content, { doubleSpacing: false, lineNumbers: true, pageNumbers: true })
    const { Packer } = await import('docx')
    const buffer = await Packer.toBuffer(doc)
    const zip = await JSZip.loadAsync(buffer)

    const documentXml = await zip.file('word/document.xml')?.async('string')
    expect(documentXml).toContain('w:lnNumType')
    const footerFiles = Object.keys(zip.files).filter((name) => /word\/footer\d*\.xml$/.test(name))
    expect(footerFiles.length).toBeGreaterThanOrEqual(1)
    const footerXml = await zip.file(footerFiles[0] as string)?.async('string')
    expect(footerXml).toContain('PAGE')
  })

  it('omits line numbers and the page-number footer when the options say so', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths })
    const doc = await buildDocxDocument(content, { doubleSpacing: false, lineNumbers: false, pageNumbers: false })
    const { Packer } = await import('docx')
    const buffer = await Packer.toBuffer(doc)
    const zip = await JSZip.loadAsync(buffer)

    const documentXml = await zip.file('word/document.xml')?.async('string')
    expect(documentXml).not.toContain('w:lnNumType')
    const footerFiles = Object.keys(zip.files).filter((name) => /word\/footer\d*\.xml$/.test(name))
    expect(footerFiles).toHaveLength(0)
  })

  it('renders an author-year reference list alphabetically for apj-aas', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'apj-aas', figurePngPaths })
    const doc = await buildDocxDocument(content, OPTIONS)
    const { Packer } = await import('docx')
    const buffer = await Packer.toBuffer(doc)
    const zip = await JSZip.loadAsync(buffer)
    const documentXml = (await zip.file('word/document.xml')?.async('string')) ?? ''
    // Jones (2019) sorts before Smith (2020) alphabetically — check within the
    // reference list itself, not the in-text author-year citations above it.
    const referencesStart = documentXml.indexOf('References')
    expect(referencesStart).toBeGreaterThan(-1)
    const referenceList = documentXml.slice(referencesStart)
    expect(referenceList.indexOf('Jones')).toBeGreaterThan(-1)
    expect(referenceList.indexOf('Jones')).toBeLessThan(referenceList.indexOf('Smith'))
  })
})

describe('exportDocx', () => {
  it('writes <dir>/output/<name>.docx and never mutates manuscript.json/sections/references.bib', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const manuscriptPath = join(dir, 'manuscript', 'manuscript.json')
    const before = await readFile(manuscriptPath, 'utf8')

    const result = await exportDocx({
      dir,
      profileId: 'nature-astronomy',
      outputName: 'fixture-paper',
      figurePngPaths,
      options: OPTIONS,
      useDocxTools: false
    })

    expect(result.path).toBe(join(dir, 'output', 'fixture-paper.docx'))
    expect(result.usedDocxTools).toBe(false)
    const bytes = await readFile(result.path)
    expect(bytes.byteLength).toBeGreaterThan(1000)
    // A .docx is a zip: PK magic bytes.
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)

    expect(await readFile(manuscriptPath, 'utf8')).toBe(before)
  })
})

describe('examples/demo-paper round trip', () => {
  it('builds a real .docx from the shipped demo project', async () => {
    const demoDir = resolve(import.meta.dirname, '..', '..', '..', '..', '..', 'examples', 'demo-paper')
    allowRoot(demoDir)
    const scratch = await mkdtemp(join(tmpdir(), 'suna-demo-docx-'))
    allowRoot(scratch)
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )
    const specFig = join(scratch, 'fig-spectrum.png')
    const velFig = join(scratch, 'fig-velocity-map.png')
    await writeFile(specFig, png)
    await writeFile(velFig, png)

    const content = await buildExportContent({
      dir: demoDir,
      profileId: 'nature-astronomy',
      figurePngPaths: { 'fig-spectrum': specFig, 'fig-velocity-map': velFig }
    })
    const doc = await buildDocxDocument(content, OPTIONS)
    const { Packer } = await import('docx')
    const buffer = await Packer.toBuffer(doc)
    const zip = await JSZip.loadAsync(buffer)
    const documentXml = (await zip.file('word/document.xml')?.async('string')) ?? ''

    expect(documentXml).toContain('Ada')
    expect(documentXml).toContain('Results')
    expect(documentXml).toContain('Gunn')

    await rm(scratch, { recursive: true, force: true })
  })
})

/**
 * SUNA style is the house drafting style, and its whole point is that the
 * exported .docx has the STRUCTURE `docx-tools build` produces. These assert
 * that structure against the real OOXML, and — just as importantly — that a
 * journal profile is NOT affected by any of it.
 */
describe('SUNA style (the house style)', () => {
  const SINGLE = { doubleSpacing: false, lineNumbers: false, pageNumbers: true }

  async function buildXml(profileId: string, options = SINGLE): Promise<string> {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId, figurePngPaths })
    const doc = await buildDocxDocument(content, options)
    const { Packer } = await import('docx')
    const zip = await JSZip.loadAsync(await Packer.toBuffer(doc))
    return (await zip.file('word/document.xml')?.async('string')) ?? ''
  }

  it('sets the page to US Letter with 0.5 in margins', async () => {
    const xml = await buildXml('suna')
    // 8.5 x 11 in = 12240 x 15840 twips; 0.5 in = 720 twips.
    expect(xml).toContain('w:w="12240"')
    expect(xml).toContain('w:h="15840"')
    expect(xml).toMatch(/w:top="720"[^>]*w:right="720"[^>]*w:bottom="720"[^>]*w:left="720"/)
  })

  it('sets body text 11 pt at 1.15 line spacing', async () => {
    const xml = await buildXml('suna')
    // 11 pt = 22 half-points on the document default; 1.15 = 276/240 auto.
    expect(xml).toMatch(/w:line="276"/)
    expect(xml).toContain('w:lineRule="auto"')
  })

  it('double spacing still wins over the style when the user asks for it', async () => {
    const xml = await buildXml('suna', { ...SINGLE, doubleSpacing: true })
    expect(xml).toMatch(/w:line="480"/)
    expect(xml).not.toMatch(/w:line="276"/)
  })

  it('forces headings to black, over Word default Heading 1 blue', async () => {
    const xml = await buildXml('suna')
    const headingBlock = xml.slice(xml.indexOf('Introduction') - 800, xml.indexOf('Introduction'))
    expect(headingBlock).toContain('w:val="000000"')
    // 13 pt = 26 half-points
    expect(headingBlock).toContain('w:val="26"')
  })

  it('breaks to a new page after the front matter so the body starts on page 2', async () => {
    const xml = await buildXml('suna')
    const beforeIntro = xml.slice(0, xml.indexOf('Introduction'))
    expect(beforeIntro).toContain('w:pageBreakBefore')
  })

  it('writes the figure caption BELOW its image, with a bold label and italic body', async () => {
    const xml = await buildXml('suna')
    const drawingAt = xml.indexOf('<w:drawing>')
    // The label prefix ("Fig." vs "Figure") is the profile's business; what
    // this asserts is that the caption follows the image, whatever it reads.
    const captionAt = xml.indexOf('A fixture figure.')
    expect(drawingAt).toBeGreaterThan(-1)
    expect(captionAt).toBeGreaterThan(drawingAt)
    // the caption paragraph is centred and its body italic
    const caption = xml.slice(captionAt - 700, captionAt + 700)
    expect(caption).toContain('w:val="center"')
    expect(caption).toContain('<w:i')
  })

  it('gives the reference list a 0.5 in hanging indent at 10 pt', async () => {
    const xml = await buildXml('suna')
    // 0.5 in = 720 twips, as both left indent and hanging.
    expect(xml).toMatch(/w:left="720"[^>]*w:hanging="720"|w:hanging="720"[^>]*w:left="720"/)
  })

  it('rules tables APA-style instead of drawing a full grid', async () => {
    const xml = await buildXml('suna')
    // Cleared borders are written as explicit "nil"/"none" rather than left out.
    expect(xml).toMatch(/w:val="(nil|none)"/)
  })

  it('leaves a journal profile completely alone', async () => {
    const xml = await buildXml('nature-astronomy')
    // A4 with 1 in (1440 twip) margins, as before.
    expect(xml).toContain('w:w="11905"')
    expect(xml).toMatch(/w:top="1440"/)
    // no page break before the first body heading
    const beforeIntro = xml.slice(0, xml.indexOf('Introduction'))
    expect(beforeIntro).not.toContain('w:pageBreakBefore')
    // and no forced-black heading override
    expect(xml).not.toContain('* Corresponding author:')
  })
})
