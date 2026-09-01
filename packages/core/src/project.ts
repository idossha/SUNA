import { z } from 'zod';
import { UiLitProviderIdSchema } from './lit';
import { DocumentEntrySchema } from './documents';
import { ProjectApprovalsSchema } from './peer-review-guide';

export const PROJECT_DIR_KEYS = [
  'manuscript',
  'figures',
  'code',
  'data',
  'analysis',
  'results',
  'output',
] as const;

export const ProjectDirKeySchema = z.enum(PROJECT_DIR_KEYS);
export type ProjectDirKey = z.infer<typeof ProjectDirKeySchema>;

export const DEFAULT_PROJECT_DIRS = {
  manuscript: 'manuscript',
  figures: 'figures',
  code: 'code',
  data: 'data',
  analysis: 'analysis',
  results: 'results',
  output: 'output',
} as const satisfies Record<ProjectDirKey, string>;

/**
 * Numeric bounds shared by three consumers: the suna.json schema below (so a
 * hand-edited out-of-range value lints in the editor and is rejected by the
 * writer), the resolver's validation of global values, and the Settings-page
 * sliders. Same numbers as the editor store's EDITOR_SETTINGS_LIMITS.
 */
export const SETTINGS_LIMITS = {
  contentWidthCh: { min: 50, max: 150 },
  fontSizePx: { min: 12, max: 22 },
  lineHeight: { min: 1.4, max: 2 },
} as const;

export const EDITOR_VIEW_MODES = ['source', 'reading'] as const;
export const EditorViewModeSchema = z.enum(EDITOR_VIEW_MODES);
export type EditorViewMode = z.infer<typeof EditorViewModeSchema>;

export const EDITOR_FONT_FAMILIES = ['serif', 'sans', 'mono'] as const;
export const EditorFontFamilySchema = z.enum(EDITOR_FONT_FAMILIES);
export type EditorFontFamily = z.infer<typeof EditorFontFamilySchema>;

export const EDITOR_THEME_IDS = [
  'suna-dark',
  'suna-light',
  'gruvbox',
  'jellybeans',
  'mono-blue-dark',
  'mono-blue-light',
] as const;
export type BuiltinThemeId = (typeof EDITOR_THEME_IDS)[number];

/**
 * A theme id. Deliberately NOT an enum over the built-ins: a user's own theme
 * in `~/.suna/themes/nord.yml` names itself, and the settings schema cannot
 * know that name. Shape only, therefore — the loader is what decides whether
 * a well-formed id actually resolves to a theme (an unknown one falls back to
 * the default theme and is reported as a config diagnostic).
 */
export const EditorThemeIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes only');
export type EditorThemeId = z.infer<typeof EditorThemeIdSchema>;

/**
 * Bounds for the chrome-geometry settings (`ui:` in config.yml). Wide enough
 * to be worth changing, narrow enough that a typo cannot produce a window with
 * no title bar or a 400px status bar.
 */
export const UI_LIMITS = {
  scale: { min: 0.75, max: 1.5 },
  titleBarHeightPx: { min: 28, max: 64 },
  activityBarWidthPx: { min: 0, max: 96 },
  statusBarHeightPx: { min: 16, max: 48 },
  radiusPx: { min: 0, max: 16 },
  textScale: { min: 0.8, max: 1.4 },
} as const;

/** Figure width presets, keyed like a profile's `figures.widthPresetsMm`. */
export const FIGURE_WIDTH_PRESETS = ['single', 'onehalf', 'double'] as const;
export const FigureWidthPresetSchema = z.enum(FIGURE_WIDTH_PRESETS);
export type FigureWidthPreset = z.infer<typeof FigureWidthPresetSchema>;

/** How this project talks to an AI: an agent CLI, an HTTP API key, or not at all. */
export const AI_MODES = ['cli', 'api', 'none'] as const;
export const AiModeSchema = z.enum(AI_MODES);
export type AiMode = z.infer<typeof AiModeSchema>;

