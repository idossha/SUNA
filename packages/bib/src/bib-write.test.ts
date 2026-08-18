import { describe, expect, it } from 'vitest'
import type { LitResult } from '@suna/core'
import type { BibEntry } from './model.js'
import { parseBibtex } from './parse.js'
import { resolvePdfPath } from './pdf.js'
import { serializeBibtex } from './serialize.js'
import { appendLitResultToBib, findExistingKey, removeEntryFromBib } from './bib-write.js'

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
  abstract: null
}

const EXISTING = `@article{gunn1972infall,
  title = {Some other paper},
  year = {1999}
}
`

describe('appendLitResultToBib', () => {
  it('appends a new entry to an empty file', () => {
    const outcome = appendLitResultToBib('', gunn)
    expect(outcome.key).toBe('gunn1972infall')
    expect(outcome.text).toContain('@article{gunn1972infall,')
    expect(outcome.text).toContain('title = {On the infall of matter into clusters of galaxies}')
    expect(outcome.parseErrors).toEqual([])
  })

  it('dedupes the key against an entry already in the file, appending after it untouched', () => {
    const outcome = appendLitResultToBib(EXISTING, gunn)
    expect(outcome.key).toBe('gunn1972infalla')
    // the original entry's exact text survives byte-for-byte
    expect(outcome.text.startsWith(EXISTING.trimEnd())).toBe(true)
    expect(outcome.text).toContain('@article{gunn1972infalla,')
  })

  it('produces a file the parser round-trips with no new errors', () => {
    const outcome = appendLitResultToBib(EXISTING, gunn)
    const reparsed = parseBibtex(outcome.text)
    expect(reparsed.errors).toEqual([])
    expect(reparsed.entries).toHaveLength(2)
    expect(reparsed.entries.map((e) => e.key)).toEqual(['gunn1972infall', 'gunn1972infalla'])
  })

  it('separates a fresh append with exactly one blank line', () => {
    const outcome = appendLitResultToBib(EXISTING, gunn)
    expect(outcome.text).toBe(`${EXISTING.trimEnd()}\n\n@article{gunn1972infalla,\n  author = {Gunn, James E. and Gott, J. Richard},\n  title = {On the infall of matter into clusters of galaxies},\n  journal = {The Astrophysical Journal},\n  year = {1972},\n  doi = {10.1086/151605}\n}\n`)
    expect(outcome.fileField).toBeNull()
  })

  it('surfaces (but does not drop) a pre-existing parse error', () => {
    const broken = `${EXISTING}\n@article{oops,\n  title = {unterminated\n`
    const outcome = appendLitResultToBib(broken, gunn)
    expect(outcome.parseErrors.length).toBeGreaterThan(0)
    // the malformed source text is still present, untouched, in the output
    expect(outcome.text).toContain('@article{oops,')
    expect(outcome.text).toContain('title = {unterminated')
  })
})

function entryByKey(bibText: string, key: string): BibEntry {
  const found = parseBibtex(bibText).entries.find((e) => e.key === key)
  if (found === undefined) throw new Error(`no entry keyed ${key} in:\n${bibText}`)
  return found
}

describe('appendLitResultToBib — file field', () => {
  it('writes the PDF path as a file field and reports it back', () => {
    const outcome = appendLitResultToBib('', gunn, { filePath: 'references/gunn1972infall.pdf' })
    expect(outcome.fileField).toBe('references/gunn1972infall.pdf')
    expect(outcome.text).toContain('file = {references/gunn1972infall.pdf}')
    expect(outcome.entry.raw['file']).toBe('references/gunn1972infall.pdf')
    expect(parseBibtex(outcome.text).errors).toEqual([])
  })

  it('round-trips so resolvePdfPath answers file-field with an EMPTY listing (no rescan)', () => {
    const outcome = appendLitResultToBib(EXISTING, gunn, {
      filePath: 'references/gunn1972infalla.pdf'
    })
    const entry = entryByKey(outcome.text, outcome.key)
    expect(resolvePdfPath(entry, [])).toEqual({
      path: 'references/gunn1972infalla.pdf',
      how: 'file-field'
    })
  })

  it('survives the serializeBibtex → parseBibtex → resolvePdfPath chain', () => {
    const outcome = appendLitResultToBib('', gunn, { filePath: 'references/gunn1972infall.pdf' })
    const reserialized = serializeBibtex([outcome.entry])
    const entry = entryByKey(reserialized, outcome.key)
    expect(resolvePdfPath(entry, [], { projectRoot: '/work/paper' })).toEqual({
      path: '/work/paper/references/gunn1972infall.pdf',
      how: 'file-field'
    })
  })

  it('escapes a semicolon in the path so the resolver reads one path, not two', () => {
    const outcome = appendLitResultToBib('', gunn, { filePath: 'references/odd;name.pdf' })
    expect(outcome.fileField).toBe('references/odd\\;name.pdf')
    const entry = entryByKey(outcome.text, outcome.key)
    expect(resolvePdfPath(entry, [])).toEqual({
      path: 'references/odd;name.pdf',
      how: 'file-field'
    })
  })

  it('leaves the 2-argument output byte-identical, whatever the empty opts shape', () => {
    const golden = appendLitResultToBib(EXISTING, gunn)
    expect(golden.text).not.toContain('file = ')
    for (const opts of [{}, { filePath: undefined }, { filePath: '' }, { filePath: '   ' }]) {
      const outcome = appendLitResultToBib(EXISTING, gunn, opts)
      expect(outcome.text).toBe(golden.text)
      expect(outcome.fileField).toBeNull()
      expect(outcome.entry.raw['file']).toBeUndefined()
    }
  })

  it('keeps the abstract raw field alongside the new one', () => {
    const outcome = appendLitResultToBib('', { ...gunn, abstract: 'A study of infall.' }, {
      filePath: 'references/gunn1972infall.pdf'
    })
    const entry = entryByKey(outcome.text, outcome.key)
    expect(entry.raw['abstract']).toBe('A study of infall.')
    expect(resolvePdfPath(entry, [])?.how).toBe('file-field')
  })
})

