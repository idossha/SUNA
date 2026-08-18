import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseSciMark } from '@suna/markdown'
import {
  backMatterSections,
  blockImageOf,
  blockImagesOf,
  buildExportContent,
  collectBlockImages,
  collectMarkdownImages,
  collectTableEmbeds,
  collectTables,
  headingLevelForDepth,
  markdownImagePath,
  numberAffiliations,
  orderByEmbedAppearance,
  pngDimensions,
  splitTexSpans,
  widthMmForPreset,
  withoutTables,
  type ExportContent
} from './export-content'
import { writeFixtureProject } from './export-fixture'
import { allowRoot } from './roots'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suna-export-content-'))
  allowRoot(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('splitTexSpans', () => {
  it('splits text/math segments and leaves an unclosed $ literal', () => {
    expect(splitTexSpans('rate at $z=1.7$ cosmic noon')).toEqual([
      { kind: 'text', value: 'rate at ' },
      { kind: 'math', value: 'z=1.7' },
      { kind: 'text', value: ' cosmic noon' }
    ])
    expect(splitTexSpans('no math here')).toEqual([{ kind: 'text', value: 'no math here' }])
    expect(splitTexSpans('unclosed $math')).toEqual([{ kind: 'text', value: 'unclosed $math' }])
  })
})

describe('headingLevelForDepth', () => {
  it('maps outline depth to the typographic vocabulary (1→A, 2→B, 3+→C-runin)', () => {
    expect(headingLevelForDepth(1)).toBe('A')
    expect(headingLevelForDepth(2)).toBe('B')
    expect(headingLevelForDepth(3)).toBe('C-runin')
    expect(headingLevelForDepth(6)).toBe('C-runin')
  })
})

describe('numberAffiliations', () => {
  it('numbers by first appearance in author order, then unreferenced affiliations by array order', () => {
    const authors = [
      { affiliationRefs: ['af2'] },
      { affiliationRefs: ['af1', 'af2'] }
    ] as unknown as Parameters<typeof numberAffiliations>[0]
    const affiliations = [
      { id: 'af1', text: 'One' },
      { id: 'af2', text: 'Two' },
      { id: 'af3', text: 'Three' }
    ]
    const { ordered, numberOf } = numberAffiliations(authors, affiliations)
    expect(ordered.map((a) => a.id)).toEqual(['af2', 'af1', 'af3'])
    expect(numberOf.get('af2')).toBe(1)
    expect(numberOf.get('af1')).toBe(2)
    expect(numberOf.get('af3')).toBe(3)
  })
})

describe('pngDimensions', () => {
  it('reads width/height from a real PNG IHDR chunk', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const { readFile } = await import('node:fs/promises')
    const bytes = await readFile(figurePngPaths['fig-a'] as string)
    expect(pngDimensions(bytes)).toEqual({ width: 1, height: 1 })
  })

  it('throws on a non-PNG buffer', () => {
    expect(() => pngDimensions(new Uint8Array([1, 2, 3, 4]))).toThrow(/not a valid PNG/)
  })
})

describe('widthMmForPreset', () => {
  it('falls back to the generic width when the profile leaves a preset null', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'apj-aas', figurePngPaths })
    // apj-aas states no widthPresetsMm values (all null) — see canvas/export-presets.test.ts's own note.
    expect(widthMmForPreset('single', content.profile)).toBe(89)
    expect(widthMmForPreset('double', content.profile)).toBe(180)
  })
})

