import { z } from 'zod';
import { UiLitProviderIdSchema, LitCliPreferenceSchema, type UiLitProviderId, type LitCliPreference } from './lit';
import { TRASH_DEFAULTS, TRASH_LIMITS } from './trash';
import {
  EditorFontFamilySchema,
  EditorThemeIdSchema,
  EditorViewModeSchema,
  AiEffortSchema,
  AiModeSchema,
  AiModelSchema,
  FigureWidthPresetSchema,
  ReviewAiDiffsSchema,
  SETTINGS_LIMITS,
  UI_LIMITS,
  type AiEffort,
  type AiMode,
  type AiModel,
  type EditorFontFamily,
  type EditorThemeId,
  type EditorViewMode,
  type FigureWidthPreset,
  type ReviewAiDiffs,
} from './project';

/**
 * The settings surface, and how a config file becomes it.
 *
 * ONE LEVEL. Every setting lives in `~/.suna/config.yml` (see userconfig.ts);
 * a key the file does not set takes the shipped default. There is no project
 * level and no second global store: an rc file that some other store can
 * silently outrank is the failure mode this design exists to avoid, and it is
 * why the Settings GUI writes into this same file rather than beside it.
 *
 * Pure by construction — no fs, no IPC, no stores. The main process owns
 * reading and writing the file; this module only decides what it means.
 *
 * Key naming rule, so every zone can agree without reading this file twice: a
 * setting key is a dot-path, and `path` below is that same path inside the
 * YAML document. `editor.lineHeight` lives at `editor: { lineHeight: }`.
 */

export type SettingSource = 'config' | 'default';

export interface ResolvedSettings {
  /** null = follow the manifest's activeProfileId. */
  previewProfileId: string | null;

  /* -- the writing surface ------------------------------------------ */
  'editor.defaultMode': EditorViewMode;
  'editor.contentWidthCh': number;
  'editor.fontSizePx': number;
  'editor.lineHeight': number;
  'editor.fontFamily': EditorFontFamily;
  /** A built-in theme id, or the id of one of the user's own themes. */
  'editor.editorTheme': EditorThemeId;
  'editor.vimMotions': boolean;
  /** Save a dirty buffer (and the figure canvas) after a pause in editing. */
  'editor.autosave': boolean;
  /** Show line numbers in the source view's gutter. */
  'editor.lineNumbers': boolean;

  /* -- app chrome geometry, shared by every theme -------------------- */
  'ui.scale': number;
  'ui.titleBarHeightPx': number;
  'ui.activityBarWidthPx': number;
  'ui.statusBarHeightPx': number;
  'ui.radiusPx': number;
  /** Multiplies the whole UI type scale (--s-text-xs … --s-text-lg). */
  'ui.textScale': number;
  /** CSS font stacks; '' keeps the shipped stack. */
  'ui.fontUi': string;
  'ui.fontSerif': string;
  'ui.fontMono': string;

  /* -- documents ----------------------------------------------------- */
  'figures.defaultWidthPreset': FigureWidthPreset;
  /** Double-space exported manuscripts (many journals require it). */
  'export.doubleSpacing': boolean;
  /** Continuous line numbers down the exported manuscript's margin. */
  'export.lineNumbers': boolean;
  /** Page numbers in the exported manuscript. */
  'export.pageNumbers': boolean;

  /* -- tooling -------------------------------------------------------- */
  /** null = no env pinned. */
  'python.envPath': string | null;
  /** null = let the picker choose (it prefers a detected agent CLI). */
  'literature.provider': UiLitProviderId | null;
  /** Polite-pool contact for Crossref/OpenAlex; '' falls back to the git email. */
  'literature.mailto': string;
  /** Which agent CLI the 'ai-cli' literature provider prefers. */
  'literature.cli': LitCliPreference;
  /** Shell override for new terminals; '' means the platform default. */
  'terminal.shell': string;
  /** Auto-open a resolved reference PDF beside the References list. */
  'references.autoOpenPdf': boolean;

  /* -- the AI --------------------------------------------------------- */
  'ai.mode': AiMode;
  /** null = auto-detect the installed CLI. */
  'ai.cliCommand': string | null;
  /** Model tier every AI call runs at — a tier, not a dated model id. */
  'ai.model': AiModel;
  /** Reasoning effort every AI call runs at. */
  'ai.effort': AiEffort;
  /** Show the AI's unreviewed changes inline, red/green at word resolution. */
  'review.aiDiffs': ReviewAiDiffs;

  /* -- response letters ------------------------------------------------ */
  /**
   * Paint the three voices of a response letter — the reviewer's comment, our
   * reply, and quoted manuscript text that is new. Workspace and export both.
   */
  'response.colorRoles': boolean;
  /** Offer the reply box's quick insertions (quote block, change mark, RE:). */
  'response.quickInsert': boolean;

