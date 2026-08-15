import { describe, expect, it } from 'vitest';
import type { BibEntry } from './model.js';
import { pdfPathFromFileField, resolvePdfPath } from './pdf.js';

function entry(over: Partial<BibEntry> & Pick<BibEntry, 'key'>): BibEntry {
  return {
    entryType: 'article',
    title: 'On the Infall of Matter into Clusters of Galaxies',
    authors: [{ kind: 'person', family: 'Gunn', given: 'James E.' }],
    year: '1972',
    raw: {},
    ...over,
  };
}

const PROJECT_LISTING = [
  'manuscript/sections/01-introduction.md',
  'references/library.bib',
  'references/gunn1972.pdf',
  'references/Jachym_2019_RamPressure.pdf',
  'references/Gunn_1972_Infall.pdf',
];

describe('resolvePdfPath — file field', () => {
  it('takes the Zotero/JabRef :path:PDF form as project-relative', () => {
    const result = resolvePdfPath(
      entry({ key: 'gunn1972', raw: { file: ':papers/gunn1972.pdf:PDF' } }),
      [],
    );
    expect(result).toEqual({ path: 'papers/gunn1972.pdf', how: 'file-field' });
  });

  it('takes a plain path file field', () => {
    const result = resolvePdfPath(
      entry({ key: 'gunn1972', raw: { file: 'papers/gunn1972.pdf' } }),
      [],
    );
    expect(result).toEqual({ path: 'papers/gunn1972.pdf', how: 'file-field' });
  });

  it('picks the first PDF out of a multi-entry Zotero list', () => {
    const file =
      'Snapshot:storage/QW/page.html:text/html;Full Text PDF:papers/jachym2019.pdf:application/pdf';
    const result = resolvePdfPath(entry({ key: 'jachym2019', raw: { file } }), []);
    expect(result).toEqual({ path: 'papers/jachym2019.pdf', how: 'file-field' });
  });

  it('returns an absolute file field untouched, even with a projectRoot', () => {
    const file = 'Full Text PDF:/Users/ada/Zotero/storage/AB/jachym.pdf:application/pdf';
    const result = resolvePdfPath(entry({ key: 'jachym2019', raw: { file } }), [], {
      projectRoot: '/work/my-paper',
    });
    expect(result).toEqual({
      path: '/Users/ada/Zotero/storage/AB/jachym.pdf',
      how: 'file-field',
    });
  });

  it('joins a relative file field to projectRoot when one is given', () => {
    const result = resolvePdfPath(
      entry({ key: 'gunn1972', raw: { file: ':papers/gunn1972.pdf:PDF' } }),
      [],
      { projectRoot: '/work/my-paper/' },
    );
    expect(result).toEqual({ path: '/work/my-paper/papers/gunn1972.pdf', how: 'file-field' });
  });

  it('falls through to the later rules when the file field holds no PDF', () => {
    const result = resolvePdfPath(
      entry({ key: 'gunn1972', raw: { file: 'Snapshot:storage/QW/page.html:text/html' } }),
      PROJECT_LISTING,
    );
    expect(result).toEqual({ path: 'references/gunn1972.pdf', how: 'citekey' });
  });

  it('reads the field whatever its case', () => {
    const result = resolvePdfPath(entry({ key: 'gunn1972', raw: { File: 'papers/g.pdf' } }), []);
    expect(result?.how).toBe('file-field');
  });
});

describe('resolvePdfPath — citekey', () => {
  it('matches references/<citekey>.pdf', () => {
    const result = resolvePdfPath(entry({ key: 'gunn1972' }), PROJECT_LISTING);
    expect(result).toEqual({ path: 'references/gunn1972.pdf', how: 'citekey' });
  });

  it('matches case-insensitively and returns the listing spelling', () => {
    const result = resolvePdfPath(entry({ key: 'Gunn1972' }), ['references/GUNN1972.PDF']);
    expect(result).toEqual({ path: 'references/GUNN1972.PDF', how: 'citekey' });
  });

  it('does not match a same-named PDF outside references/', () => {
    const result = resolvePdfPath(entry({ key: 'gunn1972', year: undefined }), [
      'papers/gunn1972.pdf',
    ]);
    expect(result).toBeNull();
  });

  it('beats the fuzzy rule when both could match', () => {
    const result = resolvePdfPath(entry({ key: 'gunn1972' }), PROJECT_LISTING);
    expect(result?.path).toBe('references/gunn1972.pdf');
  });
});

