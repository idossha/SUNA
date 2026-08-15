import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LitResultSchema } from '@suna/core'
import {
  codexProgressFromLine,
  lookupByDoi,
  parseAiCliText,
  parseClaudeCliOutput,
  parseCodexCliOutput,
  searchLiterature
} from './providers'

/**
 * No live network: every test stubs global fetch and asserts the URL shape,
 * the headers, and the mapping into the normalized LitResult.
 */

const fetchMock = vi.fn()

interface StubResponse {
  status?: number
  body: string
}

function respondWith(...responses: StubResponse[]): void {
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce({
      status: response.status ?? 200,
      text: async () => response.body
    })
  }
}

function jsonResponse(value: unknown, status = 200): StubResponse {
  return { status, body: JSON.stringify(value) }
}

function requestAt(index: number): { url: URL; init: Record<string, unknown> } {
  const call: unknown = fetchMock.mock.calls[index]
  if (!Array.isArray(call)) throw new Error(`fetch was not called ${index + 1} time(s)`)
  const [url, init] = call as [string, Record<string, unknown> | undefined]
  return { url: new URL(url), init: init ?? {} }
}

function headersAt(index: number): Record<string, string> {
  const headers = requestAt(index).init['headers']
  return typeof headers === 'object' && headers !== null
    ? (headers as Record<string, string>)
    : {}
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/* -------------------------------------------------------------- crossref -- */

const crossrefBody = {
  status: 'ok',
  message: {
    'total-results': 1089390,
    items: [
      {
        DOI: '10.1086/151605',
        URL: 'https://doi.org/10.1086/151605',
        title: ['On the infall of matter into clusters of galaxies'],
        author: [
          { given: 'James E.', family: 'Gunn' },
          { given: 'J. Richard', family: 'Gott' }
        ],
        issued: { 'date-parts': [[1972, 8]] },
        'container-title': ['The Astrophysical Journal'],
        'is-referenced-by-count': 3021,
        abstract: '<jats:p>We consider the infall of matter.</jats:p>'
      }
    ]
  }
}

describe('crossref', () => {
  it('queries the keyless works endpoint with a polite mailto and User-Agent', async () => {
    respondWith(jsonResponse(crossrefBody))
    await searchLiterature('crossref', 'ram pressure stripping', {
      limit: 5,
      mailto: 'ada@example.org'
    })

    const { url, init } = requestAt(0)
    expect(url.origin + url.pathname).toBe('https://api.crossref.org/works')
    expect(url.searchParams.get('query.bibliographic')).toBe('ram pressure stripping')
    // grant and dataset records often have no title; keep them out
    expect(url.searchParams.get('filter')).toBe('type:journal-article')
    expect(url.searchParams.get('rows')).toBe('5')
    expect(url.searchParams.get('mailto')).toBe('ada@example.org')
    expect(headersAt(0)['User-Agent']).toBe('SUNA/0.1 (mailto:ada@example.org)')
    expect(init['signal']).toBeDefined()
  })

  it('omits the mailto when the user has not set one', async () => {
    respondWith(jsonResponse(crossrefBody))
    await searchLiterature('crossref', 'ram pressure', { limit: 3 })
    expect(requestAt(0).url.searchParams.get('mailto')).toBeNull()
    expect(headersAt(0)['User-Agent']).toBe('SUNA/0.1')
  })

  it('maps message.items onto LitResult', async () => {
    respondWith(jsonResponse(crossrefBody))
    const { results, error } = await searchLiterature('crossref', 'ram pressure', { limit: 1 })
    expect(error).toBeNull()
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({
      source: 'crossref',
      id: '10.1086/151605',
      doi: '10.1086/151605',
      title: 'On the infall of matter into clusters of galaxies',
      authors: ['James E. Gunn', 'J. Richard Gott'],
      year: 1972,
      venue: 'The Astrophysical Journal',
      citedByCount: 3021,
      openAccessUrl: null,
      abstract: 'We consider the infall of matter.'
    })
    expect(LitResultSchema.safeParse(results[0]).success).toBe(true)
  })

  it('reports an HTTP failure instead of an empty result list', async () => {
    respondWith({ status: 500, body: 'upstream exploded' })
    const { results, error } = await searchLiterature('crossref', 'x', { limit: 1 })
    expect(results).toEqual([])
    expect(error).toContain('HTTP 500')
  })

  it('reports a transport failure as a human message and never throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND api.crossref.org'))
    const { results, error } = await searchLiterature('crossref', 'x', { limit: 1 })
    expect(results).toEqual([])
    expect(error).toContain('Crossref is unreachable')
  })

  it('looks a DOI up on the single-work endpoint', async () => {
    respondWith(jsonResponse({ message: crossrefBody.message.items[0] }))
    const { result, error } = await lookupByDoi('crossref', '10.1086/151605')
    expect(error).toBeNull()
    expect(result?.doi).toBe('10.1086/151605')
    expect(requestAt(0).url.pathname).toBe('/works/10.1086%2F151605')
  })

  it('returns null (not an error) for an unknown DOI', async () => {
    respondWith({ status: 404, body: 'Resource not found.' })
    expect(await lookupByDoi('crossref', '10.9999/nope')).toEqual({ result: null, error: null })
  })
})