describe('markdown images', () => {
  it('collects every image, resolving an imageReference through its definition', () => {
    const root = parseSciMark('![a](x.png) and ![b][ref]\n\n[ref]: y.png\n\n![c](https://example.org/z.png)')
    expect(collectMarkdownImages(root).map((i) => [i.url, i.alt])).toEqual([
      ['x.png', 'a'],
      ['y.png', 'b'],
      ['https://example.org/z.png', 'c']
    ])
  })

  it('treats only a paragraph that is nothing but an image as the block form', () => {
    const [block, inline] = parseSciMark('![a](x.png)\n\nSee ![b](y.png) here.').children
    expect(blockImageOf(block!)?.url).toBe('x.png')
    expect(blockImageOf(inline!)).toBeNull()
  })

  it('finds block images nested in blockquotes and list items', () => {
    const root = parseSciMark('> ![a](x.png)\n\n- ![b](y.png)\n')
    expect(collectBlockImages(root.children).map((i) => i.url)).toEqual(['x.png', 'y.png'])
  })

  /**
   * A soft break makes ONE paragraph out of two images, which a lone-image
   * test rejects — so both fell back to alt text in DOCX while the HTML
   * renderer emitted two `<img>`s.
   */
  it('treats a paragraph of nothing but images as block images, soft breaks and all', () => {
    const [both] = parseSciMark('![a](x.png)\n![b](y.png)\n').children
    expect(blockImagesOf(both!).map((i) => i.url)).toEqual(['x.png', 'y.png'])
    expect(collectBlockImages(parseSciMark('![a](x.png)\n![b](y.png)\n').children)).toHaveLength(2)
    // A lone image is still the lone-image form.
    expect(blockImageOf(both!)).toBeNull()
  })

  it('leaves a paragraph that also carries prose alone', () => {
    const [mixed] = parseSciMark('See ![b](y.png)\n![c](z.png) here.').children
    expect(blockImagesOf(mixed!)).toEqual([])
  })

  it('collects tables the way it collects images — nested ones included', () => {
    const root = parseSciMark(
      '| a |\n| :-- |\n| 1 |\n\n> | b |\n> | --: |\n> | 2 |\n\n- | c |\n  | --- |\n  | 3 |\n'
    )
    expect(collectTables(root.children)).toHaveLength(3)
  })

  it('withoutTables strips exactly what collectTables finds, leaving everything else intact', () => {
    const root = parseSciMark(
      'Before.\n\n| a |\n| :-- |\n| 1 |\n\n> quoted\n>\n> | b |\n> | --- |\n> | 2 |\n\n- item\n- | c |\n  | --- |\n  | 3 |\n\nAfter.\n'
    )
    const stripped = withoutTables(root.children)
    expect(collectTables(stripped)).toHaveLength(0)
    // Non-table content survives, including inside the pruned containers.
    const kinds = stripped.map((n) => n.type)
    expect(kinds).toContain('paragraph')
    expect(kinds).toContain('blockquote')
    expect(kinds).toContain('list')
    expect(kinds).not.toContain('table')
    // The original AST is untouched: collectTables still sees all three.
    expect(collectTables(root.children)).toHaveLength(3)
  })

  it('resolves a relative url against the manuscript directory and refuses a remote one', () => {
    expect(markdownImagePath('../figures/x.png', '/p/manuscript')).toBe('/p/figures/x.png')
    expect(markdownImagePath('figures/x.png#panel-a', '/p/manuscript')).toBe('/p/manuscript/figures/x.png')
    expect(markdownImagePath('https://example.org/x.png', '/p/manuscript')).toBeNull()
    expect(markdownImagePath('data:image/png;base64,AAAA', '/p/manuscript')).toBeNull()
    expect(markdownImagePath('', '/p/manuscript')).toBeNull()
  })
})

describe('table embeds and derived numbering order', () => {
  it('collects ![[tbl:id]] embeds in document order', () => {
    const root = parseSciMark('![[tbl:b]]\n\n| a |\n| --- |\n| 1 |\n\nProse.\n\n![[tbl:a]]\n')
    expect(collectTableEmbeds(root)).toEqual(['b', 'a'])
  })

  it('orders items by first embed appearance, unembedded ones after in manifest order', () => {
    const items = [{ id: 'x' }, { id: 'y' }, { id: 'z' }]
    expect(orderByEmbedAppearance(items, ['z', 'x', 'z'])).toEqual([{ id: 'z' }, { id: 'x' }, { id: 'y' }])
  })

  it('keeps manifest order when nothing is embedded', () => {
    const items = [{ id: 'x' }, { id: 'y' }]
    expect(orderByEmbedAppearance(items, [])).toEqual(items)
  })

  it('withoutTables also drops tableEmbed nodes', () => {
    const root = parseSciMark('![[tbl:a]]\n\n| a |\n| --- |\n| 1 |\n\nProse.\n')
    const kept = withoutTables(root.children)
    expect(kept.map((n) => n.type)).toEqual(['paragraph'])
  })
})

describe('buildExportContent', () => {
  it('assembles sections in document order with their parsed prose', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths })

    expect(content.sections.map((s) => s.heading)).toEqual(['Introduction', 'Results'])
    expect(content.sections[0]?.source).toContain('baseline')
    expect(content.sections[1]?.root).not.toBeNull()
    // What a relative image url resolves against — without it neither exporter
    // can find an image's bytes.
    expect(content.manuscriptDir).toBe(join(resolve(dir), 'manuscript'))
  })

  it('numbers citations by first appearance and renders numeric-superscript style', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths })

    // Appearance order across the whole document: smith2020, jones2019, missing2099.
    expect(content.numbers.get('smith2020')).toBe(1)
    expect(content.numbers.get('jones2019')).toBe(2)
    expect(content.numbers.get('missing2099')).toBe(3)
    expect(content.citeStyle.mode).toBe('numeric-superscript')
    // Appearance-ordered reference list; the unresolved key sinks to the end regardless.
    expect(content.referenceRows.map((r) => r.key)).toEqual(['smith2020', 'jones2019', 'missing2099'])
    expect(content.referenceRows[2]?.entry).toBeUndefined()
    expect(content.referenceCount).toBe(3)
  })

  it('sorts the reference list alphabetically for an author-year profile', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'apj-aas', figurePngPaths })

    expect(content.citeStyle.mode).toBe('author-year')
    // Alphabetical by first author surname among resolvable entries: Jones before Smith;
    // the unresolved key still sinks to the end.
    expect(content.referenceRows.map((r) => r.key)).toEqual(['jones2019', 'smith2020', 'missing2099'])
  })

  it('numbers affiliations and figures/labels the same way the live document does', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths })

    expect(content.affiliations.ordered.map((a) => a.id)).toEqual(['af1', 'af2'])
    expect(content.labels.figures.get('fig-a')).toBe('Fig. 1')
    expect(content.figures).toHaveLength(1)
    expect(content.figures[0]?.pngPath).toBe(resolve(figurePngPaths['fig-a'] as string))
  })

  it('resolves a @fig: cross-reference against the figure label', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths })
    const resultsSource = content.sections[1]?.source ?? ''
    expect(resultsSource).toContain('@fig:fig-a')
    expect(content.labels.figures.get('fig-a')).toBe('Fig. 1')
  })

  it('throws naming the figure when a manuscript figure has no rasterized PNG supplied', async () => {
    await writeFixtureProject(dir)
    await expect(buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths: {} })).rejects.toThrow(
      /fig-a/
    )
  })

  it('throws for an unknown profile id', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    await expect(
      buildExportContent({ dir, profileId: 'not-a-real-profile', figurePngPaths })
    ).rejects.toThrow(/unknown publisher profile/)
  })

  it('routes the figure label word through the resolved style, defaulting to "Figure"', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    // SUNA and any profile stating no figureLabel delta: "Figure 1".
    for (const profileId of ['suna', 'nature', 'apj-aas']) {
      const content = await buildExportContent({ dir, profileId, figurePngPaths })
      expect(content.labels.figures.get('fig-a'), profileId).toBe('Figure 1')
    }
    // Profiles whose guidelines state the abbreviated form: "Fig. 1".
    for (const profileId of ['nature-astronomy', 'mnras']) {
      const content = await buildExportContent({ dir, profileId, figurePngPaths })
      expect(content.labels.figures.get('fig-a'), profileId).toBe('Fig. 1')
    }
  })
})

