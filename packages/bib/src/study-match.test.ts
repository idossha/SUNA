import { describe, expect, it } from 'vitest';
import type { LitResult } from '@suna/core';
import { StudyResolutionSchema } from '@suna/core';
import { mergeCandidates, parseMention, rankCandidates, resolveStudy } from './study-match.js';

/**
 * Pure module, so every test is a plain call: no network, no clock, no disk.
 * The fixture is the paper the plan itself keeps quoting — Gunn & Gott 1972 —
 * so the numbers in the assertions can be checked against a real record.
 */
function result(over: Partial<LitResult> = {}): LitResult {
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

describe('parseMention', () => {
  it('reads the surnames and the year out of a plain-English mention', () => {
    const hints = parseMention('the Gunn & Gott 1972 ram-pressure stripping paper');
    expect(hints.surnames).toEqual(['gunn', 'gott']);
    expect(hints.year).toBe(1972);
    expect(hints.doi).toBeNull();
    expect(hints.arxivId).toBeNull();
    expect(hints.quotedTitle).toBeNull();
    // "paper" is about the act of citing, not about the paper.
    expect(hints.freeWords).toEqual(['ram', 'pressure', 'stripping']);
  });

  it('parses the "and", parenthetical-year and et-al forms', () => {
    expect(parseMention('Gunn and Gott (1972)')).toMatchObject({
      surnames: ['gunn', 'gott'],
      year: 1972,
    });
    expect(parseMention('(Gunn & Gott, 1972a)')).toMatchObject({
      surnames: ['gunn', 'gott'],
      year: 1972,
    });
    expect(parseMention('Jáchym et al. 2019 on stripped tails')).toMatchObject({
      surnames: ['jachym'],
      year: 2019,
    });
    expect(parseMention('Smith, Jones, and Brown 2001')).toMatchObject({
      surnames: ['smith', 'jones', 'brown'],
      year: 2001,
    });
  });

  it('drops lone initials but keeps a particled surname whole', () => {
    expect(parseMention('Gunn, J. E. & Gott, J. R. 1972').surnames).toEqual(['gunn', 'gott']);
    expect(parseMention('van der Waals and Boltzmann 1873').surnames).toEqual([
      'vanderwaals',
      'boltzmann',
    ]);
  });

  it('does not read an unquoted title-cased phrase as a list of authors', () => {
    const hints = parseMention('Ram-Pressure Stripping in the Virgo Cluster');
    expect(hints.surnames).toEqual([]);
    expect(hints.freeWords).toEqual(['ram', 'pressure', 'stripping', 'virgo', 'cluster']);
  });

  it('takes a DOI in every shape prose writes it, punctuation trimmed', () => {
    expect(parseMention('https://doi.org/10.1086/151605').doi).toBe('10.1086/151605');
    expect(parseMention('see doi: 10.1086/151605.').doi).toBe('10.1086/151605');
    expect(parseMention('(10.1086/151605)').doi).toBe('10.1086/151605');
    // A DOI's own balanced parentheses survive; the sentence's do not.
    expect(parseMention('10.1002/(SICI)1097-0258(19980315)17:5').doi).toBe(
      '10.1002/(sici)1097-0258(19980315)17:5',
    );
  });

  it('keeps a SICI DOI whole — angle brackets and all', () => {
    // Wiley's shape for its entire 1996-2004 back catalogue, and the DOI
    // Handbook's own example. Truncating at the '<' did not just shorten the
    // identifier: the tail became a bogus year and bogus title words, and the
    // truncated string became the whole provider query.
    const sici = '10.1002/(SICI)1097-0258(19980815)17:15<1661::AID-SIM968>3.0.CO;2-2';
    const hints = parseMention(sici);
    expect(hints.doi).toBe(sici.toLowerCase());
    expect(hints.year).toBeNull();
    expect(hints.freeWords).toEqual([]);
    expect(parseMention(`see https://doi.org/${sici} for the method`).doi).toBe(
      sici.toLowerCase(),
    );
  });

  it('drops the angle brackets of the RFC 3986 <URL> wrapper', () => {
    expect(parseMention('<https://doi.org/10.1086/151605>').doi).toBe('10.1086/151605');
  });

  it('recognizes arXiv ids in the arXiv:, arxiv.org and 10.48550 forms', () => {
    expect(parseMention('arXiv:2401.01234v2').arxivId).toBe('2401.01234');
    expect(parseMention('https://arxiv.org/abs/astro-ph/9901234').arxivId).toBe(
      'astro-ph/9901234',
    );
    const both = parseMention('10.48550/arXiv.2401.01234');
    expect(both.doi).toBe('10.48550/arxiv.2401.01234');
    expect(both.arxivId).toBe('2401.01234');
  });

  it('hints on the first identifier and keeps every other one out of the free words', () => {
    const hints = parseMention('arXiv 2401.01234 and arXiv:2402.00002');
    expect(hints.arxivId).toBe('2401.01234');
    expect(hints.freeWords).toEqual([]);
  });

  it('keeps a quoted title out of the surname and year scan', () => {
    const hints = parseMention('"The 1987A supernova" by Arnett 1989');
    expect(hints.quotedTitle).toBe('The 1987A supernova');
    expect(hints.surnames).toEqual(['arnett']);
    expect(hints.year).toBe(1989);
  });

  it('returns empty hints — never a throw — for prose with nothing citable in it', () => {
    expect(parseMention('find that ram pressure paper')).toEqual({
      doi: null,
      arxivId: null,
      surnames: [],
      year: null,
      quotedTitle: null,
      freeWords: ['ram', 'pressure'],
    });
    expect(parseMention('')).toEqual({
      doi: null,
      arxivId: null,
      surnames: [],
      year: null,
      quotedTitle: null,
      freeWords: [],
    });
  });
});

describe('mergeCandidates', () => {
  it('dedupes on the normalized DOI and keeps the record with the open-access URL', () => {
    const fromCrossref = result({
      source: 'crossref',
      doi: 'https://doi.org/10.1086/151605',
      abstract: 'Infall onto clusters.',
    });
    const fromOpenAlex = result({
      source: 'openalex',
      id: 'W2016',
      doi: '10.1086/151605',
      openAccessUrl: 'https://articles.adsabs.harvard.edu/pdf/1972ApJ.pdf',
    });

    const merged = mergeCandidates({ crossref: [fromCrossref], openalex: [fromOpenAlex] });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe('openalex');
    expect(merged[0]?.doi).toBe('10.1086/151605');
    expect(merged[0]?.openAccessUrl).toBe('https://articles.adsabs.harvard.edu/pdf/1972ApJ.pdf');
    // nothing the poorer record knew is thrown away
    expect(merged[0]?.abstract).toBe('Infall onto clusters.');
  });

  it('ties a preprint to its published version through the arXiv id alone', () => {
    const preprint = result({
      source: 'arxiv',
      id: 'arXiv:2401.01234',
      doi: null,
      title: 'Molecular gas in a stripped tail',
      venue: 'arXiv',
      citedByCount: null,
      openAccessUrl: 'https://arxiv.org/abs/2401.01234v2',
      abstract: 'A preprint abstract.',
    });
    const published = result({
      source: 'crossref',
      id: '10.1093/mnras/stae123',
      doi: '10.1093/mnras/stae123',
      title: 'Molecular gas in a stripped tail of a Coma galaxy',
      venue: 'Monthly Notices of the Royal Astronomical Society',
      citedByCount: 4,
      openAccessUrl: 'https://arxiv.org/abs/2401.01234',
    });

    const merged = mergeCandidates({ arxiv: [preprint], crossref: [published] });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.doi).toBe('10.1093/mnras/stae123');
    expect(merged[0]?.title).toBe('Molecular gas in a stripped tail of a Coma galaxy');
    expect(merged[0]?.abstract).toBe('A preprint abstract.');
  });

  it('falls back to the folded title when neither record carries an identifier', () => {
    const loud = result({
      source: 'openalex',
      id: 'W1',
      doi: null,
      title: 'Ram-pressure stripping!',
      citedByCount: 12,
    });
    const braced = result({
      source: 'crossref',
      id: 'C1',
      doi: null,
      title: '{Ram pressure stripping}',
      citedByCount: null,
      openAccessUrl: 'https://example.org/stripping.pdf',
    });

    const merged = mergeCandidates({ openalex: [loud], crossref: [braced] });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.citedByCount).toBe(12);
  });

  it('carries an identifier learned from one merge forward to later records', () => {
    const titleOnly = result({
      source: 'crossref',
      id: 'C1',
      doi: null,
      title: 'Ram pressure stripping',
    });
    const withDoi = result({
      source: 'openalex',
      id: 'W1',
      doi: '10.1/rps',
      title: 'Ram-pressure stripping',
    });
    const variantTitle = result({
      source: 'biorxiv',
      id: 'B1',
      doi: '10.1/rps',
      title: 'Ram pressure stripping in clusters',
    });

    // the DOI reaches the first bucket only through the record that merged into it
    const merged = mergeCandidates({
      crossref: [titleOnly],
      openalex: [withDoi],
      biorxiv: [variantTitle],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.doi).toBe('10.1/rps');
  });

  it('keeps genuinely different works apart, in the order the providers gave them', () => {
    const other = result({
      id: '10.1086/999999',
      doi: '10.1086/999999',
      title: 'A different paper entirely',
    });

    const merged = mergeCandidates({ crossref: [result(), other] });

    expect(merged.map((candidate) => candidate.id)).toEqual(['10.1086/151605', '10.1086/999999']);
  });
});

