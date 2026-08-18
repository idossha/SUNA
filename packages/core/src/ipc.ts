import { z } from 'zod';
import { DocxAnalysisSchema } from './docx-import';
import {
  DownloadPolicySchema,
  LibraryConfigSchema,
  PdfAcquisitionSchema,
  PdfMatchSchema,
} from './library';
import { LitCliIdSchema, LitProviderIdSchema, LitResultSchema } from './lit';
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
 * a profile-stated value SEEDS the checkbox default on profile switch but is
 * never forced — the journal's stance shows as an informational tag and the
 * user can override it (a `null` value, "does not state this", leaves the
 * prior choice alone). Either way the resolved boolean the user is left with
 * travels here — export services never re-read the profile to decide these,
 * they just apply them.
 */
export const ExportOptionsSchema = z.object({
  doubleSpacing: z.boolean(),
  lineNumbers: z.boolean(),
  /** Continuous page numbers. Not profile-optional (no journal asks to omit them) — always on by default. */
  pageNumbers: z.boolean(),
  /**
   * The app's active editor theme (data-suna-theme) — the PDF and web-page
   * exports render in it so the document matches the reading tab it came
   * from. Absent (or unknown to the export palette table) falls back to the
   * default look. DOCX ignores it: a Word file is a collaboration surface,
   * not a themed reading artifact.
   */
  theme: z.string().optional(),
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

/**
 * `library.json` as it now stands, plus what its roots resolve to on THIS
 * machine (feature-plan-10 §Layer 5). Both library config channels answer with
 * this shape, so a write needs no follow-up read.
 *
 * `expanded` is what lets the Settings pane be honest about the search it is
 * configuring: roots are STORED portably (`~/Zotero/storage`) and a root that
 * is gone is dropped from the scan rather than failing it, so the pane must be
 * able to say which of the user's four folders will actually be walked.
 * `missing` names them in their stored form — the string the user typed, not
 * an expanded path they never wrote.
 */
export const LibraryConfigStateSchema = z.object({
  config: LibraryConfigSchema,
  /** Absolute path of library.json, whether or not it exists yet. */
  path: z.string().min(1),
  /** 'defaults' covers both first run and a file that could not be used. */
  source: z.enum(['file', 'defaults']),
  /**
   * Why the stored file was not used, or null. A file that does not exist yet
   * is the normal first-run state and is NOT an error; a file that exists and
   * is unreadable, unparseable or invalid is — surfaced rather than swallowed,
   * because a corrupt library.json quietly ignored looks exactly like a
   * library.json whose roots simply hold no PDFs.
   */
  error: z.string().nullable(),
  expanded: z.object({
    /** Absolute, existing, symlink-resolved, deduped — what a scan would walk. */
    roots: z.array(z.string().min(1)),
    /** Configured roots that cannot be searched, in their stored ('~/…') form. */
    missing: z.array(z.string().min(1)),
    /** One line per root that was dropped or collapsed into another. */
    notes: z.array(z.string().min(1)),
  }),
});
export type LibraryConfigState = z.infer<typeof LibraryConfigStateSchema>;

/**
 * The result of one read-only machine search (feature-plan-10 §Layer 3).
 *
 * An empty `matches` is a real answer, never a swallowed failure — which is
 * why it always arrives with the rest: "nothing matched in 3 roots, ~/Papers
 * does not exist, and the walk was truncated" is a fact the user can act on,
 * an unexplained "no PDF" is not. `error` is non-null only when nothing was
 * searched at all.
 */
export const LibraryScanOutcomeSchema = z.object({
  /** Best first. Every match carries the evidence that produced it. */
  matches: z.array(PdfMatchSchema),
  /** Absolute, symlink-resolved roots that were actually walked. */
  rootsSearched: z.array(z.string().min(1)),
  /** Configured roots that were dropped, in their stored ('~/…') form. */
  rootsMissing: z.array(z.string().min(1)),
  /** Files the bounded walk examined; Spotlight hits are not walked and do not count. */
  scanned: z.number().int().nonnegative(),
  /** True when maxFilesScanned stopped the walk early — the answer is partial. */
  truncated: z.boolean(),
  /** Every partiality: skipped roots, Spotlight off, unreadable candidates. */
  notes: z.array(z.string().min(1)),
  error: z.string().nullable(),
});
export type LibraryScanOutcome = z.infer<typeof LibraryScanOutcomeSchema>;

/**
 * What one run of the acquisition ladder did (feature-plan-10, the four
 * outcomes in their strict preference order): `already-present` →
 * `copied-local` → `downloaded` → `metadata-only`.
 *
 * `acquisition` is null EXACTLY when `error` is non-null — nothing was
 * attempted, which is a different fact from `metadata-only` ("we looked
 * everywhere and there is no PDF; cite it from its metadata"). The renderer
 * must be able to tell those apart before it tells the user anything.
 */
export const LibraryAcquireOutcomeSchema = z.object({
  acquisition: PdfAcquisitionSchema.nullable(),
  /** Absolute path of the PDF inside the project, or null when none was acquired. */
  path: z.string().min(1).nullable(),
  /** 'references/<citekey>.pdf' — the value a BibTeX `file` field wants. */
  relativePath: z.string().min(1).nullable(),
  /**
   * Where the bytes came from: the absolute path on this machine they were
   * copied from, or the URL they were downloaded from. Null for
   * `already-present` (nothing was fetched) and for `metadata-only`.
   */
  source: z.string().min(1).nullable(),
  /** What the machine search found, best first — shown when the ladder stopped short. */
  matches: z.array(PdfMatchSchema),
  /** Every rung that did not produce a PDF, in the order they were tried. */
  notes: z.array(z.string().min(1)),
  error: z.string().nullable(),
});
export type LibraryAcquireOutcome = z.infer<typeof LibraryAcquireOutcomeSchema>;

/**
 * A capture region for 'app:capture-rect' / 'ai:repair-bundle': CSS px in the
 * sender window's page coordinates (capturePage takes DIP, which equals CSS
 * px here). Fractional values are expected — getBoundingClientRect() produces
 * them — and main rounds after clamping to the window's content bounds.
 */
export const CaptureRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});
export type CaptureRect = z.infer<typeof CaptureRectSchema>;

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
      /** Whether the agent layer (stubs, context/, .mcp.json) was fully written. */
      agentLayerWritten: z.boolean(),
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
  /**
   * Move entries into `targetDir`, keeping their basenames — the explorer's
   * drag-and-drop drop (feature-plan-9 §2). Batched so one drop is one tree
   * refresh, and PARTIAL by contract: every source that could not move is
   * named in `failed` with a human reason instead of failing the whole batch.
   * Sources and target are all root-confined, an existing destination is
   * refused rather than clobbered, and a directory may not land inside itself.
   * `moved` carries resolved paths on both sides so the caller can retarget the
   * open tabs pointing at them. Distinct from 'fs:rename', whose `newName` may
   * not contain a separator and so can never cross directories.
   */
  'fs:move': {
    request: z.object({
      paths: z.array(z.string().min(1)),
      targetDir: z.string().min(1),
    }),
    response: z.object({
      moved: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })),
      failed: z.array(z.object({ path: z.string().min(1), reason: z.string().min(1) })),
    }),
  },
  /**
   * Show `path` in the OS file manager (Finder / Explorer). Root-confined.
   * `error` is a human message; null means the reveal was handed to the OS.
   */
  'shell:reveal': {
    request: z.object({ path: z.string().min(1) }),
    response: z.object({ error: z.string().nullable() }),
  },
  /**
   * Open `path` with the OS's default application. Root-confined, and refuses
   * anything executable — launchable bundles/extensions plus any file carrying
   * a user-execute bit (feature-plan-9 §3): an agent can write files into the
   * project, and "open with the OS" must never become "run what the agent just
   * wrote". Directories are allowed (that is a Finder window). Electron's
   * openPath returns '' on success; that is mapped to null here, so a non-null
   * `error` always names something the user should see.
   */
  'shell:open-path': {
    request: z.object({ path: z.string().min(1) }),
    response: z.object({ error: z.string().nullable() }),
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
   * The reference library (feature-plan-10 §Layer 5): which folders on THIS
   * machine may be searched for a paper's PDF, whether Spotlight helps, and
   * how far a download may reach.
   *
   * These are deliberately NOT keys on 'settings:get'/'settings:set': the
   * settings live in `~/SunaConfig/library.json`, not Electron userData,
   * because the standalone MCP server has no userData and must search exactly
   * the folders this pane wrote.
   *
   * A missing file is the normal first run (`source: 'defaults'`, `error:
   * null`); a file that exists and cannot be used still answers with a usable
   * config — the defaults — and says why.
   */
  'library:read-config': {
    request: z.object({}),
    response: LibraryConfigStateSchema,
  },
  /**
   * Merge `patch` into library.json and write it atomically (tmp + rename).
   * Only the fields the pane actually edits are patchable — `schemaVersion` is
   * the file's own, not a setting — and an absent field is left exactly as it
   * was, so two panes editing different fields cannot clobber each other.
   *
   * A patch that would produce an invalid config writes NOTHING and comes back
   * with the unchanged config plus a sentence naming the problem: silently
   * clamping it would hide a Settings bug, and silently writing it would cost
   * the user their other choices on the next load.
   */
  'library:write-config': {
    request: z.object({ patch: LibraryConfigSchema.omit({ schemaVersion: true }).partial() }),
    response: LibraryConfigStateSchema,
  },
  /**
   * Read-only search of THIS MACHINE for a PDF of `result` — Spotlight (macOS,
   * when enabled) plus a bounded walk of the configured roots, ranked by the
   * shared evidence rules in @suna/bib. This is the one place the app reads
   * outside the open project, and it reads only inside the roots library.json
   * names: nothing is copied, moved, opened for writing or executed.
   *
   * `projectRoot` says which open project the search is FOR — main refuses a
   * directory it never opened, the same gate every other renderer-directed
   * path crosses. It does not bound the search; 'library:acquire-pdf' is where
   * it becomes the write boundary.
   */
  'library:find-pdf': {
    request: z.object({
      /** LitResultSchema — a provider hit, or one synthesized from a bib entry. */
      result: LitResultSchema,
      projectRoot: z.string().min(1),
    }),
    response: LibraryScanOutcomeSchema,
  },
  /**
   * Acquire `references/<citekey>.pdf` for one reference, walking the ladder in
   * its strict preference order: the project's own copy, then this machine,
   * then an open-access/publisher download, then metadata-only. A local file is
   * COPIED, never moved — the user's library keeps its file — and an existing
   * destination is reported as `already-present`, never overwritten.
   *
   * A local match is copied unasked only when `isAutoCopyable` says the
   * evidence names the WORK: `high`, or `medium` corroborated by a second
   * distinct evidence id. That refuses two rungs, not one — every `low` match
   * (filename title-words alone) AND an uncorroborated `medium`, which is what
   * a lone `filename-author-year` scores, because "Smith 2020" names every
   * paper Smith wrote in 2020, so whichever Smith 2020 sits in `~/Downloads`
   * would be filed under this cite key and the mistake found at submission.
   * Both come back in `matches` with their path, confidence and evidence, for
   * the view to name and the user to attach by hand instead.
   *
   * `policy` is explicitly null to mean "whatever library.json says"; a value
   * overrides the stored policy for this call only and is never written back.
   */
  'library:acquire-pdf': {
    request: z.object({
      result: LitResultSchema,
      /** The bibliography key the PDF is filed under; it may not contain a path separator. */
      citekey: z.string().min(1),
      projectRoot: z.string().min(1),
      policy: DownloadPolicySchema.nullable(),
    }),
    response: LibraryAcquireOutcomeSchema,
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
      /**
       * Directed-action extensions (feature-plan-8 §2a). All three shape the
       * CLAUDE spawn only; the codex path ignores them (codex asks run
       * --sandbox read-only, so directed EDIT actions never target it).
       * `allowedTools` joins into ONE `--allowed-tools` argv element,
       * comma-separated.
       */
      allowedTools: z.array(z.string().min(1)).optional(),
      /** Append `--mcp-config <dir>/.mcp.json` — only when that file exists on disk. */
      useMcp: z.boolean().optional(),
      /** Deliver the prompt over stdin: no argv length limit, and it never shows in `ps`. */
      viaStdin: z.boolean().optional(),
    }),
    response: z.object({ askId: z.string().min(1) }),
  },
  /** Kills the child process for an in-flight 'ai:ask' run. A no-op if it already finished. */
  'ai:cancel': {
    request: z.object({ askId: z.string().min(1) }),
    response: z.object({}),
  },
  /**
   * Screenshot a region of the SENDER's window (feature-plan-8 §2b). Main
   * clamps `rect` to the window's content bounds, captures, and writes a PNG
   * to `targetPath` (root-confined like every renderer-directed write) or to
   * <temp>/suna-captures/cap-<ts>.png when omitted. `width`/`height` are the
   * DECODED pixel size of the written PNG — on a HiDPI display that is the
   * CSS rect times the device pixel ratio, not the rect itself.
   */
  'app:capture-rect': {
    request: z.object({
      rect: CaptureRectSchema,
      targetPath: z.string().min(1).optional(),
    }),
    response: z.object({
      path: z.string().min(1),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
  },
  /**
   * Whether this is a dev (unpackaged) run, and where the SUNA source
   * checkout is. `repoRoot` is non-null exactly when `isDev` — a packaged app
   * has no source repo, which is what gates "Repair this UI"
   * (feature-plan-8 §5).
   */
  'app:dev-info': {
    request: z.object({}),
    response: z.object({
      isDev: z.boolean(),
      repoRoot: z.string().min(1).nullable(),
    }),
  },
  /**
   * Write a "Repair this UI" report bundle under <repoRoot>/bug-reports/
   * (feature-plan-8 §5): context.json (the renderer's serialized report,
   * written verbatim) plus shot.png when `rect` is given. Dev-only — throws
   * when packaged. Main also allow-lists repoRoot so the renderer's follow-up
   * 'ai:ask' with dir = repoRoot passes root confinement; main writes the
   * bundle and nothing else — the renderer composes the prompt. `shotPath` is
   * null when no rect was sent or the capture failed; the bundle is on disk
   * either way (the bundle IS the fallback when no CLI is installed).
   */
  'ai:repair-bundle': {
    request: z.object({
      slug: z.string().min(1),
      contextJson: z.string().min(1),
      rect: CaptureRectSchema.optional(),
    }),
    response: z.object({
      bundleDir: z.string().min(1),
      shotPath: z.string().min(1).nullable(),
    }),
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
   * any source file. Built entirely with the bundled 'docx' library — no
   * external binary is ever consulted.
   *
   * `target` picks the document: 'manuscript' (the default) is the main
   * manuscript; 'supplement' renders manuscript/supplementary.md as a
   * Supplementary Information document (cover title + byline, a linked
   * Contents list, S-numbered figures/tables, independently numbered
   * Supplementary References). The supplement target throws a clear error
   * naming the expected path when the file does not exist.
   */
  'export:docx': {
    request: z.object({
      dir: z.string().min(1),
      profileId: z.string().min(1),
      outputName: z.string().min(1),
      figurePngPaths: z.record(z.string(), z.string()),
      options: ExportOptionsSchema,
      target: z.enum(['manuscript', 'supplement']).default('manuscript'),
    }),
    response: z.object({
      path: z.string().min(1),
    }),
  },
  /**
   * Standalone web-page export: ONE self-contained .html file (figures and
   * KaTeX assets inlined as data: URIs, no external requests) that mirrors
   * the manuscript as the SUNA reading tab renders it — same title-page
   * shape, SUNA reading typography and palette, in-text citations as
   * hyperlinks to their reference-list entries, figure/table cross-refs as
   * in-page links. `figurePngPaths` and `target` have the same contract as
   * 'export:docx'; the print-only submission options (double spacing, line
   * numbers, page numbers) do not apply to a web page and are ignored.
   * Writes to `<dir>/output/<outputName>.html`.
   */
  'export:html': {
    request: z.object({
      dir: z.string().min(1),
      profileId: z.string().min(1),
      outputName: z.string().min(1),
      figurePngPaths: z.record(z.string(), z.string()),
      options: ExportOptionsSchema,
      target: z.enum(['manuscript', 'supplement']).default('manuscript'),
    }),
    response: z.object({ path: z.string().min(1) }),
  },
  /**
   * PDF export (feature-plan-6 §4): the SAME profile-styled content model as
   * 'export:docx', rendered to HTML and printed via a hidden BrowserWindow's
   * `printToPDF` — no LaTeX, no external binary. `figurePngPaths` and
   * `target` have the same contract as 'export:docx'. Writes to
   * `<dir>/output/<outputName>.pdf`.
   */
  'export:pdf': {
    request: z.object({
      dir: z.string().min(1),
      profileId: z.string().min(1),
      outputName: z.string().min(1),
      figurePngPaths: z.record(z.string(), z.string()),
      options: ExportOptionsSchema,
      target: z.enum(['manuscript', 'supplement']).default('manuscript'),
    }),
    response: z.object({ path: z.string().min(1) }),
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
  /**
   * Something inside the open project's directory was created, deleted,
   * renamed, or moved — by an export, an agent, the terminal, or another app.
   * Payload: `{ dir: string }`, the project root whose contents moved, so a
   * stale push for a project the renderer already closed can be ignored.
   *
   * Deliberately says only "something changed" rather than naming the path:
   * the renderer's response is always the same (re-list the tree), and a
   * recursive watch on macOS coalesces events in ways that make a precise
   * path unreliable.
   */
  projectTreeChanged: 'project:tree-changed',
} as const;

export type ChannelName = keyof typeof CHANNELS;
export type RequestOf<C extends ChannelName> = z.infer<(typeof CHANNELS)[C]['request']>;
export type ResponseOf<C extends ChannelName> = z.infer<(typeof CHANNELS)[C]['response']>;
