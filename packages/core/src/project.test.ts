import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_DIRS,
  PROJECT_DIR_KEYS,
  SunaProjectManifestSchema,
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
});