  /* -- deletion -------------------------------------------------------- */
  /**
   * Deleted FILES at or under this many MB go to SUNA's own trash, where they
   * stay restorable; anything bigger (and every directory) goes to the OS
   * trash.
   */
  'trash.maxFileMb': number;
  /** How long a file waits in SUNA's trash before it is passed to the OS trash. */
  'trash.retentionDays': number;
}

export type ResolvedSettingKey = keyof ResolvedSettings;

interface SettingKeyMeta<T> {
  /** Where the value lives inside config.yml. */
  readonly path: readonly [string, ...string[]];
  /**
   * Validates a candidate. A value that fails falls back to the default and is
   * reported: one bad hand-typed number must not take the surface down.
   */
  readonly schema: z.ZodType<NonNullable<T>>;
  /** The shipped value. */
  readonly default: T;
  /** One or two lines, emitted into the seeded config.yml above the key. */
  readonly doc: string;
}

const bounded = (limits: { min: number; max: number }): z.ZodType<number> =>
  z.number().min(limits.min).max(limits.max);

const enumDoc = (values: readonly string[]): string => values.join(' | ');

/**
 * The key registry — the single source of truth for names, YAML paths,
 * validation, defaults and the documentation the seeded config.yml carries.
 * Declaration order is the order the generated file reads in, so keep related
 * keys adjacent.
 */
