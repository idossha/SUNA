import { z } from 'zod';
import { DocxAnalysisSchema } from './docx-import';
import {
  DownloadPolicySchema,
  LibraryConfigSchema,
  PdfAcquisitionSchema,
  PdfMatchSchema,
} from './library';
import { DocumentEntrySchema } from './documents';
import { CoverLetterMetaSchema, LetterKindSchema } from './letters';
import { LitCliIdSchema, LitProviderIdSchema, LitResultSchema } from './lit';
import {
  PointStatusSchema,
  ReviewerReportSchema,
  RoundKindSchema,
  RoundSchema,
} from './rounds';
import { LoggedVersionSchema } from './versions';
import { TrashEntrySchema } from './trash';
import { NoteColorSchema } from './refnotes';
import {
  AiEffortSchema,
  AiModelSchema,
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

/** One path on one side of the repository, as `git:status` reports it. */
const GIT_CHANGE = z.object({
  path: z.string().min(1),
  status: z.enum(['modified', 'added', 'deleted', 'renamed', 'untracked', 'conflicted']),
});

/** A Diagnostic as it crosses IPC — the formatter's type, structurally. */
export const DiagnosticWireSchema = z.object({
  id: z.string(),
  severity: z.enum(['error', 'warning']),
  surface: z.string(),
  message: z.string(),
  target: z
    .object({
      figureId: z.string().optional(),
      elementId: z.string().optional(),
      sectionPath: z.string().optional(),
      documentId: z.string().optional(),
      slotId: z.string().optional(),
      pointId: z.string().optional(),
      assertionId: z.string().optional(),
    })
    .optional(),
});

/** A segmented point as it crosses IPC, before it is committed. */
export const ReviewPointWireSchema = z.object({
  id: z.string(),
  reviewerIndex: z.number(),
  pointIndex: z.number(),
  section: z.string().nullable(),
  from: z.number(),
  to: z.number(),
  verbatim: z.string(),
  reason: z.string(),
  /** The author's own reply, when the source was a response document. */
  reply: z
    .object({
      number: z.number(),
      from: z.number(),
      to: z.number(),
      text: z.string(),
    })
    .nullable()
    .default(null),
});

export const CHANNELS = {
  /* ---- documents, letters and rounds (feature-plan-12) ------------------ */
  /** The project's document registry, resolved (synthesized when absent). */
  'documents:list': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({
      documents: z.array(DocumentEntrySchema),
      /**
       * Registry ids whose prose file is no longer on disk. The registry is a
       * plain JSON file people edit, move and delete around; an entry whose
       * file has gone is shown as missing rather than silently opening an
       * empty editor.
       */
      missing: z.array(z.string()),
    }),
  },
  /** Drop one entry from suna.json's registry. Deletes no file. */
  'documents:remove': {
    request: z.object({ dir: z.string().min(1), documentId: z.string().min(1) }),
    response: z.object({ documents: z.array(DocumentEntrySchema) }),
  },
  /** Create a cover letter: prose + sidecar + gitignored private sidecar. */
  'letter:new': {
    request: z.object({
      dir: z.string().min(1),
      id: z.string().min(1),
      letterKind: LetterKindSchema,
      targetProfileId: z.string().min(1),
      title: z.string().min(1).optional(),
      salutation: z.string().nullable().optional(),
    }),
    response: z.object({
      documentId: z.string(),
      proseFile: z.string(),
      metaFile: z.string(),
      seedComment: z.string().nullable(),
      requiredAssertions: z.array(z.string()),
      gitignoreTouched: z.boolean(),
    }),
  },
  'letter:read': {
    request: z.object({ dir: z.string().min(1), metaFile: z.string().min(1) }),
    response: z.object({ meta: CoverLetterMetaSchema }),
  },
  'letter:write': {
    request: z.object({
      dir: z.string().min(1),
      metaFile: z.string().min(1),
      meta: CoverLetterMetaSchema,
    }),
    response: z.object({ ok: z.literal(true) }),
  },
  /** Diagnostics for one letter against the venue it targets. */
  'letter:check': {
    request: z.object({ dir: z.string().min(1), documentId: z.string().min(1) }),
    response: z.object({ diagnostics: z.array(DiagnosticWireSchema) }),
  },
  'round:new': {
    request: z.object({
      dir: z.string().min(1),
      id: z.string().min(1),
      kind: RoundKindSchema,
      label: z.string().min(1),
      venue: z.string().nullable().optional(),
    }),
    response: z.object({ round: RoundSchema }),
  },
  'round:list': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({ rounds: z.array(RoundSchema) }),
  },
  'round:read': {
    request: z.object({ dir: z.string().min(1), roundId: z.string().min(1) }),
    response: z.object({
      round: RoundSchema,
      reports: z.array(ReviewerReportSchema),
    }),
  },
  'round:write': {
    request: z.object({ dir: z.string().min(1), round: RoundSchema }),
    response: z.object({ ok: z.literal(true) }),
  },

  /**
   * Logged manuscript versions (versions.ts). 'version:log' copies the whole
   * manuscript into manuscript/archive/v<stage>.<minor>/; there is no write
   * counterpart, which is what makes an archived version read-only.
   */
  'version:list': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({ versions: z.array(LoggedVersionSchema) }),
  },
  'version:log': {
    request: z.object({
      dir: z.string().min(1),
      stage: z.number().int().nonnegative().optional(),
      note: z.string().optional(),
    }),
    response: z.object({ version: LoggedVersionSchema }),
  },
  'version:read-file': {
    request: z.object({
      dir: z.string().min(1),
      versionId: z.string().min(1),
      path: z.string().min(1),
    }),
    response: z.object({ text: z.string() }),
  },
  /**
   * Pass 1 of reviewer import: analyse text, or extract it from a file first.
   * WRITES NOTHING — the review screen renders this and the user confirms.
   */
  'review:analyse': {
    request: z.object({
      /** Pasted text, or null when `path` names a file to extract from. */
      text: z.string().nullable(),
      path: z.string().min(1).nullable(),
    }),
    response: z.object({
      sourceText: z.string(),
      reviewers: z.array(
        z.object({
          index: z.number(),
          label: z.string(),
          from: z.number(),
          to: z.number(),
          points: z.array(ReviewPointWireSchema),
          /** Section-heading spans: structure, neither a point nor a loss. */
          headings: z
            .array(z.object({ from: z.number(), to: z.number() }))
            .default([]),
        }),
      ),
      preamble: z.string(),
      unassigned: z.array(
        z.object({ from: z.number(), to: z.number(), text: z.string() }),
      ),
      coveragePercent: z.number(),
      totalPoints: z.number(),
      unsplitReviewers: z.array(z.number()),
      /** Reply numbers the source skips — RE57 and RE59 present, RE58 not. */
      replyGaps: z.array(z.number()).default([]),
    }),
  },
  /** Pass 2: write the reviewer records the user confirmed. */
  'review:commit': {
    request: z.object({
      dir: z.string().min(1),
      roundId: z.string().min(1),
      sourceText: z.string(),
      preamble: z.string(),
      reviewers: z.array(
        z.object({
          index: z.number(),
          label: z.string(),
          from: z.number(),
          to: z.number(),
          points: z.array(ReviewPointWireSchema),
          /** Section-heading spans: structure, neither a point nor a loss. */
          headings: z
            .array(z.object({ from: z.number(), to: z.number() }))
            .default([]),
        }),
      ),
      unassigned: z.array(z.object({ from: z.number(), to: z.number(), text: z.string() })),
    }),
    response: z.object({ reviewers: z.number(), points: z.number() }),
  },
  /** Set the author's own state on one reviewer point. */
  'review:set-point': {
    request: z.object({
      dir: z.string().min(1),
      roundId: z.string().min(1),
      pointId: z.string().min(1),
      status: PointStatusSchema,
      assignee: z.string().min(1).nullable().optional(),
    }),
    response: z.object({ round: RoundSchema }),
  },
  /** Completeness diagnostics for a round's response. */
  'review:check': {
    request: z.object({
      dir: z.string().min(1),
      roundId: z.string().min(1),
      forExport: z.boolean().optional(),
    }),
    response: z.object({ diagnostics: z.array(DiagnosticWireSchema) }),
  },
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
      scaffold: z.enum(['blank', 'starter', 'import', 'document']),
      /** Source folder for 'import'; ignored otherwise. */
      importDir: z.string().min(1).nullable(),
      /** Source .docx/.pdf/.html manuscript for 'document'; ignored otherwise. */
      documentPath: z.string().min(1).nullable().default(null),
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
   * A file's size in bytes, root-confined like the rest of the fs surface.
   * Unlike 'fs:read-binary' it never reads the bytes, so it stays cheap for
   * the very files that matter here — a multi-megabyte PDF/HTML export whose
   * size the export page reports before and after compression.
   */
  'fs:file-size': {
    request: z.object({ path: z.string().min(1) }),
    response: z.object({ bytes: z.number().int().nonnegative() }),
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
  /**
   * Delete an entry from the UI. Never a hard unlink: a small enough FILE is
   * moved into SUNA's own trash (recoverable for the retention window), and
   * everything else — directories, oversized files — goes to the OS trash.
   * `destination` reports which happened so the caller can say so.
   */
  'fs:delete': {
    request: z.object({ path: z.string().min(1) }),
    response: z.object({ destination: z.enum(['suna', 'system']) }),
  },
  /**
   * A project's recoverable files, newest first — the trash lives in the
   * project, under `.suna/trash/`. Purges expired entries first.
   */
  'trash:list': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({ entries: z.array(TrashEntrySchema) }),
  },
  /**
   * Put files back where they came from. PARTIAL by contract, like 'fs:move':
   * an entry whose name is taken again is named in `failed` rather than
   * failing the batch. A deleted original directory is recreated.
   */
  'trash:restore': {
    request: z.object({
      dir: z.string().min(1),
      ids: z.array(z.string().min(1)).min(1),
    }),
    response: z.object({
      restored: z.array(z.object({ id: z.string().min(1), path: z.string().min(1) })),
      failed: z.array(
        z.object({ id: z.string().min(1), reason: z.string().min(1) }),
      ),
    }),
  },
  /**
   * Hand entries to the OS trash and drop them from the index. `ids` absent
   * means "empty the trash" — still to the OS trash, never destroyed here.
   */
  'trash:empty': {
    request: z.object({
      dir: z.string().min(1),
      ids: z.array(z.string().min(1)).optional(),
    }),
    response: z.object({ removed: z.number().int().min(0) }),
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
  /**
   * The index and the working tree as separate lists — the split VS Code and
   * GitHub Desktop show. A path may appear in both (staged, then edited
   * again), so one merged list could not describe the repository truthfully.
   */
  'git:status': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({
      isRepo: z.boolean(),
      branch: z.string().nullable(),
      staged: z.array(GIT_CHANGE),
      unstaged: z.array(GIT_CHANGE),
    }),
  },
  /**
   * Stage, unstage, or discard ONE hunk of one file — partial staging, as in
   * VS Code. `index` is the position of the hunk in the diff for the side
   * implied by the action (unstage reads the staged diff, the others the
   * working-tree diff), which the main process re-computes before applying, so
   * a stale index fails loudly instead of patching the wrong place.
   */
  'git:apply-hunk': {
    request: z.object({
      dir: z.string().min(1),
      path: z.string().min(1),
      index: z.number().int().nonnegative(),
      action: z.enum(['stage', 'unstage', 'discard']),
    }),
    response: z.object({}),
  },
  /** `git add` for exactly these paths (untracked and deleted included). */
  'git:stage': {
    request: z.object({ dir: z.string().min(1), paths: z.array(z.string().min(1)).min(1) }),
    response: z.object({}),
  },
  /** Take these paths out of the index; the working tree is left alone. */
  'git:unstage': {
    request: z.object({ dir: z.string().min(1), paths: z.array(z.string().min(1)).min(1) }),
    response: z.object({}),
  },
  /**
   * Throw away working-tree changes — the one destructive git call the app
   * makes. Tracked paths are restored from the index; untracked paths are
   * DELETED, and only when `deleteUntracked` is set, which the caller must
   * have confirmed with the user first.
   */
  'git:discard': {
    request: z.object({
      dir: z.string().min(1),
      paths: z.array(z.string().min(1)).min(1),
      deleteUntracked: z.boolean().optional(),
    }),
    response: z.object({
      reverted: z.array(z.string()),
      deleted: z.array(z.string()),
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
  /** `amend` replaces the previous commit; only offered before it is pushed. */
  'git:commit': {
    request: z.object({
      dir: z.string().min(1),
      message: z.string().min(1),
      stageAll: z.boolean(),
      amend: z.boolean().optional(),
    }),
    response: z.object({ hash: z.string().min(1) }),
  },
  /** One file's diff, on the side asked for: index, working tree, or both. */
  'git:diff-file': {
    request: z.object({
      dir: z.string().min(1),
      path: z.string().min(1),
      side: z.enum(['staged', 'unstaged', 'both']).optional(),
    }),
    response: z.object({ diff: z.string() }),
  },
  'git:init': {
    request: z.object({ dir: z.string().min(1) }),
    /** The repo always exists on success; `warning` says why no first commit. */
    response: z.object({ committed: z.boolean(), warning: z.string().nullable() }),
  },
  /**
   * The project's `origin`, if it has one, plus how far the branch has drifted
   * from its last-known upstream. `sshUrl` is non-null only when the stored url
   * is HTTPS and converts, i.e. exactly when the UI can offer the swap.
   */
  'git:remote': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({
      name: z.string().nullable(),
      url: z.string().nullable(),
      protocol: z.enum(['ssh', 'https', 'other']).nullable(),
      host: z.string().nullable(),
      sshUrl: z.string().nullable(),
      slug: z.string().nullable(),
      upstream: z.string().nullable(),
      ahead: z.number().int(),
      behind: z.number().int(),
      hasCommits: z.boolean(),
      branch: z.string().nullable(),
    }),
  },
  /**
   * Set `origin`. HTTPS urls are rewritten to SSH unless `allowHttps` is set:
   * a windowless app cannot answer a password prompt, so SSH is the default
   * that actually works (`converted` reports when the rewrite happened).
   */
  'git:set-remote': {
    request: z.object({
      dir: z.string().min(1),
      url: z.string().min(1),
      allowHttps: z.boolean().optional(),
    }),
    response: z.object({
      url: z.string().min(1),
      protocol: z.enum(['ssh', 'https', 'other']),
      converted: z.boolean(),
    }),
  },
  /**
   * Ask the remote whether it exists (`git ls-remote`). `missing` marks the
   * fixable case — the host answered, but there is no such repository — which
   * is what a hand-typed remote for a repository never created looks like.
   */
  'git:check-remote': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({
      reachable: z.boolean(),
      missing: z.boolean(),
      message: z.string(),
    }),
  },
  /** Push the current branch to origin, setting upstream on the first push. */
  'git:push': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({
      branch: z.string().min(1),
      remote: z.string().min(1),
      setUpstream: z.boolean(),
      output: z.string(),
    }),
  },
  /**
   * What the machine already has for SSH pushing: public keys in ~/.ssh (never
   * private ones), ssh-agent identities, git's commit identity, and — only when
   * `probe` is set — a live `ssh -T git@host` handshake.
   */
  'git:ssh-status': {
    request: z.object({ host: z.string().min(1).optional(), probe: z.boolean() }),
    response: z.object({
      host: z.string(),
      sshDir: z.string(),
      keys: z.array(
        z.object({
          file: z.string(),
          type: z.string(),
          comment: z.string(),
          publicKey: z.string(),
        }),
      ),
      agentKeys: z.number().int().nullable(),
      authenticated: z.boolean().nullable(),
      probeMessage: z.string().nullable(),
      identity: z.object({ name: z.string().nullable(), email: z.string().nullable() }),
    }),
  },
  /**
   * The commit graph behind the timeline: commits with their parents and
   * decorations, plus the lane placement already computed, so the renderer
   * draws SVG rather than re-deriving ancestry.
   */
  'git:graph': {
    request: z.object({
      dir: z.string().min(1),
      limit: z.number().int().positive().max(500),
      scope: z.enum(['current', 'all']).optional(),
    }),
    response: z.object({
      commits: z.array(
        z.object({
          hash: z.string().min(1),
          parents: z.array(z.string()),
          author: z.string(),
          email: z.string(),
          date: z.string(),
          subject: z.string(),
          refs: z.array(
            z.object({
              kind: z.enum(['head', 'local', 'remote', 'tag']),
              name: z.string(),
            }),
          ),
          /** Reachable from a remote-tracking ref, i.e. already on the server. */
          pushed: z.boolean(),
        }),
      ),
      rows: z.array(
        z.object({
          hash: z.string().min(1),
          lane: z.number().int(),
          color: z.number().int(),
          /** -1 on either end means "the commit dot on this row". */
          edges: z.array(
            z.object({
              fromLane: z.number().int(),
              toLane: z.number().int(),
              color: z.number().int(),
            }),
          ),
        }),
      ),
      laneCount: z.number().int().positive(),
      truncated: z.boolean(),
    }),
  },
  /** The commits that touched one path, newest first (`git log --follow`). */
  'git:file-history': {
    request: z.object({
      dir: z.string().min(1),
      path: z.string().min(1),
      limit: z.number().int().positive().max(200),
    }),
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
  /** One commit's patch and per-file line counts, for clicking a timeline row. */
  'git:show-commit': {
    request: z.object({ dir: z.string().min(1), hash: z.string().min(4) }),
    response: z.object({
      diff: z.string(),
      files: z.array(
        z.object({
          path: z.string(),
          added: z.number().int().nonnegative(),
          removed: z.number().int().nonnegative(),
        }),
      ),
    }),
  },
  /** Local branches plus remote-only ones, each with its drift from upstream. */
  'git:branches': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({
      current: z.string().nullable(),
      detached: z.boolean(),
      branches: z.array(
        z.object({
          name: z.string().min(1),
          current: z.boolean(),
          upstream: z.string().nullable(),
          ahead: z.number().int(),
          behind: z.number().int(),
          subject: z.string(),
          date: z.string(),
          remote: z.boolean(),
        }),
      ),
    }),
  },
  'git:create-branch': {
    request: z.object({ dir: z.string().min(1), name: z.string().min(1) }),
    response: z.object({ branch: z.string().min(1), created: z.boolean() }),
  },
  /**
   * Switch branches. A remote-only name ('origin/revision-2') becomes a local
   * branch tracking it, rather than a detached HEAD the user cannot leave.
   */
  'git:switch-branch': {
    request: z.object({ dir: z.string().min(1), name: z.string().min(1) }),
    response: z.object({ branch: z.string().min(1), created: z.boolean() }),
  },
  /** Delete a local branch; `force` discards commits on no other branch. */
  'git:delete-branch': {
    request: z.object({
      dir: z.string().min(1),
      name: z.string().min(1),
      force: z.boolean().optional(),
    }),
    response: z.object({ branch: z.string().min(1) }),
  },
  /** Merge a branch in. Conflicts come back as `clean: false`, not an error. */
  'git:merge-branch': {
    request: z.object({ dir: z.string().min(1), name: z.string().min(1) }),
    response: z.object({
      clean: z.boolean(),
      conflicted: z.array(z.string()),
      output: z.string(),
    }),
  },
  /**
   * Update remote-tracking refs and re-read the drift. Without this the
   * ahead/behind counts describe whenever someone last ran git in a terminal.
   */
  'git:fetch': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({
      fetched: z.boolean(),
      ahead: z.number().int(),
      behind: z.number().int(),
      upstream: z.string().nullable(),
      error: z.string().nullable(),
    }),
  },
  /** Bring the remote's commits down; conflicts are a result, not an error. */
  'git:pull': {
    request: z.object({
      dir: z.string().min(1),
      mode: z.enum(['rebase', 'merge']).optional(),
    }),
    response: z.object({
      clean: z.boolean(),
      alreadyUpToDate: z.boolean(),
      mode: z.enum(['rebase', 'merge']),
      conflicted: z.array(z.string()),
      output: z.string(),
    }),
  },
  /** Which multi-step operation the repo is mid-way through, and what is stuck. */
  'git:conflict-state': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({
      operation: z.enum(['merge', 'rebase', 'cherry-pick', 'revert', 'none']),
      paths: z.array(z.string()),
      incoming: z.string().nullable(),
    }),
  },
  /**
   * Resolve one conflicted file by taking one side whole. Note that git's
   * 'ours' and 'theirs' swap meaning during a rebase; the UI labels them from
   * the operation rather than passing these words through.
   */
  'git:resolve-conflict': {
    request: z.object({
      dir: z.string().min(1),
      path: z.string().min(1),
      side: z.enum(['ours', 'theirs']),
    }),
    response: z.object({}),
  },
  /** Stage a hand-edited file as resolved; refuses if markers remain. */
  'git:mark-resolved': {
    request: z.object({ dir: z.string().min(1), path: z.string().min(1) }),
    response: z.object({}),
  },
  /**
   * Finish the operation. `setAside` stashes unrelated unstaged edits first —
   * git's `rebase --continue` refuses while ANY file has them, conflict or
   * not, which `blocked` reports so the UI can offer that rather than relay
   * git's misleading "you must edit all merge conflicts".
   */
  'git:continue': {
    request: z.object({ dir: z.string().min(1), setAside: z.boolean().optional() }),
    response: z.object({
      done: z.boolean(),
      paths: z.array(z.string()),
      blocked: z.array(z.string()),
      output: z.string(),
    }),
  },
  'git:abort': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({
      operation: z.enum(['merge', 'rebase', 'cherry-pick', 'revert', 'none']),
    }),
  },
  /**
   * Undo the last commit, keeping its changes staged. Refused once the commit
   * is on the remote, where undoing it locally only creates a divergence.
   */
  'git:undo-commit': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({ subject: z.string(), wasPushed: z.boolean() }),
  },
  /** The last commit's message, for pre-filling an amend. */
  'git:last-message': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({ message: z.string() }),
  },
  /**
   * Whether SUNA can act on GitHub right now. `configured: false` means this
   * build carries no OAuth App client id, so sign-in is impossible and the
   * panel says so instead of offering a button that cannot work.
   */
  'github:session': {
    request: z.object({}),
    response: z.object({
      configured: z.boolean(),
      signedIn: z.boolean(),
      needsReauth: z.boolean(),
      message: z.string().nullable(),
      account: z
        .object({
          login: z.string(),
          name: z.string().nullable(),
          avatarUrl: z.string().nullable(),
          htmlUrl: z.string(),
          scopes: z.array(z.string()),
        })
        .nullable(),
    }),
  },
  /**
   * Begin the OAuth device flow: GitHub returns a short code the user types at
   * `verificationUri`. No client secret is involved — the device flow exists
   * for apps that cannot keep one.
   */
  'github:device-start': {
    request: z.object({}),
    response: z.object({
      userCode: z.string().min(1),
      verificationUri: z.string().min(1),
      deviceCode: z.string().min(1),
      expiresIn: z.number().int().positive(),
      interval: z.number().int().positive(),
    }),
  },
  /**
   * ONE poll of the device flow. The renderer owns the timer, so closing the
   * dialog ends the flow rather than leaving main polling GitHub forever.
   */
  'github:device-poll': {
    request: z.object({
      deviceCode: z.string().min(1),
      interval: z.number().int().positive(),
    }),
    response: z.object({
      status: z.enum(['pending', 'authorized', 'denied', 'expired']),
      interval: z.number().int().positive(),
      persisted: z.boolean(),
      message: z.string().nullable(),
      account: z
        .object({
          login: z.string(),
          name: z.string().nullable(),
          avatarUrl: z.string().nullable(),
          htmlUrl: z.string(),
          scopes: z.array(z.string()),
        })
        .nullable(),
    }),
  },
  'github:sign-out': {
    request: z.object({}),
    response: z.object({}),
  },
  /** Accounts the signed-in user may create a repository under. */
  'github:owners': {
    request: z.object({}),
    response: z.object({
      owners: z.array(
        z.object({
          login: z.string().min(1),
          kind: z.enum(['user', 'org']),
          avatarUrl: z.string().nullable(),
        }),
      ),
    }),
  },
  /**
   * Create an empty repository on GitHub and point `origin` at it — SSH by
   * default, HTTPS when `useHttps` says the signed-in credential will carry
   * the push. Creates only; the first push stays an explicit user action.
   */
  'github:create-repo': {
    request: z.object({
      dir: z.string().min(1),
      name: z.string().min(1),
      visibility: z.enum(['private', 'public', 'internal']),
      owner: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      useHttps: z.boolean().optional(),
    }),
    response: z.object({
      slug: z.string().min(1),
      htmlUrl: z.string().min(1),
      remoteUrl: z.string().min(1),
    }),
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
      /**
       * Project directory, when one is open. Main resolves 'ai.model' and
       * 'ai.effort' against its suna.json before the call; absent = the
       * global level decides.
       */
      dir: z.string().min(1).nullish(),
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

  /** manuscript/revisions.json — the AI-diff baseline (feature-plan-11). */
  'revisions:read': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({ file: z.unknown() }),
  },
  'revisions:write': {
    request: z.object({ dir: z.string().min(1), file: z.unknown() }),
    response: z.object({}),
  },

  /**
   * `references/notes/<citekey>.json` (ADR-008). A missing file reads as
   * `emptyReferenceNotes(citekey)`; the write validates with
   * ReferenceNotesFileSchema and lands atomically, same discipline as
   * comments.json. Separate from comments:* because reading notes are a
   * different artifact with a different lifecycle, and because a per-paper
   * file means one highlight does not rewrite the whole project's review data.
   */
  'refnotes:read': {
    request: z.object({ dir: z.string().min(1), citekey: z.string().min(1) }),
    response: z.object({ file: z.unknown() }),
  },
  'refnotes:write': {
    request: z.object({
      dir: z.string().min(1),
      citekey: z.string().min(1),
      file: z.unknown(),
    }),
    response: z.object({}),
  },
  /**
   * Every paper's reading notes at once, for the cross-paper view. Notes are
   * stored per paper so a highlight is a small write; reading across them is
   * the other half of that trade and needs one call rather than N.
   */
  'refnotes:list-all': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({
      /** `{ citekey, file }` per paper that has a notes file, citekey-sorted. */
      papers: z.array(z.object({ citekey: z.string(), file: z.unknown() })),
    }),
  },
  /**
   * Write SUNA's highlights into `references/<citekey>.pdf` as real PDF
   * annotations (ADR-008, amended: native, in place, never a copy in output/).
   *
   * `bytes` is the whole file after an incremental save that added and removed
   * exactly the annotations the sidecar called for. The main process holds one
   * invariant and needs no stored state to hold it: **the incoming bytes must
   * begin with the file that is on disk right now.** `saveDocument()` only
   * appends, so anything else means the file changed under the renderer
   * mid-edit — and writing then would discard whatever changed it.
   *
   * That check replaced a recorded pristine baseline, which had to be
   * invalidated the moment another application rewrote the paper and left SUNA
   * unable to write to it ever again.
   */
  'refnotes:embed': {
    request: z.object({
      dir: z.string().min(1),
      citekey: z.string().min(1),
      /** Base64 of the complete PDF after the incremental save. */
      base64: z.string(),
    }),
    response: z.object({
      bytesWritten: z.number().int().nonnegative(),
    }),
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
      /**
       * Per-TASK override of the model tier and reasoning effort. Absent means
       * "resolve from this project's suna.json over global settings", which is
       * what every call did before. Present means the user chose for this one
       * run — drafting a cover letter is worth Opus even when the project runs
       * on Haiku, and the reverse is just as true.
       */
      model: AiModelSchema.optional(),
      effort: AiEffortSchema.optional(),
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
   * Export the current figure into the project's output/figures/ dir.
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
  /**
   * Reading-notes export: the literature note as a document, in the ONE shape
   * the Reading Notes tab already shows on screen — the filtered selection,
   * grouped by paper, quote + written note + page.
   *
   * Deliberately not the manuscript exporter. There is no profile, no figure
   * rasterization, no submission options and no target: a literature note is
   * not a submission, and every knob that pipeline carries would be a knob
   * with no meaning here. The renderer sends the rendered strings it is
   * already displaying (page labels included, so the printed-page correction
   * is applied exactly once, in the one place that knows the offset) and main
   * only lays them out. Writes to `<dir>/output/notes/<outputName>.<format>` —
   * its own folder, so a literature note is never mistaken for a draft of the
   * manuscript sitting beside the real exports.
   */
  'export:notes': {
    request: z.object({
      dir: z.string().min(1),
      format: z.enum(['pdf', 'docx', 'html']),
      outputName: z.string().min(1),
      /** Document title, e.g. "Reading notes". */
      title: z.string().min(1),
      /** A one-line provenance caption under the title (project, filters, date). */
      subtitle: z.string().default(''),
      papers: z.array(
        z.object({
          citekey: z.string().min(1),
          /** "Author et al. (2021)" as the notes tab prints it. */
          label: z.string(),
          /** The paper's title, or '' when the bibliography has no entry. */
          title: z.string(),
          notes: z.array(
            z.object({
              /** Already corrected to the printed page — main never re-derives it. */
              page: z.string(),
              quote: z.string(),
              body: z.string(),
              color: NoteColorSchema,
              tags: z.array(z.string()),
              detached: z.boolean().default(false),
            }),
          ),
        }),
      ),
    }),
    response: z.object({ path: z.string().min(1) }),
  },
  /**
   * Cover-letter export: the letter itself as a PDF, Word file or web page.
   *
   * Deliberately not the manuscript pipeline, for the same reason
   * 'export:notes' is not: a letter has no figures to rasterize, no
   * cross-references to number and no submission format to satisfy — the
   * questions that pipeline asks ("double spaced? line numbers? which
   * article type?") have no answer for a letter. What it does carry, and the
   * manuscript does not, is the assertions: `::assert{id}` directives are
   * replaced by the author's own words from the sidecar.
   *
   * An unanswered assertion stops the export ONCE, by name, and
   * `acknowledgeUnanswered` is the author saying they know and want the file
   * anyway — a draft to circulate, a letter whose declarations go in the
   * submission portal instead. The unanswered directive contributes nothing
   * to the exported document either way: SUNA does not write those sentences,
   * so the choice is between an export without them and no export at all,
   * never between a true letter and a fabricated one.
   * Writes to `<dir>/output/letters/<outputName>.<format>`.
   */
  'export:letter': {
    request: z.object({
      dir: z.string().min(1),
      documentId: z.string().min(1),
      format: z.enum(['pdf', 'docx', 'html']),
      outputName: z.string().min(1),
      /** The author has seen the unanswered list and wants the file regardless. */
      acknowledgeUnanswered: z.boolean().default(false),
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
  /**
   * The open project's git state moved — index, HEAD, refs, or an in-progress
   * merge/rebase. Payload: `{ dir: string }`, the project root, so a stale
   * push for a project the renderer already closed can be ignored.
   *
   * Separate from `projectTreeChanged` because the two watch disjoint things:
   * the tree watch ignores `.git` (it churns constantly and the explorer never
   * shows it), which is precisely where staging and committing happen.
   */
  gitChanged: 'git:changed',
} as const;

export type ChannelName = keyof typeof CHANNELS;
export type RequestOf<C extends ChannelName> = z.infer<(typeof CHANNELS)[C]['request']>;
export type ResponseOf<C extends ChannelName> = z.infer<(typeof CHANNELS)[C]['response']>;
