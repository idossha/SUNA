import { parseDocument, isMap, isCollection, visit, type Document } from 'yaml';
import { z } from 'zod';
import {
  ThemeDefinitionSchema,
  BUILTIN_THEME_IDS,
  type ThemeDefinition,
} from './theme';
import { SETTING_KEYS, SETTING_KEY_LIST, type ResolvedSettingKey } from './settings-resolve';

/**
 * The user config file — `~/.suna/config.yml`.
 *
 * SUNA is configured the way nvim, ghostty and aerospace are: ONE plain-text
 * file the user owns, in a dot-directory, seeded on first launch with every
 * key present and commented out. There is no second, hidden store of the same
 * values — the Settings GUI edits this same file, in place, preserving the
 * comments around what it touches. A power user hand-edits it; everyone else
 * uses the GUI; both see the same result the moment it is written.
 *
 * The file is watched, so an edit in any editor applies live.
 *
 * DIRECTORY LAYOUT
 *   ~/.suna/config.yml      every setting below
 *   ~/.suna/themes/*.yml    one custom theme per file (see theme.ts)
 *
 * Set `SUNA_CONFIG_HOME` to relocate the whole directory (tests do). It is
 * NOT `SUNA_CONFIG_DIR`, which already names the agent-context layer.
 *
 * PRECEDENCE is deliberately flat: config file, then the built-in default.
 * A value the file does not set is the shipped default; a value it sets badly
 * (out of range, misspelled enum) falls back to the default and is reported as
 * a diagnostic rather than taking the surface down.
 */

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

/**
 * The config document is validated key by key through SETTING_KEYS rather than
 * by one big zod object: that keeps the key registry the single source of
 * truth for names, paths, bounds and defaults, and it is what lets one bad
 * value fall through instead of invalidating the file.
 *
 * The two blocks below are the ones with no per-key entry, because they are
 * not scalar settings.
 */
export const UserConfigThemesSchema = z.record(z.string(), ThemeDefinitionSchema);

export interface UserConfigDiagnostic {
  /** Dot-path inside config.yml, e.g. `editor.lineHeight`. */
  path: string;
  message: string;
}

export interface ParsedUserConfig {
  /** The document as a plain object; `{}` when the file is absent or empty. */
  values: Record<string, unknown>;
  /** Inline theme definitions from the `themes:` block, keyed by id. */
  themes: (ThemeDefinition & { id: string })[];
  /** Anything wrong with the file that did not stop it being used. */
  diagnostics: UserConfigDiagnostic[];
}

const EMPTY: ParsedUserConfig = { values: {}, themes: [], diagnostics: [] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse config.yml text. Never throws: a syntactically broken file yields no
 * values and one diagnostic, so the app opens on defaults with a visible
 * explanation instead of failing to start.
 */
export function parseUserConfig(text: string): ParsedUserConfig {
  const doc = parseDocument(text, { prettyErrors: true });
  const diagnostics: UserConfigDiagnostic[] = doc.errors.map((error) => ({
    path: '',
    message: error.message,
  }));
  if (doc.errors.length > 0) return { ...EMPTY, diagnostics };

  const raw: unknown = doc.toJS();
  if (raw == null) return EMPTY;
  if (!isPlainObject(raw)) {
    return {
      ...EMPTY,
      diagnostics: [{ path: '', message: 'config.yml must contain a mapping at the top level' }],
    };
  }

  const themes: (ThemeDefinition & { id: string })[] = [];
  const themeBlock = raw['themes'];
  if (themeBlock !== undefined && themeBlock !== null) {
    if (!isPlainObject(themeBlock)) {
      diagnostics.push({ path: 'themes', message: 'themes must be a mapping of id → theme' });
    } else {
      for (const [id, definition] of Object.entries(themeBlock)) {
        const parsed = parseThemeDefinition(id, definition);
        if (parsed.theme !== null) themes.push(parsed.theme);
        for (const issue of parsed.diagnostics) {
          diagnostics.push({ path: `themes.${id}${issue.path}`, message: issue.message });
        }
      }
    }
  }

  return { values: raw, themes, diagnostics };
}

/**
 * Validate one theme definition, from `themes:` in config.yml or from a file
 * in `~/.suna/themes/`. The id comes from the mapping key or the filename
 * unless the document names its own.
 */
export function parseThemeDefinition(
  id: string,
  definition: unknown,
): { theme: (ThemeDefinition & { id: string }) | null; diagnostics: UserConfigDiagnostic[] } {
  const parsed = ThemeDefinitionSchema.safeParse(definition);
  if (!parsed.success) {
    return {
      theme: null,
      diagnostics: parsed.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? `.${issue.path.join('.')}` : '',
        message: issue.message,
      })),
    };
  }
  const resolvedId = parsed.data.id ?? id;
  const diagnostics: UserConfigDiagnostic[] = [];
  if (BUILTIN_THEME_IDS.includes(resolvedId)) {
    diagnostics.push({
      path: '',
      message: `'${resolvedId}' is a built-in theme; pick another id (use \`extends: ${resolvedId}\` to start from it)`,
    });
    return { theme: null, diagnostics };
  }
  return { theme: { ...parsed.data, id: resolvedId }, diagnostics };
}