/* -------------------------------------------------------------- openalex -- */

const openAlexBody = {
  results: [
    {
      id: 'https://openalex.org/W2741809807',
      doi: 'https://doi.org/10.1086/151605',
      display_name: 'On the infall of matter into clusters of galaxies',
      publication_year: 1972,
      cited_by_count: 3021,
      authorships: [
        { author: { display_name: 'James E. Gunn' } },
        { author: { display_name: 'J. Richard Gott' } }
      ],
      primary_location: { source: { display_name: 'The Astrophysical Journal' } },
      open_access: { oa_url: 'https://example.org/gunn1972.pdf' },
      abstract_inverted_index: { We: [0], consider: [1], infall: [3], the: [2] }
    }
  ]
}

describe('openalex', () => {
  it('builds a search URL with per-page, mailto and the stored api_key', async () => {
    respondWith(jsonResponse(openAlexBody))
    await searchLiterature('openalex', 'ram pressure', {
      limit: 10,
      mailto: 'ada@example.org',
      apiKey: 'oa-secret'
    })
    const { url } = requestAt(0)
    expect(url.origin + url.pathname).toBe('https://api.openalex.org/works')
    expect(url.searchParams.get('search')).toBe('ram pressure')
    expect(url.searchParams.get('per-page')).toBe('10')
    expect(url.searchParams.get('mailto')).toBe('ada@example.org')
    expect(url.searchParams.get('api_key')).toBe('oa-secret')
  })

  it('omits api_key when no key is stored', async () => {
    respondWith(jsonResponse(openAlexBody))
    await searchLiterature('openalex', 'ram pressure', { limit: 10 })
    expect(requestAt(0).url.searchParams.get('api_key')).toBeNull()
  })

  it('maps a work, stripping id/doi prefixes and rebuilding the abstract', async () => {
    respondWith(jsonResponse(openAlexBody))
    const { results, error } = await searchLiterature('openalex', 'ram pressure', { limit: 1 })
    expect(error).toBeNull()
    expect(results[0]).toEqual({
      source: 'openalex',
      id: 'W2741809807',
      doi: '10.1086/151605',
      title: 'On the infall of matter into clusters of galaxies',
      authors: ['James E. Gunn', 'J. Richard Gott'],
      year: 1972,
      venue: 'The Astrophysical Journal',
      citedByCount: 3021,
      openAccessUrl: 'https://example.org/gunn1972.pdf',
      abstract: 'We consider the infall'
    })
  })

  it('surfaces the metered 429 honestly instead of swallowing it', async () => {
    respondWith(
      jsonResponse(
        {
          error: 'Rate limit exceeded',
          message: 'Insufficient budget. Add funds at openalex.org/pricing'
        },
        429
      )
    )
    const { results, error } = await searchLiterature('openalex', 'ram pressure', { limit: 5 })
    expect(results).toEqual([])
    expect(error).toContain('HTTP 429')
    expect(error).toContain('Insufficient budget')
    expect(error).toContain('Crossref')
  })

  it('looks a DOI up through the doi: shortcut path', async () => {
    respondWith(jsonResponse(openAlexBody.results[0]))
    const { result } = await lookupByDoi('openalex', '10.1086/151605')
    expect(result?.id).toBe('W2741809807')
    expect(decodeURIComponent(requestAt(0).url.pathname)).toBe('/works/doi:10.1086/151605')
  })
})