export const SETTING_KEYS: {
  readonly [K in ResolvedSettingKey]: SettingKeyMeta<ResolvedSettings[K]>;
} = {
  'editor.defaultMode': {
    path: ['editor', 'defaultMode'],
    schema: EditorViewModeSchema,
    default: 'reading',
    doc: `Which view a Markdown file opens in. ${enumDoc(['source', 'reading'])}`,
  },
  'editor.contentWidthCh': {
    path: ['editor', 'contentWidthCh'],
    schema: bounded(SETTINGS_LIMITS.contentWidthCh),
    default: 140,
    doc: `Measure: characters per line before the text column stops growing.\n${SETTINGS_LIMITS.contentWidthCh.min}–${SETTINGS_LIMITS.contentWidthCh.max}.`,
  },
  'editor.fontSizePx': {
    path: ['editor', 'fontSizePx'],
    schema: bounded(SETTINGS_LIMITS.fontSizePx),
    default: 14,
    doc: `Base editor font size in px. ${SETTINGS_LIMITS.fontSizePx.min}–${SETTINGS_LIMITS.fontSizePx.max}.`,
  },
  'editor.lineHeight': {
    path: ['editor', 'lineHeight'],
    schema: bounded(SETTINGS_LIMITS.lineHeight),
    default: 1.6,
    doc: `Line height, as a multiple of the font size. ${SETTINGS_LIMITS.lineHeight.min}–${SETTINGS_LIMITS.lineHeight.max}.`,
  },
  'editor.fontFamily': {
    path: ['editor', 'fontFamily'],
    schema: EditorFontFamilySchema,
    default: 'serif',
    doc: `Body font in reading mode (source stays mono). ${enumDoc(['serif', 'sans', 'mono'])}`,
  },
  'editor.editorTheme': {
    path: ['editor', 'theme'],
    schema: EditorThemeIdSchema,
    default: 'suna-dark',
    doc: 'Theme id: a built-in (suna-dark, suna-light, gruvbox, jellybeans,\nmono-blue-dark, mono-blue-light) or one of your own from ~/.suna/themes/.',
  },
  'editor.vimMotions': {
    path: ['editor', 'vimMotions'],
    schema: z.boolean(),
    default: false,
    doc: 'Vim keymap in the source view.',
  },
  'editor.autosave': {
    path: ['editor', 'autosave'],
    schema: z.boolean(),
    default: true,
    doc: 'Save after a pause in editing instead of waiting for ⌘S.',
  },
  'editor.lineNumbers': {
    path: ['editor', 'lineNumbers'],
    schema: z.boolean(),
    default: true,
    doc: "Line numbers in the source view's gutter.",
  },

  'ui.scale': {
    path: ['ui', 'scale'],
    schema: bounded(UI_LIMITS.scale),
    default: 1,
    doc: `Whole-window zoom. ${UI_LIMITS.scale.min}–${UI_LIMITS.scale.max}.`,
  },
  'ui.titleBarHeightPx': {
    path: ['ui', 'titleBarHeightPx'],
    schema: bounded(UI_LIMITS.titleBarHeightPx),
    default: 40,
    doc: 'Height of the window title bar, in px.',
  },
  'ui.activityBarWidthPx': {
    path: ['ui', 'activityBarWidthPx'],
    schema: bounded(UI_LIMITS.activityBarWidthPx),
    default: 46,
    doc: 'Width of the left activity bar, in px.',
  },
  'ui.statusBarHeightPx': {
    path: ['ui', 'statusBarHeightPx'],
    schema: bounded(UI_LIMITS.statusBarHeightPx),
    default: 24,
    doc: 'Height of the bottom status bar, in px.',
  },
  'ui.radiusPx': {
    path: ['ui', 'radiusPx'],
    schema: bounded(UI_LIMITS.radiusPx),
    default: 4,
    doc: 'Corner radius on buttons, inputs, popovers. 0 for square corners.',
  },
  'ui.textScale': {
    path: ['ui', 'textScale'],
    schema: bounded(UI_LIMITS.textScale),
    default: 1,
    doc: 'Multiplies the chrome type scale (labels, tabs, status bar).\nUnlike ui.scale this leaves geometry alone.',
  },
  'ui.fontUi': {
    path: ['ui', 'fontUi'],
    schema: z.string(),
    default: '',
    doc: 'CSS font stack for the app chrome. Empty keeps the system stack.',
  },
  'ui.fontSerif': {
    path: ['ui', 'fontSerif'],
    schema: z.string(),
    default: '',
    doc: 'CSS font stack for serif body text (reading mode, exports preview).',
  },
  'ui.fontMono': {
    path: ['ui', 'fontMono'],
    schema: z.string(),
    default: '',
    doc: 'CSS font stack for code, the source view and the terminal.',
  },

  'figures.defaultWidthPreset': {
    path: ['figures', 'defaultWidthPreset'],
    schema: FigureWidthPresetSchema,
    default: 'double',
    doc: `Column width a new figure is created at. ${enumDoc(['single', 'onehalf', 'double'])}`,
  },
  'export.doubleSpacing': {
    path: ['export', 'doubleSpacing'],
    schema: z.boolean(),
    default: false,
    doc: 'Double-space exported manuscripts. Many journals require it at submission.',
  },
  'export.lineNumbers': {
    path: ['export', 'lineNumbers'],
    schema: z.boolean(),
    default: false,
    doc: "Continuous line numbers down the exported manuscript's margin.",
  },
  'export.pageNumbers': {
    path: ['export', 'pageNumbers'],
    schema: z.boolean(),
    default: true,
    doc: 'Page numbers in the exported manuscript.',
  },

  previewProfileId: {
    path: ['preview', 'profileId'],
    schema: z.string().min(1),
    default: null,
    doc: "Journal profile the preview and render surfaces use.\nnull follows the project's own activeProfileId.",
  },

  'python.envPath': {
    path: ['python', 'envPath'],
    schema: z.string().min(1),
    default: null,
    doc: 'Absolute path to a Python interpreter for notebooks and analysis code.\nnull lets the env picker choose.',
  },
  'literature.provider': {
    path: ['literature', 'provider'],
    schema: UiLitProviderIdSchema,
    default: null,
    doc: 'Literature search backend. null lets the picker choose\n(it prefers a detected agent CLI).',
  },
  'literature.mailto': {
    path: ['literature', 'mailto'],
    schema: z.string(),
    default: '',
    doc: "Polite-pool contact sent with Crossref/OpenAlex requests.\nEmpty falls back to your git email.",
  },
  'literature.cli': {
    path: ['literature', 'cli'],
    schema: LitCliPreferenceSchema,
    default: 'auto',
    doc: `Which agent CLI the ai-cli literature provider prefers. ${enumDoc(['auto', 'claude', 'codex'])}`,
  },
  'terminal.shell': {
    path: ['terminal', 'shell'],
    schema: z.string(),
    default: '',
    doc: 'Shell for new terminals. Empty uses the platform default.',
  },
  'references.autoOpenPdf': {
    path: ['references', 'autoOpenPdf'],
    schema: z.boolean(),
    default: true,
    doc: 'Open a resolved PDF beside the References list when you select an entry.',
  },

  'ai.mode': {
    path: ['ai', 'mode'],
    schema: AiModeSchema,
    default: 'cli',
    doc: `How SUNA reaches a model. ${enumDoc(['cli', 'api', 'none'])}`,
  },
  'ai.cliCommand': {
    path: ['ai', 'cliCommand'],
    schema: z.string().min(1),
    default: null,
    doc: "The CLI to spawn in 'cli' mode. null auto-detects an installed one.",
  },
  'ai.model': {
    path: ['ai', 'model'],
    schema: AiModelSchema,
    default: 'sonnet',
    doc: `Model tier every AI call runs at. ${enumDoc(['opus', 'sonnet', 'haiku'])}`,
  },
  'ai.effort': {
    path: ['ai', 'effort'],
    schema: AiEffortSchema,
    default: 'low',
    doc: `How hard it thinks. ${enumDoc(['low', 'medium', 'high', 'xhigh', 'max'])}`,
  },
  'review.aiDiffs': {
    path: ['review', 'aiDiffs'],
    schema: ReviewAiDiffsSchema,
    default: 'inline',
    doc: `Show the AI's unreviewed changes inline, red/green at word\nresolution. ${enumDoc(['inline', 'off'])}`,
  },

  'response.colorRoles': {
    path: ['response', 'colorRoles'],
    schema: z.boolean(),
    default: true,
    doc: "Paint a response letter's three voices: the reviewer's comment, your\nreply, and quoted manuscript text that changed.",
  },
  'response.quickInsert': {
    path: ['response', 'quickInsert'],
    schema: z.boolean(),
    default: true,
    doc: "The reply box's quick insertions (quote block, change mark, RE:).",
  },

  'trash.maxFileMb': {
    path: ['trash', 'maxFileMb'],
    schema: bounded(TRASH_LIMITS.maxFileMb),
    default: TRASH_DEFAULTS.maxFileMb,
    doc: "Deleted files at or under this size go to SUNA's restorable trash;\nanything larger, and every directory, goes to the OS trash.",
  },
  'trash.retentionDays': {
    path: ['trash', 'retentionDays'],
    schema: bounded(TRASH_LIMITS.retentionDays),
    default: TRASH_DEFAULTS.retentionDays,
    doc: "How long a file waits in SUNA's trash before it is passed to the OS trash.",
  },
};

