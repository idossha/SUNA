import { describe, expect, it } from 'vitest';
import {
  BUILTIN_THEME_DEFINITIONS,
  BUILTIN_THEME_IDS,
  CHROME_TOKENS,
  EDITOR_TOKENS,
  SYNTAX_TOKENS,
  ThemeDefinitionSchema,
  resolveTheme,
  resolveThemes,
  themeCss,
} from './theme';

const ALL_VARS = [...CHROME_TOKENS, ...EDITOR_TOKENS, ...SYNTAX_TOKENS].map((t) => t.cssVar);

describe('the shipped themes', () => {
  it('resolves every token of every built-in, so no surface falls back to nothing', () => {
    for (const theme of resolveThemes()) {
      for (const cssVar of ALL_VARS) {
        expect(theme.vars[cssVar], `${theme.id} ${cssVar}`).toBeDefined();
      }
    }
  });

  it('keeps the ids the settings surface names', () => {
    expect(BUILTIN_THEME_IDS).toEqual([
      'suna-dark',
      'suna-light',
      'gruvbox',
      'jellybeans',
      'mono-blue-dark',
      'mono-blue-light',
    ]);
  });

  it('validates against its own schema', () => {
    for (const definition of BUILTIN_THEME_DEFINITIONS) {
      const parsed = ThemeDefinitionSchema.safeParse(definition);
      expect(parsed.success, definition.id).toBe(true);
    }
  });

  it('carries the exported response hex on the light themes and a legible stand-in on the dark ones', () => {
    const byId = new Map(resolveThemes().map((t) => [t.id, t]));
    expect(byId.get('suna-light')?.vars['--s-role-reply']).toBe('#0432ff');
    expect(byId.get('mono-blue-light')?.vars['--s-role-change']).toBe('#ee0000');
    expect(byId.get('suna-dark')?.vars['--s-role-reply']).toBe('#7fa6ff');
  });

  it('inherits the graph lanes into the themes that never restated them', () => {
    const byId = new Map(resolveThemes().map((t) => [t.id, t]));
    expect(byId.get('gruvbox')?.vars['--s-graph-4']).toBe(
      byId.get('suna-dark')?.vars['--s-graph-4'],
    );
    // ...but not into one that did.
    expect(byId.get('mono-blue-dark')?.vars['--s-graph-4']).toBe('#3f7fb3');
  });
});

describe('a user theme', () => {
  const known = new Map(resolveThemes().map((t) => [t.id, t]));

  it('needs only a handful of chrome colours to produce a complete theme', () => {
    const theme = resolveTheme(
      { id: 'minimal', base: 'dark', chrome: { 'bg.editor': '#111111', ink: '#eeeeee' } },
      known,
    );
    for (const cssVar of ALL_VARS) expect(theme.vars[cssVar], cssVar).toBeDefined();
    // The editor layer derived what it was not told.
    expect(theme.vars['--ed-bg']).toBe('#111111');
    expect(theme.vars['--ed-ink']).toBe('#eeeeee');
  });

  it('resolves palette names, including through one level of aliasing', () => {
    const theme = resolveTheme(
      {
        id: 'nord',
        base: 'dark',
        palette: { base: '#2e3440', shell: 'base' },
        chrome: { 'bg.shell': 'shell', accent: '#88c0d0' },
      },
      known,
    );
    expect(theme.vars['--s-bg-shell']).toBe('#2e3440');
    expect(theme.vars['--s-accent']).toBe('#88c0d0');
  });

  it('inherits from another theme by id', () => {
    const theme = resolveTheme(
      { id: 'gruvbox-soft', base: 'dark', extends: 'gruvbox', chrome: { 'bg.shell': '#32302f' } },
      known,
    );
    expect(theme.vars['--s-bg-shell']).toBe('#32302f');
    expect(theme.vars['--s-accent']).toBe('#fabd2f');
  });

  it('degrades to the base theme when its parent does not exist', () => {
    const theme = resolveTheme({ id: 'orphan', base: 'light', extends: 'gone' }, known);
    expect(theme.vars['--s-bg-shell']).toBeDefined();
  });

  it('does not loop on a palette entry that points at itself', () => {
    const theme = resolveTheme(
      { id: 'silly', base: 'dark', palette: { a: 'a' }, chrome: { ink: 'a' } },
      known,
    );
    expect(theme.vars['--s-ink']).toBe('a');
  });

  it('resolves in dependency order even when a user theme extends a user theme', () => {
    const themes = resolveThemes([
      { id: 'child', base: 'dark', extends: 'parent', chrome: {} },
      { id: 'parent', base: 'dark', extends: 'gruvbox', chrome: { accent: '#ff0000' } },
    ]);
    expect(themes.find((t) => t.id === 'child')?.vars['--s-accent']).toBe('#ff0000');
  });

  it('rejects a token name that is not in the contract', () => {
    const parsed = ThemeDefinitionSchema.safeParse({ chrome: { 'bg.wallpaper': '#000' } });
    expect(parsed.success).toBe(false);
  });
});

describe('themeCss', () => {
  const css = themeCss(resolveThemes().find((t) => t.id === 'gruvbox') as never);

  it('scopes chrome to the app and body, and the editor layer to the editor tab', () => {
    expect(css).toContain('.app[data-suna-theme="gruvbox"]');
    expect(css).toContain('body[data-suna-theme="gruvbox"]');
    expect(css).toContain('.editor-tab--theme-gruvbox');
  });

  it('puts chrome vars only in the chrome scope', () => {
    const [chromeBlock, editorBlock] = css.split('.editor-tab--theme-');
    expect(chromeBlock).toContain('--s-accent: #fabd2f;');
    expect(chromeBlock).not.toContain('--ed-bg:');
    expect(editorBlock).toContain('--ed-bg: #282828;');
    expect(editorBlock).not.toContain('--s-accent:');
  });

  it('declares color-scheme so native scrollbars and form controls follow', () => {
    expect(css).toContain('color-scheme: dark;');
  });
});