/* ------------------------------------------------------------------- ads -- */

const adsBody = {
  response: {
    docs: [
      {
        bibcode: '1972ApJ...176....1G',
        title: ['On the infall of matter into clusters of galaxies'],
        author: ['Gunn, James E.', 'Gott, J. Richard'],
        year: '1972',
        pub: 'The Astrophysical Journal',
        citation_count: 3021,
        doi: ['10.1086/151605']
      }
    ]
  }
}

describe('ads', () => {
  it('refuses without a key and never touches the network', async () => {
    const { results, error } = await searchLiterature('ads', 'ram pressure', { limit: 5 })
    expect(results).toEqual([])
    expect(error).toBe('NASA ADS needs a free API key (Settings)')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the bearer token and the documented field list', async () => {
    respondWith(jsonResponse(adsBody))
    await searchLiterature('ads', 'ram pressure', { limit: 7, apiKey: 'ads-secret' })
    const { url } = requestAt(0)
    expect(url.origin + url.pathname).toBe('https://api.adsabs.harvard.edu/v1/search/query')
    expect(url.searchParams.get('q')).toBe('ram pressure')
    expect(url.searchParams.get('rows')).toBe('7')
    expect(url.searchParams.get('fl')).toBe('bibcode,title,author,year,pub,citation_count,doi')
    expect(headersAt(0)['Authorization']).toBe('Bearer ads-secret')
  })

  it('maps response.response.docs onto LitResult', async () => {
    respondWith(jsonResponse(adsBody))
    const { results, error } = await searchLiterature('ads', 'ram pressure', {
      limit: 1,
      apiKey: 'ads-secret'
    })
    expect(error).toBeNull()
    expect(results[0]).toEqual({
      source: 'ads',
      id: '1972ApJ...176....1G',
      doi: '10.1086/151605',
      title: 'On the infall of matter into clusters of galaxies',
      authors: ['Gunn, James E.', 'Gott, J. Richard'],
      year: 1972,
      venue: 'The Astrophysical Journal',
      citedByCount: 3021,
      openAccessUrl:
        'https://ui.adsabs.harvard.edu/abs/1972ApJ...176....1G/abstract',
      abstract: null
    })
  })

  it('explains a rejected key', async () => {
    respondWith({ status: 401, body: '{"error":"Unauthorized"}' })
    const { error } = await searchLiterature('ads', 'x', { limit: 1, apiKey: 'stale' })
    expect(error).toContain('HTTP 401')
    expect(error).toContain('Settings')
  })

  it('quotes the DOI in the ADS query syntax', async () => {
    respondWith(jsonResponse(adsBody))
    await lookupByDoi('ads', '10.1086/151605', { apiKey: 'ads-secret' })
    expect(requestAt(0).url.searchParams.get('q')).toBe('doi:"10.1086/151605"')
  })
})

/* ----------------------------------------------------------------- arxiv -- */

const arxivFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <opensearch:totalResults>1</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/2401.01234v1</id>
    <published>2024-01-02T18:00:00Z</published>
    <title>Stripping at cosmic
      noon</title>
    <summary>  We measure the stripping rate.  </summary>
    <author><name>Ada Lovelace</name></author>
    <author><name>Grace Hopper</name></author>
    <arxiv:doi>10.1234/abcd</arxiv:doi>
  </entry>
