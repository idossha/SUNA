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
