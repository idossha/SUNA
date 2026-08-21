import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildExportContent, buildSupplementContent } from './export-content'
import { buildManuscriptHtml, buildReaderHtml, buildSupplementHtml } from './export-html'
import { writeFixtureProject } from './export-fixture'
import { allowRoot } from './roots'

/**
 * export-pdf.ts's own smoke test is deliberately NOT written: it imports
 * `electron` for `BrowserWindow`/`printToPDF`, and vitest here runs under
 * plain Node, not a real Electron process — the `electron` package's main
 * export outside of Electron's own runtime is a string (the binary path),
 * not the API object, so `new BrowserWindow(...)` would throw immediately.
 * figure-export.ts's equivalent PDF path (one figure via the same
 * hidden-window pattern) has never had an automated test in this codebase
 * for the identical reason. This file instead thoroughly exercises
 * `buildManuscriptHtml` — the exact HTML export-pdf.ts hands to
 * `printToPDF` — which has no Electron dependency at all.
 */

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suna-export-html-'))
  allowRoot(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const OPTIONS = { doubleSpacing: true, lineNumbers: true }

/** A byte-valid 1x1 PNG, same one export-fixture.ts uses for the managed figure. */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

/** Appends prose to the fixture's manuscript.md — the fixture itself has no markdown image. */
async function appendProse(markdown: string): Promise<void> {
  const { FIXTURE_MANUSCRIPT_MD } = await import('./export-fixture')
  await writeFile(join(dir, 'manuscript', 'manuscript.md'), `${FIXTURE_MANUSCRIPT_MD}\n${markdown}\n`, 'utf8')
}

describe('buildManuscriptHtml', () => {
  it('renders a self-contained HTML document with the title, authors, and abstract', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'nature', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)

    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('Fixture study of')
    // $z=1$ -> KaTeX markup, not the literal dollar signs.
    expect(html).toContain('katex')
    expect(html).toContain('Ada Researcher')
    expect(html).toContain('Ben Collaborator')
    expect(html).toContain('We test the export pipeline')
  })

  it('renders numeric-superscript citations and an appearance-ordered reference list', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'nature', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)

    expect(html).toContain('<sup>')
    const refsIndex = html.indexOf('class="ms-references"')
    expect(refsIndex).toBeGreaterThan(-1)
    const refsHtml = html.slice(refsIndex)
    expect(refsHtml.indexOf('Journal of Fixtures')).toBeGreaterThan(-1)
    // The unresolved citation is flagged, not silently dropped.
    expect(refsHtml).toContain('missing2099')
    expect(refsHtml).toContain('cited but not found')
  })

  it('renders author-year citations for jneurosci without superscripts', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'jneurosci', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)

    expect(html).toContain('Smith 2020')
  })

  it('embeds the figure as a data: URI with its numbered caption', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'brain-stimulation', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)

    expect(html).toContain('data:image/png;base64,')
    expect(html).toContain('Fig. 1')
    expect(html).toContain('fixture figure')
  })

  it('resolves the @fig:/@tbl: cross-references to the same labels', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'brain-stimulation', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)
    // "(@fig:fig-a, @tbl:tbl-a)" in the fixture's Results section resolves to
    // the profile's labels — "Fig." is brain-stimulation's stated delta.
    expect(html).toMatch(/\(Fig\. 1, Table 1\)/)
  })

  it('spells figure labels "Figure" for a profile that states no Fig. delta', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'suna', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)
    expect(html).toMatch(/\(Figure 1, Table 1\)/)
    expect(html).not.toContain('Fig. 1')
  })

  it('inlines a markdown image as a data: URI, since the PDF page is loaded from a temp directory', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    await mkdir(join(dir, 'figures'), { recursive: true })
    await writeFile(join(dir, 'figures', 'x.png'), ONE_PIXEL_PNG)
    await appendProse('![Registration QC](../figures/x.png)')

    const content = await buildExportContent({ dir, profileId: 'nature', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)

    expect(html).toContain(`<img class="md-image" src="data:image/png;base64,${ONE_PIXEL_PNG.toString('base64')}"`)
    // and never the relative url, which cannot resolve from the temp directory
    expect(html).not.toContain('../figures/x.png')
  })

  it('refuses an image that escapes the project root, leaving its alt text', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    await appendProse('![escaped](../../outside.png)')

    const content = await buildExportContent({ dir, profileId: 'nature', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)

    expect(html).toMatch(/<p data-pos="\d+-\d+">escaped<\/p>/)
    expect(html).not.toContain('outside.png')
  })

  it('refuses a remote image rather than fetching it at print time', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    await appendProse('![remote](https://example.org/x.png)')

    const content = await buildExportContent({ dir, profileId: 'nature', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)

    expect(html).not.toContain('example.org')
    expect(html).toMatch(/<p data-pos="\d+-\d+">remote<\/p>/)
  })

  it('caps every image inside the printable box and centres it', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'nature', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)

    // The SUNA page for every profile: US Letter with 0.5 in margins,
    // 279.4 - 2*12.7 = 254 mm of text height.
    expect(html).toContain(
      'img.md-image, .ms-body img, figure.figure img { display: block; margin: 0 auto; width: auto; height: auto; max-width: 100%; max-height: 254mm; }'
    )
  })

  it('sizes a `{width=…}` image with a max-width, which cannot distort it', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    await mkdir(join(dir, 'figures'), { recursive: true })
    await writeFile(join(dir, 'figures', 'x.png'), ONE_PIXEL_PNG)
    await appendProse('![QC](../figures/x.png){width=40%}')

    const content = await buildExportContent({ dir, profileId: 'nature', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)

    expect(html).toContain('style="max-width:min(40%,100%)"')
    // A definite width plus the max-height cap is the measured squash.
    expect(html).not.toContain('style="width:40%"')
  })

  it('keeps managed-figure geometry after moving it off a definite width', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'nature', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)

    // nature's 'single' preset is 89 mm; a definite width would be squashed
    // by the new max-height, so it is a max-width now.
    expect(html).toContain('style="max-width:min(89mm,100%);height:auto;display:block;margin:0 auto;"')
    expect(html).not.toContain('width:89mm;max-width:100%')
  })

  it('shrink-wraps and centres tables, and lets GFM alignment beat the house convention', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const house = await buildManuscriptHtml(
      await buildExportContent({ dir, profileId: 'suna', figurePngPaths }),
      OPTIONS
    )
    const journal = await buildManuscriptHtml(
      await buildExportContent({ dir, profileId: 'nature', figurePngPaths }),
      OPTIONS
    )

    for (const html of [house, journal]) {
      expect(html).toContain('table { border-collapse: collapse; margin: 8pt auto; width: auto; max-width: 100%; }')
      expect(html).not.toContain('margin: 8pt 0; width: 100%')
      expect(html).toMatch(/th, td \{[^}]*text-align: start;/)
      // Captions are centred under both profiles, matching the DOCX writer.
      expect(html).toContain('figure.figure figcaption { font-size:')
      expect(html).toMatch(/figure\.figure figcaption \{[^}]*text-align: center;/)
    }
    // The APA column convention only applies where the cell has no inline
    // style, which is how a `:---:` delimiter row wins — and it is the
    // always-on SUNA default, so a journal profile gets it too.
    for (const html of [house, journal]) {
      expect(html).toContain('th:not([style]), td:not([style]) { text-align: center; }')
      expect(html).toContain('td:first-child:not([style]) { text-align: left; }')
    }
  })

  it('opens the body on page 2 so the first page holds only the title page', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'suna', figurePngPaths })
    const html = await buildManuscriptHtml(content, { doubleSpacing: false, lineNumbers: false })
    expect(html).toContain('ms-body--page2')
    expect(html).toContain('.ms-body--page2 { page-break-before: always; break-before: page; }')
  })

  it('applies the double-spacing and line-number CSS hooks when requested', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'nature', figurePngPaths })
    const doubled = await buildManuscriptHtml(content, { doubleSpacing: true, lineNumbers: true })
    expect(doubled).toContain('class="ms-body ms-double ms-line-numbers ms-body--page2" id="ms-body"')
    const plain = await buildManuscriptHtml(content, { doubleSpacing: false, lineNumbers: false })
    expect(plain).toContain('class="ms-body ms-body--page2" id="ms-body"')
  })

  it('writes the docx-tools corresponding-author line and the keywords line after the abstract', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'suna', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)

    expect(html).toContain('* Corresponding author: ada@example.edu')
    expect(html).not.toContain('*e-mail:')
    const keywordsAt = html.indexOf('<strong>Keywords: </strong><em>export pipelines; fixtures; stripping</em>')
    expect(keywordsAt).toBeGreaterThan(html.indexOf('We test the export pipeline'))
    expect(keywordsAt).toBeLessThan(html.indexOf('Introduction'))
  })

  it('renders the back matter sections in the ground-truth order, before the references', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'suna', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)

    const order = ['Acknowledgments', 'Funding', 'Competing Interests', 'Data Availability', 'Author Contributions']
    const positions = order.map((title) => html.indexOf(`<h2 class="ms-h-a">${title}</h2>`))
    for (const [i, at] of positions.entries()) expect(at, `"${order[i]}" missing`).toBeGreaterThan(-1)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(positions[positions.length - 1]).toBeLessThan(html.indexOf('class="ms-references"'))
    expect(html).toContain('Fixture Science Foundation (FSF-0042); Open Testing Trust')
    // availability.code is '' -> no code heading of any kind
    expect(html).not.toContain('Code Availability')
  })

  it('starts the references on a new page by default', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'suna', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)
    expect(html).toContain('.ms-references { page-break-before: always; }')
  })

  /** SLEEP's stated shape: captions list after the references, tables at the end, no embedded figures. */
  it('renders the SLEEP captions-list/tables-end conventions', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'sleep', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)

    // No figure image in the document at all — the PNG is never inlined.
    expect(html).not.toContain('data:image/png')
    const refsAt = html.indexOf('class="ms-references"')
    const captionsAt = html.indexOf('<h2 class="ms-h-a">Figure Captions</h2>')
    const tablesAt = html.indexOf('<h2 class="ms-h-a">Tables</h2>')
    expect(captionsAt).toBeGreaterThan(refsAt)
    expect(tablesAt).toBeGreaterThan(captionsAt)
    // The caption text lives in the list; SLEEP spells it "Figure 1".
    expect(html.indexOf('A fixture figure.')).toBeGreaterThan(captionsAt)
    expect(html).toContain('<strong>Figure 1.</strong>')
    expect(html).not.toContain('Fig. 1')
    // The markdown table left the body and re-renders in the Tables section.
    const tableAt = html.indexOf('<table')
    expect(tableAt).toBeGreaterThan(tablesAt)
    expect(html.lastIndexOf('<table')).toBe(tableAt)
    // The manuscript.json caption block moved there too.
    expect(html.indexOf('A fixture table')).toBeGreaterThan(tablesAt)
    // In-text mention survives.
    expect(html).toMatch(/\(Figure 1, Table 1\)/)
  })

  it('keeps inline placement for profiles that state nothing: table in body, figure embedded', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'suna', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)

    expect(html).toContain('data:image/png;base64,')
    expect(html).not.toContain('Figure Captions')
    const refsAt = html.indexOf('class="ms-references"')
    // The pre-references Tables section (manuscript.json captions) stays put.
    expect(html.indexOf('<h2 class="ms-h-a">Tables</h2>')).toBeLessThan(refsAt)
    expect(html.indexOf('<table')).toBeLessThan(refsAt)
  })
})

