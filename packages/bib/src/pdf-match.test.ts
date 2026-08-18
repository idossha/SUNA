import { describe, expect, it } from 'vitest';
import { PdfMatchSchema, type LitResult } from '@suna/core';
import { rankPdfCandidates, scorePdfCandidate } from './pdf-match.js';

/** Latin-1 encode, the way the scanner's 256 KB read arrives here. */
function bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

const gunn: LitResult = {
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
};

const aartsen: LitResult = {
  source: 'crossref',
  id: '10.1038/nphys4278',
  doi: '10.1038/nphys4278',
  title: 'Multimessenger observations of high-energy neutrinos',
  authors: ['M. G. Aartsen', 'M. Ackermann'],
  year: 2017,
  venue: 'Nature Physics',
  citedByCount: 412,
  openAccessUrl: null,
  abstract: null,
};

const lovelace: LitResult = {
  source: 'arxiv',
  id: 'arXiv:2401.01234',
  doi: null,
  title: 'Notes on the analytical engine',
  authors: ['Ada Lovelace'],
  year: 2024,
  venue: 'arXiv',
  citedByCount: null,
  openAccessUrl: 'https://arxiv.org/abs/2401.01234',
  abstract: null,
};

const oldPreprint: LitResult = {
  ...lovelace,
  id: 'arXiv:astro-ph/0601001',
  openAccessUrl: 'https://arxiv.org/abs/astro-ph/0601001',
};

const waals: LitResult = {
  source: 'crossref',
  id: 'w-1950',
  doi: null,
  title: 'On the continuity of the gaseous and liquid states',
  authors: ['Johannes van der Waals'],
  year: 1950,
  venue: null,
  citedByCount: null,
  openAccessUrl: null,
  abstract: null,
};

/** The XMP packet a publisher stamps into the front of the file, uncompressed. */
const GUNN_XMP = bytes(
  '%PDF-1.6\n<?xpacket begin=""?><x:xmpmeta><rdf:RDF><rdf:Description>' +
    '<prism:doi>10.1086/151605</prism:doi>' +
    '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>\n',
);

/** Same shape, but it is a different paper's metadata. */
const AARTSEN_XMP = bytes(
  '%PDF-1.6\n<?xpacket begin=""?><x:xmpmeta><rdf:RDF><rdf:Description>' +
    '<prism:doi>10.1038/nphys4278</prism:doi>' +
    '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>\n',
);

/** Title in the text layer, no identifier anywhere. */
const GUNN_TEXT_ONLY = bytes(
  '%PDF-1.4\nBT (On the Infall of Matter into Clusters of Galaxies) Tj ET\n',
);

describe('scorePdfCandidate — filename identifiers', () => {
  it('reads a DOI whose slash became an underscore', () => {
    expect(scorePdfCandidate(gunn, { path: '/Users/ada/Downloads/10.1086_151605.pdf' })).toEqual({
      evidence: ['filename-doi'],
      confidence: 'medium',
    });
  });

  it('reads a DOI whose slash became a hyphen', () => {
    expect(scorePdfCandidate(gunn, { path: '/Users/ada/Downloads/10.1086-151605.pdf' })).toEqual({
      evidence: ['filename-doi'],
      confidence: 'medium',
    });
  });

  it('reads a DOI sharded across a directory and its file', () => {
    expect(scorePdfCandidate(gunn, { path: '/Users/ada/papers/10.1086/151605.pdf' })).toEqual({
      evidence: ['filename-doi'],
      confidence: 'medium',
    });
  });

  it('refuses a DOI that is only a digit-prefix of the name', () => {
    const shorter: LitResult = { ...gunn, id: '10.1086/1516', doi: '10.1086/1516' };
    expect(scorePdfCandidate(shorter, { path: '/Users/ada/Downloads/10.1086_151605.pdf' })).toBeNull();
  });

  it('ignores a doi field that is not shaped like a DOI', () => {
    const junk: LitResult = { ...gunn, doi: 'not-a-doi' };
    expect(scorePdfCandidate(junk, { path: '/Users/ada/Downloads/not-a-doi.pdf' })).toBeNull();
  });

  it('reads a modern arXiv id across a version suffix', () => {
    expect(scorePdfCandidate(lovelace, { path: '/Users/ada/Downloads/arXiv-2401.01234v2.pdf' })).toEqual(
      { evidence: ['filename-arxiv-id'], confidence: 'medium' },
    );
  });

  it('refuses an arXiv id that is only a digit-prefix of the name', () => {
    expect(scorePdfCandidate(lovelace, { path: '/Users/ada/Downloads/2401.012345.pdf' })).toBeNull();
  });

  it('reads an old-style arXiv id whose slash became an underscore', () => {
    expect(scorePdfCandidate(oldPreprint, { path: '/lib/astro-ph_0601001.pdf' })).toEqual({
      evidence: ['filename-arxiv-id'],
      confidence: 'medium',
    });
  });
});