/**
 * Which model tier the AI runs at. Tiers, not exact model ids: the same
 * choice has to mean something to `claude --model` (where these three ARE the
 * aliases) and to the Messages API (mapped to a dated id in @suna/agent), and
 * an id pinned in a committed suna.json goes stale the week the next model
 * ships.
 */
export const AI_MODELS = ['opus', 'sonnet', 'haiku'] as const;
export const AiModelSchema = z.enum(AI_MODELS);
export type AiModel = z.infer<typeof AiModelSchema>;

/** How hard it thinks — exactly the levels `claude --effort` accepts. */
export const AI_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const AiEffortSchema = z.enum(AI_EFFORTS);
export type AiEffort = z.infer<typeof AiEffortSchema>;

const boundedNumber = (limits: { min: number; max: number }): z.ZodNumber =>
  z.number().min(limits.min).max(limits.max);

export const ProjectEditorSettingsSchema = z.object({
  defaultMode: EditorViewModeSchema.nullish(),
  contentWidthCh: boundedNumber(SETTINGS_LIMITS.contentWidthCh).nullish(),
  fontSizePx: boundedNumber(SETTINGS_LIMITS.fontSizePx).nullish(),
  lineHeight: boundedNumber(SETTINGS_LIMITS.lineHeight).nullish(),
  fontFamily: EditorFontFamilySchema.nullish(),
  editorTheme: EditorThemeIdSchema.nullish(),
  vimMotions: z.boolean().nullish(),
});
export type ProjectEditorSettings = z.infer<typeof ProjectEditorSettingsSchema>;

/**
 * The optional `settings` block of suna.json. **DEPRECATED and no longer
 * read** — settings have ONE level, ~/.suna/config.yml (ARCHITECTURE §6.1,
 * §4.1). The schema stays so that every suna.json ever written still
 * validates; nothing resolves through it. EVERY key is optional and nullable,
 * which is what makes an old file with a populated block still parse.
 */
/**
 * How the AI's unreviewed changes are shown (ARCHITECTURE §5.6).
 * 'inline' paints them in the editor — removals red, additions green, at word
 * resolution. 'off' hides the paint; it does NOT stop the baseline being
 * captured, so turning it back on shows everything that accumulated meanwhile.
 */
export const REVIEW_AI_DIFF_MODES = ['inline', 'off'] as const;
export const ReviewAiDiffsSchema = z.enum(REVIEW_AI_DIFF_MODES);
export type ReviewAiDiffs = z.infer<typeof ReviewAiDiffsSchema>;