/**
 * The standalone web-page export ('export:html'): one self-contained file
 * mirroring the SUNA reading tab — linked citations, in-page cross-refs,
 * inlined figures and KaTeX, the reading palette/typography.
 */
describe('page-break rules in the printed stylesheet (feature-plan-13 §A2)', () => {
  /**
   * These assert the DECLARATION only. Whether Chromium honours it is an
   * empirical question about the print pass, answered by the rendered bytes
   * in scripts/e2e/probes/table-pagination.mjs — that probe is the real gate;
   * this is the regression guard that stops the rules being deleted.
   */
  it('asks for tables and figures to be kept whole, in both printed documents', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir, { supplement: true })
    const content = await buildExportContent({ dir, profileId: 'suna', figurePngPaths })
    for (const html of [
      await buildManuscriptHtml(content, OPTIONS),
      await buildSupplementHtml(await buildSupplementContent({ dir, profileId: 'suna', figurePngPaths }), OPTIONS)
    ]) {
      expect(html).toContain('.table-block, figure.figure, .ms-table-entry { break-inside: avoid; }')
      expect(html).toContain('table, thead, tbody tr { break-inside: avoid; }')
      // Without this a broken-anyway table loses its header on page 2.
      expect(html).toContain('thead { display: table-header-group; }')
    }
  })

  it('does not leave a heading alone at the foot of a page', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'suna', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)
    expect(html).toContain('break-after: avoid')
    expect(html).toContain('orphans: 3; widows: 3;')
  })

  it('leaves the web page alone — an HTML export has no pages to break', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'suna', figurePngPaths })
    const reader = await buildReaderHtml(content)
    expect(reader).not.toContain('break-inside: avoid')
  })
})

