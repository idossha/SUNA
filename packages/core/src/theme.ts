import { z } from 'zod';

/**
 * The theme contract — what a palette is allowed to say, and which CSS custom
 * property each thing it says lands on.
 *
 * SUNA's UI has never hard-coded a colour: every surface, every piece of ink
 * and every syntax token already reads a `--s-*` (app chrome) or `--ed-*`
 * (editor surface) custom property. This module turns that implicit contract
 * into an explicit, validated one so a theme can arrive from a user's
 * `~/.suna/themes/*.yml` and be exactly as first-class as a shipped one.
 *
 * THREE LAYERS, and the reason they are separate:
 *
 *   chrome  (--s-*)   The window around the work: title bar, activity bar,
 *                     explorer, panels, status bar, dialogs, the commit graph.
 *                     Owns the surface ramp, the ink ramp, the single accent,
 *                     and the semantic colours.
 *   editor  (--ed-*)  The writing surface itself. A separate layer because a
 *                     manuscript is often wanted on paper-coloured stock
 *                     inside dark chrome (and vice versa), and because the
 *                     editor's selection/active-line need their own tuning
 *                     against a page of prose rather than against a list row.
 *   syntax  (--ed-syn-*)  Markdown/code token colours inside the editor.
 *                     Split out from `editor` because it is the layer people
 *                     port from a vim colourscheme, and the one most themes
 *                     want to say the most about.
 *
 * A theme names only what it wants to change. Everything else is inherited,
 * in this order: the theme's own `extends` target → the base theme for its
 * `base` ('dark' → suna-dark, 'light' → suna-light). The `editor` and `syntax`
 * layers additionally fall back to derived chrome values, so a palette that
 * says nothing but eight chrome colours still produces a coherent editor.
 *
 * Metrics (bar heights, radius, font stacks, type scale) are deliberately NOT
 * themeable here: they are layout, they are shared by every theme, and they
 * are configured per-user in `config.yml` under `ui:` instead.
 */

/* ------------------------------------------------------------------ */
/* The token registry — the documented element list                    */
/* ------------------------------------------------------------------ */

export type ThemeLayer = 'chrome' | 'editor' | 'syntax';

export interface ThemeTokenMeta {
  /** Dot-path a theme file uses inside its layer block (e.g. `bg.panel`). */
  readonly key: string;
  /** The CSS custom property it lands on. */
  readonly cssVar: string;
  /** What it paints, in the words a theme author needs. */
  readonly describes: string;
  /**
   * When the theme does not set it: another token key in the SAME layer, or
   * `null` when the value must come from an inherited theme.
   */
  readonly fallback: string | null;
}

const chromeToken = (
  key: string,
  cssVar: string,
  describes: string,
  fallback: string | null = null,
): ThemeTokenMeta => ({ key, cssVar, describes, fallback });

/**
 * Chrome tokens, in the order a theme file should read: surfaces darkest to
 * lightest, then ink, then the accent, then the things that only appear when
 * something happened.
 */