describe('scorePdfCandidate — filename author, year and title', () => {
  it('reads the Author_Year_Word convention', () => {
    expect(scorePdfCandidate(gunn, { path: '/Users/ada/Papers/Gunn_1972_Infall.pdf' })).toEqual({
      evidence: ['filename-author-year'],
      confidence: 'medium',
    });
  });

  it("reads Zotero's Author - Year - Title form", () => {
    const path =
      '/Users/ada/Zotero/storage/AB/Gunn and Gott - 1972 - On the infall of matter into clusters of galaxies.pdf';
    expect(scorePdfCandidate(gunn, { path })).toEqual({
      evidence: ['filename-author-year', 'filename-title-words'],
      confidence: 'medium',
    });
  });

  it("reads Zotero's Author et al. - Year - Title form", () => {
    const path =
      '/Users/ada/Zotero/storage/CD/Aartsen et al. - 2017 - Multimessenger observations of high-energy neutrinos.pdf';
    expect(scorePdfCandidate(aartsen, { path })).toEqual({
      evidence: ['filename-author-year', 'filename-title-words'],
      confidence: 'medium',
    });
  });

  it('reads the run-together citekey form, where a digit abuts the surname', () => {
    expect(scorePdfCandidate(gunn, { path: '/Users/ada/Papers/gunn1972infall.pdf' })).toEqual({
      evidence: ['filename-author-year'],
      confidence: 'medium',
    });
  });

  it('reads a surname carrying its particles, joined or spaced', () => {
    const joined = scorePdfCandidate(waals, { path: '/lib/vanderwaals_1950_forces.pdf' });
    const spaced = scorePdfCandidate(waals, {
      path: '/lib/van der Waals - 1950 - On the continuity.pdf',
    });
    expect(joined?.evidence).toContain('filename-author-year');
    expect(spaced?.evidence).toContain('filename-author-year');
  });

  it('does not mistake a longer surname for the one it wants', () => {
    expect(scorePdfCandidate(gunn, { path: '/lib/Gunning_1972_Something.pdf' })).toBeNull();
  });

  it('needs the year as its own number, not a slice of a timestamp', () => {
    expect(scorePdfCandidate(gunn, { path: '/lib/Gunn_19720104_scan.pdf' })).toBeNull();
  });

  it('takes title words alone no higher than low', () => {
    const path = '/Users/ada/Downloads/infall-of-matter-into-clusters-of-galaxies.pdf';
    expect(scorePdfCandidate(gunn, { path })).toEqual({
      evidence: ['filename-title-words'],
      confidence: 'low',
    });
  });

  it('needs more than one title word to call it a title match', () => {
    expect(scorePdfCandidate(gunn, { path: '/Users/ada/Downloads/galaxies.pdf' })).toBeNull();
  });

  it('reads the extension whatever its case, and never as a title word', () => {
    expect(scorePdfCandidate(gunn, { path: '/Users/ada/Papers/GUNN_1972_INFALL.PDF' })).toEqual({
      evidence: ['filename-author-year'],
      confidence: 'medium',
    });
  });

  it('does not take the enclosing folder as evidence about the file', () => {
    expect(scorePdfCandidate(gunn, { path: '/Users/ada/Gunn 1972 infall matter/scan.pdf' })).toBeNull();
  });
});

