import { z } from 'zod';
import { DocxAnalysisSchema } from './docx-import';
import { LitCliIdSchema, LitProviderIdSchema } from './lit';
import {
  ProjectDirKeySchema,
  ProjectSettingsSchema,
  RecentProjectSchema,
  SunaProjectManifestSchema,
} from './project';

export interface FsFileNode {
  kind: 'file';
  name: string;
  path: string;
}

export interface FsDirNode {
  kind: 'dir';
  name: string;
  path: string;
  children: FsNode[];
}

export type FsNode = FsFileNode | FsDirNode;

export const FsNodeSchema: z.ZodType<FsNode> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('file'),
      name: z.string().min(1),
      path: z.string().min(1),
    }),
    z.object({
      kind: z.literal('dir'),
      name: z.string().min(1),
      path: z.string().min(1),
      children: z.array(FsNodeSchema),
    }),
  ]),
);

export interface ChannelContract {
  readonly request: z.ZodType;
  readonly response: z.ZodType;
}

/**
 * Ceiling for 'fs:read-binary'. A whole PDF crosses the IPC boundary as
 * base64 (≈4/3 the byte size) and is held in renderer memory, so a runaway
 * file must be refused rather than wedging the app.
 */
export const MAX_READ_BINARY_BYTES = 200 * 1024 * 1024;

/**
 * A recents row as the welcome screen receives it: the persisted entry plus a
 * freshly stat'd `exists` (the directory still holds a suna.json). Only
 * `path`/`name`/`lastOpenedAt` are stored in settings.
 */
export const RecentProjectEntrySchema = RecentProjectSchema.extend({
  exists: z.boolean(),
});
export type RecentProjectEntry = z.infer<typeof RecentProjectEntrySchema>;

/**
 * Submission-format knobs the export dialog exposes (feature-plan-6 §3/§4):
 * whichever of these the ACTIVE PROFILE states a value for, the dialog fixes
 * and disables (the journal has an opinion); whichever the profile leaves
 * `null` ("does not state this"), the dialog offers as a user toggle. Either
 * way the resolved boolean the user is left with travels here — export
 * services never re-read the profile to decide these, they just apply them.
 */
export const ExportOptionsSchema = z.object({
  doubleSpacing: z.boolean(),
  lineNumbers: z.boolean(),
  /** Continuous page numbers. Not profile-optional (no journal asks to omit them) — always on by default. */
  pageNumbers: z.boolean(),
});
export type ExportOptions = z.infer<typeof ExportOptionsSchema>;

/**
 * The outcome of the flat-layout migration (feature-plan-7 §1). Rides along on
 * every project open so the renderer can tell the user what happened to their
 * files, and is the response of the manual 'project:migrate' trigger.
 *
 * `migrated` is true ONLY when files were actually rewritten; opening an
 * already-flat project reports `false` with a note, never an error. `error` is
 * non-null exactly when migration was abandoned — in that case NOTHING was
 * changed and the project is still in its old layout, which is the one state
 * the UI must surface loudly.
 */
export const MigrationOutcomeSchema = z.object({
  migrated: z.boolean(),
  notes: z.array(z.string()),
  error: z.string().nullable(),
});
export type MigrationOutcome = z.infer<typeof MigrationOutcomeSchema>;

