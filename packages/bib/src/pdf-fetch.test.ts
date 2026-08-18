import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LitResult } from '@suna/core';
import {
  citationPdfUrlFromHtml,
  downloadPdf,
  pdfUrlCandidates,
  pdfUrlPlan,
  publicHttpUrlRefusal,
} from './pdf-fetch.js';

/**
 * No live network anywhere: every test routes global `fetch` through a stub
 * keyed on the exact URL, so an unexpected request fails loudly instead of
 * silently escaping to the internet. Bodies are real ReadableStreams, which
 * is what makes the mid-stream size cap and the redirect body-cancel testable
 * at all.
 */

interface StubResponse {
  status?: number;
  /** Lowercase header names — the stub's `get` is not case-folding. */
  headers?: Record<string, string>;
  body?: string | Uint8Array | ReadableStream<Uint8Array> | null;
}

const routes = new Map<string, StubResponse>();
const requested: string[] = [];
const fetchMock = vi.fn();

function route(url: string, response: StubResponse): void {
  routes.set(url, response);
}

function streamOf(body: StubResponse['body']): ReadableStream<Uint8Array> | null {
  if (body === undefined || body === null) return null;
  if (body instanceof Uint8Array || typeof body === 'string') {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }
  return body;
}

beforeEach(() => {
  routes.clear();
  requested.length = 0;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    requested.push(url);
    const stub = routes.get(url);
    // The mirror rung asks OpenAlex for every OA location of a DOI, so it
    // fires in almost every test here — nearly none of which are ABOUT it.
    // Default it to "this work has no OA location", which makes the rung a
    // no-op the other rungs' assertions can ignore. A test that cares routes
    // the URL explicitly and wins, because `routes.get` is checked first.
    if (stub === undefined && url.startsWith('https://api.openalex.org/works/doi:')) {
      return {
        status: 200,
        headers: { get: () => null },
        body: streamOf(JSON.stringify({ locations: [] })),
      };
    }
    if (stub === undefined) throw new Error(`no route stubbed for ${url}`);
    return {
      status: stub.status ?? 200,
      headers: { get: (name: string) => stub.headers?.[name.toLowerCase()] ?? null },
      body: streamOf(stub.body),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  // The budget tests drive the clock by hand; a leaked fake clock would make
  // every later test's `Date.now()` stand still.
  vi.useRealTimers();
});

function litResult(over: Partial<LitResult> = {}): LitResult {
  return {
    source: 'crossref',
    id: '10.1086/151605',
    doi: '10.1086/151605',
    title: 'On the infall of matter into clusters of galaxies',
    authors: ['James E. Gunn', 'J. Richard Gott'],
    year: 1972,
    venue: 'The Astrophysical Journal',
    citedByCount: 3021,
    openAccessUrl: null,
    abstract: null,
    ...over,
  };
}

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< >>\ntrailer\n%%EOF\n');
const LOGIN_PAGE = '<!DOCTYPE html>\n<html><head><title>Sign in</title></head><body>Sign in</body></html>';

/* ---------------------------------------------------------- the URL ladder */

describe('pdfUrlCandidates — the ordered ladder', () => {
  const rich = litResult({
    source: 'arxiv',
    id: 'arXiv:2401.01234',
    doi: '10.1086/151605',
    openAccessUrl: 'https://repo.example.org/record/42',
  });

  it("yields nothing at all under policy 'off', and says why", () => {
    const plan = pdfUrlPlan(rich, { policy: 'off', mailto: 'ada@example.org' });
    expect(plan.candidates).toEqual([]);
    expect(plan.skipped.join(' ')).toContain("'off'");
  });

  it("runs arxiv → unpaywall → open-access landing → doi.org under 'publisher'", () => {
    const candidates = pdfUrlCandidates(rich, { policy: 'publisher', mailto: 'ada@example.org' });
    expect(candidates.map((candidate) => candidate.via)).toEqual([
      'arxiv',
      'openalex-mirror',
      'unpaywall',
      'open-access-landing',
      'doi-landing',
    ]);
  });

  it('puts a directly-PDF openAccessUrl ahead of Unpaywall, and drops the landing rung', () => {
    const candidates = pdfUrlCandidates(
      litResult({ ...rich, openAccessUrl: 'https://repo.example.org/record/42.pdf' }),
      { policy: 'publisher', mailto: 'ada@example.org' },
    );
    expect(candidates.map((candidate) => candidate.via)).toEqual([
      'arxiv',
      'openalex-mirror',
      'open-access-pdf',
      'unpaywall',
      'doi-landing',
    ]);
  });

  it("excludes the doi.org publisher page under 'open-access', and reports the exclusion", () => {
    const plan = pdfUrlPlan(rich, { policy: 'open-access', mailto: 'ada@example.org' });
    expect(plan.candidates.map((candidate) => candidate.via)).toEqual([
      'arxiv',
      'openalex-mirror',
      'unpaywall',
      'open-access-landing',
    ]);
    expect(plan.skipped.join(' ')).toContain("the download policy is 'open-access'");
  });

  it('defaults to the configured policy, which includes the publisher page', () => {
    const vias = pdfUrlCandidates(rich, { mailto: 'ada@example.org' }).map((c) => c.via);
    expect(vias).toContain('doi-landing');
  });

  it('collapses a duplicate when openAccessUrl already IS the doi.org page', () => {
    const candidates = pdfUrlCandidates(
      litResult({ openAccessUrl: 'https://doi.org/10.1086/151605' }),
      { policy: 'publisher' },
    );
    expect(candidates.map((candidate) => candidate.url)).toEqual([
      'https://api.openalex.org/works/doi:10.1086/151605',
      'https://doi.org/10.1086/151605',
    ]);
  });
});

/**
 * A registered SICI-style DOI. Every one of `#`, `?`, `&`, `<` and `>` is legal
 * in a DOI suffix, and `encodeURI` escapes none of the first three — a `#` left
 * raw turns the rest of the URL into a fragment that `fetch` never sends.
 */
const SICI_DOI = '10.1002/(SICI)1097-4571(199601)47:1<23::AID-ASI3>3.0.CO;2-#';

describe('pdfUrlCandidates — DOIs that are hostile to string interpolation', () => {
  const planFor = (doi: string): ReturnType<typeof pdfUrlPlan> =>
    pdfUrlPlan(litResult({ doi, openAccessUrl: null }), {
      policy: 'publisher',
      mailto: 'ada@example.org',
    });

  it("keeps Unpaywall's mandatory email when the DOI contains a #", () => {
    const unpaywall = planFor(SICI_DOI).candidates.find((c) => c.via === 'unpaywall');
    const url = new URL(unpaywall?.url ?? '');
    // Raw, the '#' would make '?email=…' part of a fragment fetch strips, and
    // Unpaywall's keyless API answers 422 to a request carrying no email.
    expect(url.searchParams.get('email')).toBe('ada@example.org');
    expect(url.hash).toBe('');
    expect(decodeURIComponent(url.pathname)).toBe(`/v2/${SICI_DOI}`);
  });

  it('resolves the whole DOI at doi.org, not the part before the #', () => {
    const landing = planFor(SICI_DOI).candidates.find((c) => c.via === 'doi-landing');
    const url = new URL(landing?.url ?? '');
    // Truncated at the '#', doi.org resolves a DIFFERENT work, whose PDF would
    // then be byte-verified and saved under this reference's cite key.
    expect(url.hash).toBe('');
    expect(decodeURIComponent(url.pathname)).toBe(`/${SICI_DOI}`);
  });

  it('survives a DOI carrying ? and &, which would otherwise become query parameters', () => {
    const candidates = planFor('10.1234/abc?x&y').candidates;
    const unpaywall = new URL(candidates.find((c) => c.via === 'unpaywall')?.url ?? '');
    expect(unpaywall.searchParams.get('email')).toBe('ada@example.org');
    expect([...unpaywall.searchParams.keys()]).toEqual(['email']);
    expect(decodeURIComponent(unpaywall.pathname)).toBe('/v2/10.1234/abc?x&y');
    const landing = new URL(candidates.find((c) => c.via === 'doi-landing')?.url ?? '');
    expect(landing.search).toBe('');
    expect(decodeURIComponent(landing.pathname)).toBe('/10.1234/abc?x&y');
  });

  it('escapes an arXiv id recovered from a 10.48550 DOI, which nothing validates', () => {
    const candidates = pdfUrlCandidates(
      litResult({ id: 'W1', doi: '10.48550/arXiv.2401.01234#x', openAccessUrl: null }),
      { policy: 'open-access' },
    );
    const arxiv = new URL(candidates.find((c) => c.via === 'arxiv')?.url ?? '');
    expect(arxiv.hash).toBe('');
    expect(decodeURIComponent(arxiv.pathname)).toBe('/pdf/2401.01234#x');
  });

  it('leaves an ordinary DOI byte-for-byte alone', () => {
    expect(planFor('10.1086/151605').candidates.map((c) => c.url)).toEqual([
      'https://api.openalex.org/works/doi:10.1086/151605?mailto=ada%40example.org',
      'https://api.unpaywall.org/v2/10.1086/151605?email=ada%40example.org',
      'https://doi.org/10.1086/151605',
    ]);
  });

  it('asks Unpaywall for the encoded DOI and gets the PDF back', async () => {
    const api = `https://api.unpaywall.org/v2/${SICI_DOI.split('/')
      .map(encodeURIComponent)
      .join('/')}?email=ada%40example.org`;
    route(api, {
      body: JSON.stringify({ best_oa_location: { url_for_pdf: 'https://oa.example/sici.pdf' } }),
    });
    route('https://oa.example/sici.pdf', { body: PDF_BYTES });

    const outcome = await downloadPdf(litResult({ doi: SICI_DOI, openAccessUrl: null }), {
      policy: 'open-access',
      mailto: 'ada@example.org',
    });

    expect(outcome.error).toBeNull();
    expect(outcome.via).toBe('unpaywall');
    // [0] is the mirror rung; [1] is Unpaywall, the rung this test is about.
    expect(requested[1]).toContain('%23');
    expect(requested[1]).toContain('email=ada%40example.org');
  });
});

describe('pdfUrlCandidates — arXiv', () => {
  it('derives https://arxiv.org/pdf/<id> from the arXiv provider id', () => {
    const candidates = pdfUrlCandidates(
      litResult({ source: 'arxiv', id: 'arXiv:2401.01234', doi: null, openAccessUrl: null }),
      { policy: 'open-access' },
    );
    expect(candidates[0]).toEqual({
      url: 'https://arxiv.org/pdf/2401.01234',
      via: 'arxiv',
      kind: 'pdf',
    });
  });

  it('keeps the version suffix when the id carries one', () => {
    const candidates = pdfUrlCandidates(
      litResult({ source: 'arxiv', id: 'arXiv:2401.01234v3', doi: null, openAccessUrl: null }),
      { policy: 'open-access' },
    );
    expect(candidates[0]?.url).toBe('https://arxiv.org/pdf/2401.01234v3');
  });

  it('recovers an old-style id from an arxiv.org/abs URL', () => {
    const candidates = pdfUrlCandidates(
      litResult({ id: 'x', doi: null, openAccessUrl: 'http://arxiv.org/abs/astro-ph/0601001v1' }),
      { policy: 'open-access' },
    );
    expect(candidates[0]?.url).toBe('https://arxiv.org/pdf/astro-ph/0601001v1');
  });

  it('recovers the id from a 10.48550 DataCite DOI on a Crossref record', () => {
    const candidates = pdfUrlCandidates(
      litResult({ id: 'W123', doi: '10.48550/arXiv.2401.01234', openAccessUrl: null }),
      { policy: 'open-access' },
    );
    expect(candidates[0]?.url).toBe('https://arxiv.org/pdf/2401.01234');
  });

  it('never mistakes an ordinary DOI for an arXiv id', () => {
    const vias = pdfUrlCandidates(litResult(), { policy: 'publisher' }).map((c) => c.via);
    expect(vias).not.toContain('arxiv');
  });
});

describe('pdfUrlCandidates — bioRxiv / medRxiv', () => {
  it('appends .full.pdf to a bioRxiv landing page', () => {
    const candidates = pdfUrlCandidates(
      litResult({
        source: 'biorxiv',
        id: '10.1101/2020.01.01.123456',
        doi: '10.1101/2020.01.01.123456',
        openAccessUrl: 'https://www.biorxiv.org/content/10.1101/2020.01.01.123456v1',
      }),
      { policy: 'open-access' },
    );
    expect(candidates[0]).toEqual({
      url: 'https://www.biorxiv.org/content/10.1101/2020.01.01.123456v1.full.pdf',
      via: 'biorxiv',
      kind: 'pdf',
    });
  });

  it('does the same for medRxiv, and tolerates a trailing slash and a query', () => {
    const candidates = pdfUrlCandidates(
      litResult({
        source: 'biorxiv',
        doi: '10.1101/2021.02.02.654321',
        openAccessUrl: 'https://www.medrxiv.org/content/10.1101/2021.02.02.654321v2/?utm=1',
      }),
      { policy: 'open-access' },
    );
    expect(candidates[0]?.url).toBe(
      'https://www.medrxiv.org/content/10.1101/2021.02.02.654321v2.full.pdf',
    );
  });

  it('leaves an already-PDF preprint URL to the open-access-pdf rung', () => {
    const candidates = pdfUrlCandidates(
      litResult({
        doi: null,
        openAccessUrl: 'https://www.biorxiv.org/content/10.1101/2020.01.01.123456v1.full.pdf',
      }),
      { policy: 'open-access' },
    );
    expect(candidates.map((candidate) => candidate.via)).toEqual(['open-access-pdf']);
  });
});

describe('pdfUrlCandidates — Unpaywall', () => {
  it('builds the keyless v2 URL with the contact email', () => {
    const candidates = pdfUrlCandidates(litResult(), {
      policy: 'open-access',
      mailto: 'ada@example.org',
    });
    // [0] is now the OpenAlex mirror rung, which sits ahead of Unpaywall.
    expect(candidates[1]).toEqual({
      url: 'https://api.unpaywall.org/v2/10.1086/151605?email=ada%40example.org',
      via: 'unpaywall',
      kind: 'unpaywall',
    });
  });

  it('skips Unpaywall without a mailto and REPORTS the skip', () => {
    const plan = pdfUrlPlan(litResult(), { policy: 'open-access' });
    expect(plan.candidates.map((candidate) => candidate.via)).not.toContain('unpaywall');
    expect(plan.skipped.join(' ')).toContain('Unpaywall');
    expect(plan.skipped.join(' ')).toContain('contact email');
  });

  it('skips Unpaywall for a record with no DOI, and says that instead', () => {
    const plan = pdfUrlPlan(litResult({ doi: null }), {
      policy: 'open-access',
      mailto: 'ada@example.org',
    });
    expect(plan.skipped.join(' ')).toContain('no DOI');
  });

  it('strips a doi.org prefix a provider baked into the DOI', () => {
    const candidates = pdfUrlCandidates(litResult({ doi: 'https://doi.org/10.1086/151605' }), {
      policy: 'publisher',
    });
    expect(candidates.map((candidate) => candidate.url)).toEqual([
      'https://api.openalex.org/works/doi:10.1086/151605',
      'https://doi.org/10.1086/151605',
    ]);
  });
});

/* ------------------------------------------------------- citation_pdf_url */

describe('citationPdfUrlFromHtml', () => {
  const base = 'https://publisher.example/articles/151605';

  it('reads the Google-Scholar meta tag', () => {
    const html = `<head><meta name="citation_pdf_url" content="https://publisher.example/pdf/151605.pdf"></head>`;
    expect(citationPdfUrlFromHtml(html, base)).toBe('https://publisher.example/pdf/151605.pdf');
  });

  it('reads it with the attributes in the reverse order', () => {
    const html = `<meta content="https://publisher.example/pdf/151605.pdf" name="citation_pdf_url" />`;
    expect(citationPdfUrlFromHtml(html, base)).toBe('https://publisher.example/pdf/151605.pdf');
  });

  it('accepts single quotes', () => {
    const html = `<meta name='citation_pdf_url' content='https://publisher.example/pdf/151605.pdf'>`;
    expect(citationPdfUrlFromHtml(html, base)).toBe('https://publisher.example/pdf/151605.pdf');
  });

  it('resolves a relative href against baseUrl', () => {
    const html = `<meta name="citation_pdf_url" content="/content/151605.full.pdf">`;
    expect(citationPdfUrlFromHtml(html, base)).toBe(
      'https://publisher.example/content/151605.full.pdf',
    );
  });

  it('resolves a document-relative href against baseUrl', () => {
    const html = `<meta name="citation_pdf_url" content="151605.pdf">`;
    expect(citationPdfUrlFromHtml(html, base)).toBe('https://publisher.example/articles/151605.pdf');
  });

  it('decodes &amp; in the URL the way a browser would', () => {
    const html = `<meta name="citation_pdf_url" content="https://p.example/get?id=7&amp;fmt=pdf">`;
    expect(citationPdfUrlFromHtml(html, base)).toBe('https://p.example/get?id=7&fmt=pdf');
  });

  it('is case-insensitive about the tag and attribute names', () => {
    const html = `<META NAME="CITATION_PDF_URL" CONTENT="https://p.example/a.pdf">`;
    expect(citationPdfUrlFromHtml(html, base)).toBe('https://p.example/a.pdf');
  });

  it('falls back to <link rel="alternate" type="application/pdf">', () => {
    const html = `<link rel="alternate" type="application/pdf" href="/dl/151605.pdf">`;
    expect(citationPdfUrlFromHtml(html, base)).toBe('https://publisher.example/dl/151605.pdf');
  });

  it('reads that link with type before rel, and a multi-token rel', () => {
    const html = `<link type="application/pdf" href="/dl/151605.pdf" rel="alternate nofollow">`;
    expect(citationPdfUrlFromHtml(html, base)).toBe('https://publisher.example/dl/151605.pdf');
  });

  it('prefers the meta tag over the alternate link', () => {
    const html = [
      '<link rel="alternate" type="application/pdf" href="/dl/wrong.pdf">',
      '<meta name="citation_pdf_url" content="/dl/right.pdf">',
    ].join('\n');
    expect(citationPdfUrlFromHtml(html, base)).toBe('https://publisher.example/dl/right.pdf');
  });

  it('ignores an alternate link that is not a PDF', () => {
    const html = `<link rel="alternate" type="text/html" href="/dl/151605.html">`;
    expect(citationPdfUrlFromHtml(html, base)).toBeNull();
  });

  it('ignores an empty content attribute', () => {
    expect(citationPdfUrlFromHtml(`<meta name="citation_pdf_url" content="">`, base)).toBeNull();
  });

  it('returns null for a page that advertises no PDF', () => {
    expect(citationPdfUrlFromHtml(LOGIN_PAGE, base)).toBeNull();
  });

  it('returns null rather than throwing on an unusable base', () => {
    const html = `<meta name="citation_pdf_url" content="/dl/x.pdf">`;
    expect(citationPdfUrlFromHtml(html, 'not a url')).toBeNull();
  });
});

/* -------------------------------------------------------------- downloadPdf */

describe('downloadPdf — the happy paths', () => {
  it('takes arXiv first and stops there', async () => {
    route('https://arxiv.org/pdf/2401.01234', { body: PDF_BYTES });
    const outcome = await downloadPdf(
      litResult({ source: 'arxiv', id: 'arXiv:2401.01234', doi: '10.1086/151605' }),
      { policy: 'publisher', mailto: 'ada@example.org' },
    );

    expect(outcome.error).toBeNull();
    expect(outcome.via).toBe('arxiv');
    expect(outcome.sourceUrl).toBe('https://arxiv.org/pdf/2401.01234');
    expect(outcome.bytes).toEqual(PDF_BYTES);
    expect(requested).toEqual(['https://arxiv.org/pdf/2401.01234']);
  });

  it('follows Unpaywall to best_oa_location.url_for_pdf', async () => {
    route('https://api.unpaywall.org/v2/10.1086/151605?email=ada%40example.org', {
      body: JSON.stringify({
        doi: '10.1086/151605',
        best_oa_location: { url_for_pdf: 'https://oa.example/151605.pdf' },
      }),
    });
    route('https://oa.example/151605.pdf', { body: PDF_BYTES });

    const outcome = await downloadPdf(litResult(), {
      policy: 'open-access',
      mailto: 'ada@example.org',
    });
    expect(outcome.error).toBeNull();
    expect(outcome.via).toBe('unpaywall');
    expect(outcome.sourceUrl).toBe('https://oa.example/151605.pdf');
  });

  it('reads citation_pdf_url off the publisher page reached through doi.org', async () => {
    route('https://doi.org/10.1086/151605', {
      status: 302,
      headers: { location: 'https://publisher.example/articles/151605' },
      body: '',
    });
    route('https://publisher.example/articles/151605', {
      // Relative href: it must resolve against the page we LANDED on, not doi.org.
      body: `<meta name="citation_pdf_url" content="/content/151605.full.pdf">`,
    });
    route('https://publisher.example/content/151605.full.pdf', { body: PDF_BYTES });

    const outcome = await downloadPdf(litResult(), { policy: 'publisher' });
    expect(outcome.error).toBeNull();
    expect(outcome.via).toBe('doi-landing');
    expect(outcome.sourceUrl).toBe('https://publisher.example/content/151605.full.pdf');
  });

  it('follows up to 3 redirects', async () => {
    route('https://arxiv.org/pdf/2401.01234', {
      status: 301,
      headers: { location: 'https://arxiv.org/a' },
      body: '',
    });
    route('https://arxiv.org/a', { status: 302, headers: { location: '/b' }, body: '' });
    route('https://arxiv.org/b', { status: 307, headers: { location: '/c.pdf' }, body: '' });
    route('https://arxiv.org/c.pdf', { body: PDF_BYTES });

    const outcome = await downloadPdf(
      litResult({ source: 'arxiv', id: 'arXiv:2401.01234', doi: null }),
      { policy: 'open-access' },
    );
    expect(outcome.error).toBeNull();
    // sourceUrl is the URL the bytes really came from, after the redirects.
    expect(outcome.sourceUrl).toBe('https://arxiv.org/c.pdf');
  });
});

describe('downloadPdf — rejecting what is not a PDF', () => {
  it('rejects an HTML login page served at a .pdf URL and tries the next rung', async () => {
    route('https://repo.example.org/record/42.pdf', { body: LOGIN_PAGE });
    route('https://doi.org/10.1086/151605', {
      body: `<meta name="citation_pdf_url" content="https://publisher.example/real.pdf">`,
    });
    route('https://publisher.example/real.pdf', { body: PDF_BYTES });

    const outcome = await downloadPdf(
      litResult({ openAccessUrl: 'https://repo.example.org/record/42.pdf' }),
      { policy: 'publisher' },
    );

    expect(outcome.error).toBeNull();
    expect(outcome.via).toBe('doi-landing');
    expect(outcome.sourceUrl).toBe('https://publisher.example/real.pdf');
    expect(requested[1]).toBe('https://repo.example.org/record/42.pdf');
  });

  it('rejects bytes with no %PDF- header', async () => {
    route('https://arxiv.org/pdf/2401.01234', { body: 'just some text, not a document at all' });
    const outcome = await downloadPdf(
      litResult({ source: 'arxiv', id: 'arXiv:2401.01234', doi: null }),
      { policy: 'open-access' },
    );
    expect(outcome.bytes).toBeNull();
    expect(outcome.error).toContain('not a PDF');
  });

  it('aborts an oversized body mid-stream instead of buffering it', async () => {
    let cancelled = false;
    let enqueued = 0;
    const chunk = new Uint8Array(512);
    chunk.set(new TextEncoder().encode('%PDF-1.7'));
    route('https://arxiv.org/pdf/2401.01234', {
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          enqueued += 1;
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        },
      }),
    });

    const outcome = await downloadPdf(
      litResult({ source: 'arxiv', id: 'arXiv:2401.01234', doi: null }),
      { policy: 'open-access', maxBytes: 1024 },
    );

    expect(outcome.bytes).toBeNull();
    expect(outcome.error).toContain('1 KB cap');
    expect(cancelled).toBe(true);
    // 512-byte chunks against a 1 KB cap: the read stops on the third one
    // (the stream may have one chunk pre-queued), nowhere near the whole body.
    expect(enqueued).toBeGreaterThanOrEqual(3);
    expect(enqueued).toBeLessThanOrEqual(5);
  });
});

