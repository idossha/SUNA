import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import JSZip from 'jszip'
import { buildExportContent } from './export-content'
import { buildDocxDocument, exportDocx } from './export-docx'
import { FIXTURE_MANUSCRIPT, FIXTURE_MANUSCRIPT_MD, writeFixtureProject } from './export-fixture'
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

/** A byte-valid 1x1 PNG, same one export-fixture.ts uses for the managed figure. */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

/**
 * A byte-valid PNG of a given pixel size, so a `{width=…}` cap has something
 * bigger than itself to narrow. Built rather than fixtured because the sizing
 * rule reads the IHDR, and a 1x1 image can only ever be its own natural size.
 */
function pngOfSize(width: number, height: number): Buffer {
  const chunk = (type: string, body: Buffer): Buffer => {
    const head = Buffer.alloc(4)
    head.writeUInt32BE(body.length)
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), body])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(typed))
    return Buffer.concat([head, typed, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // greyscale
  // One filter byte plus `width` samples per row, all zero.
  const raw = Buffer.alloc(height * (width + 1))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** `<wp:extent>` of the LAST drawing in the document, in EMU. */
function lastExtent(xml: string): { cx: number; cy: number } {
  const matches = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)]
  const last = matches[matches.length - 1]
  return { cx: Number(last?.[1] ?? 0), cy: Number(last?.[2] ?? 0) }
}

/** Appends prose to the fixture's manuscript.md — the fixture itself has no markdown image. */
async function appendProse(markdown: string): Promise<void> {
  await writeFile(join(dir, 'manuscript', 'manuscript.md'), `${FIXTURE_MANUSCRIPT_MD}\n${markdown}\n`, 'utf8')
}

async function zipFor(profileId: string, options = OPTIONS): Promise<JSZip> {
  const content = await buildExportContent({
    dir,
    profileId,
    figurePngPaths: { 'fig-a': join(dir, 'output', 'fig-a.png') }
  })
  const doc = await buildDocxDocument(content, options)
  const { Packer } = await import('docx')
  return JSZip.loadAsync(await Packer.toBuffer(doc))
}

async function documentXmlFor(profileId: string, options = OPTIONS): Promise<string> {
  const zip = await zipFor(profileId, options)
  return (await zip.file('word/document.xml')?.async('string')) ?? ''
}

/** Strips XML tags so assertions match text that Word splits across <w:t> runs. */
function visibleText(xml: string): string {
  return xml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')
}

/** Rewrites manuscript.json from a patched copy of the fixture manuscript. */
async function patchManuscript(patch: (m: Record<string, unknown>) => void): Promise<void> {
  const m = JSON.parse(JSON.stringify(FIXTURE_MANUSCRIPT)) as Record<string, unknown>
  patch(m)
  await writeFile(join(dir, 'manuscript', 'manuscript.json'), JSON.stringify(m, null, 2) + '\n', 'utf8')
}