</feed>`

describe('arxiv', () => {
  it('parses the Atom feed with regex extraction (no XML dependency)', async () => {
    respondWith({ body: arxivFeed })
    const { results, error } = await searchLiterature('arxiv', 'stripping', { limit: 1 })
    expect(error).toBeNull()
    expect(results[0]).toEqual({
      source: 'arxiv',
      id: 'arXiv:2401.01234v1',
      doi: '10.1234/abcd',
      title: 'Stripping at cosmic noon',
      authors: ['Ada Lovelace', 'Grace Hopper'],
      year: 2024,
      venue: 'arXiv',
      citedByCount: null,
      openAccessUrl: 'http://arxiv.org/abs/2401.01234v1',
      abstract: 'We measure the stripping rate.'
    })
    const { url } = requestAt(0)
    expect(url.origin + url.pathname).toBe('http://export.arxiv.org/api/query')
    expect(url.searchParams.get('search_query')).toBe('all:stripping')
    expect(url.searchParams.get('max_results')).toBe('1')
  })

  it('reports an unreadable/empty feed instead of pretending nothing matched', async () => {
    respondWith({ body: '' })
    const { results, error } = await searchLiterature('arxiv', 'stripping', { limit: 1 })
    expect(results).toEqual([])
    expect(error).toContain('arXiv')
  })

  it('treats an honest zero-result feed as zero results, not an error', async () => {
    respondWith({
      body: '<feed><opensearch:totalResults>0</opensearch:totalResults></feed>'
    })
    expect(await searchLiterature('arxiv', 'zzzz', { limit: 1 })).toEqual({
      results: [],
      error: null
    })
  })
})

/* ------------------------------------------------------------------ ai-cli -- */

const gunnGott = {
  title: 'On the infall of matter into clusters of galaxies',
  authors: ['James E. Gunn', 'J. Richard Gott'],
  year: 1972,
  venue: 'The Astrophysical Journal',
  doi: '10.1086/151605',
  url: 'https://doi.org/10.1086/151605',
  abstract: null
}
const abadi = {
  title: 'Ram Pressure Stripping of Spiral Galaxies in Clusters',
  authors: ['Mario G. Abadi', 'Ben Moore', 'Matthias Bower'],
  year: 1999,
  venue: 'Monthly Notices of the Royal Astronomical Society',
  doi: '10.1046/j.1365-8711.1999.02715.x'
}

function mappedGunnGott(): unknown {
  return {
    source: 'ai-cli',
    id: '10.1086/151605',
    doi: '10.1086/151605',
    title: 'On the infall of matter into clusters of galaxies',
    authors: ['James E. Gunn', 'J. Richard Gott'],
    year: 1972,
    venue: 'The Astrophysical Journal',
    citedByCount: null,
    openAccessUrl: 'https://doi.org/10.1086/151605',
    abstract: null
  }
}

describe('parseAiCliText', () => {
  it('parses a bare JSON array', () => {
    const { results, error } = parseAiCliText(JSON.stringify([gunnGott]))
    expect(error).toBeNull()
    expect(results).toEqual([mappedGunnGott()])
  })

  it('strips a ```json fence around the whole answer', () => {
    const fenced = '```json\n' + JSON.stringify([gunnGott]) + '\n```'
    const { results, error } = parseAiCliText(fenced)
    expect(error).toBeNull()
    expect(results).toEqual([mappedGunnGott()])
  })

  it('extracts the array from prose wrapped around it', () => {
    const prose =
      `Here are two papers on ram pressure stripping:\n\n${JSON.stringify([gunnGott, abadi])}\n\nLet me know if you would like more.`
    const { results, error } = parseAiCliText(prose)
    expect(error).toBeNull()
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.doi)).toEqual([gunnGott.doi, abadi.doi])
  })

  it('drops non-object array entries but keeps the good ones, never failing the whole search', () => {
    const mixed = [gunnGott, null, 'not an object', 42, ['nested', 'array'], abadi]
    const { results, error } = parseAiCliText(JSON.stringify(mixed))
    expect(error).toBeNull()
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.doi)).toEqual([gunnGott.doi, abadi.doi])
  })

  it('fills sensible fallbacks for a sparse-but-well-formed item, same as the other providers', () => {
    const { results } = parseAiCliText(JSON.stringify([{ authors: ['no title given'] }]))
    expect(results).toEqual([
      {
        source: 'ai-cli',
        id: 'ai-cli-result',
        doi: null,
        title: '(untitled)',
        authors: ['no title given'],
        year: null,
        venue: null,
        citedByCount: null,
        openAccessUrl: null,
        abstract: null
      }
    ])
  })

  it('reports the first 300 chars of unparseable text instead of an empty list', () => {
    const { results, error } = parseAiCliText('I could not find any papers matching that query.')
    expect(results).toEqual([])
    expect(error).toBe('I could not find any papers matching that query.')
  })

  it('every mapped item validates against LitResultSchema', () => {
    const { results } = parseAiCliText(JSON.stringify([gunnGott, abadi]))
    for (const result of results) {
      expect(LitResultSchema.safeParse(result).success).toBe(true)
      expect(result.source).toBe('ai-cli')
    }
  })
})