describe('backMatterSections', () => {
  function contentWith(
    backMatter: Record<string, unknown>,
    availability: { data: string; code: string }
  ): ExportContent {
    return { manuscript: { backMatter, availability } } as unknown as ExportContent
  }

  const FULL = {
    acknowledgements: 'Thanks.',
    authorContributions: 'A did it.',
    funding: [
      { funder: 'Fund A', grant: 'G-1' },
      { funder: 'Fund B', grant: null }
    ],
    competingInterests: 'None.',
    peerReview: { statement: 'Reviewed.', reviewers: ['R1'] },
    supplementaryInfo: { doi: '10.1/supp' }
  }

  it('orders the full set the ground-truth way and joins funding into one paragraph', () => {
    const sections = backMatterSections(contentWith(FULL, { data: 'Data here.', code: 'Code there.' }))
    expect(sections.map((s) => s.title)).toEqual([
      'Acknowledgments',
      'Funding',
      'Competing Interests',
      'Data and Code Availability',
      'Author Contributions'
    ])
    expect(sections[1]?.paragraphs).toEqual(['Fund A (G-1); Fund B'])
    expect(sections[3]?.paragraphs).toEqual(['Data here.', 'Code there.'])
  })

  it('keeps a single availability statement under its own heading', () => {
    const dataOnly = backMatterSections(contentWith(FULL, { data: 'Data here.', code: '' }))
    expect(dataOnly.map((s) => s.title)).toContain('Data Availability')
    expect(dataOnly.map((s) => s.title)).not.toContain('Data and Code Availability')
    const codeOnly = backMatterSections(contentWith(FULL, { data: '', code: 'Code there.' }))
    expect(codeOnly.map((s) => s.title)).toContain('Code Availability')
  })

  it('renders nothing for an empty back matter, and never exports peerReview/supplementaryInfo', () => {
    const empty = backMatterSections(
      contentWith(
        {
          acknowledgements: null,
          authorContributions: '   ',
          funding: [],
          competingInterests: null,
          peerReview: { statement: 'Reviewed.', reviewers: [] },
          supplementaryInfo: { doi: '10.1/supp' }
        },
        { data: '', code: '' }
      )
    )
    expect(empty).toEqual([])
  })
})

describe('buildExportContent — examples/demo-paper round trip', () => {
  it('builds real content from the shipped demo project without throwing', async () => {
    const demoDir = resolve(import.meta.dirname, '..', '..', '..', '..', '..', 'examples', 'demo-paper')
    allowRoot(demoDir)
    // The demo's own figure.svg files are not rasterized here (that step lives in the
    // renderer); stand in with the same 1x1 PNG fixture uses — buildExportContent only
    // needs a PNG to exist and be readable, not to depict the real figure content.
    const scratch = await mkdtemp(join(tmpdir(), 'suna-demo-figs-'))
    allowRoot(scratch)
    const { writeFile } = await import('node:fs/promises')
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

    expect(content.manuscript.title).toContain('ram-pressure stripping')
    expect(content.authors.authors).toHaveLength(2)
    expect(content.sections.length).toBeGreaterThanOrEqual(4)
    expect(content.figures).toHaveLength(2)
    // references.bib has 10 entries; the demo's sections cite a subset of them.
    expect(content.referenceRows.length).toBeGreaterThan(0)
    expect(content.referenceRows.every((r) => r.entry !== undefined)).toBe(true)

    await rm(scratch, { recursive: true, force: true })
  })
})