const LIBRARY = `@article{gunnEtAl1972,
  author = {Gunn, James E. and Gott, J. Richard},
  title = {On the Infall of Matter Into Clusters of Galaxies!},
  journal = {The Astrophysical Journal},
  year = {1972},
  doi = {HTTPS://DOI.ORG/10.1086/151605}
}

@article{kim2020alignment,
  author = {Kim, Sun},
  title = {Widget alignment under load},
  year = {2020},
  doi = {10.1234/ABC.2020.XYZ}
}

@misc{lovelace2024notes,
  author = {Lovelace, Ada},
  title = {Notes on the analytical engine},
  year = {2024},
  eprint = {2401.00001v2},
  archiveprefix = {arXiv}
}

@article{shakespeare1600hamlet,
  author = {Shakespeare, William},
  title = {The Tragedy of Hamlet, Prince of Denmark},
  year = {1600}
}
`

function litResult(over: Partial<LitResult> = {}): LitResult {
  return { ...gunn, ...over }
}

describe('findExistingKey', () => {
  it('matches on DOI through a doi.org URL and a case difference', () => {
    expect(findExistingKey(LIBRARY, gunn)).toBe('gunnEtAl1972')
  })

  it('folds the DOI suffix too — DOIs are case-insensitive by definition', () => {
    const result = litResult({
      id: '10.1234/abc.2020.xyz',
      doi: '10.1234/abc.2020.xyz',
      title: 'A title the file does not have',
      authors: ['Sun Kim'],
      year: 2020
    })
    expect(findExistingKey(LIBRARY, result)).toBe('kim2020alignment')
  })

  it('accepts a doi: prefix on the incoming result', () => {
    expect(findExistingKey(LIBRARY, litResult({ doi: 'doi:10.1086/151605' }))).toBe('gunnEtAl1972')
  })

  it('matches on arXiv id across a version suffix, ignoring the title', () => {
    const preprint = litResult({
      source: 'arxiv',
      id: 'arXiv:2401.00001',
      doi: null,
      title: 'Sketch of the analytical engine',
      authors: ['Ada Lovelace'],
      year: 2024,
      venue: 'arXiv',
      citedByCount: null,
      openAccessUrl: 'https://arxiv.org/abs/2401.00001'
    })
    expect(findExistingKey(LIBRARY, preprint)).toBe('lovelace2024notes')
  })

  it('matches on the folded title when punctuation, case and spacing differ', () => {
    const result = litResult({
      id: 'w1',
      doi: null,
      title: 'the tragedy of hamlet — prince of Denmark',
      authors: ['William Shakespeare'],
      year: 1600,
      venue: null,
      citedByCount: null
    })
    expect(findExistingKey(LIBRARY, result)).toBe('shakespeare1600hamlet')
  })

  it('lets the DOI decide when another entry merely shares the title', () => {
    const twins = `@article{wrongdoi,
  title = {On the Infall of Matter Into Clusters of Galaxies},
  year = {1972},
  doi = {10.9999/not-the-same}
}

@article{rightdoi,
  title = {A completely unrelated write-up},
  year = {1972},
  doi = {10.1086/151605}
}
`
    expect(findExistingKey(twins, gunn)).toBe('rightdoi')
  })

  it('misses on a genuinely different paper', () => {
    const other = litResult({
      source: 'openalex',
      id: 'W2741809807',
      doi: '10.1088/0004-637x/700/1/1',
      title: 'Ram pressure stripping in the Virgo cluster',
      authors: ['Pavel Jáchym'],
      year: 2019,
      venue: 'The Astrophysical Journal',
      citedByCount: 12
    })
    expect(findExistingKey(LIBRARY, other)).toBeNull()
  })

  it('does not match on author and year alone', () => {
    const sameAuthorAndYear = litResult({
      id: 'w2',
      doi: null,
      title: 'The Tragedy of King Lear',
      authors: ['William Shakespeare'],
      year: 1600,
      venue: null,
      citedByCount: null
    })
    expect(findExistingKey(LIBRARY, sameAuthorAndYear)).toBeNull()
  })

  it('returns null for an empty bibliography', () => {
    expect(findExistingKey('', gunn)).toBeNull()
  })

  it('finds the key appendLitResultToBib just wrote, so a second append is refused', () => {
    const outcome = appendLitResultToBib(EXISTING, gunn)
    expect(findExistingKey(outcome.text, gunn)).toBe(outcome.key)
  })

  it('finds an appended arXiv preprint by its id alone', () => {
    const preprint = litResult({
      source: 'arxiv',
      id: 'arXiv:2401.00001',
      doi: null,
      title: 'Notes on the analytical engine',
      authors: ['Ada Lovelace'],
      year: 2024,
      venue: 'arXiv',
      citedByCount: null,
      openAccessUrl: 'https://arxiv.org/abs/2401.00001'
    })
    const outcome = appendLitResultToBib('', preprint)
    const lookedUp = litResult({
      source: 'arxiv',
      id: 'arXiv:2401.00001v3',
      doi: null,
      title: 'A different rendering of the same preprint',
      authors: ['Ada Lovelace'],
      year: 2024,
      venue: 'arXiv',
      citedByCount: null,
      openAccessUrl: null
    })
    expect(findExistingKey(outcome.text, lookedUp)).toBe(outcome.key)
  })
})