/** Parse a standalone `~/.suna/themes/<file>.yml`. */
export function parseThemeFile(
  filename: string,
  text: string,
): { theme: (ThemeDefinition & { id: string }) | null; diagnostics: UserConfigDiagnostic[] } {
  const id = filename.replace(/\.ya?ml$/i, '');
  const doc = parseDocument(text, { prettyErrors: true });
  if (doc.errors.length > 0) {
    return {
      theme: null,
      diagnostics: doc.errors.map((error) => ({ path: '', message: error.message })),
    };
  }
  return parseThemeDefinition(id, doc.toJS() ?? {});
}

/* ------------------------------------------------------------------ */
/* Writing — the GUI's edits, into the user's own file                 */
/* ------------------------------------------------------------------ */

/**
 * Apply one setting to config.yml text, returning the new text.
 *
 * Uses the YAML document API rather than re-serialising a parsed object so
 * that the user's comments, key order and blank lines survive a GUI toggle —
 * the property that makes "the GUI edits the same file you hand-edit"
 * actually livable. A `null` value REMOVES the key, which is how the GUI's
 * "reset to default" leaves a clean file.
 *
 * A file whose YAML is broken is returned unchanged, with `written: false`:
 * silently rewriting a file the user is mid-edit in would lose their work.
 */
export function writeSettingToYaml(
  text: string,
  key: ResolvedSettingKey,
  value: unknown,
): { text: string; written: boolean; error?: string } {
  const doc = parseDocument(text.length === 0 ? '{}\n' : text, { prettyErrors: true });
  if (doc.errors.length > 0) {
    return { text, written: false, error: doc.errors[0]?.message ?? 'config.yml is not valid YAML' };
  }
  if (!isMap(doc.contents)) {
    // The seeded config.yml is ALL comments, so it parses to no contents at
    // all. Give the SAME document a mapping to hang the key on rather than
    // starting a new one: the comment block is what the file is for, and a
    // fresh document would throw every line of it away on the first GUI
    // toggle.
    doc.contents = doc.createNode({}) as unknown as typeof doc.contents;
  }
  return writeInto(doc, key, value);
}

/**
 * Force block style on every collection in the document.
 *
 * A mapping created from scratch (`createNode({})`) serialises FLOW —
 * `{ editor: { lineHeight: 1.8 } }` on one line — and every nested map created
 * under it inherits that. In a file whose entire purpose is being hand-edited
 * that is unusable: it does not look like the commented example above it, and
 * appending a normal `editor:` block below it produces a duplicate key that
 * makes the whole file fail to parse. So: block style, always.
 */
function forceBlockStyle(doc: Document): void {
  if (isCollection(doc.contents)) doc.contents.flow = false;
  visit(doc, {
    Map: (_key, node) => {
      node.flow = false;
    },
    Seq: (_key, node) => {
      node.flow = false;
    },
  });
}

function writeInto(
  doc: Document,
  key: ResolvedSettingKey,
  value: unknown,
): { text: string; written: boolean } {
  const path = [...SETTING_KEYS[key].path];
  if (value === null || value === undefined) {
    // Deleting a key whose block is not in the file is a no-op, not an error:
    // "reset to default" is the commonest write there is, and on a fresh
    // config.yml every key it names is already absent. (yaml's deleteIn throws
    // rather than shrugging when an ancestor is missing.)
    if (doc.hasIn(path)) {
      doc.deleteIn(path);
      pruneEmptyBlocks(doc, path);
    }
  } else {
    doc.setIn(path, value);
  }
  forceBlockStyle(doc);
  // A document emptied by deletions must go back to being comments only: an
  // `{}` left at the end of an otherwise-commented file is both ugly and a
  // trap, since a hand-added block below it is then a second document.
  if (isMap(doc.contents) && doc.contents.items.length === 0) {
    doc.contents = null;
  }
  return { text: doc.toString({ lineWidth: 0 }), written: true };
}

