import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'
import { buildSupplementContent } from './export-content'
import { buildSupplementDocx, exportDocx } from './export-docx'
import { buildSupplementHtml } from './export-html'
import { writeFixtureProject } from './export-fixture'
import { allowRoot } from './roots'

/**
 * The Supplementary Information document, asserted against real OOXML the
 * way export-docx.test.ts pins the main manuscript. The ground truth is the
 * user's published supplement (sleepTI_supplement.docx): cover title +
 * manuscript byline, a linked Contents list, inline 165 mm figures with
 * "Figure S1." captions, "Table S1." tables at 9 pt cells, independently
 * numbered "Supplementary References", and an always-on page footer.
 *
 * The profile under test is 'sleep' on purpose: its main-manuscript deltas
 * (figurePlacement captions-list, tablePlacement end) must NOT leak into the
 * supplement, which embeds figures and keeps tables in the flow regardless.
 */

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suna-export-supp-'))
  allowRoot(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const OPTIONS = { doubleSpacing: false, lineNumbers: false, pageNumbers: true }

async function supplementZip(profileId = 'sleep', options = OPTIONS): Promise<JSZip> {
  const { figurePngPaths } = await writeFixtureProject(dir, { supplement: true })
  const content = await buildSupplementContent({ dir, profileId, figurePngPaths })
  const doc = await buildSupplementDocx(content, options)
  const { Packer } = await import('docx')
  return JSZip.loadAsync(await Packer.toBuffer(doc))
}

async function supplementXml(profileId = 'sleep', options = OPTIONS): Promise<string> {
  const zip = await supplementZip(profileId, options)
  return (await zip.file('word/document.xml')?.async('string')) ?? ''
}

/** Strips XML tags so assertions match text that Word splits across <w:t> runs. */
function visibleText(xml: string): string {
  return xml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')
}

describe('supplement cover', () => {
  it('titles the document "Supplementary Information: <main title>" in the title role', async () => {
    const xml = await supplementXml()
    const text = visibleText(xml)
    // $z=1$ passes through texRuns, so the math is stripped to its source.
    expect(text).toContain('Supplementary Information: Fixture study of')
    const at = xml.indexOf('Supplementary Information:')
    const para = xml.slice(xml.lastIndexOf('<w:p>', at), at)
    // 14 pt bold centred — the style's title role.
    expect(para).toContain('w:val="center"')
    const run = xml.slice(at - 300, at)
    expect(run).toContain('<w:b/>')
    expect(run).toContain('w:val="28"')
  })

  it('repeats the SAME author/affiliation/corresponding block as the manuscript', async () => {
    const text = visibleText(await supplementXml())
    expect(text).toContain('Ada Researcher')
    expect(text).toContain('Ben Collaborator')
    expect(text).toContain('Department of Astronomy, Fixture University')
    expect(text).toContain('* Corresponding author: ada@example.edu')
  })

  it('carries no abstract, keywords, highlights or back matter', async () => {
    const text = visibleText(await supplementXml())
    expect(text).not.toContain('Abstract')
    expect(text).not.toContain('Keywords:')
    expect(text).not.toContain('Highlights')
    expect(text).not.toContain('Acknowledgments')
    expect(text).not.toContain('Competing Interests')
  })
})

describe('supplement Contents', () => {
  it('writes a bold 12 pt Contents label followed by internal hyperlinks', async () => {
    const xml = await supplementXml()
    const at = xml.indexOf('>Contents<')
    expect(at).toBeGreaterThan(-1)
    const label = xml.slice(at - 300, at)
    expect(label).toContain('<w:b/>')
    expect(label).toContain('w:val="24"')
  })

  it('pairs every Contents hyperlink with a bookmark on its heading', async () => {
    const xml = await supplementXml()
    const anchors = [...xml.matchAll(/<w:hyperlink [^>]*w:anchor="(_supp_[^"]+)"/g)].map((m) => m[1])
    const bookmarks = [...xml.matchAll(/w:name="(_supp_[^"]+)"/g)].map((m) => m[1])
    expect(anchors).toEqual(['_supp_supplementary-methods', '_supp_parameter-grid', '_supp_supplementary-results'])
    expect([...new Set(bookmarks)].sort()).toEqual([...new Set(anchors)].sort())
    // Each link jumps somewhere: every anchor has its bookmark.
    for (const anchor of anchors) expect(bookmarks).toContain(anchor)
  })

  it('styles the links blue 2B579A underlined and indents H1 0.2in, H2 0.45in', async () => {
    const xml = await supplementXml()
    const linkOf = (anchor: string): string =>
      new RegExp(`<w:hyperlink [^>]*w:anchor="${anchor}"[^>]*>([\\s\\S]*?)</w:hyperlink>`).exec(xml)?.[1] ?? ''
    const h1Link = linkOf('_supp_supplementary-methods')
    expect(h1Link).toContain('w:val="2B579A"')
    expect(h1Link).toContain('<w:u ')
    // The paragraph around an H1 entry indents 0.2 in (288 twips); the H2
    // "Parameter grid" entry indents 0.45 in (648 twips).
    const h1At = xml.indexOf('w:anchor="_supp_supplementary-methods"')
    expect(xml.slice(xml.lastIndexOf('<w:p>', h1At), h1At)).toContain('w:left="288"')
    const h2At = xml.indexOf('w:anchor="_supp_parameter-grid"')
    expect(xml.slice(xml.lastIndexOf('<w:p>', h2At), h2At)).toContain('w:left="648"')
  })
})

describe('supplement figures and tables', () => {
  it('embeds the figure inline at 165 mm with a "Figure S1." bold caption — even under sleep\'s captions-list delta', async () => {
    const zip = await supplementZip()
    // JSZip lists the word/media/ directory record itself — count only files.
    const media = Object.keys(zip.files).filter(
      (name) => name.startsWith('word/media/') && zip.files[name]?.dir !== true
    )
    expect(media.length).toBe(1)
    const xml = (await zip.file('word/document.xml')?.async('string')) ?? ''
    expect(xml).toContain('<w:drawing>')
    // 165 mm at 96 dpi = 624 px = 5,943,600 EMU (the 1x1 fixture PNG is square).
    expect(xml).toContain('<wp:extent cx="5943600"')
    const at = xml.indexOf('Figure S1.')
    expect(at).toBeGreaterThan(-1)
    expect(xml.slice(at - 300, at)).toContain('<w:b/>')
    // The caption is bookmarked as the cross-ref target.
    expect(xml).toContain('w:name="_fig_1"')
  })

  it('resolves an in-text @fig: cross-ref to the S-label as a working hyperlink', async () => {
    const xml = await supplementXml()
    const link = /<w:hyperlink [^>]*w:anchor="_fig_1"[^>]*>([\s\S]*?)<\/w:hyperlink>/.exec(xml)
    expect(link).not.toBeNull()
    expect(link?.[1]).toContain('Figure S1')
  })

  it('captions the GFM table "Table S1." above it and sets 9 pt cells — even under sleep\'s tables-at-end delta', async () => {
    const xml = await supplementXml()
    const captionAt = xml.indexOf('Table S1.')
    const tableAt = xml.indexOf('<w:tbl>')
    expect(captionAt).toBeGreaterThan(-1)
    expect(tableAt).toBeGreaterThan(captionAt)
    // No trailing "Tables" section: the table renders exactly once, in place.
    expect(xml.lastIndexOf('<w:tbl>')).toBe(tableAt)
    // Cell runs are 9 pt = 18 half-points.
    const table = xml.slice(tableAt, xml.indexOf('</w:tbl>'))
    expect(table).toContain('w:val="18"')
    expect(table).toContain('Parameter')
  })
})

describe('supplement references', () => {
  it('numbers citations independently, restarting at [1] by supplement appearance', async () => {
    const xml = await supplementXml()
    const text = visibleText(xml)
    const refsAt = text.indexOf('Supplementary References')
    expect(refsAt).toBeGreaterThan(-1)
    const list = text.slice(refsAt)
    // jones2019 is [2] in the MAIN manuscript but the supplement cites it
    // first, so its list opens "1. …Extending the baseline" (Jones).
    const first = list.indexOf('Extending the baseline')
    const second = list.indexOf('A baseline study')
    expect(first).toBeGreaterThan(-1)
    expect(second).toBeGreaterThan(first)
    expect(list.slice(0, first)).toContain('1. ')
    // And no plain "References" heading anywhere.
    expect(text).not.toMatch(/(?<!Supplementary )References/)
  })
})

describe('supplement footer', () => {
  it('always writes the right-aligned 9 pt PAGE footer, even with pageNumbers off', async () => {
    const zip = await supplementZip('sleep', { doubleSpacing: false, lineNumbers: false, pageNumbers: false })
    const footerFiles = Object.keys(zip.files).filter((name) => /word\/footer\d*\.xml$/.test(name))
    expect(footerFiles.length).toBeGreaterThanOrEqual(1)
    const footerXml = (await zip.file(footerFiles[0] as string)?.async('string')) ?? ''
    expect(footerXml).toContain('PAGE')
    expect(footerXml).toContain('w:val="right"')
    // 9 pt = 18 half-points, in the body face.
    expect(footerXml).toContain('w:val="18"')
    expect(footerXml).toContain('Times New Roman')
  })
})

describe('exportDocx supplement target', () => {
  it('writes <dir>/output/<name>.docx and never mutates any source file', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir, { supplement: true })
    const suppPath = join(dir, 'manuscript', 'supplementary.md')
    const manuscriptPath = join(dir, 'manuscript', 'manuscript.json')
    const suppBefore = await readFile(suppPath, 'utf8')
    const manuscriptBefore = await readFile(manuscriptPath, 'utf8')

    const result = await exportDocx({
      dir,
      profileId: 'sleep',
      outputName: 'fixture-supplement',
      figurePngPaths,
      options: OPTIONS,
      target: 'supplement'
    })

    expect(result.path).toBe(join(dir, 'output', 'fixture-supplement.docx'))
    const bytes = await readFile(result.path)
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)

    expect(await readFile(suppPath, 'utf8')).toBe(suppBefore)
    expect(await readFile(manuscriptPath, 'utf8')).toBe(manuscriptBefore)
  })

  it('throws a clear error naming the expected path when supplementary.md is missing', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir) // no supplement
    await expect(
      exportDocx({
        dir,
        profileId: 'sleep',
        outputName: 'nope',
        figurePngPaths,
        options: OPTIONS,
        target: 'supplement'
      })
    ).rejects.toThrow(/supplementary\.md/)
  })

  it('still exports the MAIN manuscript when target is omitted', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir, { supplement: true })
    const result = await exportDocx({
      dir,
      profileId: 'sleep',
      outputName: 'fixture-main',
      figurePngPaths,
      options: OPTIONS
    })
    const zip = await JSZip.loadAsync(await readFile(result.path))
    const xml = (await zip.file('word/document.xml')?.async('string')) ?? ''
    expect(visibleText(xml)).not.toContain('Supplementary Information:')
    expect(visibleText(xml)).toContain('Introduction')
  })
})

