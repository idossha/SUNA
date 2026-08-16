import { describe, expect, it } from 'vitest';
import { ProjectSettingsSchema, type ProjectSettings } from './project';
import {
  SETTINGS_DEFAULTS,
  SETTING_KEYS,
  SETTING_KEY_LIST,
  applySettingsPatch,
  mergeProjectSettings,
  projectSettingPatch,
  resolveSetting,
  resolveSettings,
} from './settings-resolve';

const project = (settings: unknown): ProjectSettings => ProjectSettingsSchema.parse(settings);

describe('resolveSettings precedence', () => {
  it('falls back to the built-in default when neither level sets a key', () => {
    const { value, sources } = resolveSettings({}, undefined);
    expect(value).toEqual(SETTINGS_DEFAULTS);
    for (const key of SETTING_KEY_LIST) expect(sources[key]).toBe('default');
  });

  it('takes a global value when only global sets it', () => {
    const out = resolveSettings({ 'editor.contentWidthCh': 90 }, undefined);
    expect(out.value['editor.contentWidthCh']).toBe(90);
    expect(out.sources['editor.contentWidthCh']).toBe('global');
  });

  it('takes a project value when only the project sets it', () => {
    const out = resolveSettings({}, project({ editor: { contentWidthCh: 120 } }));
    expect(out.value['editor.contentWidthCh']).toBe(120);
    expect(out.sources['editor.contentWidthCh']).toBe('project');
  });

  it('prefers the project value when both levels set it', () => {
    const out = resolveSettings(
      { 'editor.contentWidthCh': 90 },
      project({ editor: { contentWidthCh: 120 } }),
    );
    expect(out.value['editor.contentWidthCh']).toBe(120);
    expect(out.sources['editor.contentWidthCh']).toBe('project');
  });

  it('treats an explicit project null as "not set" and falls through to global', () => {
    const out = resolveSettings(
      { 'editor.contentWidthCh': 90 },
      project({ editor: { contentWidthCh: null } }),
    );
    expect(out.value['editor.contentWidthCh']).toBe(90);
    expect(out.sources['editor.contentWidthCh']).toBe('global');
  });

  it('treats an explicit project null with no global as the default', () => {
    const out = resolveSettings({}, project({ editor: { contentWidthCh: null } }));
    expect(out.value['editor.contentWidthCh']).toBe(140);
    expect(out.sources['editor.contentWidthCh']).toBe('default');
  });

  it('treats a null editor group as "no project editor settings"', () => {
    const out = resolveSettings({ 'editor.fontSizePx': 18 }, project({ editor: null }));
    expect(out.value['editor.fontSizePx']).toBe(18);
    expect(out.sources['editor.fontSizePx']).toBe('global');
  });

  it('treats a global null as "not set"', () => {
    const out = resolveSettings({ 'editor.fontSizePx': null }, undefined);
    expect(out.value['editor.fontSizePx']).toBe(14);
    expect(out.sources['editor.fontSizePx']).toBe('default');
  });

  it('resolves each key independently — one project override does not shadow the rest', () => {
    const out = resolveSettings(
      { 'editor.fontSizePx': 18, 'editor.lineHeight': 1.9 },
      project({ editor: { fontSizePx: 12 } }),
    );
    expect(out.value['editor.fontSizePx']).toBe(12);
    expect(out.sources['editor.fontSizePx']).toBe('project');
    expect(out.value['editor.lineHeight']).toBe(1.9);
    expect(out.sources['editor.lineHeight']).toBe('global');
    expect(out.value['editor.fontFamily']).toBe('serif');
    expect(out.sources['editor.fontFamily']).toBe('default');
  });
});

describe('resolveSettings validation', () => {
  it('ignores a global value of the wrong type and falls through', () => {
    const out = resolveSettings({ 'editor.contentWidthCh': 'wide' }, undefined);
    expect(out.value['editor.contentWidthCh']).toBe(140);
    expect(out.sources['editor.contentWidthCh']).toBe('default');
  });

  it('ignores an out-of-range global number but keeps an in-range project value', () => {
    const out = resolveSettings(
      { 'editor.fontSizePx': 400 },
      project({ editor: { fontSizePx: 20 } }),
    );
    expect(out.value['editor.fontSizePx']).toBe(20);
    expect(out.sources['editor.fontSizePx']).toBe('project');
  });

  it('ignores an unknown enum member at global level', () => {
    const out = resolveSettings({ 'editor.defaultMode': 'zen' }, undefined);
    expect(out.value['editor.defaultMode']).toBe('reading');
    expect(out.sources['editor.defaultMode']).toBe('default');
  });

  it('reads the legacy global editor.theme key for editor.editorTheme', () => {
    const out = resolveSettings({ 'editor.theme': 'suna-light' }, undefined);
    expect(out.value['editor.editorTheme']).toBe('suna-light');
    expect(out.sources['editor.editorTheme']).toBe('global');
  });

  it('lets a project editorTheme win over the legacy global key', () => {
    const out = resolveSettings(
      { 'editor.theme': 'suna-light' },
      project({ editor: { editorTheme: 'high-contrast' } }),
    );
    expect(out.value['editor.editorTheme']).toBe('high-contrast');
    expect(out.sources['editor.editorTheme']).toBe('project');
  });

  it('ignores an unrelated global key entirely', () => {
    const out = resolveSettings({ 'lit.mailto': 'ada@example.edu' }, undefined);
    expect(out.value).toEqual(SETTINGS_DEFAULTS);
  });
});