/** After a delete, drop a parent block the delete left empty. */
function pruneEmptyBlocks(doc: Document, path: readonly string[]): void {
  for (let depth = path.length - 1; depth > 0; depth -= 1) {
    const parentPath = path.slice(0, depth);
    const parent = doc.getIn(parentPath);
    if (isMap(parent) && parent.items.length === 0) doc.deleteIn(parentPath);
    else return;
  }
}

/* ------------------------------------------------------------------ */
/* Migration from the settings.json that came before                   */
/* ------------------------------------------------------------------ */

/**
 * Old global-settings key → the setting it becomes. Only keys whose meaning
 * is unchanged; anything per-machine (the env picked for a directory, the
 * recents list) stays in userData, where it belongs.
 *
 * `editor.theme` is the one rename that matters: it is the key the Settings
 * page always wrote, and it becomes `editor.editorTheme`.
 */
export const LEGACY_SETTING_KEYS: Readonly<Record<string, ResolvedSettingKey>> = {
  'editor.defaultMode': 'editor.defaultMode',
  'editor.contentWidthCh': 'editor.contentWidthCh',
  'editor.fontSizePx': 'editor.fontSizePx',
  'editor.lineHeight': 'editor.lineHeight',
  'editor.fontFamily': 'editor.fontFamily',
  'editor.theme': 'editor.editorTheme',
  'editor.editorTheme': 'editor.editorTheme',
  'editor.vimMotions': 'editor.vimMotions',
  'editor.autosave': 'editor.autosave',
  'appearance.uiScale': 'ui.scale',
  'figures.defaultWidthPreset': 'figures.defaultWidthPreset',
  'literature.provider': 'literature.provider',
  'lit.mailto': 'literature.mailto',
  'lit.cli': 'literature.cli',
  'terminal.shell': 'terminal.shell',
  'references.autoOpenPdf': 'references.autoOpenPdf',
  'review.aiDiffs': 'review.aiDiffs',
  'response.colorRoles': 'response.colorRoles',
  'response.quickInsert': 'response.quickInsert',
  'ai.mode': 'ai.mode',
  'ai.cliCommand': 'ai.cliCommand',
  'ai.model': 'ai.model',
  'ai.effort': 'ai.effort',
  'trash.maxFileMb': 'trash.maxFileMb',
  'trash.retentionDays': 'trash.retentionDays',
};

/**
 * Carry an existing installation's settings into a freshly seeded config.yml.
 *
 * Run ONCE, when config.yml is created. Without it, everyone who has ever
 * changed a setting silently reverts to the shipped defaults the first time
 * they open a SUNA that reads this file — which is not a migration, it is
 * losing their preferences and blaming the release notes.
 *
 * A value that no longer validates is dropped rather than written: an old
 * theme id, or a number outside today's bounds, must not land in the new file
 * where it would only produce a diagnostic on every launch.
 */
export function migrateLegacySettings(
  seeded: string,
  legacy: Record<string, unknown>,
): { text: string; migrated: ResolvedSettingKey[] } {
  let text = seeded;
  const migrated: ResolvedSettingKey[] = [];
  for (const [oldKey, key] of Object.entries(LEGACY_SETTING_KEYS)) {
    const value = legacy[oldKey];
    if (value == null) continue;
    if (migrated.includes(key)) continue;
    if (!SETTING_KEYS[key].schema.safeParse(value).success) continue;
    // A theme id from an older SUNA ('mono-blue', before it split into
    // -dark/-light) is a well-formed slug that resolves to nothing. Migrating
    // it would leave the user on the default theme AND a diagnostic on every
    // launch; dropping it leaves them on the default theme, quietly.
    if (key === 'editor.editorTheme' && !BUILTIN_THEME_IDS.includes(value as string)) continue;
    const written = writeSettingToYaml(text, key, value);
    if (!written.written) continue;
    text = written.text;
    migrated.push(key);
  }
  return { text, migrated };
}

/* ------------------------------------------------------------------ */
/* The seeded default file                                             */
/* ------------------------------------------------------------------ */

/**
 * The config.yml SUNA writes on first launch: every key present, every key
 * commented out, each with what it does and what it accepts. Commented-out
 * means the shipped default applies AND the user can see what they may change
 * — the same trick ghostty's generated config uses, and the reason a power
 * user never has to read our docs to find a key.
 *
 * Generated from SETTING_KEYS so it cannot drift from the real surface.
 */