export const CHANNELS = {
  'project:create': {
    request: z.object({
      dir: z.string().min(1),
      name: z.string().min(1),
    }),
    response: SunaProjectManifestSchema,
  },
  /**
   * Opens `dir` and — because the old `sections/` layout must not reach any
   * reader — runs the flat-layout migration before returning. `migration`
   * reports what that did; the project opens either way.
   */
  'project:open': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({
      manifest: SunaProjectManifestSchema,
      manuscriptPresent: z.boolean(),
      migration: MigrationOutcomeSchema,
    }),
  },
  /**
   * Manual re-run of the flat-layout migration on an already-open project
   * (feature-plan-7 §1). Idempotent, and never needed in the happy path —
   * 'project:open' / 'project:open-example' already migrate. Useful after the
   * user fixes whatever made an automatic attempt abandon.
   */
  'project:migrate': {
    request: z.object({ dir: z.string().min(1) }),
    response: MigrationOutcomeSchema,
  },
  'project:scaffold-status': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({
      manifestPresent: z.boolean(),
      dirs: z.record(ProjectDirKeySchema, z.boolean()),
    }),
  },
  /**
   * Read-merge-validate-write on suna.json's `settings` block — the project
   * half of the settings hierarchy (feature-plan-5 §4). Main re-reads the file
   * from disk, merges `patch` into `settings` (see mergeProjectSettings: null
   * DELETES a key, which is how "Reset to global" leaves a clean file),
   * validates the result with SunaProjectManifestSchema and writes atomically.
   * Never touches global settings, and never touches any manifest key outside
   * `settings`. Build the patch with projectSettingPatch(key, value).
   */
  'project:update-settings': {
    request: z.object({ dir: z.string().min(1), patch: ProjectSettingsSchema }),
    response: z.object({ manifest: SunaProjectManifestSchema }),
  },
  /**
   * Recent projects for the welcome screen, most-recent first (feature-plan-5
   * §1). Persisted in GLOBAL settings under 'recentProjects'; `exists` is
   * recomputed on every read (true = the directory still holds a suna.json) so
   * a deleted project can render its "Missing" state without being opened.
   */
  'project:recents': {
    request: z.object({}),
    response: z.object({ recents: z.array(RecentProjectEntrySchema) }),
  },
  /**
   * Record an open. Callers rarely need this: project:create / project:open /
   * project:open-example already touch recents themselves. Deduped by path,
   * capped at 10.
   */
  'project:touch-recent': {
    request: z.object({ path: z.string().min(1), name: z.string().min(1) }),
    response: z.object({ recents: z.array(RecentProjectEntrySchema) }),
  },
  /** Drop one entry (the "Remove" action on a missing project). */
  'project:forget-recent': {
    request: z.object({ path: z.string().min(1) }),
    response: z.object({ recents: z.array(RecentProjectEntrySchema) }),
  },
  /**
   * Onboarding wizard step 1 live validation (feature-plan-5 §5): does
   * `<parentDir>/<name>` already exist, and can `parentDir` be written to.
   * Pure filename-shape checks (empty/illegal characters) run in the renderer
   * without a round trip — this only answers questions the filesystem knows.
   */
  'project:check-target': {
    request: z.object({ parentDir: z.string().min(1), name: z.string().min(1) }),
    response: z.object({
      path: z.string().min(1),
      exists: z.boolean(),
      parentWritable: z.boolean(),
    }),
  },
  /**
   * Onboarding wizard step 3 "Import existing": shallow-scans `dir` (depth
   * capped, `.git`/`node_modules`/venvs skipped) for `.md`/`.tex`/`.bib`
   * files so the step can list what will be copied in before anything is
   * written.
   */
  'project:list-importable': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({
      files: z.array(
        z.object({
          path: z.string().min(1),
          name: z.string().min(1),
          ext: z.enum(['md', 'tex', 'bib']),
        }),
      ),
    }),
  },
  /**
   * Onboarding wizard step 7 "Create project" (feature-plan-5 §5): the one
   * call that actually writes anything — directories, suna.json, the
   * scaffolded/imported manuscript, and (best-effort) a git init + first
   * commit. Never called before the review step. `settings` is the step-6
   * "save to this project" patch (possibly empty). Distinct from
   * 'project:create', which always writes the fixed starter manuscript with
   * no profile/scaffold-kind/import choice.
   */
  'project:scaffold': {
    request: z.object({
      dir: z.string().min(1),
      name: z.string().min(1),
      activeProfileId: z.string().min(1),
      scaffold: z.enum(['blank', 'starter', 'import']),
      /** Source folder for 'import'; ignored otherwise. */
      importDir: z.string().min(1).nullable(),
      settings: ProjectSettingsSchema,
    }),
    response: z.object({
      manifest: SunaProjectManifestSchema,
      gitInitialized: z.boolean(),
      /** Non-fatal issues (e.g. git unavailable, an import name collision). */
      warnings: z.array(z.string()),
    }),
  },
  /**
   * DOCX import step 1 (feature-plan-6 §2): converts `path` with mammoth and
   * runs the front-matter/section/reference heuristics, WITHOUT writing
   * anything — the review screen edits the returned `analysis` before
   * 'docx:commit' ever runs. Images are extracted to a temp dir named in
   * `analysis.tempDir`.
   */
  'docx:analyze': {
    request: z.object({ path: z.string().min(1) }),
    response: z.object({ analysis: DocxAnalysisSchema }),
  },
  /**
   * DOCX import step 2: writes the project from a (possibly user-edited)
   * `analysis` into a fresh `dir` — suna.json, manuscript/manuscript.json,
   * manuscript/manuscript.md (one flat prose file, each analyzed section's
   * heading rendered at its level — feature-plan-7 §1, no `sections/`
   * directory), manuscript/authors.json, manuscript/references.bib, and
   * figures/imported-N directories. Refuses a non-empty `dir` unless `force`
   * is set, and refuses a `dir` that
   * is already a SUNA project (has a suna.json) regardless of `force` — import
   * never overwrites an existing project.
   */
  'docx:commit': {
    request: z.object({ analysis: DocxAnalysisSchema, dir: z.string().min(1), force: z.boolean() }),
    response: z.object({ dir: z.string().min(1) }),
  },
  'fs:read-text': {
    request: z.object({ path: z.string().min(1) }),
    response: z.object({ content: z.string() }),
  },
  'fs:write-text': {
    request: z.object({
      path: z.string().min(1),
      content: z.string(),
    }),
    response: z.object({ bytesWritten: z.number().int().nonnegative() }),
  },
  /**
   * Read a file's bytes as base64 — root-confined exactly like 'fs:read-text',
   * so no `file://` and no CSP relaxation. Feeds the PDF/image viewers, which
   * decode to a Uint8Array (or a data URI) in the renderer. Files larger than
   * MAX_READ_BINARY_BYTES are refused with a message naming both sizes.
   */
  'fs:read-binary': {
    request: z.object({ path: z.string().min(1) }),
    response: z.object({
      base64: z.string(),
      /** Decoded byte length (not the base64 length). */
      bytes: z.number().int().nonnegative(),
    }),
  },
  /**
   * Copy a file INTO the project ("Attach PDF…"). `from` may live anywhere on
   * disk — that is the point — while `to` must resolve inside an open project
   * root. Parent directories are created; an existing `to` is never
   * overwritten (the copy fails instead). Copy, never move: the original stays.
   */
  'fs:copy-file': {
    request: z.object({ from: z.string().min(1), to: z.string().min(1) }),
    response: z.object({ path: z.string().min(1) }),
  },
  'fs:list': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({ root: FsNodeSchema }),
  },
  'project:open-example': {
    request: z.object({}),
    response: z.object({
      dir: z.string().min(1),
      manifest: SunaProjectManifestSchema,
      migration: MigrationOutcomeSchema,
    }),
  },
  'dialog:pick-directory': {
    request: z.object({
      title: z.string().min(1),
      allowCreate: z.boolean(),
    }),
    response: z.object({ path: z.string().min(1).nullable() }),
  },
  /**
   * Native single-file open dialog. `extensions` are bare, dot-less filter
   * extensions (`['pdf']`); an empty array means "any file". Returns null when
   * the user cancels.
   */
  'dialog:pick-file': {
    request: z.object({
      title: z.string().min(1),
      extensions: z.array(z.string().min(1)),
    }),
    response: z.object({ path: z.string().min(1).nullable() }),
  },
  'fs:rename': {
    request: z.object({ path: z.string().min(1), newName: z.string().min(1) }),
    response: z.object({ path: z.string().min(1) }),
  },
  'fs:delete': {
    // moves to the OS trash, never a hard unlink
    request: z.object({ path: z.string().min(1) }),
    response: z.object({}),
  },
  'fs:mkdir': {
    request: z.object({ path: z.string().min(1) }),
    response: z.object({}),
  },
  'fs:create-file': {
    request: z.object({ path: z.string().min(1), content: z.string() }),
    response: z.object({}),
  },
  'git:status': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({
      isRepo: z.boolean(),
      branch: z.string().nullable(),
      changes: z.array(
        z.object({
          path: z.string().min(1),
          status: z.enum(['modified', 'added', 'deleted', 'renamed', 'untracked', 'conflicted']),
        }),
      ),
    }),
  },
  'git:log': {
    request: z.object({ dir: z.string().min(1), limit: z.number().int().positive().max(200) }),
    response: z.object({
      entries: z.array(
        z.object({
          hash: z.string().min(1),
          subject: z.string(),
          author: z.string(),
          date: z.string(),
        }),
      ),
    }),
  },
  'git:commit': {
    request: z.object({
      dir: z.string().min(1),
      message: z.string().min(1),
      stageAll: z.boolean(),
    }),
    response: z.object({ hash: z.string().min(1) }),
  },
  'git:diff-file': {
    request: z.object({ dir: z.string().min(1), path: z.string().min(1) }),
    response: z.object({ diff: z.string() }),
  },
  'git:init': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({}),
  },
  'agent:set-key': {
    request: z.object({ provider: z.enum(['anthropic', 'openai', 'ollama']), key: z.string() }),
    response: z.object({}),
  },
  'agent:provider-status': {
    request: z.object({}),
    response: z.object({
      providers: z.array(
        z.object({
          id: z.enum(['anthropic', 'openai', 'ollama']),
          hasKey: z.boolean(),
        }),
      ),
    }),
  },
  'term:create': {
    request: z.object({
      cwd: z.string().min(1),
      cols: z.number().int().positive(),
      rows: z.number().int().positive(),
      // when set, the pty starts with this python env activated
      envPath: z.string().min(1).nullable(),
    }),
    response: z.object({ id: z.string().min(1) }),
  },
  'term:write': {
    request: z.object({ id: z.string().min(1), data: z.string() }),
    response: z.object({}),
  },
  'term:resize': {
    request: z.object({
      id: z.string().min(1),
      cols: z.number().int().positive(),
      rows: z.number().int().positive(),
    }),
    response: z.object({}),
  },
  'term:kill': {
    request: z.object({ id: z.string().min(1) }),
    response: z.object({}),
  },
  'env:detect': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({
      envs: z.array(
        z.object({
          kind: z.enum(['uv', 'venv', 'conda']),
          name: z.string().min(1),
          path: z.string().min(1),
          python: z.string().min(1).nullable(),
        }),
      ),
    }),
  },
  'env:select': {
    request: z.object({ dir: z.string().min(1), envPath: z.string().min(1).nullable() }),
    response: z.object({}),
  },
  'env:selected': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({ envPath: z.string().min(1).nullable() }),
  },
  /** Onboarding wizard step 4: is `uv` on PATH, so "create with uv" can be offered honestly. */
  'env:uv-available': {
    request: z.object({}),
    response: z.object({ available: z.boolean() }),
  },
  /**
   * Onboarding wizard step 7's env sub-step: runs `uv venv` in `dir` (the
   * just-created project). Never called before the project exists — step 4
   * only records the choice, per §5's "nothing written until Create". `error`
   * is a human message (e.g. uv missing); `ok: false` never throws, so a
   * missing `uv` does not fail the rest of creation.
   */
  'env:create': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({
      ok: z.boolean(),
      envPath: z.string().min(1).nullable(),
      error: z.string().nullable(),
    }),
  },
  'settings:get': {
    request: z.object({}),
    response: z.object({ settings: z.record(z.string(), z.unknown()) }),
  },
  'settings:set': {
    request: z.object({ patch: z.record(z.string(), z.unknown()) }),
    response: z.object({ settings: z.record(z.string(), z.unknown()) }),
  },
  'agent:write-mcp-config': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({ path: z.string().min(1) }),
  },
  'agent:chat': {
    request: z.object({
      provider: z.enum(['anthropic', 'openai', 'ollama']),
      system: z.string(),
      messages: z
        .array(
          z.object({
            role: z.enum(['user', 'assistant']),
            content: z.string().min(1),
          }),
        )
        .min(1),
    }),
    response: z.object({ text: z.string() }),
  },

  /**
   * Read-merge-validate-write on manuscript.json. Main re-reads the file from
   * disk, deep-merges `patch` into it (objects merge key by key, arrays and
   * scalars replace wholesale, `undefined` values are ignored), validates with
   * ManuscriptSchema and writes atomically. The response carries the manuscript
   * as it now exists on disk; parse it with ManuscriptSchema in the renderer.
   */
  'manuscript:update': {
    request: z.object({ dir: z.string().min(1), patch: z.unknown() }),
    response: z.object({ manuscript: z.unknown() }),
  },
  /** Missing comments.json reads as `{ schemaVersion: 1, comments: [] }`. */
  'comments:read': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({ file: z.unknown() }),
  },
  /** Validated with CommentsFileSchema, then written atomically. */
  'comments:write': {
    request: z.object({ dir: z.string().min(1), file: z.unknown() }),
    response: z.object({}),
  },

  /** Results are LitResult shaped; `error` is a human message, never swallowed. */
  'lit:search': {
    request: z.object({
      provider: LitProviderIdSchema,
      query: z.string().min(1),
      limit: z.number().int().positive().max(100),
    }),
    response: z.object({
      results: z.array(z.unknown()),
      error: z.string().nullable(),
    }),
  },
  /** `result` is a LitResult or null when the DOI is unknown to the provider. */
  'lit:by-doi': {
    request: z.object({ provider: LitProviderIdSchema, doi: z.string().min(1) }),
    response: z.object({
      result: z.unknown(),
      error: z.string().nullable(),
    }),
  },
  /** An empty key clears the stored entry. Keys never leave the main process. */
  'lit:set-key': {
    request: z.object({ provider: LitProviderIdSchema, key: z.string() }),
    response: z.object({}),
  },
  'lit:providers': {
    request: z.object({}),
    response: z.object({
      providers: z.array(
        z.object({
          id: LitProviderIdSchema,
          hasKey: z.boolean(),
          /** Callable without a key (OpenAlex is keyless but metered). */
          keyless: z.boolean(),
        }),
      ),
    }),
  },
  /** Which agent CLIs (claude, codex) `--version` answered within 5s, cached per session by main. */
  'lit:cli-status': {
    request: z.object({}),
    response: z.object({ available: z.array(LitCliIdSchema) }),
  },
  /**
   * Starts an 'ai-cli' search as a killable child process and returns
   * immediately with a searchId; progress and the final outcome arrive over
   * EVENT_CHANNELS.litProgress(searchId) / litDone(searchId). Never call
   * 'lit:search' with this provider — the two HTTP providers channel above
   * only knows LitProviderId, not 'ai-cli'.
   */
  'lit:ai-search': {
    request: z.object({
      provider: z.literal('ai-cli'),
      query: z.string().min(1),
      limit: z.number().int().positive().max(100),
      dir: z.string().min(1),
    }),
    response: z.object({ searchId: z.string().min(1) }),
  },
  /** Kills the child process for an in-flight 'ai-cli' search. A no-op if it already finished. */
  'lit:cancel': {
    request: z.object({ searchId: z.string().min(1) }),
    response: z.object({}),
  },

  /**
   * General-purpose "ask the agent CLI" (feature-plan-4 §5, the command
   * palette's `?` prefix): spawns whichever agent CLI is installed with
   * `prompt`, cwd'd to `dir`, and returns immediately with an askId; progress
   * and the final answer arrive over EVENT_CHANNELS.aiAskProgress(askId) /
   * aiAskDone(askId). Mirrors 'lit:ai-search' but for one free-text answer
   * instead of a paper list — never call it expecting a synchronous reply.
   */
  'ai:ask': {
    request: z.object({
      prompt: z.string().min(1),
      dir: z.string().min(1),
    }),
    response: z.object({ askId: z.string().min(1) }),
  },
  /** Kills the child process for an in-flight 'ai:ask' run. A no-op if it already finished. */
  'ai:cancel': {
    request: z.object({ askId: z.string().min(1) }),
    response: z.object({}),
  },

  /**
   * Export the current figure into the project's output/ dir.
   * Main handles 'svg' (byte copy) and 'pdf' (hidden window → printToPDF).
   * 'png'/'tiff' are rasterized in the renderer and written with
   * 'figure:write-binary'; asking main for them is an error.
   */
  'figure:export': {
    request: z.object({
      dir: z.string().min(1),
      figureId: z.string().min(1),
      format: z.enum(['svg', 'png', 'pdf', 'tiff']),
      widthMm: z.number().positive(),
      dpi: z.number().int().positive(),
      transparent: z.boolean(),
    }),
    response: z.object({
      path: z.string().min(1),
      widthPx: z.number().int().positive(),
      heightPx: z.number().int().positive(),
    }),
  },
  /** Write renderer-produced bytes (PNG/TIFF) to a path inside the project. */
  'figure:write-binary': {
    request: z.object({ path: z.string().min(1), base64: z.string() }),
    response: z.object({ path: z.string().min(1) }),
  },
  /**
   * Copy figures/<figureId> to figures/<newId>. The RENDERER registers the new
   * id in manuscript.json via 'manuscript:update'; this never touches it.
   */
  'figure:duplicate': {
    request: z.object({
      dir: z.string().min(1),
      figureId: z.string().min(1),
      newId: z.string().min(1),
    }),
    response: z.object({ figureId: z.string().min(1) }),
  },
  /**
   * Create figures/<slug>/{figure.svg,figure.json} from scratch: a blank
   * artboard at `widthMm` (the caller resolves the active profile's
   * double-column preset) with height = widthMm * 0.618. `figureId` is
   * derived from `name`, de-duplicated against existing figure directories.
   * The RENDERER registers the new figure in manuscript.json via
   * 'manuscript:update'; this never touches it (same split as duplicate).
   */
  'figure:create': {
    request: z.object({
      dir: z.string().min(1),
      name: z.string().min(1),
      widthMm: z.number().positive(),
    }),
    response: z.object({
      figureId: z.string().min(1),
      canvasRef: z.string().regex(/\.svg$/),
      svgPath: z.string().min(1),
      jsonPath: z.string().min(1),
      widthMm: z.number().positive(),
      heightMm: z.number().positive(),
    }),
  },

  /**
   * Word export (feature-plan-6 §3): renders manuscript.json +
   * manuscript.md + authors.json + references.bib (feature-plan-7 §1 flat
   * layout — sections are derived from manuscript.md's Markdown headings,
   * not stored separately) through the active profile with the bundled
   * 'docx' library — title page, body, figures, reference list, submission
   * format.
   * `figurePngPaths` maps every manuscript.json figure id to an ALREADY
   * rasterized PNG on disk (figureId -> absolute path): main has no canvas,
   * so the caller rasterizes each figure via the existing
   * 'figure:export'('png') + 'figure:write-binary' round trip (at the
   * profile's width preset / minDpi) before calling this — every figure the
   * manuscript references must have an entry or the export throws naming the
   * missing one. Writes to `<dir>/output/<outputName>.docx`; never touches
   * any source file. `useDocxTools` requests the OPTIONAL accelerator (spec
   * §3's "build via docx-tools") when it is on PATH — detected via
   * 'export:tools-available', never required; ignored (silently, since the
   * caller already checked) when the tool is unavailable, falling back to
   * the bundled-library path so export never fails for lacking it.
   */
  'export:docx': {
    request: z.object({
      dir: z.string().min(1),
      profileId: z.string().min(1),
      outputName: z.string().min(1),
      figurePngPaths: z.record(z.string(), z.string()),
      options: ExportOptionsSchema,
      useDocxTools: z.boolean(),
    }),
    response: z.object({
      path: z.string().min(1),
      /** Whether the docx-tools accelerator actually built this file (false = the bundled 'docx' library did). */
      usedDocxTools: z.boolean(),
    }),
  },
  /**
   * PDF export (feature-plan-6 §4): the SAME profile-styled content model as
   * 'export:docx', rendered to HTML and printed via a hidden BrowserWindow's
   * `printToPDF` — no LaTeX, no external binary. `figurePngPaths` has the
   * same contract as 'export:docx'. Writes to `<dir>/output/<outputName>.pdf`.
   */
  'export:pdf': {
    request: z.object({
      dir: z.string().min(1),
      profileId: z.string().min(1),
      outputName: z.string().min(1),
      figurePngPaths: z.record(z.string(), z.string()),
      options: ExportOptionsSchema,
    }),
    response: z.object({ path: z.string().min(1) }),
  },
  /**
   * Is the `docx-tools` CLI on PATH (detected with `--version`, 5s timeout,
   * cached per session by main)? Purely informational — the export dialog
   * uses it to decide whether "Build via docx-tools" is offered at all.
   */
  'export:tools-available': {
    request: z.object({}),
    response: z.object({ docxTools: z.boolean() }),
  },
} as const satisfies Record<string, ChannelContract>;