export const CHROME_TOKENS: readonly ThemeTokenMeta[] = [
  chromeToken('bg.chrome', '--s-bg-chrome', 'Window frame: title bar and activity bar'),
  chromeToken('bg.shell', '--s-bg-shell', 'Shell behind the panes; the app background'),
  chromeToken('bg.panel', '--s-bg-panel', 'Side panels: explorer, references, review'),
  chromeToken('bg.editor', '--s-bg-editor', 'Chrome-side editor surface (tab strip, gutters)'),
  chromeToken('bg.raised', '--s-bg-raised', 'Things that float: menus, popovers, dialogs'),
  chromeToken('bg.hover', '--s-bg-hover', 'Hover wash over a row or button; use a translucent value'),
  chromeToken('bg.active', '--s-bg-active', 'The active tab / current item; usually the accent, tinted'),
  chromeToken('bg.selected', '--s-bg-selected', 'Selected rows in a list; must read above hover'),
  chromeToken('ink', '--s-ink', 'Primary text'),
  chromeToken('ink.muted', '--s-ink-muted', 'Secondary text: labels, inactive tabs', 'ink'),
  chromeToken('ink.faint', '--s-ink-faint', 'Tertiary text: hints, disabled, line numbers', 'ink.muted'),
  chromeToken('accent', '--s-accent', 'The one accent: focus rings, active indicators, carets'),
  chromeToken('accent.ink', '--s-accent-ink', 'Text ON the accent (a filled button label)', 'bg.chrome'),
  chromeToken('ok', '--s-ok', 'Success: passing checks, clean status'),
  chromeToken('warn', '--s-warn', 'Warning: compliance advisories, unsaved state'),
  chromeToken('err', '--s-err', 'Error: failed checks, conflicts, lint errors'),
  chromeToken('border', '--s-border', 'Ordinary dividers between regions'),
  chromeToken('border.strong', '--s-border-strong', 'Emphasised borders: focused inputs, active pane', 'border'),
  chromeToken('diff.ins', '--s-diff-ins', 'Inserted words in an inline diff; needs to survive under prose', 'ok'),
  chromeToken('role.comment', '--s-role-comment', "A reviewer's comment in a response letter", 'ink'),
  chromeToken('role.reply', '--s-role-reply', 'Our reply in a response letter'),
  chromeToken('role.change', '--s-role-change', 'Quoted manuscript text that changed'),
  chromeToken('graph.0', '--s-graph-0', 'Commit-graph lane 0 — the branch you are on; usually the accent', 'accent'),
  chromeToken('graph.1', '--s-graph-1', 'Commit-graph lane 1', 'ink.muted'),
  chromeToken('graph.2', '--s-graph-2', 'Commit-graph lane 2', 'ink.muted'),
  chromeToken('graph.3', '--s-graph-3', 'Commit-graph lane 3', 'ink.muted'),
  chromeToken('graph.4', '--s-graph-4', 'Commit-graph lane 4', 'ink.muted'),
  chromeToken('graph.5', '--s-graph-5', 'Commit-graph lane 5', 'ink.muted'),
  chromeToken('graph.6', '--s-graph-6', 'Commit-graph lane 6', 'ink.muted'),
  chromeToken('graph.7', '--s-graph-7', 'Commit-graph lane 7', 'ink.muted'),
];

/**
 * Editor tokens. Every one falls back to its chrome counterpart, which is what
 * lets a theme say nothing at all about the editor and still get one.
 */
export const EDITOR_TOKENS: readonly ThemeTokenMeta[] = [
  chromeToken('bg', '--ed-bg', 'The page you write on', 'chrome:bg.editor'),
  chromeToken('ink', '--ed-ink', 'Body text in the editor', 'chrome:ink'),
  chromeToken('ink.muted', '--ed-ink-muted', 'Block quotes, the active line number', 'chrome:ink.muted'),
  chromeToken('ink.faint', '--ed-ink-faint', 'Line numbers, markdown punctuation, comments', 'chrome:ink.faint'),
  chromeToken('accent', '--ed-accent', 'Caret and editor focus colour', 'chrome:accent'),
  chromeToken('border', '--ed-border', 'Rules inside the editor: hr, table lines, callouts', 'chrome:border.strong'),
  chromeToken('selection', '--ed-selection', 'Selected text; translucent so prose stays readable through it', 'chrome:bg.selected'),
  chromeToken('activeLine', '--ed-active-line', 'The line the caret is on; keep it barely-there', 'chrome:bg.hover'),
];

/** Syntax tokens — the layer ported from a vim colourscheme. */
export const SYNTAX_TOKENS: readonly ThemeTokenMeta[] = [
  chromeToken('heading', '--ed-syn-heading', 'Markdown headings', 'editor:accent'),
  chromeToken('em', '--ed-syn-em', 'Emphasis (italic)', 'editor:ink'),
  chromeToken('strong', '--ed-syn-strong', 'Strong emphasis (bold)', 'editor:ink'),
  chromeToken('link', '--ed-syn-link', 'Links, URLs, property names', 'editor:accent'),
  chromeToken('code', '--ed-syn-code', 'Inline code, fenced code, strings', 'editor:ink'),
  chromeToken('label', '--ed-syn-label', 'Citation keys, figure labels, cross-references', 'editor:accent'),
  chromeToken('number', '--ed-syn-number', 'Numbers, booleans, null', 'editor:ink.muted'),
  chromeToken('keyword', '--ed-syn-keyword', 'Language keywords in fenced code', 'editor:accent'),
];