describe('removeEntryFromBib', () => {
  const two = [
    '@article{gunn1972,',
    '  title = {On the Infall of Matter into Clusters of Galaxies},',
    '  author = {Gunn, James E. and Gott, J. Richard},',
    '  year = {1972},',
    '  file = {references/gunn1972.pdf},',
    '}',
    '',
    '@article{lovelace2024,',
    '  title = {A note on braces {\\{}nested{\\}} inside a field},',
    '  author = {Lovelace, Ada},',
    '  year = {2024},',
    '}',
    ''
  ].join('\n');

  it('removes only the named entry and reports its file field', () => {
    const outcome = removeEntryFromBib(two, 'gunn1972');
    expect(outcome.removed).toBe(true);
    expect(outcome.fileField).toBe('references/gunn1972.pdf');
    const parsed = parseBibtex(outcome.text);
    expect(parsed.entries.map((e) => e.key)).toEqual(['lovelace2024']);
    // the survivor's text is untouched, not re-serialized
    expect(outcome.text.trim()).toBe(two.slice(two.indexOf('@article{lovelace2024')).trim());
  });

  it('handles the last entry, and braces nested in a field', () => {
    const outcome = removeEntryFromBib(two, 'lovelace2024');
    expect(outcome.removed).toBe(true);
    expect(outcome.fileField).toBeNull();
    expect(parseBibtex(outcome.text).entries.map((e) => e.key)).toEqual(['gunn1972']);
  });

  it('leaves the file byte-identical when the key is not there', () => {
    const outcome = removeEntryFromBib(two, 'nobody1999');
    expect(outcome).toEqual({ text: two, removed: false, fileField: null });
  });

  it('keeps text the parser could not read', () => {
    const messy = `@article{broken,\n  title = {unterminated\n\n${two}`;
    const outcome = removeEntryFromBib(messy, 'gunn1972');
    expect(outcome.removed).toBe(true);
    expect(outcome.text).toContain('@article{broken');
    expect(outcome.text).not.toContain('gunn1972');
  });

  it('empties a single-entry file rather than leaving stray text', () => {
    const one = removeEntryFromBib('@article{only2020,\n  title = {Solo},\n}\n', 'only2020');
    expect(one.text).toBe('');
    expect(one.removed).toBe(true);
  });

  it('round-trips with append: adding then removing restores the original', () => {
    const added = appendLitResultToBib(two, gunn);
    expect(removeEntryFromBib(added.text, added.key).text).toBe(two.trimEnd() + '\n');
  });
});