/** The `w:jc` values of the cell paragraphs of the LAST table in the document, row by row. */
function cellAlignments(xml: string): string[][] {
  const table = xml.slice(xml.lastIndexOf('<w:tbl>'))
  return [...table.matchAll(/<w:tr>[\s\S]*?<\/w:tr>/g)].map((row) =>
    [...(row[0] ?? '').matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map(
      (cell) => /<w:jc w:val="([a-z]+)"\/>/.exec(cell[0] ?? '')?.[1] ?? 'none'
    )
  )
}

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

/**
 * The bug this guards: /Users/idohaber/Desktop/P077/output/p077.docx has ZERO
 * word/media entries and ZERO <w:drawing> elements — every markdown image in
 * the manuscript was replaced by its alt text as a literal run.
 */
describe('markdown images', () => {
  it('embeds a lone markdown image as a centred ImageRun, not its alt text', async () => {
    await writeFixtureProject(dir)
    await mkdir(join(dir, 'figures'), { recursive: true })
    await writeFile(join(dir, 'figures', 'x.png'), ONE_PIXEL_PNG)
    await appendProse('![Registration QC](../figures/x.png)')

    const xml = await documentXmlFor('suna')
    // Two <w:drawing>s now: the managed figure and the markdown image.
    expect((xml.match(/<w:drawing>/g) ?? []).length).toBe(2)
    expect(xml).not.toContain('Registration QC')

    const drawing = xml.slice(xml.lastIndexOf('<w:p>', xml.lastIndexOf('<w:drawing>')))
    expect(drawing).toContain('w:val="center"')
  })

  it('carries the image bytes into the package as a word/media entry', async () => {
    await writeFixtureProject(dir)
    await mkdir(join(dir, 'figures'), { recursive: true })
    await writeFile(join(dir, 'figures', 'x.png'), ONE_PIXEL_PNG)
    await appendProse('![Registration QC](../figures/x.png)')

    const content = await buildExportContent({
      dir,
      profileId: 'suna',
      figurePngPaths: { 'fig-a': join(dir, 'output', 'fig-a.png') }
    })
    const { Packer } = await import('docx')
    const zip = await JSZip.loadAsync(await Packer.toBuffer(await buildDocxDocument(content, OPTIONS)))
    const media = Object.keys(zip.files).filter((name) => name.startsWith('word/media/'))
    expect(media.length).toBe(2)
  })

  it('degrades an .svg url to its alt text rather than throwing', async () => {
    await writeFixtureProject(dir)
    await mkdir(join(dir, 'figures'), { recursive: true })
    await writeFile(join(dir, 'figures', 'method.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8')
    await appendProse('![Method](../figures/method.svg)')

    const xml = await documentXmlFor('suna')
    expect(xml).toContain('Method')
    expect((xml.match(/<w:drawing>/g) ?? []).length).toBe(1)
  })

  it('keeps an image that sits inside a sentence as alt text', async () => {
    await writeFixtureProject(dir)
    await mkdir(join(dir, 'figures'), { recursive: true })
    await writeFile(join(dir, 'figures', 'x.png'), ONE_PIXEL_PNG)
    await appendProse('See ![Registration QC](../figures/x.png) inline.')

    const xml = await documentXmlFor('suna')
    expect(xml).toContain('Registration QC')
    expect((xml.match(/<w:drawing>/g) ?? []).length).toBe(1)
  })

  /**
   * `{width=…}` was read by the HTML renderer and ignored here, so the same
   * source produced a quarter-width figure on screen and in the PDF and a
   * full-width one in Word.
   */
  it('honours a `{width=…}` attribute block as a ceiling', async () => {
    await writeFixtureProject(dir)
    await mkdir(join(dir, 'figures'), { recursive: true })
    await writeFile(join(dir, 'figures', 'wide.png'), pngOfSize(600, 300))

    await appendProse('![Tall](../figures/wide.png)')
    const natural = lastExtent(await documentXmlFor('suna'))

    await appendProse('![Tall](../figures/wide.png){width=25%}')
    const narrowed = lastExtent(await documentXmlFor('suna'))

    expect(narrowed.cx).toBeLessThan(natural.cx)
    // Both axes scale by the same factor: clamping one alone distorts.
    expect(narrowed.cx / narrowed.cy).toBeCloseTo(natural.cx / natural.cy, 2)
  })

  it('never UPSCALES past the natural size, which is what the other renderers do', async () => {
    await writeFixtureProject(dir)
    await mkdir(join(dir, 'figures'), { recursive: true })
    await writeFile(join(dir, 'figures', 'small.png'), pngOfSize(80, 40))

    await appendProse('![Icon](../figures/small.png)')
    const natural = lastExtent(await documentXmlFor('suna'))

    await appendProse('![Icon](../figures/small.png){width=100%}')
    expect(lastExtent(await documentXmlFor('suna'))).toEqual(natural)
  })

  it('embeds both images of a soft-broken paragraph, not their alt text', async () => {
    await writeFixtureProject(dir)
    await mkdir(join(dir, 'figures'), { recursive: true })
    await writeFile(join(dir, 'figures', 'x.png'), ONE_PIXEL_PNG)
    await appendProse('![Panel one](../figures/x.png)\n![Panel two](../figures/x.png)')

    const xml = await documentXmlFor('suna')
    // The managed figure plus both markdown images.
    expect((xml.match(/<w:drawing>/g) ?? []).length).toBe(3)
    expect(xml).not.toContain('Panel one')
    expect(xml).not.toContain('Panel two')
  })

  it('embeds an image that is the whole of a list item', async () => {
    await writeFixtureProject(dir)
    await mkdir(join(dir, 'figures'), { recursive: true })
    await writeFile(join(dir, 'figures', 'x.png'), ONE_PIXEL_PNG)
    await appendProse('- ![Panel A](../figures/x.png)\n')

    const xml = await documentXmlFor('suna')
    expect((xml.match(/<w:drawing>/g) ?? []).length).toBe(2)
    expect(xml).not.toContain('Panel A')
  })
})

/**
 * GFM column alignment survived to the screen and the PDF but was silently
 * dropped in Word: `tableFromMdast` never read `node.align`.
 */
describe('markdown table alignment', () => {
  const ALIGNED = '| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |'

  it('honours an explicit GFM delimiter row under a house profile', async () => {
    await writeFixtureProject(dir)
    await appendProse(ALIGNED)
    expect(cellAlignments(await documentXmlFor('suna'))).toEqual([
      ['left', 'center', 'right'],
      ['left', 'center', 'right']
    ])
  })

  it('honours it under a journal profile too, which otherwise states no alignment', async () => {
    await writeFixtureProject(dir)
    await appendProse(ALIGNED)
    expect(cellAlignments(await documentXmlFor('nature-astronomy'))).toEqual([
      ['left', 'center', 'right'],
      ['left', 'center', 'right']
    ])
  })

  it('keeps the APA fallback for an unspecified column, under house and journal profiles alike', async () => {
    await writeFixtureProject(dir)
    await appendProse('| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |')
    // SUNA's APA convention is the always-on default: header all centred,
    // body first column left and the rest centred — journal profiles state
    // no alignment of their own and inherit it.
    const apa = [
      ['center', 'center', 'center'],
      ['left', 'center', 'center']
    ]
    expect(cellAlignments(await documentXmlFor('suna'))).toEqual(apa)
    expect(cellAlignments(await documentXmlFor('nature-astronomy'))).toEqual(apa)
  })

  it('shrink-wraps and centres the table instead of stretching it to 100%', async () => {
    await writeFixtureProject(dir)
    const xml = await documentXmlFor('suna')
    const table = xml.slice(xml.lastIndexOf('<w:tbl>'))
    expect(table).toContain('w:type="auto"')
    expect(table).not.toContain('w:type="pct"')
    expect(table.slice(0, table.indexOf('<w:tr>'))).toContain('<w:jc w:val="center"/>')
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
      options: OPTIONS
    })

    expect(result.path).toBe(join(dir, 'output', 'fixture-paper.docx'))
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

  /**
   * The always-on model: a journal profile inherits the FULL SUNA typography
   * and shifts only the convention deltas its guidelines state. The old
   * "journal profile left completely alone on A4/12pt" behavior is gone BY
   * DESIGN — no journal states submitted-manuscript page geometry (ADR-002),
   * so every export drafts in SUNA style.
   */
  it('a journal profile inherits the SUNA typography plus only its stated deltas', async () => {
    const xml = await buildXml('nature-astronomy')
    // US Letter with 0.5 in (720 twip) margins — the SUNA page, not A4/1in.
    expect(xml).toContain('w:w="12240"')
    expect(xml).toContain('w:h="15840"')
    expect(xml).toMatch(/w:top="720"/)
    expect(xml).not.toContain('w:w="11905"')
    // SUNA's 1.15 line spacing and front-matter page break apply too.
    expect(xml).toMatch(/w:line="276"/)
    const beforeIntro = xml.slice(0, xml.indexOf('Introduction'))
    expect(beforeIntro).toContain('w:pageBreakBefore')
    // docx-tools' corresponding-author line, not the legacy "*e-mail:" one.
    expect(xml).toContain('* Corresponding author:')
    expect(xml).not.toContain('*e-mail:')
    // The one delta nature-astronomy's guidelines state: "Fig. 1" labels.
    expect(xml).toContain('Fig. 1')
  })

  it('a journal profile with no documentStyle at all still drafts in full SUNA style', async () => {
    const xml = await buildXml('apj-aas')
    expect(xml).toContain('w:w="12240"')
    expect(xml).toMatch(/w:top="720"/)
    expect(xml).toMatch(/w:line="276"/)
    expect(xml).toContain('* Corresponding author:')
    // No stated figure-label delta -> the SUNA "Figure 1" spelling.
    expect(xml).toContain('Figure 1')
    expect(xml).not.toContain('Fig. 1')
  })
})

describe('back matter', () => {
  it('renders the non-empty sections in the ground-truth order, before the references', async () => {
    await writeFixtureProject(dir)
    const text = visibleText(await documentXmlFor('suna'))
    const order = [
      'Acknowledgments',
      'Funding',
      'Competing Interests',
      'Data Availability',
      'Author Contributions',
      'References'
    ]
    const positions = order.map((title) => text.indexOf(title))
    for (const [i, at] of positions.entries()) {
      expect(at, `"${order[i]}" missing`).toBeGreaterThan(-1)
    }
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    // The bodies made it through, funding as one "Funder (grant)" paragraph.
    expect(text).toContain('We thank the export test harness.')
    expect(text).toContain('Fixture Science Foundation (FSF-0042); Open Testing Trust')
    expect(text).toContain('Fixture data are available from the corresponding author.')
  })

  it('never renders an empty section: blank code stays out, empty back matter renders nothing', async () => {
    await writeFixtureProject(dir)
    // The fixture's availability.code is '' -> data-only heading, no code one.
    const withData = visibleText(await documentXmlFor('suna'))
    expect(withData).toContain('Data Availability')
    expect(withData).not.toContain('Code Availability')
    expect(withData).not.toContain('Data and Code Availability')

    await patchManuscript((m) => {
      m['availability'] = { data: '', code: '' }
      m['backMatter'] = {
        acknowledgements: null,
        authorContributions: null,
        funding: [],
        competingInterests: null,
        peerReview: null,
        supplementaryInfo: null
      }
    })
    const empty = visibleText(await documentXmlFor('suna'))
    for (const title of ['Acknowledgments', 'Funding', 'Competing Interests', 'Availability', 'Author Contributions']) {
      expect(empty).not.toContain(title)
    }
  })

  it('merges data and code into one section when both statements exist', async () => {
    await writeFixtureProject(dir)
    await patchManuscript((m) => {
      m['availability'] = { data: 'Data live in the archive.', code: 'Code lives in the repository.' }
    })
    const text = visibleText(await documentXmlFor('suna'))
    expect(text).toContain('Data and Code Availability')
    expect(text).toContain('Data live in the archive.')
    expect(text).toContain('Code lives in the repository.')
  })
})

describe('keywords', () => {
  it('renders bold "Keywords: " plus the italic ;-joined list right after the abstract', async () => {
    await writeFixtureProject(dir)
    const xml = await documentXmlFor('suna')
    const at = xml.indexOf('Keywords:')
    expect(at).toBeGreaterThan(xml.indexOf('We test the export pipeline'))
    expect(at).toBeLessThan(xml.indexOf('Introduction'))
    const para = xml.slice(at - 300, at + 500)
    expect(para).toContain('<w:b/>')
    expect(para).toContain('export pipelines; fixtures; stripping')
    expect(xml.slice(xml.indexOf('export pipelines') - 200, xml.indexOf('export pipelines'))).toContain('<w:i/>')
  })

  it('renders no keywords line when the manuscript has none', async () => {
    await writeFixtureProject(dir)
    await patchManuscript((m) => {
      delete m['keywords']
    })
    expect(await documentXmlFor('suna')).not.toContain('Keywords:')
  })
})

/**
 * Markdown lists are REAL Word lists now: registered numbering definitions in
 * word/numbering.xml, referenced through <w:numPr>, no literal "1. "/"• "
 * text — so Word renumbers on edit.
 */
describe('real Word lists', () => {
  it('renders an ordered list through numbering.xml, not literal number prefixes', async () => {
    await writeFixtureProject(dir)
    await appendProse('1. First item\n2. Second item\n')
    const zip = await zipFor('suna')
    const numberingXml = (await zip.file('word/numbering.xml')?.async('string')) ?? ''
    expect(numberingXml).toContain('<w:abstractNum')
    expect(numberingXml).toContain('w:val="decimal"')
    const xml = (await zip.file('word/document.xml')?.async('string')) ?? ''
    expect(xml).toContain('<w:numPr>')
    expect(xml).toContain('First item')
    expect(visibleText(xml)).not.toContain('1. First item')
  })

  it('renders bullets through numbering.xml with no literal glyph in the body', async () => {
    await writeFixtureProject(dir)
    await appendProse('- Alpha point\n- Beta point\n')
    const zip = await zipFor('suna')
    const numberingXml = (await zip.file('word/numbering.xml')?.async('string')) ?? ''
    expect(numberingXml).toContain('w:val="bullet"')
    const xml = (await zip.file('word/document.xml')?.async('string')) ?? ''
    expect(xml).toContain('<w:numPr>')
    expect(xml).toContain('Alpha point')
    expect(xml).not.toContain('•')
  })

  it('nests levels natively: an inner list references a deeper ilvl', async () => {
    await writeFixtureProject(dir)
    await appendProse('1. Top item\n   1. Inner item\n')
    const xml = await documentXmlFor('suna')
    expect(xml).toContain('<w:ilvl w:val="0"/>')
    expect(xml).toContain('<w:ilvl w:val="1"/>')
    expect(visibleText(xml)).not.toContain('1. Inner item')
  })

  it('restarts numbering per list: two ordered lists get two concrete instances', async () => {
    await writeFixtureProject(dir)
    await appendProse('1. one\n2. two\n\nBetween the lists.\n\n1. uno\n2. dos\n')
    const xml = await documentXmlFor('suna')
    const numIds = new Set([...xml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]))
    expect(numIds.size).toBe(2)
  })

  it('keeps an author-stated start ("3.") through a startOverride-carrying reference', async () => {
    await writeFixtureProject(dir)
    await appendProse('3. three\n4. four\n')
    const zip = await zipFor('suna')
    const numberingXml = (await zip.file('word/numbering.xml')?.async('string')) ?? ''
    expect(numberingXml).toContain('<w:start w:val="3"/>')
  })
})

describe('cross-reference bookmarks and hyperlinks', () => {
  it('bookmarks the figure and table captions as _fig_N/_tbl_N', async () => {
    await writeFixtureProject(dir)
    const xml = await documentXmlFor('suna')
    expect(xml).toContain('w:name="_fig_1"')
    expect(xml).toContain('w:name="_tbl_1"')
  })

  it('renders @fig:/@tbl: cross-refs as styled internal hyperlinks, and citations as plain runs', async () => {
    await writeFixtureProject(dir)
    const xml = await documentXmlFor('suna')
    const fig = /<w:hyperlink [^>]*w:anchor="_fig_1"[^>]*>([\s\S]*?)<\/w:hyperlink>/.exec(xml)
    expect(fig).not.toBeNull()
    expect(fig?.[1]).toContain('Figure 1')
    expect(fig?.[1]).toContain('w:val="2B579A"')
    expect(fig?.[1]).toContain('<w:u ')
    expect(xml).toMatch(/<w:hyperlink [^>]*w:anchor="_tbl_1"/)
    // Exactly the two cross-refs are internal links; citations stay plain.
    expect([...xml.matchAll(/<w:hyperlink [^>]*w:anchor=/g)]).toHaveLength(2)
  })
})

/**
 * The SLEEP journal's stated shape (its documentStyle delta): figure captions
 * in a list after the references instead of embedded images, tables at the
 * end, references on a new page — on top of full SUNA typography.
 */
describe('figurePlacement captions-list + tablePlacement end (SLEEP)', () => {
  it('embeds no figure image at all and emits a Figure Captions section after the references', async () => {
    await writeFixtureProject(dir)
    const zip = await zipFor('sleep')
    const media = Object.keys(zip.files).filter((name) => name.startsWith('word/media/'))
    expect(media).toHaveLength(0)
    const xml = (await zip.file('word/document.xml')?.async('string')) ?? ''
    expect(xml).not.toContain('<w:drawing>')

    const refsAt = xml.indexOf('References')
    const captionsAt = xml.indexOf('Figure Captions')
    expect(captionsAt).toBeGreaterThan(refsAt)
    // The caption itself lives in the list, bookmarked for the cross-ref.
    expect(xml.indexOf('A fixture figure.')).toBeGreaterThan(captionsAt)
    expect(xml.indexOf('w:name="_fig_1"')).toBeGreaterThan(captionsAt)
    // SLEEP states "Figure 1", never "Fig."
    expect(xml).toContain('Figure 1')
    expect(xml).not.toContain('Fig. 1')
  })

  it('keeps the in-text mention as a working hyperlink to the caption list', async () => {
    await writeFixtureProject(dir)
    const xml = await documentXmlFor('sleep')
    expect(xml).toMatch(/<w:hyperlink [^>]*w:anchor="_fig_1"/)
  })

  it('moves markdown tables and table captions into a Tables section after the captions list', async () => {
    await writeFixtureProject(dir)
    const xml = await documentXmlFor('sleep')
    const captionsAt = xml.indexOf('Figure Captions')
    const tablesAt = xml.indexOf('Tables')
    expect(tablesAt).toBeGreaterThan(captionsAt)
    // The GFM table left the body entirely and re-appears at the end.
    expect(xml.indexOf('<w:tbl>')).toBeGreaterThan(tablesAt)
    expect(xml.lastIndexOf('<w:tbl>')).toBe(xml.indexOf('<w:tbl>'))
    // The manuscript.json table caption sits in the same trailing section.
    expect(xml.indexOf('A fixture table')).toBeGreaterThan(tablesAt)
  })

  it('starts the references on a new page (SLEEP states it; SUNA defaults to it anyway)', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const xml = await documentXmlFor('sleep')
    const refsAt = xml.indexOf('References')
    expect(xml.slice(refsAt - 700, refsAt)).toContain('w:pageBreakBefore')

    // And the override in the other direction works: a style that states
    // referencesStartNewPage: false keeps the references in the flow.
    const content = await buildExportContent({ dir, profileId: 'suna', figurePngPaths })
    const patched = {
      ...content,
      profile: { ...content.profile, documentStyle: { referencesStartNewPage: false } }
    }
    const doc = await buildDocxDocument(patched, OPTIONS)
    const { Packer } = await import('docx')
    const zip = await JSZip.loadAsync(await Packer.toBuffer(doc))
    const flowXml = (await zip.file('word/document.xml')?.async('string')) ?? ''
    const flowRefsAt = flowXml.indexOf('References')
    expect(flowXml.slice(flowRefsAt - 700, flowRefsAt)).not.toContain('w:pageBreakBefore')
  })
})