describe('scorePdfCandidate — byte evidence', () => {
  it('lifts a filename-only candidate to high when the bytes carry the DOI', () => {
    const path = '/Users/ada/Papers/Gunn_1972_Infall.pdf';
    expect(scorePdfCandidate(gunn, { path })).toEqual({
      evidence: ['filename-author-year'],
      confidence: 'medium',
    });
    expect(scorePdfCandidate(gunn, { path, bytesSample: GUNN_XMP })).toEqual({
      evidence: ['doi-in-bytes', 'filename-author-year'],
      confidence: 'high',
    });
  });

  it('reaches high on the DOI alone, with nothing in the name to go on', () => {
    const scored = scorePdfCandidate(gunn, {
      path: '/Users/ada/Downloads/scan-0042.pdf',
      bytesSample: GUNN_XMP,
    });
    expect(scored).toEqual({ evidence: ['doi-in-bytes'], confidence: 'high' });
  });

  it('does not match a PDF whose bytes name a different DOI', () => {
    expect(
      scorePdfCandidate(gunn, {
        path: '/Users/ada/Downloads/scan-0042.pdf',
        bytesSample: AARTSEN_XMP,
      }),
    ).toBeNull();
  });

  it('reads an arXiv id out of the text layer', () => {
    const sample = bytes('%PDF-1.5\nBT (arXiv:2401.01234v2 [cs.LG] 3 Jan 2024) Tj ET\n');
    expect(scorePdfCandidate(lovelace, { path: '/lib/download.pdf', bytesSample: sample })).toEqual({
      evidence: ['arxiv-id-in-bytes'],
      confidence: 'high',
    });
  });

  it('holds a title found only in the bytes at medium, uncorroborated', () => {
    expect(
      scorePdfCandidate(gunn, {
        path: '/Users/ada/Downloads/scan-0042.pdf',
        bytesSample: GUNN_TEXT_ONLY,
      }),
    ).toEqual({ evidence: ['title-in-bytes'], confidence: 'medium' });
  });

  it('lifts that same title to high once the filename agrees', () => {
    expect(
      scorePdfCandidate(gunn, {
        path: '/Users/ada/Papers/Gunn_1972_Infall.pdf',
        bytesSample: GUNN_TEXT_ONLY,
      }),
    ).toEqual({
      evidence: ['title-in-bytes', 'filename-author-year'],
      confidence: 'high',
    });
  });

  it('treats an empty sample as "not read yet", not as a failed read', () => {
    const path = '/Users/ada/Papers/Gunn_1972_Infall.pdf';
    expect(scorePdfCandidate(gunn, { path, bytesSample: new Uint8Array(0) })).toEqual(
      scorePdfCandidate(gunn, { path, bytesSample: null }),
    );
  });

  it("takes Spotlight's DOI content hit as byte-level evidence", () => {
    expect(
      scorePdfCandidate(gunn, {
        path: '/Users/ada/Zotero/storage/AB/Full Text.pdf',
        spotlightContentHit: 'doi',
      }),
    ).toEqual({ evidence: ['spotlight-content-hit'], confidence: 'high' });
  });

  it("grades Spotlight's TITLE hit as title-in-bytes, not as a decisive hit", () => {
    // A citing paper, a review's reference list and a syllabus all carry the
    // title verbatim in their text, so Spotlight matching on the title is
    // exactly `title-in-bytes` and carries its rule: medium alone.
    expect(
      scorePdfCandidate(gunn, {
        path: '/Users/ada/Downloads/Some_Review_2020.pdf',
        spotlightContentHit: 'title',
      }),
    ).toEqual({ evidence: ['title-in-bytes'], confidence: 'medium' });
  });

  it("lets Spotlight's title hit reach high once the name corroborates it", () => {
    expect(
      scorePdfCandidate(gunn, {
        path: '/Users/ada/Papers/Gunn_1972_Infall.pdf',
        spotlightContentHit: 'title',
      }),
    ).toEqual({
      evidence: ['title-in-bytes', 'filename-author-year'],
      confidence: 'high',
    });
  });

  it('returns evidence in the canonical PDF_EVIDENCE_IDS order', () => {
    const path =
      '/Users/ada/Zotero/storage/AB/Gunn and Gott - 1972 - On the infall of matter into clusters of galaxies.pdf';
    const scored = scorePdfCandidate(gunn, {
      path,
      bytesSample: GUNN_XMP,
      spotlightContentHit: 'doi',
    });
    expect(scored?.evidence).toEqual([
      'doi-in-bytes',
      'filename-author-year',
      'filename-title-words',
      'spotlight-content-hit',
    ]);
  });
});

