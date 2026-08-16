import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
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

  it('applies the double-spacing and line-number CSS hooks when requested', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths })
    const doubled = await buildManuscriptHtml(content, { doubleSpacing: true, lineNumbers: true })
    expect(doubled).toContain('class="ms-body ms-double ms-line-numbers" id="ms-body"')
    const plain = await buildManuscriptHtml(content, { doubleSpacing: false, lineNumbers: false })
    expect(plain).toContain('class="ms-body" id="ms-body"')
  })
})