export const ProjectSettingsSchema = z.object({
  /** Profile the preview/render surfaces use; falls back to activeProfileId. */
  previewProfileId: z.string().min(1).nullish(),
  editor: ProjectEditorSettingsSchema.nullish(),
  figures: z
    .object({ defaultWidthPreset: FigureWidthPresetSchema.nullish() })
    .nullish(),
  /** Committed, portable python env path (the per-machine pick lives in global settings). */
  python: z.object({ envPath: z.string().min(1).nullish() }).nullish(),
  literature: z.object({ provider: UiLitProviderIdSchema.nullish() }).nullish(),
  review: z.object({ aiDiffs: ReviewAiDiffsSchema.nullish() }).nullish(),
  /**
   * How a response to reviewers is rendered — in the round workspace and in
   * every exported response document. Both keys are house style rather than
   * anything the schema depends on, which is why they are settings and not
   * fields on the round.
   */
  response: z
    .object({
      /** Paint the three voices (comment / reply / manuscript change). */
      colorRoles: z.boolean().nullish(),
      /** Offer the reply box's quick insertions and their shortcuts. */
      quickInsert: z.boolean().nullish(),
    })
    .nullish(),
  ai: z
    .object({
      mode: AiModeSchema.nullish(),
      /** Explicit CLI to spawn ('claude', 'codex'); null = auto-detect. */
      cliCommand: z.string().min(1).nullish(),
      /** Model tier every AI call in this project runs at. */
      model: AiModelSchema.nullish(),
      /** Reasoning effort every AI call in this project runs at. */
      effort: AiEffortSchema.nullish(),
    })
    .nullish(),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

/** suna.json — the project manifest at the root of a SUNA research project. */
export const SunaProjectManifestSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  activeProfileId: z.string().min(1),
  directories: z.record(ProjectDirKeySchema, z.string().min(1)),
  createdAt: z.iso.datetime(),
  /**
   * DEPRECATED and no longer read. Settings live in the user's
   * ~/.suna/config.yml (see settings-resolve.ts and docs/design/
   * configuration.md); there is no project level any more. The field stays in
   * the schema so every suna.json written while it existed still validates —
   * removing it would make those manifests fail to open, which is a far worse
   * outcome than an ignored key.
   */
  settings: ProjectSettingsSchema.optional(),
  /**
   * The document registry (ARCHITECTURE §4.2). Absent on every project created before
   * ARCHITECTURE §4.2, and `resolveDocuments` synthesizes a one-manuscript
   * registry for those — which is what makes the registry a zero-file
   * migration. `settings` above is the precedent for an additive optional
   * block, and `schemaVersion` stays 1 for the same reason it did then.
   */
  documents: z.array(DocumentEntrySchema).optional(),
  /**
   * Recorded human approvals that gate an AI capability (currently only
   * reviewer-reply drafting). Optional and additive for the same reason
   * `settings` and `documents` are: every project predating it must open
   * unchanged, and an absent block simply means nothing has been approved.
   */
  approvals: ProjectApprovalsSchema.optional(),
});
export type SunaProjectManifest = z.infer<typeof SunaProjectManifestSchema>;

/* ------------------------------------------------------------------ */
/* Recent projects (DECISIONS 2026-08-15)                                  */
/* ------------------------------------------------------------------ */

/** Global-settings key holding the recents list. */
export const RECENT_PROJECTS_KEY = 'recentProjects';

/** Welcome-screen cap; older entries fall off the end. */
export const MAX_RECENT_PROJECTS = 10;

export const RecentProjectSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  lastOpenedAt: z.iso.datetime(),
});
export type RecentProject = z.infer<typeof RecentProjectSchema>;

/**
 * Dedupe key for recents: trailing separators are noise ('/work/p' and
 * '/work/p/' are the same project). The filesystem root stays as-is.
 */
export function normalizeProjectPath(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '');
  return trimmed === '' ? path : trimmed;
}

/**
 * Read the persisted value defensively: it comes from a hand-editable JSON
 * bag, so anything malformed is dropped rather than throwing. Stored order is
 * authoritative (touchRecentProject writes most-recent first).
 */
export function coerceRecentProjects(raw: unknown): RecentProject[] {
  if (!Array.isArray(raw)) return [];
  const out: RecentProject[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const parsed = RecentProjectSchema.safeParse(entry);
    if (!parsed.success) continue;
    const path = normalizeProjectPath(parsed.data.path);
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ ...parsed.data, path });
    if (out.length >= MAX_RECENT_PROJECTS) break;
  }
  return out;
}

/** Most-recent first, deduped by normalized path, capped at MAX_RECENT_PROJECTS. */
export function touchRecentProject(
  list: readonly RecentProject[],
  entry: RecentProject,
): RecentProject[] {
  const path = normalizeProjectPath(entry.path);
  const head: RecentProject = { ...entry, path };
  const rest = list.filter((item) => normalizeProjectPath(item.path) !== path);
  return [head, ...rest].slice(0, MAX_RECENT_PROJECTS);
}

/** Drop one entry (the welcome screen's "Remove" on a missing project). */
export function forgetRecentProject(
  list: readonly RecentProject[],
  path: string,
): RecentProject[] {
  const target = normalizeProjectPath(path);
  return list.filter((item) => normalizeProjectPath(item.path) !== target);
}
