import { describe, expect, it } from 'vitest';
import {
  SETTINGS_DEFAULTS,
  SETTING_KEYS,
  SETTING_KEY_LIST,
  resolveSetting,
  resolveSettings,
  settingPath,
} from './settings-resolve';

describe('resolveSetting', () => {
  it('falls back to the shipped default when the config says nothing', () => {
    const out = resolveSetting('editor.lineHeight', {});
    expect(out.value).toBe(1.6);
    expect(out.source).toBe('default');
  });

  it('takes a value the config file sets', () => {
    const out = resolveSetting('editor.lineHeight', { editor: { lineHeight: 1.8 } });
    expect(out.value).toBe(1.8);
    expect(out.source).toBe('config');
  });

  it('treats null as unset, so a hand-written null means "reset to default"', () => {
    const out = resolveSetting('editor.contentWidthCh', { editor: { contentWidthCh: null } });
    expect(out.value).toBe(SETTINGS_DEFAULTS['editor.contentWidthCh']);
    expect(out.source).toBe('default');
  });

  it('falls back rather than throwing on an out-of-range number', () => {
    const out = resolveSetting('editor.fontSizePx', { editor: { fontSizePx: 400 } });
    expect(out.value).toBe(14);
    expect(out.source).toBe('default');
  });

  it('falls back rather than throwing on a misspelled enum', () => {
    const out = resolveSetting('editor.fontFamily', { editor: { fontFamily: 'cursive' } });
    expect(out.value).toBe('serif');
    expect(out.source).toBe('default');
  });

  it('survives a block that is a scalar where a mapping was expected', () => {
    const out = resolveSetting('ai.model', { ai: 'sonnet' });
    expect(out.source).toBe('default');
  });

  it('accepts a theme id that is not a built-in, because a user theme names itself', () => {
    const out = resolveSetting('editor.editorTheme', { editor: { theme: 'nord-night' } });
    expect(out.value).toBe('nord-night');
    expect(out.source).toBe('config');
  });

  it('rejects a theme id that is not a legal slug', () => {
    const out = resolveSetting('editor.editorTheme', { editor: { theme: 'Nord Night' } });
    expect(out.source).toBe('default');
  });
});

describe('resolveSettings', () => {
  it('resolves every key and reports where each came from', () => {
    const out = resolveSettings({ editor: { lineHeight: 1.9 }, ui: { radiusPx: 0 } });
    expect(out.value['editor.lineHeight']).toBe(1.9);
    expect(out.sources['editor.lineHeight']).toBe('config');
    expect(out.value['ui.radiusPx']).toBe(0);
    expect(out.sources['ui.radiusPx']).toBe('config');
    expect(out.sources['ai.model']).toBe('default');
  });

  it('defaults everything for an empty config', () => {
    const out = resolveSettings({});
    expect(out.value).toEqual(SETTINGS_DEFAULTS);
    expect(out.problems).toEqual([]);
  });

  it('reports a bad value as a problem instead of dropping it silently', () => {
    const out = resolveSettings({ editor: { lineHeight: 9 } });
    expect(out.value['editor.lineHeight']).toBe(1.6);
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0]?.path).toBe('editor.lineHeight');
  });

  it('does not report a key the file never mentions', () => {
    expect(resolveSettings({ editor: {} }).problems).toEqual([]);
  });
});

describe('the key registry', () => {
  it('gives every key a unique YAML path', () => {
    const paths = SETTING_KEY_LIST.map(settingPath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("validates its own defaults, except the nullable 'unset' ones", () => {
    for (const key of SETTING_KEY_LIST) {
      const meta = SETTING_KEYS[key];
      if (meta.default === null) continue;
      expect(meta.schema.safeParse(meta.default).success, key).toBe(true);
    }
  });

  it('documents every key, so the seeded config.yml can explain itself', () => {
    for (const key of SETTING_KEY_LIST) {
      expect(SETTING_KEYS[key].doc.length, key).toBeGreaterThan(10);
    }
  });
});