describe('resolveSetting (single key)', () => {
  it('matches the whole-surface resolution for the same inputs', () => {
    const global = { 'ai.mode': 'api' };
    const settings = project({ ai: { cliCommand: 'codex' } });
    expect(resolveSetting('ai.mode', global, settings)).toEqual({ value: 'api', source: 'global' });
    expect(resolveSetting('ai.cliCommand', global, settings)).toEqual({
      value: 'codex',
      source: 'project',
    });
    const whole = resolveSettings(global, settings);
    expect(whole.value['ai.mode']).toBe('api');
    expect(whole.sources['ai.cliCommand']).toBe('project');
  });

  it('resolves the top-level previewProfileId from the project', () => {
    const out = resolveSetting('previewProfileId', {}, project({ previewProfileId: 'science' }));
    expect(out).toEqual({ value: 'science', source: 'project' });
  });
});

describe('shipped defaults', () => {
  it('ships 14px / 1.6 line-height (feature-plan-5 §2)', () => {
    expect(SETTINGS_DEFAULTS['editor.fontSizePx']).toBe(14);
    expect(SETTINGS_DEFAULTS['editor.lineHeight']).toBe(1.6);
  });

  it('covers every declared key exactly once', () => {
    expect(SETTING_KEY_LIST.sort()).toEqual(Object.keys(SETTINGS_DEFAULTS).sort());
  });

  it('validates its own defaults against each key schema (null means "unset")', () => {
    for (const key of SETTING_KEY_LIST) {
      const value = SETTINGS_DEFAULTS[key];
      if (value === null) continue;
      expect(SETTING_KEYS[key].schema.safeParse(value).success).toBe(true);
    }
  });
});

describe('projectSettingPatch', () => {
  it('builds the nested patch for a grouped key', () => {
    expect(projectSettingPatch('editor.contentWidthCh', 90)).toEqual({
      editor: { contentWidthCh: 90 },
    });
  });

  it('builds a flat patch for a top-level key', () => {
    expect(projectSettingPatch('previewProfileId', 'science')).toEqual({
      previewProfileId: 'science',
    });
  });

  it('spells "reset to global" as a null', () => {
    expect(projectSettingPatch('editor.fontSizePx', null)).toEqual({
      editor: { fontSizePx: null },
    });
  });

  it('refuses an out-of-range value before it reaches IPC', () => {
    expect(() => projectSettingPatch('editor.fontSizePx', 400)).toThrow();
  });
});

describe('mergeProjectSettings', () => {
  it('adds a key to an empty settings block', () => {
    expect(mergeProjectSettings(undefined, { editor: { fontSizePx: 18 } })).toEqual({
      editor: { fontSizePx: 18 },
    });
  });

  it('merges into a sibling group without touching it', () => {
    const merged = mergeProjectSettings(
      { editor: { fontSizePx: 18 }, python: { envPath: '/env' } },
      { editor: { lineHeight: 1.8 } },
    );
    expect(merged).toEqual({
      editor: { fontSizePx: 18, lineHeight: 1.8 },
      python: { envPath: '/env' },
    });
  });

  it('replaces a scalar', () => {
    expect(
      mergeProjectSettings({ editor: { fontSizePx: 18 } }, { editor: { fontSizePx: 12 } }),
    ).toEqual({ editor: { fontSizePx: 12 } });
  });

  it('deletes a key on null and prunes the group it emptied', () => {
    expect(
      mergeProjectSettings({ editor: { fontSizePx: 18 } }, { editor: { fontSizePx: null } }),
    ).toBeUndefined();
  });

  it('keeps the group when other keys survive the delete', () => {
    expect(
      mergeProjectSettings(
        { editor: { fontSizePx: 18, lineHeight: 1.8 } },
        { editor: { fontSizePx: null } },
      ),
    ).toEqual({ editor: { lineHeight: 1.8 } });
  });

  it('is a no-op for an empty patch', () => {
    expect(mergeProjectSettings({ editor: { fontSizePx: 18 } }, {})).toEqual({
      editor: { fontSizePx: 18 },
    });
  });

  it('does not mutate the input', () => {
    const current = { editor: { fontSizePx: 18 } };
    mergeProjectSettings(current, { editor: { fontSizePx: 12 } });
    expect(current).toEqual({ editor: { fontSizePx: 18 } });
  });
});

describe('applySettingsPatch', () => {
  const manifest = {
    schemaVersion: 1,
    name: 'my-paper',
    activeProfileId: 'nature-astronomy',
    directories: { manuscript: 'manuscript' },
    createdAt: '2026-08-13T09:30:00Z',
  };

  it('adds a settings block without touching any other manifest key', () => {
    const next = applySettingsPatch(manifest, { editor: { contentWidthCh: 90 } });
    expect(next).toEqual({ ...manifest, settings: { editor: { contentWidthCh: 90 } } });
  });

  it('preserves keys this schema version does not know about', () => {
    const next = applySettingsPatch(
      { ...manifest, futureKey: { a: 1 } },
      { editor: { contentWidthCh: 90 } },
    );
    expect(next['futureKey']).toEqual({ a: 1 });
  });

  it('drops the settings block entirely when the last key is cleared', () => {
    const withSettings = { ...manifest, settings: { editor: { contentWidthCh: 90 } } };
    const next = applySettingsPatch(withSettings, { editor: { contentWidthCh: null } });
    expect('settings' in next).toBe(false);
  });

  it('rejects a suna.json that is not an object', () => {
    expect(() => applySettingsPatch([1, 2, 3], {})).toThrow(/JSON object/);
  });
});
