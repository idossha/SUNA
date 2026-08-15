import { z } from 'zod';
import { UiLitProviderIdSchema, type UiLitProviderId } from './lit';
import {
  EditorFontFamilySchema,
  EditorThemeIdSchema,
  EditorViewModeSchema,
  AiModeSchema,
  FigureWidthPresetSchema,
  ProjectSettingsSchema,
  SETTINGS_LIMITS,
  type AiMode,
  type EditorFontFamily,
  type EditorThemeId,
  type EditorViewMode,
  type FigureWidthPreset,
  type ProjectSettings,
} from './project';

/**
 * The settings hierarchy (feature-plan-5 §4): project value ?? global value ??
 * built-in default, with the winning level reported so the UI can label it
 * ("from project" / "from global" / "default") and offer "Reset to global".
 *
 * Pure by construction — no fs, no IPC, no stores. The main process owns
 * userData/settings.json (global) and suna.json (project); this module only
 * decides what the two of them mean together.
 *
 * Key naming rule, so three zones can agree without reading this file twice:
 * a resolved key IS the dot-path of the value inside suna.json's `settings`
 * object. 'editor.contentWidthCh' lives at `settings.editor.contentWidthCh`.
 * Global settings use the same string, with one legacy exception noted on
 * 'editor.editorTheme' below.
 */

export type SettingSource = 'project' | 'global' | 'default';

export interface ResolvedSettings {
  /** null = follow the manifest's activeProfileId. */
  previewProfileId: string | null;
  'editor.defaultMode': EditorViewMode;
  'editor.contentWidthCh': number;
  'editor.fontSizePx': number;
  'editor.lineHeight': number;
  'editor.fontFamily': EditorFontFamily;
  'editor.editorTheme': EditorThemeId;
  'editor.vimMotions': boolean;
  'figures.defaultWidthPreset': FigureWidthPreset;
  /** null = no env pinned; the per-machine pick in global settings applies. */
  'python.envPath': string | null;
  /** null = let the picker choose (it prefers a detected agent CLI). */
  'literature.provider': UiLitProviderId | null;
  'ai.mode': AiMode;
  /** null = auto-detect the installed CLI. */
  'ai.cliCommand': string | null;
}

export type ResolvedSettingKey = keyof ResolvedSettings;

/**
 * Shipped defaults. fontSizePx 14 / lineHeight 1.6 are feature-plan-5 §2 — a
 * fresh install and a fresh project must agree on them.
 */
export const SETTINGS_DEFAULTS: ResolvedSettings = {
  previewProfileId: null,
  'editor.defaultMode': 'reading',
  'editor.contentWidthCh': 68,
  'editor.fontSizePx': 14,
  'editor.lineHeight': 1.6,
  'editor.fontFamily': 'serif',
  'editor.editorTheme': 'suna-dark',
  'editor.vimMotions': false,
  'figures.defaultWidthPreset': 'double',
  'python.envPath': null,
  'literature.provider': null,
  'ai.mode': 'cli',
  'ai.cliCommand': null,
};

interface SettingKeyMeta<T> {
  /** Where the value lives inside suna.json's `settings` object. */
  readonly projectPath: readonly [string, ...string[]];
  /**
   * Global-settings keys in lookup order. [0] is where setGlobal writes; the
   * rest are read-only fallbacks for keys the app shipped under another name.
   */
  readonly globalKeys: readonly [string, ...string[]];
  /**
   * Validates a candidate from either level. A value that fails falls through
   * to the next level instead of throwing: one bad hand-typed number must not
   * take the whole settings surface down.
   */
  readonly schema: z.ZodType<NonNullable<T>>;
}

const bounded = (limits: { min: number; max: number }): z.ZodType<number> =>
  z.number().min(limits.min).max(limits.max);

export const SETTING_KEYS: {
  readonly [K in ResolvedSettingKey]: SettingKeyMeta<ResolvedSettings[K]>;
} = {
  previewProfileId: {
    projectPath: ['previewProfileId'],
    globalKeys: ['previewProfileId'],
    schema: z.string().min(1),
  },
  'editor.defaultMode': {
    projectPath: ['editor', 'defaultMode'],
    globalKeys: ['editor.defaultMode'],
    schema: EditorViewModeSchema,
  },
  'editor.contentWidthCh': {
    projectPath: ['editor', 'contentWidthCh'],
    globalKeys: ['editor.contentWidthCh'],
    schema: bounded(SETTINGS_LIMITS.contentWidthCh),
  },
  'editor.fontSizePx': {
    projectPath: ['editor', 'fontSizePx'],
    globalKeys: ['editor.fontSizePx'],
    schema: bounded(SETTINGS_LIMITS.fontSizePx),
  },
  'editor.lineHeight': {
    projectPath: ['editor', 'lineHeight'],
    globalKeys: ['editor.lineHeight'],
    schema: bounded(SETTINGS_LIMITS.lineHeight),
  },
  'editor.fontFamily': {
    projectPath: ['editor', 'fontFamily'],
    globalKeys: ['editor.fontFamily'],
    schema: EditorFontFamilySchema,
  },
  'editor.editorTheme': {
    projectPath: ['editor', 'editorTheme'],
    // 'editor.theme' is the key the Settings page has always written; it stays
    // the canonical global slot so both APIs keep one source of truth.
    globalKeys: ['editor.theme', 'editor.editorTheme'],
    schema: EditorThemeIdSchema,
  },
  'editor.vimMotions': {
    projectPath: ['editor', 'vimMotions'],
    globalKeys: ['editor.vimMotions'],
    schema: z.boolean(),
  },
  'figures.defaultWidthPreset': {
    projectPath: ['figures', 'defaultWidthPreset'],
    globalKeys: ['figures.defaultWidthPreset'],
    schema: FigureWidthPresetSchema,
  },
  'python.envPath': {
    projectPath: ['python', 'envPath'],
    globalKeys: ['python.envPath'],
    schema: z.string().min(1),
  },
  'literature.provider': {
    projectPath: ['literature', 'provider'],
    globalKeys: ['literature.provider'],
    schema: UiLitProviderIdSchema,
  },
  'ai.mode': {
    projectPath: ['ai', 'mode'],
    globalKeys: ['ai.mode'],
    schema: AiModeSchema,
  },
  'ai.cliCommand': {
    projectPath: ['ai', 'cliCommand'],
    globalKeys: ['ai.cliCommand'],
    schema: z.string().min(1),
  },
};