describe('downloadPdf — honest failure', () => {
  it('names EVERY url tried, why each failed, and the rung it skipped', async () => {
    route('https://arxiv.org/pdf/2401.01234', { status: 403, body: LOGIN_PAGE });
    route('https://repo.example.org/record/42', { body: LOGIN_PAGE });
    route('https://doi.org/10.1086/151605', { status: 404, body: '' });

    const outcome = await downloadPdf(
      litResult({
        source: 'arxiv',
        id: 'arXiv:2401.01234',
        doi: '10.1086/151605',
        openAccessUrl: 'https://repo.example.org/record/42',
      }),
      { policy: 'publisher' },
    );

    expect(outcome.bytes).toBeNull();
    expect(outcome.sourceUrl).toBeNull();
    expect(outcome.via).toBeNull();

    const error = outcome.error ?? '';
    expect(error).toContain('https://arxiv.org/pdf/2401.01234');
    expect(error).toContain('HTTP 403');
    expect(error).toContain('https://repo.example.org/record/42');
    expect(error).toContain('citation_pdf_url');
    expect(error).toContain('https://doi.org/10.1086/151605');
    expect(error).toContain('HTTP 404');
    // The rung that was never attempted is named too, with its reason.
    expect(error).toContain('Not tried:');
    expect(error).toContain('Unpaywall');
    expect(error).toContain('Tried 4 URLs');
  });

  it('reports a 403 as a 403 and states that SUNA does not defeat paywalls', async () => {
    route('https://doi.org/10.1086/151605', { status: 403, body: '' });
    const outcome = await downloadPdf(litResult(), { policy: 'publisher' });
    expect(outcome.error).toContain('HTTP 403');
    expect(outcome.error).toContain('never tries to defeat one');
  });

  it('stops after 3 redirects', async () => {
    route('https://arxiv.org/pdf/2401.01234', {
      status: 302,
      headers: { location: '/a' },
      body: '',
    });
    route('https://arxiv.org/a', { status: 302, headers: { location: '/b' }, body: '' });
    route('https://arxiv.org/b', { status: 302, headers: { location: '/c' }, body: '' });
    route('https://arxiv.org/c', { status: 302, headers: { location: '/d' }, body: '' });

    const outcome = await downloadPdf(
      litResult({ source: 'arxiv', id: 'arXiv:2401.01234', doi: null }),
      { policy: 'open-access' },
    );
    expect(outcome.error).toContain('more than 3 redirects');
    expect(requested).toHaveLength(4);
  });

  it('reports a transport failure verbatim rather than throwing', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const outcome = await downloadPdf(
      litResult({ source: 'arxiv', id: 'arXiv:2401.01234', doi: null }),
      { policy: 'open-access' },
    );
    expect(outcome.error).toContain('fetch failed');
  });

  it('says when Unpaywall has no open copy, naming the API url', async () => {
    route('https://api.unpaywall.org/v2/10.1086/151605?email=ada%40example.org', {
      body: JSON.stringify({ doi: '10.1086/151605', best_oa_location: null }),
    });
    const outcome = await downloadPdf(litResult(), {
      policy: 'open-access',
      mailto: 'ada@example.org',
    });
    expect(outcome.error).toContain('https://api.unpaywall.org/v2/10.1086/151605');
    expect(outcome.error).toContain('best_oa_location.url_for_pdf');
  });

  it("fetches nothing at all under policy 'off'", async () => {
    const outcome = await downloadPdf(litResult({ openAccessUrl: 'https://oa.example/x.pdf' }), {
      policy: 'off',
      mailto: 'ada@example.org',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome.bytes).toBeNull();
    expect(outcome.error).toContain("the download policy is 'off'");
  });

  it('never visits doi.org under the open-access policy', async () => {
    route('https://repo.example.org/record/42', { body: LOGIN_PAGE });
    const outcome = await downloadPdf(
      litResult({ openAccessUrl: 'https://repo.example.org/record/42' }),
      { policy: 'open-access' },
    );
    expect(requested).toEqual([
      'https://api.openalex.org/works/doi:10.1086/151605',
      'https://repo.example.org/record/42',
    ]);
    expect(outcome.error).toContain("the download policy is 'open-access'");
  });
});

