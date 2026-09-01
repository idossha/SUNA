import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { synthesizedRegistry, DEFAULT_PROJECT_DIRS } from '@suna/core';
import { listReferenceNotes } from './refnotes';
import type { ProjectContext } from './project';

/**
 * `list_reference_notes` over a real temp project — the verb an agent uses to
 * see what the researcher judged worth keeping, and which paper each judgement
 * belongs to (ARCHITECTURE §14.4).
 */

const roots: string[] = [];

async function project(options: {
  bib?: string;
  notes?: Record<string, unknown>;
}): Promise<ProjectContext> {
  const root = await mkdtemp(join(tmpdir(), 'suna-refnotes-'));
  roots.push(root);
  await mkdir(join(root, 'manuscript'), { recursive: true });
  await mkdir(join(root, 'references', 'notes'), { recursive: true });
  if (options.bib !== undefined) {
    await writeFile(join(root, 'manuscript', 'references.bib'), options.bib, 'utf8');
  }
  for (const [citekey, file] of Object.entries(options.notes ?? {})) {
    await writeFile(
      join(root, 'references', 'notes', `${citekey}.json`),
      JSON.stringify(file),
      'utf8',
    );
  }
  return { root, name: 'test', activeProfileId: null, dirs: { ...DEFAULT_PROJECT_DIRS }, documents: synthesizedRegistry() };
}

const note = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'n-1',
  color: 'yellow',
  runs: [{ page: 3, quote: 'Ram pressure strips the gas.', prefix: '', suffix: '', detached: false }],
  body: '',
  tags: [],
  author: { kind: 'human', name: 'You' },
  createdAt: '2026-08-18T10:00:00.000Z',
  updatedAt: '2026-08-18T10:00:00.000Z',
  ambiguous: false,
  embed: [],
  ...over,
});

const notesFile = (citekey: string, notes: Record<string, unknown>[]): Record<string, unknown> => ({
  schemaVersion: 1,
  citekey,
  source: null,
  embed: null,
  notes,
});

const BIB = `@article{gunn1972,
  title = {On the Infall of Matter Into Clusters of Galaxies},
  author = {Gunn, James E. and Gott, J. Richard},
  year = {1972},
  doi = {10.1086/151605}
}
@article{moore1996,
  title = {Galaxy Harassment},
  author = {Moore, Ben and Katz, Neal and Lake, George and Dressler, Alan},
  year = {1996}
}
`;

afterEach(() => {
  roots.length = 0;
});

describe('listReferenceNotes', () => {
  it('says so plainly when nothing has been highlighted', async () => {
    const ctx = await project({});
    expect(await listReferenceNotes(ctx, {})).toContain('No reading notes yet');
  });

  it('joins every note to the paper it came from', async () => {
    const ctx = await project({
      bib: BIB,
      notes: { gunn1972: notesFile('gunn1972', [note()]) },
    });
    const out = await listReferenceNotes(ctx, {});
    expect(out).toContain('[@gunn1972]');
    expect(out).toContain('Gunn & Gott (1972)');
    expect(out).toContain('On the Infall of Matter Into Clusters of Galaxies');
    expect(out).toContain('doi:10.1086/151605');
    expect(out).toContain('> Ram pressure strips the gas.');
  });

  it('gives the page, so a claim can be cited without a second lookup', async () => {
    const ctx = await project({ bib: BIB, notes: { gunn1972: notesFile('gunn1972', [note()]) } });
    expect(await listReferenceNotes(ctx, {})).toContain('p. 3');
  });

  it('shortens a long author list rather than printing all of it', async () => {
    const ctx = await project({ bib: BIB, notes: { moore1996: notesFile('moore1996', [note()]) } });
    expect(await listReferenceNotes(ctx, {})).toContain('Moore et al. (1996)');
  });

  it('distinguishes the highlighted passage from what the reader wrote', async () => {
    const ctx = await project({
      bib: BIB,
      notes: { gunn1972: notesFile('gunn1972', [note({ body: 'The mechanism for the intro.' })]) },
    });
    const out = await listReferenceNotes(ctx, {});
    expect(out).toContain('> Ram pressure strips the gas.');
    expect(out).toContain('The mechanism for the intro.');
  });

  it('reads every paper in the project, counting them', async () => {
    const ctx = await project({
      bib: BIB,
      notes: {
        gunn1972: notesFile('gunn1972', [note()]),
        moore1996: notesFile('moore1996', [note({ id: 'n-2' }), note({ id: 'n-3' })]),
      },
    });
    const out = await listReferenceNotes(ctx, {});
    expect(out).toContain('3 notes across 2 papers');
  });

  it('still answers for a paper that is not in the bibliography', async () => {
    // A notes file can outlive its bib entry; the notes are still the reader's.
    const ctx = await project({ bib: BIB, notes: { orphan2020: notesFile('orphan2020', [note()]) } });
    expect(await listReferenceNotes(ctx, {})).toContain('not in references.bib');
  });

  it('answers without a bibliography at all', async () => {
    const ctx = await project({ notes: { gunn1972: notesFile('gunn1972', [note()]) } });
    expect(await listReferenceNotes(ctx, {})).toContain('[@gunn1972]');
  });

  describe('filters', () => {
    const build = async (): Promise<ProjectContext> =>
      project({
        bib: BIB,
        notes: {
          gunn1972: notesFile('gunn1972', [
            note({ id: 'n-1', color: 'green', tags: ['method'] }),
            note({ id: 'n-2', color: 'red', body: 'doubtful', tags: ['doubt'] }),
          ]),
          moore1996: notesFile('moore1996', [note({ id: 'n-3', color: 'green' })]),
        },
      });

    it('narrows to one paper', async () => {
      const out = await listReferenceNotes(await build(), { citekey: 'moore1996' });
      expect(out).toContain('[@moore1996]');
      expect(out).not.toContain('[@gunn1972]');
    });

    it('narrows by colour', async () => {
      const out = await listReferenceNotes(await build(), { colors: ['red'] });
      expect(out).toContain('1 note across 1 paper');
      expect(out).toContain('doubtful');
    });

    it('narrows by tag', async () => {
      expect(await listReferenceNotes(await build(), { tags: ['method'] })).toContain(
        '1 note across 1 paper',
      );
    });

    it('narrows to notes that were actually written on', async () => {
      const out = await listReferenceNotes(await build(), { withBodyOnly: true });
      expect(out).toContain('1 note across 1 paper');
      expect(out).toContain('doubtful');
    });

    it('says so when a filter matches nothing, rather than looking empty', async () => {
      expect(await listReferenceNotes(await build(), { tags: ['nope'] })).toBe(
        'No reading notes match that filter.',
      );
    });
  });

  it('ignores a corrupt notes file rather than failing the whole call', async () => {
    const ctx = await project({ bib: BIB, notes: { gunn1972: notesFile('gunn1972', [note()]) } });
    await writeFile(join(ctx.root, 'references', 'notes', 'broken.json'), '{ not json', 'utf8');
    expect(await listReferenceNotes(ctx, {})).toContain('[@gunn1972]');
  });
});