/**
 * Event channels (main → renderer pushes; not request/response). The preload
 * exposes subscription helpers for exactly these prefixes.
 */
export const EVENT_CHANNELS = {
  termData: (id: string) => `term:data:${id}`,
  termExit: (id: string) => `term:exit:${id}`,
  /** Status-line pushes for one 'lit:ai-search' run (e.g. "Searching the web…"). */
  litProgress: (searchId: string) => `lit:progress:${searchId}`,
  /** Terminal event for one 'lit:ai-search' run: `{ results: unknown[], error: string | null }`. */
  litDone: (searchId: string) => `lit:done:${searchId}`,
  /** Status-line pushes for one 'ai:ask' run (e.g. "Asking Claude Code…"). */
  aiAskProgress: (askId: string) => `ai:progress:${askId}`,
  /** Terminal event for one 'ai:ask' run: `{ text: string | null, error: string | null }`. */
  aiAskDone: (askId: string) => `ai:done:${askId}`,
  /**
   * The open project's `suna.json` changed on disk (feature-plan-5 §4: "watch
   * suna.json for external edits — the user typing in it, or an agent — and
   * re-resolve live"). Payload: `{ dir: string }`, the project root whose
   * manifest moved. A single channel rather than a per-project one: exactly
   * one project is open at a time, and the payload names it so a stale push
   * for a project the renderer already closed can be ignored.
   */
  projectManifestChanged: 'project:manifest-changed',
} as const;

export type ChannelName = keyof typeof CHANNELS;
export type RequestOf<C extends ChannelName> = z.infer<(typeof CHANNELS)[C]['request']>;
export type ResponseOf<C extends ChannelName> = z.infer<(typeof CHANNELS)[C]['response']>;