export const THEME_TOKENS: Record<ThemeLayer, readonly ThemeTokenMeta[]> = {
  chrome: CHROME_TOKENS,
  editor: EDITOR_TOKENS,
  syntax: SYNTAX_TOKENS,
};

const layerKeys = (tokens: readonly ThemeTokenMeta[]): Set<string> =>
  new Set(tokens.map((t) => t.key));

const CHROME_KEYS = layerKeys(CHROME_TOKENS);
const EDITOR_KEYS = layerKeys(EDITOR_TOKENS);
const SYNTAX_KEYS = layerKeys(SYNTAX_TOKENS);

/* ------------------------------------------------------------------ */
/* The theme file schema                                               */
/* ------------------------------------------------------------------ */

/**
 * A colour, as written in a theme file. Either a CSS colour literal (`#2e3440`,
 * `rgba(255,255,255,.05)`, `transparent`) or the name of an entry in the
 * theme's own `palette:` block. Resolved by `resolveTheme`.
 */
export const ThemeColorSchema = z.string().min(1).max(120);

const layerBlock = (keys: Set<string>): z.ZodType<Record<string, string>> =>
  z.record(z.string(), ThemeColorSchema).superRefine((block, ctx) => {
    for (const key of Object.keys(block)) {
      if (keys.has(key)) continue;
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `unknown token '${key}'. Known: ${[...keys].join(', ')}`,
      });
    }
  });

export const ThemeBaseSchema = z.enum(['dark', 'light']);
export type ThemeBase = z.infer<typeof ThemeBaseSchema>;

export const ThemeDefinitionSchema = z.object({
  /** Stable id — how `ui.theme` in config.yml names it. Defaults to the filename. */
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes only')
    .optional(),
  /** Human name shown in the theme picker. Defaults to the id. */
  name: z.string().min(1).max(80).optional(),
  /**
   * Whether the OS should treat this as a dark or light UI (`color-scheme`,
   * and CodeMirror's own dark flag). Also picks the inheritance root when
   * `extends` is absent.
   */
  base: ThemeBaseSchema.default('dark'),
  /** Inherit every unstated token from this theme id. */
  extends: z.string().min(1).max(64).optional(),
  /** Named colours reusable as values in the layer blocks below. */
  palette: z.record(z.string(), ThemeColorSchema).optional(),
  chrome: layerBlock(CHROME_KEYS).optional(),
  editor: layerBlock(EDITOR_KEYS).optional(),
  syntax: layerBlock(SYNTAX_KEYS).optional(),
});
export type ThemeDefinition = z.infer<typeof ThemeDefinitionSchema>;