describe('buildSupplementHtml (the PDF page)', () => {
  it('mirrors the DOCX shape: cover, byline, linked Contents, S-captions, Supplementary References', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir, { supplement: true })
    const content = await buildSupplementContent({ dir, profileId: 'sleep', figurePngPaths })
    const html = await buildSupplementHtml(content, { doubleSpacing: false, lineNumbers: false })

    expect(html).toContain('Supplementary Information:')
    expect(html).toContain('Ada Researcher')
    expect(html).toContain('* Corresponding author: ada@example.edu')
    // Contents links to real heading anchors.
    expect(html).toContain('href="#supp-supplementary-methods"')
    expect(html).toContain('id="supp-supplementary-methods"')
    expect(html).toContain('href="#supp-parameter-grid"')
    expect(html).toContain('#2B579A')
    // The figure embeds inline (data URI) at the supplement width.
    expect(html).toContain('data:image/png;base64,')
    expect(html).toContain('165mm')
    expect(html).toContain('Figure S1')
    // The GFM table gets its S-caption; the reference list restarts at Jones.
    expect(html).toContain('Table S1.')
    const refsAt = html.indexOf('Supplementary References')
    expect(refsAt).toBeGreaterThan(-1)
    expect(html.indexOf('Extending the baseline')).toBeGreaterThan(refsAt)
    expect(html.indexOf('Extending the baseline')).toBeLessThan(html.indexOf('A baseline study'))
    // No abstract/back matter on the supplement page.
    expect(html).not.toContain('Abstract')
    expect(html).not.toContain('Acknowledgments')
  })
})