/** Every key, in declaration order — iterate this, not Object.keys. */
export const SETTING_KEY_LIST = Object.keys(SETTING_KEYS) as ResolvedSettingKey[];

/** Shipped defaults, derived from the registry so the two cannot drift. */
export const SETTINGS_DEFAULTS: ResolvedSettings = Object.fromEntries(
  SETTING_KEY_LIST.map((key) => [key, SETTING_KEYS[key].default]),
) as unknown as ResolvedSettings;

export interface ResolvedSetting<K extends ResolvedSettingKey> {
  value: ResolvedSettings[K];
  source: SettingSource;
}

export interface SettingsResolution {
  value: ResolvedSettings;
  sources: Record<ResolvedSettingKey, SettingSource>;
  /** Keys the config file set to something invalid, and why. */
  problems: { key: ResolvedSettingKey; path: string; message: string }[];
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
 * Resolve one key against the parsed config document.
 *
 * `null` means "not set" — identical to the key being absent — which is what
 * makes a hand-written `lineHeight: null` read as "reset to the default"
 * rather than as a value.
 */
export function resolveSetting<K extends ResolvedSettingKey>(
  key: K,
  config: Record<string, unknown>,
): ResolvedSetting<K> {
  const meta = SETTING_KEYS[key];
  const candidate = valueAtPath(config, meta.path);
  if (candidate != null) {
    const parsed = meta.schema.safeParse(candidate);
    if (parsed.success) {
      return { value: parsed.data as ResolvedSettings[K], source: 'config' };
    }
  }
  return { value: SETTINGS_DEFAULTS[key], source: 'default' };
}

/** Resolve the whole surface at once — what the renderer store holds. */
export function resolveSettings(config: Record<string, unknown> = {}): SettingsResolution {
  // Built key by key through the typed resolveSetting; the accumulators are
  // untyped only because TypeScript cannot narrow a union-keyed assignment.
  const value: Record<string, unknown> = {};
  const sources: Record<string, SettingSource> = {};
  const problems: SettingsResolution['problems'] = [];
  for (const key of SETTING_KEY_LIST) {
    const meta = SETTING_KEYS[key];
    const resolved = resolveSetting(key, config);
    value[key] = resolved.value;
    sources[key] = resolved.source;
    const candidate = valueAtPath(config, meta.path);
    if (candidate != null && resolved.source === 'default') {
      const parsed = meta.schema.safeParse(candidate);
      problems.push({
        key,
        path: meta.path.join('.'),
        message: parsed.success
          ? 'value was rejected'
          : (parsed.error.issues[0]?.message ?? 'invalid value'),
      });
    }
  }
  return {
    value: value as unknown as ResolvedSettings,
    sources: sources as Record<ResolvedSettingKey, SettingSource>,
    problems,
  };
}

/** The YAML dot-path a key lives at — for error messages and "reveal in file". */
export function settingPath(key: ResolvedSettingKey): string {
  return SETTING_KEYS[key].path.join('.');
}
