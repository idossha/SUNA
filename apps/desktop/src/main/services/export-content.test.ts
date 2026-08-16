import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  buildExportContent,
  headingLevelForDepth,
  numberAffiliations,
  pngDimensions,
  splitTexSpans,
  widthMmForPreset
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

describe('buildExportContent', () => {
  it('assembles sections in document order with their parsed prose', async () => {
    const { figurePngPaths } = await writeFixtureProject(dir)
    const content = await buildExportContent({ dir, profileId: 'nature-astronomy', figurePngPaths })

    expect(content.sections.map((s) => s.heading)).toEqual(['Introduction', 'Results'])
    expect(content.sections[0]?.source).toContain('baseline')
    expect(content.sections[1]?.root).not.toBeNull()
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