describe('examples/demo-paper supplement round trip', () => {
  it('builds a real supplement .docx from the shipped demo project', async () => {
    const demoDir = resolve(import.meta.dirname, '..', '..', '..', '..', '..', 'examples', 'demo-paper')
    allowRoot(demoDir)
    const scratch = await mkdtemp(join(tmpdir(), 'suna-demo-supp-'))
    allowRoot(scratch)
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )
    const velFig = join(scratch, 'fig-velocity-map.png')
    await writeFile(velFig, png)

    const content = await buildSupplementContent({
      dir: demoDir,
      profileId: 'suna',
      figurePngPaths: { 'fig-velocity-map': velFig }
    })
    // Only the embedded figure is required/S-labelled; the spectrum figure is not.
    expect(content.figures.map((f) => f.label)).toEqual(['Figure S1'])
    const doc = await buildSupplementDocx(content, OPTIONS)
    const { Packer } = await import('docx')
    const zip = await JSZip.loadAsync(await Packer.toBuffer(doc))
    const xml = (await zip.file('word/document.xml')?.async('string')) ?? ''
    const text = visibleText(xml)
    expect(text).toContain('Supplementary Information: Rapid quenching')
    expect(text).toContain('Supplementary Methods')
    expect(text).toContain('Table S1.')
    expect(text).toContain('Figure S1')
    expect(text).toContain('Supplementary References')
    // hunter2007 is the supplement's only citation -> [1] independent of the main paper.
    expect(text).toContain('1. ')
    expect(text).toContain('Hunter')

    await rm(scratch, { recursive: true, force: true })
  })
})

describe('buildSupplementContent', () => {
  it('S-labels figures by supplement appearance and numbers citations independently', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir, { supplement: true })
    const content = await buildSupplementContent({ dir, profileId: 'sleep', figurePngPaths })
    expect(content.figures.map((f) => f.label)).toEqual(['Figure S1'])
    expect(content.labels.figures.get('fig-a')).toBe('Figure S1')
    // jones2019 first in the supplement -> number 1; smith2020 second -> 2.
    expect(content.numbers.get('jones2019')).toBe(1)
    expect(content.numbers.get('smith2020')).toBe(2)
    // No manuscript.json tables leak in.
    expect(content.tables).toEqual([])
  })

  it('throws when an embedded figure has no rasterized PNG', async () => {
    await writeFixtureProject(dir, { supplement: true })
    await expect(buildSupplementContent({ dir, profileId: 'sleep', figurePngPaths: {} })).rejects.toThrow(
      /fig-a/
    )
  })
})
