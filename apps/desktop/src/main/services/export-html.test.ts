import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildExportContent } from './export-content'
import { buildManuscriptHtml } from './export-html'
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
    const content = await buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths })
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
    const content = await buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths })
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

  it('renders author-year citations for apj-aas without superscripts', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'apj-aas', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)

    expect(html).toContain('Smith 2020')
  })

  it('embeds the figure as a data: URI with its numbered caption', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)

    expect(html).toContain('data:image/png;base64,')
    expect(html).toContain('Fig. 1')
    expect(html).toContain('fixture figure')
  })

  it('resolves the @fig: cross-reference to the same figure label', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)
    // "(@fig:fig-a)" in the fixture's Results section resolves to "(Fig. 1)".
    expect(html).toMatch(/\(Fig\. 1\)/)
  })

  it('inlines a markdown image as a data: URI, since the PDF page is loaded from a temp directory', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    await mkdir(join(dir, 'figures'), { recursive: true })
    await writeFile(join(dir, 'figures', 'x.png'), ONE_PIXEL_PNG)
    await appendProse('![Registration QC](../figures/x.png)')

    const content = await buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)

    expect(html).toContain(`<img class="md-image" src="data:image/png;base64,${ONE_PIXEL_PNG.toString('base64')}"`)
    // and never the relative url, which cannot resolve from the temp directory
    expect(html).not.toContain('../figures/x.png')
  })

  it('refuses an image that escapes the project root, leaving its alt text', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    await appendProse('![escaped](../../outside.png)')

    const content = await buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)

    expect(html).toMatch(/<p data-pos="\d+-\d+">escaped<\/p>/)
    expect(html).not.toContain('outside.png')
  })

  it('refuses a remote image rather than fetching it at print time', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    await appendProse('![remote](https://example.org/x.png)')

    const content = await buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)

    expect(html).not.toContain('example.org')
    expect(html).toMatch(/<p data-pos="\d+-\d+">remote<\/p>/)
  })

  it('caps every image inside the printable box and centres it', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)

    // A4 with 1 in margins: 297 - 2*25.4 = 246.2 mm of text height.
    expect(html).toContain(
      'img.md-image, .ms-body img, figure.figure img { display: block; margin: 0 auto; width: auto; height: auto; max-width: 100%; max-height: 246.2mm; }'
    )
  })

  it('sizes a `{width=…}` image with a max-width, which cannot distort it', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    await mkdir(join(dir, 'figures'), { recursive: true })
    await writeFile(join(dir, 'figures', 'x.png'), ONE_PIXEL_PNG)
    await appendProse('![QC](../figures/x.png){width=40%}')

    const content = await buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)

    expect(html).toContain('style="max-width:min(40%,100%)"')
    // A definite width plus the max-height cap is the measured squash.
    expect(html).not.toContain('style="width:40%"')
  })

  it('keeps managed-figure geometry after moving it off a definite width', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths })
    const html = await buildManuscriptHtml(content, OPTIONS)

    // nature-astronomy's 'single' preset is 88 mm; a definite width would be
    // squashed by the new max-height, so it is a max-width now.
    expect(html).toContain('style="max-width:min(88mm,100%);height:auto;display:block;margin:0 auto;"')
    expect(html).not.toContain('width:88mm;max-width:100%')
  })

  it('shrink-wraps and centres tables, and lets GFM alignment beat the house convention', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const house = await buildManuscriptHtml(
      await buildExportContent({ dir, profileId: 'suna', figurePngPaths }),
      OPTIONS
    )
    const journal = await buildManuscriptHtml(
      await buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths }),
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
    // style, which is how a `:---:` delimiter row wins.
    expect(house).toContain('th:not([style]), td:not([style]) { text-align: center; }')
    expect(house).toContain('td:first-child:not([style]) { text-align: left; }')
  })

  it('applies the double-spacing and line-number CSS hooks when requested', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths })
    const doubled = await buildManuscriptHtml(content, { doubleSpacing: true, lineNumbers: true })
    expect(doubled).toContain('class="ms-body ms-double ms-line-numbers" id="ms-body"')
    const plain = await buildManuscriptHtml(content, { doubleSpacing: false, lineNumbers: false })
    expect(plain).toContain('class="ms-body" id="ms-body"')
  })
})