/**
 * LaTeX math is typeset as real OMML (tex-omml.ts) when the strict subset
 * covers the WHOLE equation, and falls back — whole, never partially — to the
 * italic-literal rendering otherwise.
 */
describe('OMML math', () => {
  it('typesets a supported display equation as a centred m:oMath paragraph', async () => {
    await writeFixtureProject(dir)
    await appendProse('$$\nE = mc^2\n$$')
    const xml = await documentXmlFor('suna')
    expect(xml).toContain('<m:oMath>')
    // No literal $$…$$ run remains for it.
    expect(visibleText(xml)).not.toContain('$$')
    const para = xml.slice(xml.lastIndexOf('<w:p>', xml.indexOf('<m:oMath>')))
    expect(para.slice(0, para.indexOf('<m:oMath>'))).toContain('w:val="center"')
  })

  it('writes the real OOXML structure for a fraction with a subscript', async () => {
    await writeFixtureProject(dir)
    await appendProse('$$\n\\frac{\\Sigma_\\mathrm{gas}}{v^2}\n$$')
    const xml = await documentXmlFor('suna')
    expect(xml).toContain('<m:f>')
    expect(xml).toContain('<m:num>')
    expect(xml).toContain('<m:den>')
    expect(xml).toContain('<m:sSub>')
    expect(xml).toContain('<m:sSup>')
    // \mathrm content is an upright (m:nor) run carrying "gas".
    expect(xml).toContain('<m:nor/>')
    expect(visibleText(xml)).toContain('gas')
  })

  it('renders an UNSUPPORTED equation as the italic literal with no m:oMath', async () => {
    await writeFixtureProject(dir)
    await appendProse('$$\n\\undefinedmacro{x} & y\n$$')
    const xml = await documentXmlFor('suna')
    expect(xml).not.toContain('<m:oMath>')
    // visibleText strips tags, not entities — the & arrives XML-escaped.
    expect(visibleText(xml)).toContain('$$\\undefinedmacro{x} &amp; y$$')
    const at = xml.indexOf('undefinedmacro')
    expect(xml.slice(at - 400, at)).toContain('<w:i/>')
  })

  it('typesets supported inline math and leaves unsupported inline math italic', async () => {
    await writeFixtureProject(dir)
    await appendProse('The line H$\\alpha$ shifts by $\\Delta v \\approx 40$ but $\\weird{x}$ stays.')
    const xml = await documentXmlFor('suna')
    expect((xml.match(/<m:oMath>/g) ?? []).length).toBe(2)
    expect(visibleText(xml)).toContain('α')
    expect(visibleText(xml)).toContain('\\weird{x}')
  })

  it('converts the demo paper stripping equation from the real project', async () => {
    const demoDir = resolve(import.meta.dirname, '..', '..', '..', '..', '..', 'examples', 'demo-paper')
    allowRoot(demoDir)
    const scratch = await mkdtemp(join(tmpdir(), 'suna-demo-math-'))
    allowRoot(scratch)
    const specFig = join(scratch, 'fig-spectrum.png')
    const velFig = join(scratch, 'fig-velocity-map.png')
    await writeFile(specFig, ONE_PIXEL_PNG)
    await writeFile(velFig, ONE_PIXEL_PNG)
    const content = await buildExportContent({
      dir: demoDir,
      profileId: 'suna',
      figurePngPaths: { 'fig-spectrum': specFig, 'fig-velocity-map': velFig }
    })
    const { Packer } = await import('docx')
    const zip = await JSZip.loadAsync(await Packer.toBuffer(await buildDocxDocument(content, OPTIONS)))
    const xml = (await zip.file('word/document.xml')?.async('string')) ?? ''
    // The display equation ($$ P_\mathrm{ram} = … $$) is real OMML now.
    expect(xml).toContain('<m:oMath>')
    expect(xml).toContain('<m:nor/>')
    expect(visibleText(xml)).not.toContain('$$')
    await rm(scratch, { recursive: true, force: true })
  })
})

describe('document metadata', () => {
  it('names SUNA as creator/lastModifiedBy and leaks no library name', async () => {
    await writeFixtureProject(dir)
    const zip = await zipFor('suna')
    const core = (await zip.file('docProps/core.xml')?.async('string')) ?? ''
    expect(core).toContain('<dc:creator>SUNA</dc:creator>')
    expect(core).toContain('<cp:lastModifiedBy>SUNA</cp:lastModifiedBy>')
    expect(core.toLowerCase()).not.toContain('easleyit')
    expect(core).not.toMatch(/docx(?!-)/i)
  })
})
