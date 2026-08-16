import { beforeEach, describe, expect, it } from 'vitest'
import { docxToolsAvailable, resetDocxToolsAvailabilityCache, type DocxToolsProbe } from './docx-tools-accelerator'
import type { ExportContent } from './export-content'

/**
 * `buildViaDocxTools`'s spec.json construction (the bulk of this module) is
 * deliberately left without dedicated unit tests: it is the OPTIONAL
 * accelerator (feature-plan-6 §3 step 3) — export-docx.ts always falls back
 * to the bundled 'docx' library on any failure here, so its correctness
 * bar is "produces something docx-tools' own build() accepts", not
 * "identical output to the primary path", and it has no exported surface
 * narrower than the full `buildViaDocxTools(dir, content, options, target)`
 * call, which needs a real `docx-tools` binary on PATH to verify end to end.
 * This file covers what IS deterministically testable: the injectable
 * detection probe and its per-session cache, mirroring lit.ts's
 * isCliAvailable/CliProbe test pattern.
 */

beforeEach(() => {
  resetDocxToolsAvailabilityCache()
})

describe('docxToolsAvailable', () => {
  it('reports true when the probe resolves the binary', async () => {
    const probe: DocxToolsProbe = async () => true
    expect(await docxToolsAvailable(probe)).toBe(true)
  })

  it('reports false when the probe finds nothing on PATH', async () => {
    const probe: DocxToolsProbe = async () => false
    expect(await docxToolsAvailable(probe)).toBe(false)
  })

  it('caches the first result for the session — a later probe is never called', async () => {
    let calls = 0
    const probe: DocxToolsProbe = async () => {
      calls += 1
      return true
    }
    expect(await docxToolsAvailable(probe)).toBe(true)
    expect(await docxToolsAvailable(probe)).toBe(true)
    expect(calls).toBe(1)
  })

  it('resetDocxToolsAvailabilityCache forces a fresh probe', async () => {
    expect(await docxToolsAvailable(async () => false)).toBe(false)
    resetDocxToolsAvailabilityCache()
    expect(await docxToolsAvailable(async () => true)).toBe(true)
  })
})

/**
 * The accelerator's spec.json cannot express per-column table alignment
 * (docx_tools/tables.py:117-118 hardcodes "first column left, rest centred")
 * or a caption-less block image ('figure' is the only image block and
 * docx_tools/figures.py:47-57 numbers it), so a document containing either has
 * to go to the bundled writer instead of being exported wrong.
 */
describe('docxToolsSupports', () => {
  async function contentFor(markdown: string): Promise<ExportContent> {
    const { mkdtemp, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { writeFixtureProject, FIXTURE_MANUSCRIPT_MD } = await import('./export-fixture')
    const { buildExportContent } = await import('./export-content')
    const { allowRoot } = await import('./roots')

    const dir = await mkdtemp(join(tmpdir(), 'suna-accel-supports-'))
    allowRoot(dir)
    const { figurePngPaths } = await writeFixtureProject(dir)
    await writeFile(join(dir, 'manuscript', 'manuscript.md'), `${FIXTURE_MANUSCRIPT_MD}\n${markdown}\n`, 'utf8')
    return buildExportContent({ dir, profileId: 'suna', figurePngPaths })
  }

  it('accepts the fixture, whose only table has no explicit alignment', async () => {
    const { docxToolsSupports } = await import('./docx-tools-accelerator')
    expect(docxToolsSupports(await contentFor(''))).toBe(true)
  })

  it('declines a document containing an aligned table', async () => {
    const { docxToolsSupports } = await import('./docx-tools-accelerator')
    expect(docxToolsSupports(await contentFor('| a | b |\n| :--- | ---: |\n| 1 | 2 |'))).toBe(false)
  })

  it('declines a document containing a block image', async () => {
    const { docxToolsSupports } = await import('./docx-tools-accelerator')
    expect(docxToolsSupports(await contentFor('![Registration QC](../figures/x.png)'))).toBe(false)
  })

  it('still accepts an image that only sits inside a sentence', async () => {
    const { docxToolsSupports } = await import('./docx-tools-accelerator')
    expect(docxToolsSupports(await contentFor('See ![QC](../figures/x.png) inline.'))).toBe(true)
  })

  /**
   * The guard used to scan only `section.root.children`, while `blockOf`
   * recurses into blockquotes and lists — so a nested aligned table reached
   * the spec anyway and had its delimiter row silently dropped.
   */
  it('declines an aligned table nested in a blockquote or a list item', async () => {
    const { docxToolsSupports } = await import('./docx-tools-accelerator')
    expect(docxToolsSupports(await contentFor('> | a | b |\n> | :-- | --: |\n> | 1 | 2 |'))).toBe(
      false
    )
    expect(
      docxToolsSupports(await contentFor('- | a | b |\n  | :-- | --: |\n  | 1 | 2 |'))
    ).toBe(false)
  })
})

describe('buildSpecObjects', () => {
  it('does not prefix figure captions with our own label — docx-tools writes its own', async () => {
    // Regression: passing "Figure 1. <caption>" made the built .docx read
    // "Figure 1. Figure 1. <caption>", because docx-tools numbers figures
    // itself and prepends a bold "Figure N. " to whatever caption it is given.
    const { mkdtemp, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { writeFixtureProject } = await import('./export-fixture')
    const { buildExportContent } = await import('./export-content')
    const { allowRoot } = await import('./roots')
    const { buildSpecObjects } = await import('./docx-tools-accelerator')

    const dir = await mkdtemp(join(tmpdir(), 'suna-accel-'))
    allowRoot(dir)
    try {
      const { figurePngPaths } = await writeFixtureProject(dir)
      const content = await buildExportContent({ dir, profileId: 'suna', figurePngPaths })
      const { spec } = buildSpecObjects(
        content,
        { doubleSpacing: false, lineNumbers: false, pageNumbers: true },
        join(dir, 'manuscript', 'references.bib')
      )
      const figures = (spec['content'] as Array<Record<string, unknown>>).filter(
        (block) => block['type'] === 'figure'
      )
      expect(figures.length).toBeGreaterThan(0)
      for (const figure of figures) {
        expect(String(figure['caption'])).not.toMatch(/^(Figure|Fig\.)\s*\d+\./)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
