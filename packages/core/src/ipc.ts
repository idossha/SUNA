import { z } from 'zod';
import { LitCliIdSchema, LitProviderIdSchema } from './lit';
import { ProjectDirKeySchema, SunaProjectManifestSchema } from './project';

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

export const CHANNELS = {
  'project:create': {
    request: z.object({
      dir: z.string().min(1),
      name: z.string().min(1),
    }),
    response: SunaProjectManifestSchema,
  },
  'project:open': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({
      manifest: SunaProjectManifestSchema,
      manuscriptPresent: z.boolean(),
    }),
  },
  'project:scaffold-status': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({
      manifestPresent: z.boolean(),
      dirs: z.record(ProjectDirKeySchema, z.boolean()),
    }),
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
  'fs:list': {
    request: z.object({ dir: z.string().min(1) }),
    response: z.object({ root: FsNodeSchema }),
  },
  'project:open-example': {
    request: z.object({}),
    response: z.object({
      dir: z.string().min(1),
      manifest: SunaProjectManifestSchema,
    }),
  },
  'dialog:pick-directory': {
    request: z.object({
      title: z.string().min(1),
      allowCreate: z.boolean(),
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
} as const;

export type ChannelName = keyof typeof CHANNELS;
export type RequestOf<C extends ChannelName> = z.infer<(typeof CHANNELS)[C]['request']>;
export type ResponseOf<C extends ChannelName> = z.infer<(typeof CHANNELS)[C]['response']>;