describe('resolvePdfPath — fuzzy Author_Year', () => {
  it('matches the Gunn_1972_Infall.pdf convention', () => {
    const result = resolvePdfPath(entry({ key: 'gunn1972a' }), PROJECT_LISTING);
    expect(result).toEqual({ path: 'references/Gunn_1972_Infall.pdf', how: 'fuzzy' });
  });

  it('ASCII-folds an accented family name (Jáchym → Jachym)', () => {
    const result = resolvePdfPath(
      entry({
        key: 'jachym2019',
        year: '2019',
        authors: [{ kind: 'person', family: 'Jáchym', given: 'Pavel' }],
      }),
      PROJECT_LISTING,
    );
    expect(result).toEqual({ path: 'references/Jachym_2019_RamPressure.pdf', how: 'fuzzy' });
  });

  it('is case-insensitive and ignores spaces in the family name', () => {
    const result = resolvePdfPath(
      entry({
        key: 'vdw1950',
        year: '1950',
        authors: [{ kind: 'person', family: 'van der Waals', given: 'Johannes' }],
      }),
      ['references/vanderwaals_1950_forces.pdf'],
    );
    expect(result).toEqual({ path: 'references/vanderwaals_1950_forces.pdf', how: 'fuzzy' });
  });

  it('prefers a references/ hit over one elsewhere in the tree', () => {
    const result = resolvePdfPath(entry({ key: 'gunn1972a' }), [
      'downloads/Gunn_1972_Copy.pdf',
      'references/Gunn_1972_Infall.pdf',
    ]);
    expect(result?.path).toBe('references/Gunn_1972_Infall.pdf');
  });

  it('joins the fuzzy hit to projectRoot when one is given', () => {
    const result = resolvePdfPath(entry({ key: 'gunn1972a' }), PROJECT_LISTING, {
      projectRoot: '/work/my-paper',
    });
    expect(result?.path).toBe('/work/my-paper/references/Gunn_1972_Infall.pdf');
  });

  it('needs a year: an entry without one never matches fuzzily', () => {
    const result = resolvePdfPath(entry({ key: 'gunn', year: undefined }), PROJECT_LISTING);
    expect(result).toBeNull();
  });
});

describe('resolvePdfPath — no match', () => {
  it('returns null when nothing resolves', () => {
    const result = resolvePdfPath(
      entry({
        key: 'schmidt1963',
        year: '1963',
        authors: [{ kind: 'person', family: 'Schmidt', given: 'Maarten' }],
      }),
      PROJECT_LISTING,
    );
    expect(result).toBeNull();
  });

  it('returns null for an empty listing and no file field', () => {
    expect(resolvePdfPath(entry({ key: 'gunn1972' }), [])).toBeNull();
  });

  it('ignores non-PDF listing entries that share the Author_Year prefix', () => {
    const result = resolvePdfPath(entry({ key: 'gunn1972a' }), ['references/Gunn_1972_Notes.md']);
    expect(result).toBeNull();
  });
});

describe('pdfPathFromFileField', () => {
  it('stitches a Windows drive letter back together', () => {
    expect(pdfPathFromFileField(':C:\\Users\\ada\\gunn.pdf:PDF')).toBe('C:\\Users\\ada\\gunn.pdf');
  });

  it('honours escaped separators inside a path', () => {
    expect(pdfPathFromFileField('Text:papers/a\\;b/gunn.pdf:PDF')).toBe('papers/a;b/gunn.pdf');
  });

  it('strips a file:// URI and decodes it', () => {
    expect(pdfPathFromFileField('file:///Users/ada/my%20papers/gunn.pdf')).toBe(
      '/Users/ada/my papers/gunn.pdf',
    );
  });

  it('strips brace/quote wrappers a raw parse may leave behind', () => {
    expect(pdfPathFromFileField('{:papers/gunn1972.pdf:PDF}')).toBe('papers/gunn1972.pdf');
  });

  it('never mistakes the application/pdf MIME type for a path', () => {
    expect(pdfPathFromFileField('Full Text PDF:storage/x.html:application/pdf')).toBeNull();
  });

  it('returns null for an empty field', () => {
    expect(pdfPathFromFileField('')).toBeNull();
  });
});
