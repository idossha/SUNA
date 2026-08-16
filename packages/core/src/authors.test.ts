import { describe, expect, it } from 'vitest';
import demoAuthors from '../../../examples/demo-paper/manuscript/authors.json';
import { AuthorsFileSchema, emptyAuthorsFile, type AuthorsFile } from './authors';

const fixture = {
  schemaVersion: 1,
  authors: [
    {
      id: 'a1',
      given: 'Tao',
      family: 'Wang',
      nativeScript: '王涛',
      orcid: '0000-0002-2504-2421',
      affiliationRefs: ['af1', 'af2'],
      corresponding: true,
      email: 'taowang@nju.edu.cn',
      equalContribution: true,
      deceased: false,
    },
    {
      id: 'a2',
      given: 'Ada',
      family: 'Smith',
      nativeScript: null,
      orcid: '0000-0001-5109-370X',
      affiliationRefs: ['af2'],
      corresponding: false,
      email: null,
      equalContribution: true,
      deceased: false,
    },
  ],
  affiliations: [
    { id: 'af1', text: 'School of Astronomy and Space Science, Nanjing University, Nanjing, China' },
    { id: 'af2', text: 'Department of Astronomy, Example University, Madison, WI, USA' },
  ],
} satisfies AuthorsFile;

describe('AuthorsFileSchema', () => {
  it('parses a two-author file with ORCIDs, native script and shared affiliations', () => {
    const parsed = AuthorsFileSchema.parse(fixture);
    expect(parsed).toEqual(fixture);
    expect(parsed.authors[0]?.nativeScript).toBe('王涛');
    expect(parsed.authors[0]?.corresponding).toBe(true);
    expect(parsed.authors[1]?.affiliationRefs).toEqual(['af2']);
    expect(parsed.authors.every((a) => a.equalContribution)).toBe(true);
  });

  it('accepts an empty byline (a project that has not named anyone yet)', () => {
    const empty = emptyAuthorsFile();
    expect(AuthorsFileSchema.parse(empty)).toEqual({
      schemaVersion: 1,
      authors: [],
      affiliations: [],
    });
  });

  it('rejects a malformed ORCID', () => {
    const bad: unknown = {
      ...fixture,
      authors: [{ ...fixture.authors[0], orcid: '12-34' }],
    };
    expect(AuthorsFileSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a wrong schemaVersion and a missing affiliations array', () => {
    expect(AuthorsFileSchema.safeParse({ ...fixture, schemaVersion: 2 }).success).toBe(false);
    expect(
      AuthorsFileSchema.safeParse({ schemaVersion: 1, authors: fixture.authors }).success,
    ).toBe(false);
  });

  it('never stores affiliation numbering: smuggled marker fields are stripped', () => {
    const smuggled: unknown = {
      ...fixture,
      affiliations: [{ ...fixture.affiliations[0], number: 1 }],
    };
    const parsed = AuthorsFileSchema.parse(smuggled);
    expect(parsed.affiliations[0]).not.toHaveProperty('number');
  });

  it('keeps the shipped demo-paper authors.json schema-valid', () => {
    const parsed = AuthorsFileSchema.parse(demoAuthors);
    expect(parsed.authors).toHaveLength(2);
    expect(parsed.affiliations).toHaveLength(2);
  });
});
