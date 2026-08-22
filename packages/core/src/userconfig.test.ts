import { describe, expect, it } from 'vitest';
import {
  defaultConfigYaml,
  migrateLegacySettings,
  parseThemeFile,
  parseUserConfig,
  writeSettingToYaml,
} from './userconfig';
import { SETTING_KEYS, SETTING_KEY_LIST, resolveSettings } from './settings-resolve';

describe('parseUserConfig', () => {
  it('reads a nested document into the shape the resolver expects', () => {
    const out = parseUserConfig('editor:\n  lineHeight: 1.75\n  theme: gruvbox\n');
    expect(resolveSettings(out.values).value['editor.lineHeight']).toBe(1.75);
    expect(out.diagnostics).toEqual([]);
  });

  it('degrades to defaults with one diagnostic when the YAML is broken', () => {
    const out = parseUserConfig('editor:\n  lineHeight: [1.6\n');
    expect(out.values).toEqual({});
    expect(out.diagnostics.length).toBeGreaterThan(0);
  });

  it('treats an empty file as an empty config, not an error', () => {
    expect(parseUserConfig('').diagnostics).toEqual([]);
    expect(parseUserConfig('# only a comment\n').values).toEqual({});
  });

  it('refuses a top-level scalar', () => {
    expect(parseUserConfig('nope\n').diagnostics).toHaveLength(1);
  });

  it('collects inline themes and keys them by their mapping key', () => {
    const out = parseUserConfig(
      'themes:\n  nord:\n    base: dark\n    chrome:\n      ink: "#eceff4"\n',
    );
    expect(out.themes).toHaveLength(1);
    expect(out.themes[0]?.id).toBe('nord');
    expect(out.diagnostics).toEqual([]);
  });

  it('refuses to let a user theme shadow a built-in id', () => {
    const out = parseUserConfig('themes:\n  gruvbox:\n    base: dark\n');
    expect(out.themes).toHaveLength(0);
    expect(out.diagnostics[0]?.message).toContain('built-in');
  });

  it('reports an unknown token with the path that names it', () => {
    const out = parseUserConfig('themes:\n  nord:\n    chrome:\n      bg.wallpaper: "#000"\n');
    expect(out.themes).toHaveLength(0);
    expect(out.diagnostics[0]?.path).toContain('themes.nord');
  });
});

describe('parseThemeFile', () => {
  it('takes its id from the filename', () => {
    const out = parseThemeFile('nord-night.yml', 'base: dark\nchrome:\n  ink: "#eceff4"\n');
    expect(out.theme?.id).toBe('nord-night');
  });

  it('lets the document override the filename id', () => {
    const out = parseThemeFile('whatever.yaml', 'id: nord\nbase: dark\n');
    expect(out.theme?.id).toBe('nord');
  });
});

describe('writeSettingToYaml', () => {
  it('sets a nested key, creating the block', () => {
    const { text, written } = writeSettingToYaml('', 'editor.lineHeight', 1.8);
    expect(written).toBe(true);
    expect(resolveSettings(parseUserConfig(text).values).value['editor.lineHeight']).toBe(1.8);
  });

  it('keeps the comments around what it edits — the whole point of writing YAML in place', () => {
    const before = [
      '# my config',
      'editor:',
      '  # I like a loose measure',
      '  lineHeight: 1.6',
      '  theme: gruvbox',
      '',
    ].join('\n');
    const { text } = writeSettingToYaml(before, 'editor.lineHeight', 1.9);
    expect(text).toContain('# my config');
    expect(text).toContain('# I like a loose measure');
    expect(text).toContain('lineHeight: 1.9');
    expect(text).toContain('theme: gruvbox');
  });

  it('deletes the key on null, and prunes the block it emptied', () => {
    const { text } = writeSettingToYaml('editor:\n  lineHeight: 1.9\n', 'editor.lineHeight', null);
    expect(text).not.toContain('lineHeight');
    expect(text).not.toContain('editor:');
  });

  it('keeps a block that still has siblings', () => {
    const { text } = writeSettingToYaml(
      'editor:\n  lineHeight: 1.9\n  theme: gruvbox\n',
      'editor.lineHeight',
      null,
    );
    expect(text).toContain('theme: gruvbox');
  });

  it('shrugs off a delete of a key whose block is not in the file at all', () => {
    // "Reset to default" on a fresh config: the commonest write there is.
    const seeded = defaultConfigYaml();
    const out = writeSettingToYaml(seeded, 'editor.contentWidthCh', null);
    expect(out.written).toBe(true);
    expect(parseUserConfig(out.text).values).toEqual({});
    expect(out.text).toContain('# SUNA configuration.');
  });

  it('refuses to rewrite a file whose YAML is broken, rather than losing an in-progress edit', () => {
    const broken = 'editor:\n  lineHeight: [1.6\n';
    const out = writeSettingToYaml(broken, 'editor.lineHeight', 1.9);
    expect(out.written).toBe(false);
    expect(out.text).toBe(broken);
    expect(out.error).toBeTruthy();
  });
});