export function defaultConfigYaml(): string {
  const lines: string[] = [
    '# SUNA configuration.',
    '#',
    '# Everything below is commented out and shows the shipped default. Uncomment',
    '# a line to change it. The file is watched: saving applies it immediately.',
    '#',
    '# The Settings GUI edits this same file in place and preserves your comments,',
    '# so you can use either, or both.',
    '#',
    '# Custom colour themes go in ~/.suna/themes/<name>.yml, or in the `themes:`',
    '# block at the bottom of this file. See the theme reference:',
    '#   docs/CONFIGURATION.md',
    '',
  ];

  let currentBlock: string | null = null;
  for (const key of SETTING_KEY_LIST) {
    const meta = SETTING_KEYS[key];
    const path = meta.path;
    const block = path.length > 1 ? (path[0] as string) : null;
    if (block !== currentBlock) {
      if (currentBlock !== null) lines.push('');
      if (block !== null) lines.push(`# ${BLOCK_NOTES[block] ?? block}`, `#${block}:`);
      currentBlock = block;
    }
    const indent = path.length > 1 ? '  ' : '';
    for (const line of meta.doc.split('\n')) lines.push(`#${indent}# ${line}`);
    const leaf = path[path.length - 1] as string;
    lines.push(`#${indent}${leaf}: ${yamlScalar(meta.default)}`);
  }

  lines.push(
    '',
    '# Custom themes, inline. One entry per theme id; the same shape as a file in',
    '# ~/.suna/themes/. Only the tokens you name change; the rest are inherited.',
    '#themes:',
    '#  nord-night:',
    '#    name: Nord Night',
    '#    base: dark',
    '#    extends: suna-dark',
    '#    palette:',
    '#      base: "#2e3440"',
    '#      surface: "#3b4252"',
    '#      frost: "#88c0d0"',
    '#    chrome:',
    '#      bg.chrome: base',
    '#      bg.shell: base',
    '#      bg.panel: surface',
    '#      bg.editor: base',
    '#      ink: "#eceff4"',
    '#      accent: frost',
    '#    syntax:',
    '#      heading: frost',
    '#      keyword: "#81a1c1"',
    '',
  );
  return lines.join('\n');
}

const BLOCK_NOTES: Record<string, string> = {
  editor: 'The writing surface: measure, type, theme, motions.',
  ui: 'App chrome geometry and type. Shared by every theme.',
  figures: 'Defaults applied to newly created figures.',
  python: 'The interpreter notebooks and analysis code run under.',
  literature: 'Literature search: which provider, and who to identify as.',
  ai: 'How SUNA talks to a model, and how hard it thinks.',
  review: "How the AI's unreviewed changes are shown.",
  response: 'Response-letter authoring.',
  references: 'The References view.',
  terminal: 'The integrated terminal.',
  trash: 'What happens to a file you delete.',
  preview: 'Which journal profile the preview and render surfaces use.',
};

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value.length === 0 ? '""' : JSON.stringify(value);
  return String(value);
}

/* ------------------------------------------------------------------ */
/* The IPC payload                                                     */
/* ------------------------------------------------------------------ */

export const ConfigDiagnosticSchema = z.object({
  /** Dot-path in config.yml, or `themes/<file>` for a theme file. '' = the file itself. */
  path: z.string(),
  message: z.string(),
});

export const ConfigThemeSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  base: z.enum(['dark', 'light']),
  builtin: z.boolean(),
});

/**
 * Everything the renderer needs to paint the configured app, in one payload.
 *
 * `settings` and `sources` are open records rather than a re-declaration of
 * ResolvedSettings: the typed shape already lives in settings-resolve.ts, and
 * spelling it twice would make adding a setting a two-file edit that silently
 * half-works when you forget the second file. The renderer casts once, at the
 * store boundary.
 */
export const LoadedConfigSchema = z.object({
  /**
   * Monotonic, bumped on every reload in the main process. The renderer adopts
   * a config only if it is NEWER than what it holds: a `config:set` reply can
   * land after a file-watch push that already superseded it, and adopting it
   * would silently roll the UI back to the state before someone's hand edit.
   */
  revision: z.number(),
  path: z.string(),
  text: z.string(),
  settings: z.record(z.string(), z.unknown()),
  sources: z.record(z.string(), z.enum(['config', 'default'])),
  themesCss: z.string(),
  themes: z.array(ConfigThemeSummarySchema),
  diagnostics: z.array(ConfigDiagnosticSchema),
});
export type LoadedConfigPayload = z.infer<typeof LoadedConfigSchema>;