describe('buildReaderHtml + exportHtml', () => {
  const READER_OPTIONS = { doubleSpacing: false, lineNumbers: false, pageNumbers: true }

  async function readerHtml(profileId = 'suna'): Promise<string> {
    const { buildReaderHtml } = await import('./export-html')
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId, figurePngPaths })
    return buildReaderHtml(content)
  }

  it('links every in-text citation to its reference-list entry', async () => {
    const html = await readerHtml('sleep') // parenthetical-numeric
    expect(html).toContain('href="#ref-smith2020"')
    expect(html).toContain('href="#ref-jones2019"')
    expect(html).toContain('id="ref-smith2020"')
    expect(html).toContain('id="ref-jones2019"')
    // The unresolved key is flagged in the list, and still linked in text.
    expect(html).toContain('href="#ref-missing2099"')
    expect(html).toContain('id="ref-missing2099"')
    expect(html).toContain('cited but not found')
  })

  it('links author-year citations too', async () => {
    const html = await readerHtml('suna') // author-year
    expect(html).toContain('class="ms-cite-link" href="#ref-smith2020"')
    expect(html).toContain('Smith')
  })

  it('turns figure/table cross-refs into in-page links with matching anchors', async () => {
    const html = await readerHtml('suna')
    expect(html).toContain('href="#fig-fig-a"')
    expect(html).toContain('id="fig-fig-a"')
    expect(html).toContain('href="#tbl-tbl-a"')
    expect(html).toContain('id="tbl-tbl-a"')
  })

  it('embeds the figure inline regardless of the profile placement convention', async () => {
    // SLEEP states captions-list for SUBMISSION; the reading view always
    // shows the figure, and the web page mirrors the reading view.
    const html = await readerHtml('sleep')
    expect(html).toContain('data:image/png;base64,')
    expect(html).toContain('<strong>Figure 1.</strong>')
  })

  it('is fully self-contained: KaTeX css + fonts inlined, no external references', async () => {
    const html = await readerHtml('suna')
    expect(html).toContain('@font-face')
    expect(html).toContain('data:font/woff2;base64,')
    expect(html).not.toContain('<link rel="stylesheet"')
    expect(html).not.toContain('src="http')
  })

  it('carries the SUNA reading design: palette tokens, serif stack, light scheme', async () => {
    const html = await readerHtml('suna')
    expect(html).toContain('#1e1e26') // night-sky editor surface
    expect(html).toContain('Iowan Old Style')
    expect(html).toContain('prefers-color-scheme: light')
    expect(html).toContain('#f7f2e9') // suna-light warm paper
    expect(html).toContain('class="ms-label"')
  })

  it('renders the title page in reading order with the byline', async () => {
    const html = await readerHtml('suna')
    expect(html).toContain('class="ms-title"')
    expect(html).toContain('Ada Researcher')
    expect(html).toContain('* Corresponding author: ada@example.edu')
    const abstractAt = html.indexOf('>Abstract<')
    expect(abstractAt).toBeGreaterThan(-1)
    expect(html.indexOf('We test the export pipeline')).toBeGreaterThan(abstractAt)
    expect(html).toContain('export pipelines; fixtures; stripping')
  })

  it('exportHtml writes <dir>/output/<name>.html and never mutates sources', async () => {
    const { exportHtml } = await import('./export-html')
    const { readFile: read } = await import('node:fs/promises')
    const { figurePngPaths } = await writeFixtureProject(dir)
    const manuscriptPath = join(dir, 'manuscript', 'manuscript.json')
    const before = await read(manuscriptPath, 'utf8')

    const result = await exportHtml({
      dir,
      profileId: 'suna',
      outputName: 'fixture-web',
      figurePngPaths,
      options: READER_OPTIONS
    })
    expect(result.path).toBe(join(dir, 'output', 'fixture-web.html'))
    const html = await read(result.path, 'utf8')
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('data:image/png;base64,')
    expect(await read(manuscriptPath, 'utf8')).toBe(before)
  })

  it('exportHtml supplement target writes the standalone supplement page', async () => {
    const { exportHtml } = await import('./export-html')
    const { readFile: read } = await import('node:fs/promises')
    const { figurePngPaths } = await writeFixtureProject(dir, { supplement: true })
    const result = await exportHtml({
      dir,
      profileId: 'suna',
      outputName: 'fixture-supp-web',
      figurePngPaths,
      options: READER_OPTIONS,
      target: 'supplement'
    })
    const html = await read(result.path, 'utf8')
    expect(html).toContain('Supplementary Information:')
    expect(html).toContain('Supplementary References')
    // The relative katex link is replaced by the inlined stylesheet.
    expect(html).not.toContain('<link rel="stylesheet" href="katex.min.css">')
    expect(html).toContain('@font-face')
  })
})