/* ---------------------------------------------------- the SSRF perimeter -- */

describe('publicHttpUrlRefusal', () => {
  const refused = [
    'http://127.0.0.1:9200/_cat/indices',
    'http://127.1.2.3/x',
    'https://localhost/paper.pdf',
    'http://kibana.localhost/x',
    'http://printer.local/x',
    'http://0.0.0.0:8080/x',
    'http://10.1.2.3/x',
    'http://172.16.5.4/x',
    'http://172.31.255.255/x',
    'http://192.168.1.5/paper.pdf',
    'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'http://100.64.0.1/x',
    'http://[::1]/x',
    'http://[::]/x',
    'http://[fe80::1]/x',
    'http://[fd00::1]/x',
    'http://[::ffff:127.0.0.1]/x',
    // The URL parser normalizes these to 127.0.0.1 before we ever see them.
    'http://2130706433/x',
    'http://0x7f.1/x',
  ];
  for (const url of refused) {
    it(`refuses ${url}`, () => {
      expect(publicHttpUrlRefusal(url)).not.toBeNull();
    });
  }

  it('refuses a scheme that is not http(s), so data: and file: cannot be fetched', () => {
    expect(publicHttpUrlRefusal('data:application/pdf;base64,JVBERi0=')).toContain('http(s)');
    expect(publicHttpUrlRefusal('file:///etc/passwd')).toContain('http(s)');
  });

  const allowed = [
    'https://arxiv.org/pdf/2401.01234',
    'http://93.184.216.34/paper.pdf',
    'https://localhost.example.org/paper.pdf',
    'https://www.biorxiv.org/content/10.1101/2020.01.01.123456v1.full.pdf',
    'http://[2606:4700::1111]/x',
  ];
  for (const url of allowed) {
    it(`allows ${url}`, () => {
      expect(publicHttpUrlRefusal(url)).toBeNull();
    });
  }
});