describe('scorePdfCandidate — nothing to go on', () => {
  it('returns null rather than an empty evidence list', () => {
    expect(scorePdfCandidate(gunn, { path: '/Users/ada/Downloads/tax-return-2019.pdf' })).toBeNull();
  });

  it('survives a result with no DOI, no year and no authors', () => {
    const bare: LitResult = { ...gunn, doi: null, year: null, authors: [], openAccessUrl: null };
    expect(scorePdfCandidate(bare, { path: '/Users/ada/Downloads/scan.pdf' })).toBeNull();
    expect(
      scorePdfCandidate(bare, { path: '/lib/infall-matter-clusters-galaxies.pdf' })?.confidence,
    ).toBe('low');
  });
});

describe('rankPdfCandidates', () => {
  const byteVerified = {
    path: '/Users/ada/Downloads/scan-0042.pdf',
    bytesSample: GUNN_XMP,
  };
  const filenameOnly = { path: '/Users/ada/Papers/Gunn_1972_Infall.pdf' };
  const titleWordsOnly = {
    path: '/Users/ada/Downloads/infall-of-matter-into-clusters-of-galaxies.pdf',
  };
  const unrelated = { path: '/Users/ada/Downloads/tax-return-2019.pdf' };

  it('puts the byte-verified candidate above the filename-only one', () => {
    const ranked = rankPdfCandidates(gunn, [filenameOnly, titleWordsOnly, byteVerified]);
    expect(ranked.map((match) => match.path)).toEqual([
      byteVerified.path,
      filenameOnly.path,
      titleWordsOnly.path,
    ]);
    expect(ranked.map((match) => match.confidence)).toEqual(['high', 'medium', 'low']);
  });

  it('drops candidates that matched nothing instead of ranking them last', () => {
    const ranked = rankPdfCandidates(gunn, [unrelated, filenameOnly]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.path).toBe(filenameOnly.path);
  });

  it('answers with an empty list when no file on the machine looks like the paper', () => {
    expect(rankPdfCandidates(gunn, [unrelated])).toEqual([]);
  });

  it('breaks a dead heat by path, so the walk order cannot change the answer', () => {
    const a = { path: '/a/Gunn_1972_Infall.pdf' };
    const z = { path: '/z/Gunn_1972_Infall.pdf' };
    expect(rankPdfCandidates(gunn, [z, a]).map((match) => match.path)).toEqual([a.path, z.path]);
    expect(rankPdfCandidates(gunn, [a, z]).map((match) => match.path)).toEqual([a.path, z.path]);
  });

  it('outranks stronger filename evidence within a tier', () => {
    const doiNamed = { path: '/Users/ada/Downloads/10.1086_151605.pdf' };
    const ranked = rankPdfCandidates(gunn, [filenameOnly, doiNamed]);
    expect(ranked.map((match) => match.path)).toEqual([doiNamed.path, filenameOnly.path]);
  });

  it('yields exactly a PdfMatch once the host adds the size it stat()ed', () => {
    const ranked = rankPdfCandidates(gunn, [byteVerified]);
    const first = ranked[0];
    expect(first).toBeDefined();
    expect(PdfMatchSchema.parse({ ...first, sizeBytes: 184_320 })).toEqual({
      path: byteVerified.path,
      sizeBytes: 184_320,
      confidence: 'high',
      evidence: ['doi-in-bytes'],
    });
  });
});