describe('parseClaudeCliOutput', () => {
  function claudeEnvelope(result: string, isError = false): string {
    return JSON.stringify({ result, is_error: isError })
  }

  it('parses the ground-truth envelope: stdout is one object, .result is a string array', () => {
    const stdout = claudeEnvelope(JSON.stringify([gunnGott, abadi]))
    const { results, error } = parseClaudeCliOutput(stdout, '', 0)
    expect(error).toBeNull()
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual(mappedGunnGott())
  })

  it('unwraps a fenced array inside .result', () => {
    const fenced = '```json\n' + JSON.stringify([gunnGott]) + '\n```'
    const { results, error } = parseClaudeCliOutput(claudeEnvelope(fenced), '', 0)
    expect(error).toBeNull()
    expect(results).toEqual([mappedGunnGott()])
  })

  it('is_error true surfaces the failure message, not an empty silent list', () => {
    const stdout = claudeEnvelope('rate limited by the model provider', true)
    const { results, error } = parseClaudeCliOutput(stdout, '', 0)
    expect(results).toEqual([])
    expect(error).toBe('rate limited by the model provider')
  })

  it('a non-zero exit surfaces the first 300 chars of stdout/stderr', () => {
    const { results, error } = parseClaudeCliOutput('', 'command not found: claude', 127)
    expect(results).toEqual([])
    expect(error).toBe('command not found: claude')
  })

  it('unparseable stdout (not the promised JSON object) surfaces honestly', () => {
    const { results, error } = parseClaudeCliOutput('not json at all', '', 0)
    expect(results).toEqual([])
    expect(error).toBe('not json at all')
  })

  it('truncates a very long error to 300 chars with an ellipsis', () => {
    const long = 'x'.repeat(500)
    const { error } = parseClaudeCliOutput(claudeEnvelope(long, true), '', 0)
    expect(error).toHaveLength(301)
    expect(error?.endsWith('…')).toBe(true)
  })
})

describe('parseCodexCliOutput', () => {
  it('parses the --output-last-message file content directly (no envelope)', () => {
    const { results, error } = parseCodexCliOutput(JSON.stringify([gunnGott, abadi]), '', 0)
    expect(error).toBeNull()
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual(mappedGunnGott())
  })

  it('a non-zero exit surfaces stderr when the last-message file is empty', () => {
    const { results, error } = parseCodexCliOutput('', 'error: not authenticated', 1)
    expect(results).toEqual([])
    expect(error).toBe('error: not authenticated')
  })

  it('an empty last-message with exit 0 is still an honest error, not an empty silent list', () => {
    const { results, error } = parseCodexCliOutput('', '', 0)
    expect(results).toEqual([])
    expect(error).not.toBeNull()
  })
})

describe('codexProgressFromLine', () => {
  it('narrates the lifecycle + web_search/agent_message events verified live', () => {
    expect(codexProgressFromLine('{"type":"thread.started","thread_id":"t1"}')).toBe(
      'Starting Codex…'
    )
    expect(codexProgressFromLine('{"type":"turn.started"}')).toBe('Thinking…')
    expect(
      codexProgressFromLine('{"type":"item.started","item":{"type":"web_search"}}')
    ).toBe('Searching the web…')
    expect(
      codexProgressFromLine('{"type":"item.completed","item":{"type":"web_search"}}')
    ).toBe('Reading results…')
    expect(
      codexProgressFromLine('{"type":"item.completed","item":{"type":"agent_message","text":"[]"}}')
    ).toBe('Compiling results…')
    expect(codexProgressFromLine('{"type":"turn.completed","usage":{}}')).toBe('Finishing…')
  })

  it('returns null for blank lines, unparseable lines, and event types with nothing to narrate', () => {
    expect(codexProgressFromLine('')).toBeNull()
    expect(codexProgressFromLine('   ')).toBeNull()
    expect(codexProgressFromLine('not json')).toBeNull()
    expect(codexProgressFromLine('{"type":"item.started","item":{"type":"reasoning"}}')).toBeNull()
    expect(codexProgressFromLine('{"type":"some.other.event"}')).toBeNull()
  })
})