describe('downloadPdf — never fetches inward', () => {
  it('refuses a redirect to loopback instead of following it', async () => {
    route('https://arxiv.org/pdf/2401.01234', {
      status: 302,
      headers: { location: 'http://127.0.0.1:9200/secret-admin' },
      body: '',
    });

    const outcome = await downloadPdf(
      litResult({ source: 'arxiv', id: 'arXiv:2401.01234', doi: null }),
      { policy: 'open-access' },
    );

    // The internal endpoint was never contacted — not even to learn its status,
    // which would make the failure report a port scanner.
    expect(requested).toEqual(['https://arxiv.org/pdf/2401.01234']);
    expect(outcome.bytes).toBeNull();
    expect(outcome.error).toContain('127.0.0.1');
    expect(outcome.error).toContain('refused');
  });

  it("refuses a landing page's citation_pdf_url that points at loopback", async () => {
    route('https://doi.org/10.1086/151605', {
      body: '<html><head><meta name="citation_pdf_url" content="http://127.0.0.1:8080/aws-creds"></head></html>',
    });

    const outcome = await downloadPdf(litResult(), { policy: 'publisher' });

    expect(requested).toEqual([
      'https://api.openalex.org/works/doi:10.1086/151605',
      'https://doi.org/10.1086/151605',
    ]);
    expect(outcome.bytes).toBeNull();
    expect(outcome.error).toContain('http://127.0.0.1:8080/aws-creds');
    expect(outcome.error).toContain('refused');
  });

  it("refuses Unpaywall's url_for_pdf when it names the cloud metadata service", async () => {
    const api = 'https://api.unpaywall.org/v2/10.1086/151605?email=ada%40example.org';
    route(api, {
      body: JSON.stringify({
        best_oa_location: { url_for_pdf: 'http://169.254.169.254/latest/meta-data/' },
      }),
    });

    const outcome = await downloadPdf(litResult(), {
      policy: 'open-access',
      mailto: 'ada@example.org',
    });

    expect(requested).toEqual(['https://api.openalex.org/works/doi:10.1086/151605?mailto=ada%40example.org', api]);
    expect(outcome.bytes).toBeNull();
    expect(outcome.error).toContain('169.254.169.254');
  });

  it('refuses a private-range openAccessUrl and carries on down the ladder', async () => {
    route('https://doi.org/10.1086/151605', { body: LOGIN_PAGE });

    const outcome = await downloadPdf(
      litResult({ openAccessUrl: 'http://192.168.1.5/paper.pdf' }),
      { policy: 'publisher' },
    );

    // The private URL was never fetched; the publisher rung still ran.
    expect(requested).toEqual([
      'https://api.openalex.org/works/doi:10.1086/151605',
      'https://doi.org/10.1086/151605',
    ]);
    expect(outcome.bytes).toBeNull();
    expect(outcome.error).toContain('192.168.1.5');
  });

  it('refuses a redirect that leaves http(s) altogether', async () => {
    route('https://arxiv.org/pdf/2401.01234', {
      status: 302,
      headers: { location: 'file:///etc/passwd' },
      body: '',
    });

    const outcome = await downloadPdf(
      litResult({ source: 'arxiv', id: 'arXiv:2401.01234', doi: null }),
      { policy: 'open-access' },
    );

    expect(requested).toEqual(['https://arxiv.org/pdf/2401.01234']);
    expect(outcome.error).toContain('http(s)');
  });
});