describe('rankCandidates', () => {
  it('never lets citedByCount outrank a better title match', () => {
    const hints = parseMention('"Ram pressure stripping in the Virgo cluster"');
    const exact = result({
      id: 'W-exact',
      doi: '10.1/exact',
      title: 'Ram pressure stripping in the Virgo cluster',
      authors: [],
      year: null,
      citedByCount: 1,
    });
    const popular = result({
      id: 'W-popular',
      doi: '10.1/popular',
      title: 'Ram pressure stripping in the Coma cluster and beyond',
      authors: [],
      year: null,
      citedByCount: 99_999,
    });

    const ranked = rankCandidates(hints, [popular, exact]);

    expect(ranked.map((candidate) => candidate.result.id)).toEqual(['W-exact', 'W-popular']);
    expect(ranked[0]?.titleSimilarity).toBe(1);
  });

  it('uses citedByCount to break an otherwise exact tie', () => {
    const hints = parseMention('"ram pressure stripping"');
    const quiet = result({
      id: 'W-quiet',
      doi: '10.1/quiet',
      title: 'Ram pressure stripping',
      authors: [],
      year: null,
      citedByCount: 5,
    });
    const loud = result({
      id: 'W-loud',
      doi: '10.1/loud',
      title: 'Ram pressure stripping',
      authors: [],
      year: null,
      citedByCount: 500,
    });

    const ranked = rankCandidates(hints, [quiet, loud]);

    expect(ranked.map((candidate) => candidate.result.id)).toEqual(['W-loud', 'W-quiet']);
  });

  it('matches a particled surname against the author’s whole display name', () => {
    const hints = parseMention('van der Waals 1873 equation of state');
    const waals = result({
      id: 'W-waals',
      doi: '10.1/waals',
      title: 'Over de continuïteit van den gas- en vloeistoftoestand',
      authors: ['Johannes Diderik van der Waals'],
      year: 1873,
    });
    const other = result({
      id: 'W-other',
      doi: '10.1/other',
      title: 'A completely unrelated result',
      authors: ['Jane Roe'],
      year: 1873,
    });

    const ranked = rankCandidates(hints, [other, waals]);

    // both match the year; only one matches the author, and "Waals" alone is
    // the last token of a name the mention wrote out in full
    expect(ranked.map((candidate) => candidate.result.id)).toEqual(['W-waals', 'W-other']);
  });

  it('flags the identifier hit as decisive and sorts it ahead of the field', () => {
    const ranked = rankCandidates(parseMention('10.1086/151605'), [
      result({ id: 'W-other', doi: '10.9999/other', title: 'Something else', citedByCount: 99_999 }),
      result(),
    ]);

    expect(ranked[0]?.decisive).toBe(true);
    expect(ranked[0]?.result.doi).toBe('10.1086/151605');
    expect(ranked[1]?.decisive).toBe(false);
  });
});

