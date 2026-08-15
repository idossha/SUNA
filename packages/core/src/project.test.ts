import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_DIRS,
  MAX_RECENT_PROJECTS,
  PROJECT_DIR_KEYS,
  ProjectSettingsSchema,
  SunaProjectManifestSchema,
  coerceRecentProjects,
  forgetRecentProject,
  normalizeProjectPath,
  touchRecentProject,
  type RecentProject,
  type SunaProjectManifest,
} from './project';

const manifest = {
  schemaVersion: 1,
  name: 'my-paper',
  activeProfileId: 'nature-astronomy',
  directories: DEFAULT_PROJECT_DIRS,
  createdAt: '2026-08-13T09:30:00Z',
} satisfies SunaProjectManifest;

describe('SunaProjectManifestSchema', () => {
  it('parses a manifest using the default directory layout', () => {
    const parsed = SunaProjectManifestSchema.parse(manifest);
    expect(parsed).toEqual(manifest);
  });

  it('covers every project directory key in DEFAULT_PROJECT_DIRS', () => {
    expect(Object.keys(DEFAULT_PROJECT_DIRS).sort()).toEqual([...PROJECT_DIR_KEYS].sort());
  });

  it('rejects a directory map missing a key', () => {
    const { output: _output, ...partial } = DEFAULT_PROJECT_DIRS;
    const bad: unknown = { ...manifest, directories: partial };
    expect(SunaProjectManifestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown schema version', () => {
    const bad: unknown = { ...manifest, schemaVersion: 2 };
    expect(SunaProjectManifestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a non-ISO createdAt', () => {
    const bad: unknown = { ...manifest, createdAt: 'yesterday' };
    expect(SunaProjectManifestSchema.safeParse(bad).success).toBe(false);
  });

  it('keeps a manifest without a settings block valid', () => {
    expect(SunaProjectManifestSchema.parse(manifest).settings).toBeUndefined();
  });

  it('parses a manifest carrying project settings', () => {
    const withSettings: unknown = {
      ...manifest,
      settings: {
        previewProfileId: 'science',
        editor: { contentWidthCh: 90, fontSizePx: 14, defaultMode: 'source' },
        figures: { defaultWidthPreset: 'single' },
        python: { envPath: '.venv' },
        literature: { provider: 'crossref' },
        ai: { mode: 'cli', cliCommand: 'claude' },
      },
    };
    const parsed = SunaProjectManifestSchema.parse(withSettings);
    expect(parsed.settings?.editor?.contentWidthCh).toBe(90);
    expect(parsed.settings?.ai?.mode).toBe('cli');
  });

  it('rejects an out-of-range editor value in the settings block', () => {
    const bad: unknown = { ...manifest, settings: { editor: { fontSizePx: 400 } } };
    expect(SunaProjectManifestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown enum member in the settings block', () => {
    const bad: unknown = { ...manifest, settings: { editor: { defaultMode: 'zen' } } };
    expect(SunaProjectManifestSchema.safeParse(bad).success).toBe(false);
  });
});

describe('ProjectSettingsSchema', () => {
  it('accepts an empty block — every key is optional', () => {
    expect(ProjectSettingsSchema.parse({})).toEqual({});
  });

  it('accepts null for every key, meaning "not set here"', () => {
    const cleared: unknown = {
      previewProfileId: null,
      editor: null,
      figures: null,
      python: null,
      literature: null,
      ai: null,
    };
    expect(ProjectSettingsSchema.safeParse(cleared).success).toBe(true);
    expect(
      ProjectSettingsSchema.safeParse({ editor: { contentWidthCh: null, vimMotions: null } })
        .success,
    ).toBe(true);
  });

  it('rejects a non-numeric editor width', () => {
    expect(ProjectSettingsSchema.safeParse({ editor: { contentWidthCh: 'wide' } }).success).toBe(
      false,
    );
  });
});

describe('recent projects', () => {
  const entry = (path: string, at: string): RecentProject => ({
    path,
    name: path.split('/').pop() ?? path,
    lastOpenedAt: at,
  });

  const a = entry('/work/a', '2026-08-10T10:00:00.000Z');
  const b = entry('/work/b', '2026-08-11T10:00:00.000Z');

  it('puts the touched project first', () => {
    expect(touchRecentProject([a, b], entry('/work/c', '2026-08-12T10:00:00.000Z'))).toEqual([
      entry('/work/c', '2026-08-12T10:00:00.000Z'),
      a,
      b,
    ]);
  });

  it('dedupes by path, keeping the newest timestamp and one row', () => {
    const reopened = entry('/work/a', '2026-08-12T10:00:00.000Z');
    expect(touchRecentProject([a, b], reopened)).toEqual([reopened, b]);
  });

  it('treats a trailing separator as the same project', () => {
    const reopened = { ...entry('/work/a/', '2026-08-12T10:00:00.000Z'), name: 'a' };
    const out = touchRecentProject([a, b], reopened);
    expect(out).toHaveLength(2);
    expect(out[0]?.path).toBe('/work/a');
  });

  it('caps the list at MAX_RECENT_PROJECTS', () => {
    let list: RecentProject[] = [];
    for (let i = 0; i < MAX_RECENT_PROJECTS + 5; i += 1) {
      list = touchRecentProject(list, entry(`/work/p${i}`, '2026-08-12T10:00:00.000Z'));
    }
    expect(list).toHaveLength(MAX_RECENT_PROJECTS);
    expect(list[0]?.path).toBe(`/work/p${MAX_RECENT_PROJECTS + 4}`);
  });

  it('forgets one entry and leaves the rest in order', () => {
    expect(forgetRecentProject([a, b], '/work/a')).toEqual([b]);
    expect(forgetRecentProject([a, b], '/work/a/')).toEqual([b]);
    expect(forgetRecentProject([a, b], '/work/missing')).toEqual([a, b]);
  });

  it('coerces a malformed persisted list instead of throwing', () => {
    const raw: unknown = [a, { path: '/work/x' }, 'nonsense', null, b];
    expect(coerceRecentProjects(raw)).toEqual([a, b]);
    expect(coerceRecentProjects(undefined)).toEqual([]);
    expect(coerceRecentProjects({ path: '/work/a' })).toEqual([]);
  });

  it('drops duplicates already present in the persisted list', () => {
    expect(coerceRecentProjects([a, { ...a, path: '/work/a/' }, b])).toEqual([a, b]);
  });

  it('normalizes trailing separators without eating a bare root', () => {
    expect(normalizeProjectPath('/work/a/')).toBe('/work/a');
    expect(normalizeProjectPath('/work/a')).toBe('/work/a');
    expect(normalizeProjectPath('C:\\work\\a\\')).toBe('C:\\work\\a');
    expect(normalizeProjectPath('/')).toBe('/');
  });
});
