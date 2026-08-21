import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_KIND_FILES,
  DOCUMENT_KIND_IDS,
  DocumentEntrySchema,
  PRIMARY_DOCUMENT_ID,
  documentById,
  documentForPath,
  documentPaths,
  filesForKind,
  primaryDocument,
  resolveDocuments,
  usesJournalRegistry,
  type DocumentEntry,
  type DocumentKindId,
} from './documents';
import { SunaProjectManifestSchema, type SunaProjectManifest } from './project';

/** A manifest exactly as every project on disk carries it today — no registry. */
const legacyManifest = (): SunaProjectManifest =>
  SunaProjectManifestSchema.parse({
    schemaVersion: 1,
    name: 'Demo',
    activeProfileId: 'nature',
    directories: {
      manuscript: 'manuscript',
      figures: 'figures',
      code: 'code',
      data: 'data',
      analysis: 'analysis',
      results: 'results',
      output: 'output',
    },
    createdAt: '2026-08-14T00:00:00.000Z',
  });

const letterEntry = (over: Partial<DocumentEntry> = {}): unknown => ({
  id: 'cover-science',
  kind: 'cover-letter',
  file: 'letters/cover-science.md',
  meta: 'letters/cover-science.json',
  title: 'Cover letter — Science',
  ...over,
});

describe('resolveDocuments — the zero-file migration', () => {
  it('synthesizes a one-manuscript registry when suna.json declares none', () => {
    const docs = resolveDocuments(legacyManifest());
    expect(docs).toHaveLength(1);
    expect(docs[0]?.id).toBe(PRIMARY_DOCUMENT_ID);
    expect(docs[0]?.kind).toBe('manuscript');
    // The prose filename is NOT in the registry: it lives in
    // manuscript.json:manuscriptFile, so the two cannot drift.
    expect(docs[0]?.file).toBeNull();
    expect(docs[0]?.meta).toBe('manuscript.json');
  });

  it('treats an empty declared registry as no registry at all', () => {
    const m = { ...legacyManifest(), documents: [] };
    expect(resolveDocuments(m)).toHaveLength(1);
    expect(primaryDocument(m).kind).toBe('manuscript');
  });

  it('does not mutate the manifest it is given', () => {
    const m = legacyManifest();
    resolveDocuments(m).push(DocumentEntrySchema.parse(letterEntry()));
    expect(resolveDocuments(m)).toHaveLength(1);
  });

  it('returns the declared registry when there is one', () => {
    const m = SunaProjectManifestSchema.parse({
      ...legacyManifest(),
      documents: [
        { id: 'manuscript', kind: 'manuscript', file: null, meta: 'manuscript.json', title: 'Manuscript' },
        letterEntry(),
      ],
    });
    expect(resolveDocuments(m).map((d) => d.id)).toEqual(['manuscript', 'cover-science']);
    expect(primaryDocument(m).id).toBe('manuscript');
  });

  it('finds a primary even when the declared registry forgot one', () => {
    const m = SunaProjectManifestSchema.parse({ ...legacyManifest(), documents: [letterEntry()] });
    expect(primaryDocument(m).kind).toBe('manuscript');
  });
});

describe('documentPaths — byte-identical for the primary document', () => {
  it('reproduces the paths the manuscript resolves to today', () => {
    const m = legacyManifest();
    const paths = documentPaths('/p/manuscript', primaryDocument(m));
    expect(paths.meta).toBe('/p/manuscript/manuscript.json');
    expect(paths.prose).toBe('/p/manuscript/manuscript.md');
  });

  it('honours manuscript.json:manuscriptFile through the override', () => {
    const paths = documentPaths('/p/manuscript', primaryDocument(legacyManifest()), 'paper.md');
    expect(paths.prose).toBe('/p/manuscript/paper.md');
  });

  it('works against a renamed manuscript directory', () => {
    // The caller resolves `directories.manuscript` and passes the result, so a
    // renamed dir is this function's caller's problem, never a hardcoded string.
    const paths = documentPaths('/p/ms-src', primaryDocument(legacyManifest()));
    expect(paths.meta).toBe('/p/ms-src/manuscript.json');
  });

  it('nests a letter under the manuscript dir', () => {
    const doc = DocumentEntrySchema.parse(letterEntry());
    const paths = documentPaths('/p/manuscript', doc);
    expect(paths.prose).toBe('/p/manuscript/letters/cover-science.md');
    expect(paths.meta).toBe('/p/manuscript/letters/cover-science.json');
  });

  it('returns null prose for a kind that has none', () => {
    const pkg = DocumentEntrySchema.parse({
      id: 'r01',
      kind: 'package',
      file: null,
      meta: 'package.json',
      title: 'NIH R01',
    });
    expect(documentPaths('/p/manuscript', pkg).prose).toBeNull();
  });

  it('tolerates a trailing slash on the manuscript dir', () => {
    const paths = documentPaths('/p/manuscript/', primaryDocument(legacyManifest()));
    expect(paths.meta).toBe('/p/manuscript/manuscript.json');
  });
});

