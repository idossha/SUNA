import { describe, expect, it } from 'vitest';
import { openAlexMirrorUrls, pdfUrlPlan } from './pdf-fetch.js';
import type { LitResult } from '@suna/core';

/**
 * Hermetic tests for the mirror-first rung. Every fixture below is the real
 * shape returned by api.openalex.org on 2026-08-18, trimmed to the fields the
 * parser reads — so these lock in behaviour that was measured, not imagined.
 * The live counterpart is packages/agent/src/lit-access.probe.test.ts.
 */

const work = (locations: unknown[]): string => JSON.stringify({ locations });

describe('openAlexMirrorUrls', () => {
  it('prefers a mirror over the publisher, which is the whole point', () => {
    // MDPI 10.3390/e23010081: mdpi.com answers 403, arxiv.org answers 200.
    // best_oa_location names mdpi.com, which is why reading only that field
    // made this paper look undownloadable.
    const json = work([
      { is_oa: true, pdf_url: 'https://www.mdpi.com/1099-4300/23/1/81/pdf?version=1610095226' },
      { is_oa: true, pdf_url: 'https://arxiv.org/pdf/2012.11763' },
    ]);
    expect(openAlexMirrorUrls(json).urls).toEqual([
      'https://arxiv.org/pdf/2012.11763',
      'https://www.mdpi.com/1099-4300/23/1/81/pdf?version=1610095226',
    ]);
  });

  it('builds a Europe PMC url for a PMC location that carries no pdf_url', () => {
    // eLife 10.7554/eLife.00013 — every location has pdf_url null, and Europe
    // PMC records the id WITHOUT the "PMC" prefix.
    const json = work([
      { is_oa: true, pdf_url: null, landing_page_url: 'https://doi.org/10.7554/elife.00013' },
      {
        is_oa: true,
        pdf_url: null,
        landing_page_url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/3463246',
      },
    ]);
    expect(openAlexMirrorUrls(json).urls).toEqual([
      'https://europepmc.org/articles/PMC3463246?pdf=render',
    ]);
  });

  it('reads a PMC id whether or not the url spells the prefix', () => {
    const withPrefix = work([
      { is_oa: true, landing_page_url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7102627/' },
    ]);
    expect(openAlexMirrorUrls(withPrefix).urls).toEqual([
      'https://europepmc.org/articles/PMC7102627?pdf=render',
    ]);
  });

  it('skips locations that are not open access', () => {
    const json = work([
      { is_oa: false, pdf_url: 'https://paywalled.example/x.pdf' },
      { is_oa: true, pdf_url: 'https://arxiv.org/pdf/1234.5678' },
    ]);
    expect(openAlexMirrorUrls(json).urls).toEqual(['https://arxiv.org/pdf/1234.5678']);
  });

  it('returns an empty list — not an error — for bronze OA with no mirror', () => {
    // Wiley 10.1111/j.1469-8137.2009.03069.x: the publisher is the ONLY
    // location. Nothing to fall back to is a real answer, and the ladder must
    // still report the publisher url rather than pretending there is none.
    const json = work([
      {
        is_oa: true,
        pdf_url: 'https://onlinelibrary.wiley.com/doi/pdfdirect/10.1111/j.1469-8137.2009.03069.x',
      },
    ]);
    const answer = openAlexMirrorUrls(json);
    expect(answer.error).toBeNull();
    expect(answer.urls).toEqual([
      'https://onlinelibrary.wiley.com/doi/pdfdirect/10.1111/j.1469-8137.2009.03069.x',
    ]);
  });

  it('deduplicates a url that appears as several locations', () => {
    const json = work([
      { is_oa: true, pdf_url: 'https://arxiv.org/pdf/1234.5678' },
      { is_oa: true, pdf_url: 'https://arxiv.org/pdf/1234.5678' },
    ]);
    expect(openAlexMirrorUrls(json).urls).toHaveLength(1);
  });

  it('reports unreadable JSON rather than returning a silent empty list', () => {
    expect(openAlexMirrorUrls('<html>nope</html>').error).toMatch(/could not read/i);
  });

  it('survives a work record with no locations at all', () => {
    const answer = openAlexMirrorUrls(JSON.stringify({}));
    expect(answer.error).toBeNull();
    expect(answer.urls).toEqual([]);
  });
});

describe('pdfUrlPlan — mirror rung ordering', () => {
  const result: LitResult = {
    source: 'openalex',
    id: 'W123',
    doi: '10.3390/e23010081',
    title: 'Time-Rescaling of Dirac Dynamics',
    authors: [],
    year: 2021,
    venue: 'Entropy',
    citedByCount: null,
    openAccessUrl: 'https://www.mdpi.com/1099-4300/23/1/81/article.pdf',
    abstract: null,
  };

  it('asks OpenAlex for every location BEFORE trying the publisher pdf', () => {
    const plan = pdfUrlPlan(result, { policy: 'publisher', mailto: 'a@b.edu' });
    const mirror = plan.candidates.findIndex((c) => c.via === 'openalex-mirror');
    const publisher = plan.candidates.findIndex((c) => c.via === 'open-access-pdf');
    expect(mirror).toBeGreaterThanOrEqual(0);
    expect(publisher).toBeGreaterThanOrEqual(0);
    expect(mirror).toBeLessThan(publisher);
  });

  it('still offers the mirror rung without a mailto — OpenAlex is keyless', () => {
    // Unlike Unpaywall, which is skipped entirely without a contact address.
    const plan = pdfUrlPlan(result, { policy: 'publisher', mailto: null });
    expect(plan.candidates.some((c) => c.via === 'openalex-mirror')).toBe(true);
    expect(plan.candidates.some((c) => c.via === 'unpaywall')).toBe(false);
  });

  it('offers no mirror rung for a record with no DOI', () => {
    const plan = pdfUrlPlan({ ...result, doi: null }, { policy: 'publisher', mailto: 'a@b.edu' });
    expect(plan.candidates.some((c) => c.via === 'openalex-mirror')).toBe(false);
  });

  it("adds nothing when the policy is 'off'", () => {
    const plan = pdfUrlPlan(result, { policy: 'off', mailto: 'a@b.edu' });
    expect(plan.candidates).toEqual([]);
  });
});