/** A theme with every token filled in and every css var ready to emit. */
export interface ResolvedTheme {
  id: string;
  name: string;
  base: ThemeBase;
  /** Whether it shipped with SUNA (picker grouping; not otherwise special). */
  builtin: boolean;
  /** cssVar → colour literal, complete across all three layers. */
  vars: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

const CHROME_BY_KEY = new Map(CHROME_TOKENS.map((t) => [t.key, t]));
const EDITOR_BY_KEY = new Map(EDITOR_TOKENS.map((t) => [t.key, t]));
const SYNTAX_BY_KEY = new Map(SYNTAX_TOKENS.map((t) => [t.key, t]));

/** Follow a `palette:` name; a value that is not a palette key is a literal. */
function literal(value: string, palette: Record<string, string>, seen = 0): string {
  const next = palette[value];
  // Bounded: a palette that points at itself resolves to its own name rather
  // than looping. An invalid colour is inert in CSS, which is the right
  // failure — the rest of the theme still applies.
  if (next === undefined || seen > 8) return value;
  return literal(next, palette, seen + 1);
}

/**
 * Resolve one theme definition against already-resolved themes.
 *
 * `known` must contain the `extends` target and both base themes; the loader
 * resolves in dependency order and passes what it has. An `extends` that does
 * not resolve degrades to the base theme rather than failing: a user who
 * renames a theme file should lose an inheritance, not their whole UI.
 */
export function resolveTheme(
  definition: ThemeDefinition,
  known: ReadonlyMap<string, ResolvedTheme>,
  options: { id?: string; builtin?: boolean } = {},
): ResolvedTheme {
  const id = definition.id ?? options.id ?? 'custom';
  const palette = definition.palette ?? {};
  const root = definition.base === 'light' ? LIGHT_ROOT : DARK_ROOT;
  // An `extends` that does not resolve degrades to the base root rather than
  // to nothing: renaming a theme file should cost you an inheritance, not
  // every colour in your UI.
  const parent =
    (definition.extends !== undefined && definition.extends !== id
      ? known.get(definition.extends)
      : undefined) ?? (root === id ? undefined : known.get(root));
  const vars: Record<string, string> = { ...(parent?.vars ?? {}) };

  /**
   * What THIS theme declared, as css vars. Inherited values are overwritten
   * freely; the set matters for the derivation pass below, which re-derives an
   * editor/syntax token whenever the chrome colour it comes from was changed
   * here. That is what lets a theme say four chrome colours and get a matching
   * editor, instead of four new colours pasted over its parent's editor.
   */
  const declared = new Set<string>();

  // chrome first: the editor and syntax layers fall back into it.
  for (const token of CHROME_TOKENS) {
    const own = definition.chrome?.[token.key];
    if (own === undefined) continue;
    vars[token.cssVar] = literal(own, palette);
    declared.add(token.cssVar);
  }
  for (const token of CHROME_TOKENS) {
    if (vars[token.cssVar] !== undefined) continue;
    const from = token.fallback === null ? undefined : CHROME_BY_KEY.get(token.fallback);
    if (from !== undefined && vars[from.cssVar] !== undefined) {
      vars[token.cssVar] = vars[from.cssVar] as string;
    }
  }

  for (const [tokens, byKey, block] of [
    [EDITOR_TOKENS, EDITOR_BY_KEY, definition.editor],
    [SYNTAX_TOKENS, SYNTAX_BY_KEY, definition.syntax],
  ] as const) {
    for (const token of tokens) {
      const own = block?.[token.key];
      if (own === undefined) continue;
      vars[token.cssVar] = literal(own, palette);
      declared.add(token.cssVar);
    }
    for (const token of tokens) {
      const fallback = token.fallback;
      if (declared.has(token.cssVar)) continue;
      if (fallback === null) continue;
      // 'chrome:bg.editor' / 'editor:accent' / a bare key in this layer.
      const [scope, path] = fallback.includes(':')
        ? (fallback.split(':') as [string, string])
        : ['self', fallback];
      const source =
        scope === 'chrome'
          ? CHROME_BY_KEY.get(path)?.cssVar ?? `--s-${path.replace(/\./g, '-')}`
          : scope === 'editor'
            ? EDITOR_BY_KEY.get(path)?.cssVar ?? `--ed-${path.replace(/\./g, '-')}`
            : byKey.get(path)?.cssVar;
      if (source === undefined || vars[source] === undefined) continue;
      // Derive when there is nothing to derive from an inheritance, or when
      // the colour this token comes from is one THIS theme changed. Without
      // the second half a theme that only re-tints its chrome would keep its
      // parent's editor colours; without the first half, a theme that changed
      // nothing relevant would lose its parent's deliberate editor tuning
      // (gruvbox's selection wash is not its chrome selection wash).
      if (vars[token.cssVar] !== undefined && !declared.has(source)) continue;
      vars[token.cssVar] = vars[source] as string;
    }
  }

  return {
    id,
    name: definition.name ?? parent?.name ?? id,
    base: definition.base,
    builtin: options.builtin ?? false,
    vars,
  };
}

/* ------------------------------------------------------------------ */
/* CSS emission                                                        */
/* ------------------------------------------------------------------ */

const CHROME_VARS = new Set(CHROME_TOKENS.map((t) => t.cssVar));

function declarations(vars: Record<string, string>, chrome: boolean): string {
  return Object.entries(vars)
    .filter(([name]) => CHROME_VARS.has(name) === chrome)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
}

/**
 * The stylesheet for one theme. Two scopes, because the two layers are
 * stamped on different elements:
 *
 *   `.app[data-suna-theme=id]`, `body[data-suna-theme=id]` — chrome. Body too,
 *   so menus portalled to <body> and the body background follow along.
 *   `.editor-tab--theme-<id>` — the editor and syntax layers, on whichever
 *   surface renders text (the editor tab, a notebook, a document view).
 *
 * The id is a validated slug, so it is safe to interpolate into both a
 * selector and an attribute value unescaped.
 */
export function themeCss(theme: ResolvedTheme): string {
  const attr = `[data-suna-theme="${theme.id}"]`;
  return [
    `.app${attr},\nbody${attr} {\n${declarations(theme.vars, true)}\n  color-scheme: ${theme.base};\n}`,
    `.editor-tab--theme-${theme.id} {\n${declarations(theme.vars, false)}\n  background: var(--ed-bg);\n}`,
  ].join('\n\n');
}

/** One stylesheet for every theme the app knows about. */
export function themesCss(themes: readonly ResolvedTheme[]): string {
  return themes.map(themeCss).join('\n\n');
}

/* ------------------------------------------------------------------ */
/* The shipped themes                                                  */
/* ------------------------------------------------------------------ */

export const DARK_ROOT = 'suna-dark';
export const LIGHT_ROOT = 'suna-light';

/**
 * Every theme SUNA ships, as data rather than as CSS, so that a built-in and a
 * user's own `~/.suna/themes/nord.yml` go through exactly the same resolver
 * and reach the DOM by exactly the same route. `styles/tokens.css` therefore
 * carries only metrics and font stacks; the colours all originate here.
 */
export const BUILTIN_THEME_DEFINITIONS: readonly (ThemeDefinition & { id: string })[] = [
  {
    id: 'suna-dark',
    name: 'SUNA Dark',
    base: 'dark',
    chrome: {
      'bg.chrome': '#101014',
      'bg.shell': '#16161c',
      'bg.panel': '#1a1a21',
      'bg.editor': '#1e1e26',
      'bg.raised': '#23232c',
      'bg.hover': 'rgba(255, 255, 255, 0.05)',
      'bg.active': 'rgba(232, 180, 92, 0.12)',
      'bg.selected': 'rgba(232, 180, 92, 0.18)',
      ink: '#e8e6e1',
      'ink.muted': '#a09d97',
      'ink.faint': '#6b6963',
      accent: '#e8b45c',
      'accent.ink': '#16161c',
      ok: '#7fb8a4',
      warn: '#d9915b',
      err: '#d97b6c',
      // The three voices of a response letter. The exported .docx uses black /
      // #0432FF / #EE0000; black on a dark panel is unreadable, so the dark
      // themes carry the same three ROLES at a legible lightness and the light
      // themes resolve to the exported hex exactly.
      'role.comment': '#e8e6e1',
      'role.reply': '#7fa6ff',
      'role.change': '#ff8577',
      // An inserted-word wash sits UNDER prose: the desaturated `ok` teal sank
      // into the dark editor and read as a smudge, so the diff carries its own
      // brighter green here.
      'diff.ins': '#57d9a3',
      border: '#2a2a33',
      'border.strong': '#3a3a45',
      // Eight lanes that stay apart at 2px and stay quieter than the prose
      // beside them. Lane 0 is the accent: it is the branch you are on.
      'graph.0': '#e8b45c',
      'graph.1': '#7fb8a4',
      'graph.2': '#8fa8d9',
      'graph.3': '#d9915b',
      'graph.4': '#b89ad9',
      'graph.5': '#d97b6c',
      'graph.6': '#9fbf7f',
      'graph.7': '#c9a9c9',
    },
    editor: {
      bg: '#1e1e26',
      ink: '#e8e6e1',
      'ink.muted': '#a09d97',
      'ink.faint': '#6b6963',
      accent: '#e8b45c',
      border: '#3a3a45',
      selection: 'rgba(232, 180, 92, 0.18)',
      activeLine: 'rgba(255, 255, 255, 0.03)',
    },
    syntax: {
      heading: '#e8b45c',
      em: '#c9c6f0',
      strong: '#f0ede8',
      link: '#8ab4d8',
      code: '#a8d8b8',
      label: '#d8a8c8',
      number: '#d8b48c',
      keyword: '#c0a0dc',
    },
  },
  {
    id: 'suna-light',
    name: 'SUNA Light',
    base: 'light',
    // Explicitly rooted at the dark theme so the lanes and roles it does not
    // restate still arrive; `base: light` alone would point it at itself.
    extends: 'suna-dark',
    chrome: {
      'bg.chrome': '#ece7dd',
      'bg.shell': '#f2ede3',
      'bg.panel': '#f5f0e6',
      'bg.editor': '#f7f2e9',
      'bg.raised': '#fffdf8',
      'bg.hover': 'rgba(43, 38, 32, 0.06)',
      'bg.active': 'rgba(138, 106, 47, 0.14)',
      'bg.selected': 'rgba(138, 106, 47, 0.2)',
      ink: '#2b2620',
      'ink.muted': '#6b6257',
      'ink.faint': '#9a9184',
      accent: '#8a6a2f',
      'accent.ink': '#fbf7ee',
      ok: '#3f6b4f',
      'diff.ins': '#3f6b4f',
      warn: '#a05c22',
      err: '#b0503f',
      // On paper-coloured surfaces the workspace shows exactly the hex the
      // exported response will contain.
      'role.comment': '#2b2620',
      'role.reply': '#0432ff',
      'role.change': '#ee0000',
      border: '#d8cfbf',
      'border.strong': '#c2b8a5',
      // Darkened lanes: the dark theme's hues vanish on warm paper.
      'graph.0': '#8a6a2f',
      'graph.1': '#2f6b57',
      'graph.2': '#415a94',
      'graph.3': '#a05c22',
      'graph.4': '#6b4a94',
      'graph.5': '#b0503f',
      'graph.6': '#4f7030',
      'graph.7': '#8a4a76',
    },
    editor: {
      bg: '#f7f2e9',
      ink: '#2b2620',
      'ink.muted': '#6b6257',
      'ink.faint': '#9a9184',
      accent: '#8a6a2f',
      border: '#d8cfbf',
      selection: 'rgba(138, 106, 47, 0.22)',
      activeLine: 'rgba(43, 38, 32, 0.045)',
    },
    syntax: {
      heading: '#7a5a1f',
      em: '#4a4668',
      strong: '#1d1913',
      link: '#35618a',
      code: '#3f6b4f',
      label: '#7a4a66',
      number: '#8a5a28',
      keyword: '#6a4a8a',
    },
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    base: 'dark',
    // Inherits SUNA Dark's graph lanes and response-letter roles unchanged —
    // exactly what the CSS this replaced did by simply not restating them.
    extends: 'suna-dark',
    chrome: {
      'bg.chrome': '#1d2021',
      'bg.shell': '#282828',
      'bg.panel': '#32302f',
      'bg.editor': '#282828',
      'bg.raised': '#3c3836',
      'bg.hover': 'rgba(235, 219, 178, 0.07)',
      'bg.active': 'rgba(250, 189, 47, 0.15)',
      'bg.selected': 'rgba(250, 189, 47, 0.22)',
      ink: '#ebdbb2',
      'ink.muted': '#bdae93',
      'ink.faint': '#928374',
      accent: '#fabd2f',
      'accent.ink': '#282828',
      ok: '#b8bb26',
      'diff.ins': '#b8bb26',
      warn: '#fe8019',
      err: '#fb4934',
      border: '#3c3836',
      'border.strong': '#504945',
    },
    editor: {
      bg: '#282828',
      ink: '#ebdbb2',
      'ink.muted': '#bdae93',
      'ink.faint': '#928374',
      accent: '#fabd2f',
      border: '#504945',
      selection: 'rgba(80, 73, 69, 0.6)',
      activeLine: 'rgba(60, 56, 54, 0.5)',
    },
    syntax: {
      heading: '#fabd2f',
      em: '#d3869b',
      strong: '#fbf1c7',
      link: '#83a598',
      code: '#b8bb26',
      label: '#8ec07c',
      number: '#d3869b',
      keyword: '#fb4934',
    },
  },
  {
    id: 'jellybeans',
    name: 'Jellybeans',
    base: 'dark',
    extends: 'suna-dark',
    chrome: {
      'bg.chrome': '#101010',
      'bg.shell': '#151515',
      'bg.panel': '#191919',
      'bg.editor': '#151515',
      'bg.raised': '#1c1c1c',
      'bg.hover': 'rgba(232, 232, 211, 0.06)',
      'bg.active': 'rgba(250, 208, 122, 0.12)',
      'bg.selected': 'rgba(250, 208, 122, 0.18)',
      ink: '#e8e8d3',
      'ink.muted': '#a8a89a',
      'ink.faint': '#888888',
      accent: '#fad07a',
      'accent.ink': '#151515',
      ok: '#99ad6a',
      'diff.ins': '#99ad6a',
      warn: '#ffb964',
      err: '#cf6a4c',
      border: '#252525',
      'border.strong': '#404040',
    },
    editor: {
      bg: '#151515',
      ink: '#e8e8d3',
      'ink.muted': '#a8a89a',
      'ink.faint': '#888888',
      accent: '#fad07a',
      border: '#404040',
      selection: 'rgba(143, 191, 220, 0.2)',
      activeLine: '#1c1c1c',
    },
    syntax: {
      heading: '#fad07a',
      em: '#c6b6ee',
      strong: '#f4f4df',
      link: '#8fbfdc',
      code: '#99ad6a',
      label: '#ffb964',
      number: '#cf6a4c',
      keyword: '#8197bf',
    },
  },
  {
    id: 'mono-blue-dark',
    name: 'Mono Blue Dark',
    base: 'dark',
    extends: 'suna-dark',
    chrome: {
      'bg.chrome': '#0a0a0b',
      'bg.shell': '#0e0e10',
      'bg.panel': '#131315',
      'bg.editor': '#0e0e10',
      'bg.raised': '#1a1a1d',
      'bg.hover': 'rgba(255, 255, 255, 0.06)',
      'bg.active': 'rgba(91, 157, 217, 0.14)',
      'bg.selected': 'rgba(91, 157, 217, 0.2)',
      ink: '#f2f2f2',
      'ink.muted': '#a6a6a8',
      'ink.faint': '#6e6e72',
      accent: '#5b9dd9',
      'accent.ink': '#0a0a0b',
      ok: '#7fae93',
      'diff.ins': '#63c79b',
      warn: '#c9a26a',
      err: '#cf7a72',
      border: '#232326',
      'border.strong': '#3a3a3f',
      // Lanes stay mostly greyscale; the accent leads, with two further blues
      // so a busy history still separates without introducing a new hue.
      'graph.0': '#5b9dd9',
      'graph.1': '#9a9a9e',
      'graph.2': '#7fb6e6',
      'graph.3': '#6e6e72',
      'graph.4': '#3f7fb3',
      'graph.5': '#c4c4c8',
      'graph.6': '#4f4f54',
      'graph.7': '#a8c8e4',
    },
    editor: {
      bg: '#0e0e10',
      ink: '#f2f2f2',
      'ink.muted': '#a6a6a8',
      'ink.faint': '#6e6e72',
      accent: '#5b9dd9',
      border: '#3a3a3f',
      selection: 'rgba(91, 157, 217, 0.22)',
      activeLine: 'rgba(255, 255, 255, 0.035)',
    },
    syntax: {
      heading: '#5b9dd9',
      em: '#c8c8cc',
      strong: '#ffffff',
      link: '#7fb6e6',
      code: '#a8c8e4',
      label: '#8fa8bf',
      number: '#b9b9bd',
      keyword: '#4f8fc4',
    },
  },
  {
    id: 'mono-blue-light',
    name: 'Mono Blue Light',
    base: 'light',
    extends: 'suna-dark',
    chrome: {
      'bg.chrome': '#eaeaee',
      'bg.shell': '#f1f1f4',
      'bg.panel': '#f6f6f8',
      'bg.editor': '#ffffff',
      'bg.raised': '#ffffff',
      'bg.hover': 'rgba(23, 23, 26, 0.06)',
      'bg.active': 'rgba(47, 111, 174, 0.14)',
      'bg.selected': 'rgba(47, 111, 174, 0.2)',
      ink: '#17171a',
      'ink.muted': '#5c5c63',
      'ink.faint': '#8e8e96',
      accent: '#2f6fae',
      'accent.ink': '#ffffff',
      ok: '#2f6b4f',
      'diff.ins': '#2f6b4f',
      warn: '#8a5a1f',
      err: '#a8463a',
      'role.comment': '#17171a',
      'role.reply': '#0432ff',
      'role.change': '#ee0000',
      border: '#dcdce1',
      'border.strong': '#c9c9d0',
      'graph.0': '#2f6fae',
      'graph.1': '#5c5c63',
      'graph.2': '#1f4f80',
      'graph.3': '#8e8e96',
      'graph.4': '#4a86c4',
      'graph.5': '#3a3a40',
      'graph.6': '#6d93b5',
      'graph.7': '#77777f',
    },
    editor: {
      bg: '#ffffff',
      ink: '#17171a',
      'ink.muted': '#5c5c63',
      'ink.faint': '#8e8e96',
      accent: '#2f6fae',
      border: '#c9c9d0',
      selection: 'rgba(47, 111, 174, 0.2)',
      activeLine: 'rgba(23, 23, 26, 0.04)',
    },
    syntax: {
      heading: '#2f6fae',
      em: '#4a4a52',
      strong: '#000000',
      link: '#1f4f80',
      code: '#3a6a90',
      label: '#5a7590',
      number: '#55555c',
      keyword: '#24598c',
    },
  },
];

export const BUILTIN_THEME_IDS: readonly string[] = BUILTIN_THEME_DEFINITIONS.map((t) => t.id);

/**
 * Resolve a set of theme definitions in dependency order.
 *
 * Built-ins resolve first, so a user theme may `extends: gruvbox`. A user
 * theme may also extend another user theme; the pass repeats while progress is
 * being made, and anything still unresolved (a cycle, a missing parent) is
 * resolved last against its base root, which is the degradation described on
 * `resolveTheme`.
 */
export function resolveThemes(
  userThemes: readonly (ThemeDefinition & { id: string })[] = [],
): ResolvedTheme[] {
  const known = new Map<string, ResolvedTheme>();
  const out: ResolvedTheme[] = [];
  for (const definition of BUILTIN_THEME_DEFINITIONS) {
    const resolved = resolveTheme(definition, known, { id: definition.id, builtin: true });
    known.set(resolved.id, resolved);
    out.push(resolved);
  }
  let pending = userThemes.filter((t) => !known.has(t.id));
  while (pending.length > 0) {
    const ready = pending.filter((t) => t.extends === undefined || known.has(t.extends));
    const batch = ready.length > 0 ? ready : pending;
    for (const definition of batch) {
      const resolved = resolveTheme(definition, known, { id: definition.id });
      known.set(resolved.id, resolved);
      out.push(resolved);
    }
    if (ready.length === 0) break;
    pending = pending.filter((t) => !known.has(t.id));
  }
  return out;
}