/** Every resolved key, in declaration order — iterate this, not Object.keys. */
export const SETTING_KEY_LIST = Object.keys(SETTING_KEYS) as ResolvedSettingKey[];

export interface ResolvedSetting<K extends ResolvedSettingKey> {
  value: ResolvedSettings[K];
  source: SettingSource;
}

export interface SettingsResolution {
  value: ResolvedSettings;
  sources: Record<ResolvedSettingKey, SettingSource>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valueAtPath(root: unknown, path: readonly string[]): unknown {
  let cursor: unknown = root;
  for (const segment of path) {
    if (!isPlainObject(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

/**
 * Resolve one key. `null` at either level means "not set" — identical to the
 * key being absent — which is what makes "Reset to global" work on a
 * hand-edited file that spells the reset as `"contentWidthCh": null`.
 */
export function resolveSetting<K extends ResolvedSettingKey>(
  key: K,
  global: Record<string, unknown>,
  project: ProjectSettings | undefined,
): ResolvedSetting<K> {
  const meta = SETTING_KEYS[key];

  const fromProject = valueAtPath(project, meta.projectPath);
  if (fromProject != null) {
    const parsed = meta.schema.safeParse(fromProject);
    if (parsed.success) {
      return { value: parsed.data as ResolvedSettings[K], source: 'project' };
    }
  }

  for (const globalKey of meta.globalKeys) {
    const candidate = global[globalKey];
    if (candidate == null) continue;
    const parsed = meta.schema.safeParse(candidate);
    if (parsed.success) {
      return { value: parsed.data as ResolvedSettings[K], source: 'global' };
    }
  }

  return { value: SETTINGS_DEFAULTS[key], source: 'default' };
}

/** Resolve the whole surface at once — what the renderer store holds. */
export function resolveSettings(
  global: Record<string, unknown>,
  project: ProjectSettings | undefined,
): SettingsResolution {
  // Built key by key through the typed resolveSetting; the accumulator is
  // untyped only because TypeScript cannot narrow a union-keyed assignment.
  const value: Record<string, unknown> = {};
  const sources: Record<string, SettingSource> = {};
  for (const key of SETTING_KEY_LIST) {
    const resolved = resolveSetting(key, global, project);
    value[key] = resolved.value;
    sources[key] = resolved.source;
  }
  return {
    value: value as unknown as ResolvedSettings,
    sources: sources as Record<ResolvedSettingKey, SettingSource>,
  };
}

/**
 * The nested `settings` patch that sets one flat key — the body of a
 * 'project:update-settings' call. Pass null to clear the key (the writer
 * deletes it, so the value falls back to global/default).
 */
export function projectSettingPatch<K extends ResolvedSettingKey>(
  key: K,
  value: ResolvedSettings[K] | null,
): ProjectSettings {
  const path = SETTING_KEYS[key].projectPath;
  let nested: unknown = value;
  for (let i = path.length - 1; i >= 0; i -= 1) {
    nested = { [path[i] as string]: nested };
  }
  // Validates the value on the way out: an out-of-range number is refused here
  // rather than at the far end of the IPC hop.
  return ProjectSettingsSchema.parse(nested);
}

/**
 * Merge a patch into a project's settings block.
 *
 * - plain object + plain object → merged key by key (recursively)
 * - scalar → replaces
 * - null / undefined → DELETES the key (this is how "Reset to global" leaves a
 *   clean suna.json). Deliberately unlike 'manuscript:update', where null
 *   replaces: here a null value and an absent key already mean the same thing.
 * - a group left empty by deletions is pruned; an all-empty block returns
 *   undefined so the writer can drop `settings` entirely.
 */
export function mergeProjectSettings(
  current: unknown,
  patch: ProjectSettings,
): ProjectSettings | undefined {
  const merged = mergeObjects(isPlainObject(current) ? current : {}, patch);
  return merged === undefined ? undefined : (merged as ProjectSettings);
}

function mergeObjects(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value == null) {
      delete out[key];
      continue;
    }
    if (isPlainObject(value)) {
      const base2 = out[key];
      const child = mergeObjects(isPlainObject(base2) ? base2 : {}, value);
      if (child === undefined) delete out[key];
      else out[key] = child;
      continue;
    }
    out[key] = value;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * Apply a settings patch to a whole suna.json object, preserving every other
 * key (including ones this schema version does not know about). Returns a new
 * object; the caller validates it with SunaProjectManifestSchema and writes it
 * atomically.
 */
export function applySettingsPatch(
  manifest: unknown,
  patch: ProjectSettings,
): Record<string, unknown> {
  if (!isPlainObject(manifest)) {
    throw new Error('suna.json does not contain a JSON object');
  }
  const next: Record<string, unknown> = { ...manifest };
  const merged = mergeProjectSettings(next['settings'], patch);
  if (merged === undefined) delete next['settings'];
  else next['settings'] = merged;
  return next;
}