describe('writing into the seeded file', () => {
  it('keeps the whole comment block, which is the only thing a fresh file contains', () => {
    const seeded = defaultConfigYaml();
    const { text, written } = writeSettingToYaml(seeded, 'editor.lineHeight', 1.9);
    expect(written).toBe(true);
    expect(text).toContain('# SUNA configuration.');
    expect(text).toContain('#  contentWidthCh: 140');
    expect(resolveSettings(parseUserConfig(text).values).value['editor.lineHeight']).toBe(1.9);
  });

  it('survives a run of writes into it — the onboarding wizard does exactly this', () => {
    let text = defaultConfigYaml();
    const writes: [Parameters<typeof writeSettingToYaml>[1], unknown][] = [
      ['ai.mode', 'cli'],
      ['ai.cliCommand', null],
      ['editor.defaultMode', 'reading'],
      ['editor.editorTheme', 'gruvbox'],
      ['editor.fontSizePx', 16],
    ];
    for (const [key, value] of writes) {
      const out = writeSettingToYaml(text, key, value);
      expect(out.written, `${key}: ${out.error ?? ''}`).toBe(true);
      text = out.text;
    }
    const resolved = resolveSettings(parseUserConfig(text).values);
    expect(resolved.value['editor.fontSizePx']).toBe(16);
    expect(resolved.value['editor.editorTheme']).toBe('gruvbox');
    expect(resolved.value['ai.mode']).toBe('cli');
    // The cleared key never landed, so it still reads as the default.
    expect(resolved.sources['ai.cliCommand']).toBe('default');
    expect(text).toContain('# SUNA configuration.');
  });
});

describe('the file stays hand-editable', () => {
  it('writes BLOCK style, never a flow map on one line', () => {
    const { text } = writeSettingToYaml(defaultConfigYaml(), 'editor.lineHeight', 1.9);
    expect(text).not.toContain('{ editor:');
    expect(text).toMatch(/^editor:$/m);
    expect(text).toMatch(/^ {2}lineHeight: 1\.9$/m);
  });

  it('lets a hand-appended block parse alongside what the GUI wrote', () => {
    // The real failure this guards: a flow map left by the GUI turned an
    // appended `editor:` block into a duplicate key, and the whole file
    // stopped parsing — so a hand edit silently did nothing.
    const written = writeSettingToYaml(defaultConfigYaml(), 'editor.vimMotions', true).text;
    const handEdited = `${written}\nui:\n  radiusPx: 0\n`;
    const parsed = parseUserConfig(handEdited);
    expect(parsed.diagnostics).toEqual([]);
    const resolved = resolveSettings(parsed.values);
    expect(resolved.value['editor.vimMotions']).toBe(true);
    expect(resolved.value['ui.radiusPx']).toBe(0);
  });

  it('goes back to comments only when the last key is reset away', () => {
    const written = writeSettingToYaml(defaultConfigYaml(), 'editor.lineHeight', 1.9).text;
    const cleared = writeSettingToYaml(written, 'editor.lineHeight', null).text;
    expect(cleared).not.toContain('{}');
    expect(parseUserConfig(cleared).values).toEqual({});
    expect(cleared).toContain('# SUNA configuration.');
  });
});

describe('migrateLegacySettings', () => {
  it('carries an existing installation across, renaming editor.theme', () => {
    const { text, migrated } = migrateLegacySettings(defaultConfigYaml(), {
      'editor.vimMotions': true,
      'editor.contentWidthCh': 120,
      'editor.theme': 'gruvbox',
      'references.autoOpenPdf': false,
      'ai.model': 'haiku',
    });
    const resolved = resolveSettings(parseUserConfig(text).values);
    expect(resolved.value['editor.vimMotions']).toBe(true);
    expect(resolved.value['editor.contentWidthCh']).toBe(120);
    expect(resolved.value['editor.editorTheme']).toBe('gruvbox');
    expect(resolved.value['references.autoOpenPdf']).toBe(false);
    expect(resolved.value['ai.model']).toBe('haiku');
    expect(migrated).toContain('editor.editorTheme');
    // and the file is still the documented, commented one
    expect(text).toContain('# SUNA configuration.');
  });

  it('drops a value that no longer validates instead of planting a diagnostic', () => {
    // 'mono-blue' is a well-formed slug that no longer names a theme — it
    // split into -dark/-light. Migrating it would leave a diagnostic on every
    // launch for a preference that cannot be honoured anyway.
    const { text, migrated } = migrateLegacySettings(defaultConfigYaml(), {
      'editor.theme': 'mono-blue',
      'editor.contentWidthCh': 9999,
    });
    expect(migrated).toEqual([]);
    const parsed = parseUserConfig(text);
    expect(parsed.diagnostics).toEqual([]);
    expect(resolveSettings(parsed.values).problems).toEqual([]);
  });

  it('ignores machine state, which stays in userData', () => {
    const { text, migrated } = migrateLegacySettings(defaultConfigYaml(), {
      recentProjects: [{ path: '/a', name: 'a', lastOpenedAt: '2026-01-01T00:00:00Z' }],
      'env.selected:/some/project': '/some/project/.venv',
      'palette.recents./some/project': [],
    });
    expect(migrated).toEqual([]);
    expect(parseUserConfig(text).values).toEqual({});
  });

  it('does nothing with an empty settings bag', () => {
    const { migrated } = migrateLegacySettings(defaultConfigYaml(), {});
    expect(migrated).toEqual([]);
  });
});

describe('defaultConfigYaml', () => {
  const yaml = defaultConfigYaml();

  it('parses to an empty config, because every key ships commented out', () => {
    const out = parseUserConfig(yaml);
    expect(out.diagnostics).toEqual([]);
    expect(out.values).toEqual({});
  });

  it('mentions every setting, so the file is its own documentation', () => {
    for (const key of SETTING_KEY_LIST) {
      const path = SETTING_KEYS[key].path;
      expect(yaml, key).toContain(`${path[path.length - 1] as string}:`);
    }
  });

  it('becomes a working config once the comment markers come off', () => {
    const uncommented = yaml
      .split('\n')
      .filter((line) => /^#\s*[a-z][\w.-]*:/.test(line))
      .map((line) => line.slice(1))
      .join('\n');
    const out = parseUserConfig(uncommented);
    expect(out.diagnostics).toEqual([]);
    const resolution = resolveSettings(out.values);
    expect(resolution.problems).toEqual([]);
  });
});