describe('documentForPath', () => {
  const m = SunaProjectManifestSchema.parse({
    ...legacyManifest(),
    documents: [
      { id: 'manuscript', kind: 'manuscript', file: null, meta: 'manuscript.json', title: 'Manuscript' },
      letterEntry(),
    ],
  });

  it('resolves a nested letter path', () => {
    expect(documentForPath(m, 'letters/cover-science.md')?.id).toBe('cover-science');
  });

  it('resolves the primary through the supplied prose filename', () => {
    expect(documentForPath(m, 'manuscript.md')?.kind).toBe('manuscript');
    expect(documentForPath(m, 'paper.md', 'paper.md')?.kind).toBe('manuscript');
    // …and not through the default once the project renamed its prose file.
    expect(documentForPath(m, 'manuscript.md', 'paper.md')).toBeNull();
  });

  it('returns null rather than throwing for an unknown path', () => {
    expect(documentForPath(m, 'nope.md')).toBeNull();
  });

  it('normalizes ./ and leading slashes', () => {
    expect(documentForPath(m, './letters/cover-science.md')?.id).toBe('cover-science');
    expect(documentForPath(m, '/letters/cover-science.md')?.id).toBe('cover-science');
  });

  it('refuses a path that escapes the manuscript dir', () => {
    expect(documentForPath(m, '../secrets.md')).toBeNull();
    expect(documentForPath(m, 'letters/../../secrets.md')).toBeNull();
  });

  it('documentById finds and misses cleanly', () => {
    expect(documentById(m, 'cover-science')?.kind).toBe('cover-letter');
    expect(documentById(m, 'absent')).toBeNull();
  });
});

describe('DOCUMENT_KIND_FILES is exhaustive and the only filename authority', () => {
  it('names every kind', () => {
    for (const kind of DOCUMENT_KIND_IDS) {
      expect(DOCUMENT_KIND_FILES[kind]).toBeDefined();
    }
    expect(Object.keys(DOCUMENT_KIND_FILES).sort()).toEqual([...DOCUMENT_KIND_IDS].sort());
  });

  it('substitutes <id> and <slot> so no caller hand-builds a filename', () => {
    expect(filesForKind('cover-letter', 'cover-science')).toEqual({
      meta: 'cover-science.json',
      prose: 'cover-science.md',
      extra: ['cover-science.private.json'],
    });
    expect(filesForKind('response', 'round-2')).toEqual({
      meta: 'round-2.doc.json',
      prose: 'round-2.md',
      extra: [],
    });
    expect(filesForKind('component', 'specific-aims').prose).toBe('specific-aims.md');
  });

  it('leaves the manuscript prose null — manuscript.json owns that name', () => {
    expect(DOCUMENT_KIND_FILES.manuscript.prose).toBeNull();
    expect(filesForKind('manuscript', 'manuscript').prose).toBeNull();
  });
});

describe('profile registry tagging', () => {
  it('accepts a journal profile on a journal-registry kind', () => {
    const doc = DocumentEntrySchema.parse(
      letterEntry({ profile: { registry: 'journal', id: 'science' } as DocumentEntry['profile'] }),
    );
    expect(doc.profile?.id).toBe('science');
  });

  it('rejects a sponsor profile on a cover letter', () => {
    const parsed = DocumentEntrySchema.safeParse(
      letterEntry({ profile: { registry: 'sponsor', id: 'nih-r01' } as DocumentEntry['profile'] }),
    );
    expect(parsed.success).toBe(false);
  });

  it('rejects a journal profile on a package', () => {
    const parsed = DocumentEntrySchema.safeParse({
      id: 'r01',
      kind: 'package',
      file: null,
      meta: 'package.json',
      title: 'NIH R01',
      profile: { registry: 'journal', id: 'science' },
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts a sponsor profile on a package and a component', () => {
    for (const kind of ['package', 'component'] as const) {
      const parsed = DocumentEntrySchema.safeParse({
        id: 'r01',
        kind,
        file: kind === 'component' ? 'r01/aims.md' : null,
        meta: kind === 'component' ? 'r01/aims.json' : 'package.json',
        title: 'NIH R01',
        profile: { registry: 'sponsor', id: 'nih-r01' },
      });
      expect(parsed.success).toBe(true);
    }
  });

  it('defaults profile to null, which means "inherit activeProfileId"', () => {
    expect(DocumentEntrySchema.parse(letterEntry()).profile).toBeNull();
  });

  it('marks exactly the journal-registry kinds as inheriting', () => {
    const journal: DocumentKindId[] = [];
    const sponsor: DocumentKindId[] = [];
    for (const kind of DOCUMENT_KIND_IDS) (usesJournalRegistry(kind) ? journal : sponsor).push(kind);
    expect(sponsor).toEqual(['package', 'component']);
    expect(journal).toContain('manuscript');
  });
});

describe('DocumentEntrySchema shape', () => {
  it('rejects an id that is not a slug', () => {
    for (const id of ['Cover Letter', '1st', 'cover_science', '', 'Cover-Science']) {
      expect(DocumentEntrySchema.safeParse(letterEntry({ id })).success).toBe(false);
    }
  });

  it('rejects an unknown kind', () => {
    expect(DocumentEntrySchema.safeParse(letterEntry({ kind: 'memo' as DocumentKindId })).success).toBe(false);
  });

  it('defaults roundId and archived', () => {
    const doc = DocumentEntrySchema.parse(letterEntry());
    expect(doc.roundId).toBeNull();
    expect(doc.archived).toBe(false);
  });
});

describe('the manifest carries the registry additively', () => {
  it('parses a manifest with no documents field and leaves it absent', () => {
    const m = legacyManifest();
    expect(m.documents).toBeUndefined();
    // Nothing is written back to make the registry work.
    expect(JSON.stringify(m)).not.toContain('documents');
  });

  it('parses a manifest that declares one', () => {
    const m = SunaProjectManifestSchema.parse({ ...legacyManifest(), documents: [letterEntry()] });
    expect(m.documents).toHaveLength(1);
  });

  it('rejects a manifest whose registry entry is invalid', () => {
    const parsed = SunaProjectManifestSchema.safeParse({
      ...legacyManifest(),
      documents: [letterEntry({ id: 'Not A Slug' })],
    });
    expect(parsed.success).toBe(false);
  });

  it('keeps schemaVersion at 1 — the registry is not a breaking change', () => {
    expect(legacyManifest().schemaVersion).toBe(1);
  });
});
