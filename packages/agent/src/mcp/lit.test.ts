import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PROJECT_DIRS } from '@suna/core'
import { addReference, lookupDoiTool, searchLiteratureTool } from './lit'
import type { ProjectContext } from './project'

/** No live network: every test stubs global fetch, matching @suna/bib's own provider tests. */
const fetchMock = vi.fn()

interface StubResponse {
  status?: number
  body: string
}

function respondWith(response: StubResponse): void {
  fetchMock.mockResolvedValueOnce({
    status: response.status ?? 200,
    text: async () => response.body
  })
}

function jsonResponse(value: unknown, status = 200): StubResponse {
  return { status, body: JSON.stringify(value) }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

let dir = ''
let ctx: ProjectContext

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suna-mcp-lit-'))
  await mkdir(join(dir, 'manuscript'), { recursive: true })
  ctx = { root: dir, name: 'test', activeProfileId: null, dirs: { ...DEFAULT_PROJECT_DIRS } }
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const crossrefHit = {
  status: 'ok',
  message: {
    'total-results': 1,
    items: [
      {
        DOI: '10.1086/151605',
        title: ['On the infall of matter into clusters of galaxies'],
        author: [
          { given: 'James E.', family: 'Gunn' },
          { given: 'J. Richard', family: 'Gott' }
        ],
        issued: { 'date-parts': [[1972]] },
        'container-title': ['The Astrophysical Journal'],
        'is-referenced-by-count': 3021
      }
    ]
  }
}

describe('searchLiteratureTool', () => {
  it('defaults to Crossref and formats a header + one row per result', async () => {
    respondWith(jsonResponse(crossrefHit))
    const out = await searchLiteratureTool({ query: 'ram pressure stripping' })
    expect(out).toContain('crossref: 1 result for "ram pressure stripping"')
    expect(out).toContain('doi:10.1086/151605')
    expect(out).toContain('Gunn, J. Richard Gott')
    expect(out).toContain('1972')
  })

  it('surfaces a provider error string rather than hiding it behind an empty list', async () => {
    respondWith({
      status: 429,
      body: JSON.stringify({ message: 'Insufficient budget — Rate limit exceeded' })
    })
    const out = await searchLiteratureTool({ query: 'anything', provider: 'openalex' })
    expect(out).toContain('openalex:')
    expect(out).toContain('error:')
    expect(out.toLowerCase()).toContain('rate-limited')
  })

  it('reports zero results honestly instead of an empty string', async () => {
    respondWith(jsonResponse({ status: 'ok', message: { items: [] } }))
    const out = await searchLiteratureTool({ query: 'zzznoresults' })
    expect(out).toContain('0 results')
    expect(out).toContain('(none)')
  })

  it('respects an explicit limit and provider selection', async () => {
    respondWith(jsonResponse(crossrefHit))
    await searchLiteratureTool({ query: 'x', provider: 'crossref', limit: 5 })
    const call = fetchMock.mock.calls[0] as [string, unknown]
    const url = new URL(call[0])
    expect(url.hostname).toBe('api.crossref.org')
    expect(url.searchParams.get('rows')).toBe('5')
  })
})

describe('lookupDoiTool', () => {
  it('formats the single matched work', async () => {
    respondWith(jsonResponse({ status: 'ok', message: crossrefHit.message.items[0] }))
    const out = await lookupDoiTool({ doi: '10.1086/151605' })
    expect(out).toContain('crossref:10.1086/151605')
    expect(out).toContain('On the infall of matter into clusters of galaxies')
  })

  it('reports an unknown DOI without throwing', async () => {
    respondWith({ status: 404, body: '' })
    const out = await lookupDoiTool({ doi: '10.9999/does-not-exist' })
    expect(out).toContain('no record for DOI 10.9999/does-not-exist')
  })

  it('routes a biorxiv lookup through Crossref and tags the source', async () => {
    respondWith(
      jsonResponse({
        status: 'ok',
        message: { ...crossrefHit.message.items[0], institution: [{ name: 'bioRxiv' }] }
      })
    )
    const out = await lookupDoiTool({ doi: '10.1086/151605', provider: 'biorxiv' })
    expect(out).toContain('biorxiv:10.1086/151605')
    const call = fetchMock.mock.calls[0] as [string, unknown]
    expect(new URL(call[0]).hostname).toBe('api.crossref.org')
  })
})

describe('addReference', () => {
  it('looks up the DOI and appends a new entry to references.bib', async () => {
    respondWith(jsonResponse({ status: 'ok', message: crossrefHit.message.items[0] }))
    const out = await addReference(ctx, { doi: '10.1086/151605' })
    expect(out).toContain('added gunn1972infall to references.bib')

    const bibText = await readFile(join(dir, 'manuscript', 'references.bib'), 'utf8')
    expect(bibText).toContain('@article{gunn1972infall,')
    expect(bibText).toContain('doi = {10.1086/151605}')
  })

  it('dedupes against an existing key already in the file', async () => {
    await writeFile(
      join(dir, 'manuscript', 'references.bib'),
      '@article{gunn1972infall,\n  title = {Some other paper},\n  year = {1999}\n}\n',
      'utf8'
    )
    respondWith(jsonResponse({ status: 'ok', message: crossrefHit.message.items[0] }))
    const out = await addReference(ctx, { doi: '10.1086/151605' })
    expect(out).toContain('added gunn1972infalla to references.bib')
  })

  it('does not write anything when the DOI is unknown to the provider', async () => {
    respondWith({ status: 404, body: '' })
    const out = await addReference(ctx, { doi: '10.9999/does-not-exist' })
    expect(out).toContain('nothing added')
    await expect(readFile(join(dir, 'manuscript', 'references.bib'), 'utf8')).rejects.toThrow()
  })

  it('surfaces a provider error and writes nothing', async () => {
    respondWith({ status: 500, body: 'upstream exploded' })
    const out = await addReference(ctx, { doi: '10.1086/151605' })
    expect(out).toContain('HTTP 500')
    expect(out).toContain('nothing added')
    await expect(readFile(join(dir, 'manuscript', 'references.bib'), 'utf8')).rejects.toThrow()
  })
})