/* ------------------------------------------------- one budget per call -- */

/**
 * The clock is driven by hand: each stubbed hop advances fake time by 25 s,
 * which is what a server answering just inside the 20 s hop timeout looks like
 * without anybody waiting for it. The point of these tests is that the hops do
 * NOT each get their own budget — six candidates × two requests × four
 * redirect hops × 20 s is the twelve-minute stall the shared deadline forbids.
 */
describe('downloadPdf — one budget for the whole call', () => {
  function stubSlowFetch(respond: (url: string) => StubResponse): void {
    fetchMock.mockImplementation(async (url: string) => {
      requested.push(url);
      vi.advanceTimersByTime(25_000);
      const stub = respond(url);
      return {
        status: stub.status ?? 200,
        headers: { get: (name: string) => stub.headers?.[name.toLowerCase()] ?? null },
        body: streamOf(stub.body),
      };
    });
  }

  it('stops the ladder once the shared budget is gone, and names the rungs it never reached', async () => {
    vi.useFakeTimers();
    stubSlowFetch(() => ({ status: 404, body: null }));

    const outcome = await downloadPdf(
      litResult({
        source: 'arxiv',
        id: 'arXiv:2401.01234',
        openAccessUrl: 'https://repo.example.org/record/42',
      }),
      { policy: 'publisher', mailto: 'ada@example.org' },
    );

    // Five rungs are planned now; three fit in 60 s at 25 s each, and the two
    // beyond them are reported as untried rather than silently dropped.
    expect(requested).toEqual([
      'https://arxiv.org/pdf/2401.01234',
      'https://api.openalex.org/works/doi:10.1086/151605?mailto=ada%40example.org',
      'https://api.unpaywall.org/v2/10.1086/151605?email=ada%40example.org',
    ]);
    expect(outcome.bytes).toBeNull();
    expect(outcome.error).toContain('Not tried:');
    expect(outcome.error).toContain('https://doi.org/10.1086/151605');
    expect(outcome.error).toContain('60s budget for the whole download ran out');
  });

  it('checks the deadline between redirect hops too, not only between rungs', async () => {
    vi.useFakeTimers();
    stubSlowFetch(() => ({
      status: 302,
      headers: { location: `/hop${requested.length}` },
      body: null,
    }));

    const outcome = await downloadPdf(
      litResult({ source: 'arxiv', id: 'arXiv:2401.01234', doi: null, openAccessUrl: null }),
      { policy: 'open-access' },
    );

    // The 3-redirect ceiling alone would allow four 20 s hops — 80 s inside a
    // 60 s call — so the budget has to cut the chain at three.
    expect(requested).toEqual([
      'https://arxiv.org/pdf/2401.01234',
      'https://arxiv.org/hop1',
      'https://arxiv.org/hop2',
    ]);
    expect(outcome.error).toContain('60s budget for the whole download ran out');
  });

  it("stops on the caller's AbortSignal, and says the cancel is what stopped it", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async (url: string) => {
      requested.push(url);
      controller.abort();
      return { status: 404, headers: { get: () => null }, body: null };
    });

    const outcome = await downloadPdf(
      litResult({
        source: 'arxiv',
        id: 'arXiv:2401.01234',
        openAccessUrl: 'https://repo.example.org/record/42',
      }),
      { policy: 'publisher', mailto: 'ada@example.org', signal: controller.signal },
    );

    expect(requested).toEqual(['https://arxiv.org/pdf/2401.01234']);
    expect(outcome.bytes).toBeNull();
    expect(outcome.error).toContain('cancelled by the caller');
    expect(outcome.error).toContain('https://api.unpaywall.org/v2/10.1086/151605');
  });

  it('fetches nothing at all when the caller hands in an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();

    const outcome = await downloadPdf(litResult(), {
      policy: 'publisher',
      signal: controller.signal,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome.bytes).toBeNull();
    // Not "no PDF URL could be derived" — one was derived, and never fetched.
    expect(outcome.error).toContain('cancelled by the caller');
    expect(outcome.error).not.toContain('could be derived');
  });
});