describe('resolveStudy', () => {
  it('lets a DOI hint win outright, even against a better title match', () => {
    const hints = parseMention('"Ram pressure stripping in the Virgo cluster" 10.1086/151605');
    const betterTitle = result({
      id: 'W-title',
      doi: '10.9999/other',
      title: 'Ram pressure stripping in the Virgo cluster',
      citedByCount: 99_999,
    });

    const resolution = resolveStudy(hints, [betterTitle, result()], {
      providersTried: ['crossref', 'openalex'],
      errors: [],
    });

    expect(resolution.chosen?.doi).toBe('10.1086/151605');
    expect(resolution.confidence).toBe('high');
    expect(resolution.alternatives.map((candidate) => candidate.id)).toEqual(['W-title']);
    expect(() => StudyResolutionSchema.parse(resolution)).not.toThrow();
  });

  it('takes the DOI holder when the mention is nothing but the DOI', () => {
    const popular = result({
      id: 'W-popular',
      doi: '10.9999/other',
      title: 'A much more popular paper',
      citedByCount: 99_999,
    });

    const resolution = resolveStudy(parseMention('10.1086/151605'), [popular, result()]);

    expect(resolution.chosen?.id).toBe('10.1086/151605');
    expect(resolution.confidence).toBe('high');
  });

  it('treats an arXiv id as decisive, whatever version suffix either side carries', () => {
    const preprint = result({
      source: 'arxiv',
      id: 'arXiv:2401.01234v2',
      doi: null,
      title: 'Molecular gas in a stripped tail',
      openAccessUrl: 'https://arxiv.org/abs/2401.01234v2',
    });
    const decoy = result({
      id: 'W-decoy',
      doi: '10.1/decoy',
      title: 'Molecular gas in a stripped tail',
      citedByCount: 99_999,
    });

    const resolution = resolveStudy(parseMention('arXiv:2401.01234'), [decoy, preprint], {
      providersTried: ['arxiv', 'crossref'],
      errors: [],
    });

    expect(resolution.chosen?.id).toBe('arXiv:2401.01234v2');
    expect(resolution.confidence).toBe('high');
  });

  it('refuses to choose between two near-identical candidates and returns both', () => {
    const hints = parseMention('"Ram pressure stripping in the cluster"');
    const virgo = result({
      id: 'W-virgo',
      doi: '10.1/virgo',
      title: 'Ram pressure stripping in the Virgo cluster',
    });
    const coma = result({
      id: 'W-coma',
      doi: '10.1/coma',
      title: 'Ram pressure stripping in the Coma cluster',
    });

    const resolution = resolveStudy(hints, [virgo, coma], {
      providersTried: ['crossref'],
      errors: [],
    });

    // the plan's fifth outcome: matched too closely to choose, never papered over
    expect(resolution.chosen).toBeNull();
    expect(resolution.confidence).toBe('low');
    expect(resolution.alternatives.map((candidate) => candidate.id)).toEqual([
      'W-virgo',
      'W-coma',
    ]);
    expect(() => StudyResolutionSchema.parse(resolution)).not.toThrow();
  });

  it('resolves on the title alone when the mention carries no year', () => {
    const hints = parseMention('"On the infall of matter into clusters of galaxies"');
    expect(hints.year).toBeNull();
    expect(hints.surnames).toEqual([]);

    const other = result({
      id: 'W-other',
      doi: '10.1/other',
      title: 'Ram pressure stripping of galaxies in clusters',
      authors: ['Jane Roe'],
    });
    const resolution = resolveStudy(hints, [other, result()], {
      providersTried: ['crossref'],
      errors: [],
    });

    expect(resolution.chosen?.id).toBe('10.1086/151605');
    expect(resolution.confidence).toBe('high');
    expect(resolution.alternatives.map((candidate) => candidate.id)).toEqual(['W-other']);
  });

  it('prefers the year the mention gave, and still reports low without a title', () => {
    const later = result({
      id: 'W-1980',
      doi: '10.1/1980',
      title: 'A later paper by the same pair',
      year: 1980,
    });

    const resolution = resolveStudy(parseMention('Gunn & Gott 1972'), [later, result()], {
      providersTried: ['crossref'],
      errors: [],
    });

    expect(resolution.chosen?.id).toBe('10.1086/151605');
    expect(resolution.confidence).toBe('low');
    expect(resolution.alternatives.map((candidate) => candidate.id)).toEqual(['W-1980']);
  });

  it('still matches a title made entirely of function words', () => {
    const hamlet = result({ id: 'W-hamlet', doi: '10.1/hamlet', title: 'To Be or Not to Be' });
    const other = result({ id: 'W-other', doi: '10.1/other', title: 'All or Nothing' });

    const resolution = resolveStudy(parseMention('"To be or not to be"'), [hamlet, other], {
      providersTried: ['crossref'],
      errors: [],
    });

    // every word of that title is a stopword; dropping them would leave the
    // mention with no tokens at all and score every candidate at 0
    expect(resolution.chosen?.id).toBe('W-hamlet');
    expect(resolution.confidence).toBe('high');
  });

  it('pushes a candidate a decade off the mentioned year below a thinner author match', () => {
    const rightYear = result({
      id: 'W-1972',
      doi: '10.1/1972',
      authors: ['James E. Gunn'],
      year: 1972,
    });
    const wrongYear = result({
      id: 'W-1990',
      doi: '10.1/1990',
      title: 'A much later paper by the same pair',
      year: 1990,
    });

    const resolution = resolveStudy(parseMention('Gunn & Gott 1972'), [rightYear, wrongYear], {
      providersTried: ['crossref'],
      errors: [],
    });

    // wrongYear matches both surnames and rightYear only one, so without the
    // mismatch penalty the two would tie and nothing could be chosen at all
    expect(resolution.chosen?.id).toBe('W-1972');
  });

  it('still returns the best guess, marked low, when the title match is thin', () => {
    const tail = result({
      id: 'W-tail',
      doi: '10.1/tail',
      title: 'Molecular gas in a stripped tail',
    });

    const resolution = resolveStudy(parseMention('that ram pressure paper'), [tail], {
      providersTried: ['crossref'],
      errors: [],
    });

    expect(resolution.chosen?.id).toBe('W-tail');
    expect(resolution.confidence).toBe('low');
    expect(resolution.alternatives).toEqual([]);
  });

  it('reports a null choice with the provider failures intact when nothing matched', () => {
    const resolution = resolveStudy(parseMention('a paper nobody indexed'), [], {
      providersTried: ['crossref', 'openalex', '  ', 'crossref'],
      errors: ['openalex search failed — HTTP 429.', ''],
    });

    expect(resolution.chosen).toBeNull();
    expect(resolution.confidence).toBe('low');
    expect(resolution.alternatives).toEqual([]);
    // blanks and repeats are dropped, or the schema's .min(1) would reject the answer
    expect(resolution.providersTried).toEqual(['crossref', 'openalex']);
    expect(resolution.errors).toEqual(['openalex search failed — HTTP 429.']);
    expect(() => StudyResolutionSchema.parse(resolution)).not.toThrow();
  });

  it('answers with empty bookkeeping when the caller passes no context', () => {
    const resolution = resolveStudy(parseMention('10.1086/151605'), [result()]);

    expect(resolution.providersTried).toEqual([]);
    expect(resolution.errors).toEqual([]);
    expect(() => StudyResolutionSchema.parse(resolution)).not.toThrow();
  });
});
