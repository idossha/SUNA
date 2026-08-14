import { z } from 'zod';
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
} as const satisfies Record<string, ChannelContract>;

export type ChannelName = keyof typeof CHANNELS;
export type RequestOf<C extends ChannelName> = z.infer<(typeof CHANNELS)[C]['request']>;
export type ResponseOf<C extends ChannelName> = z.infer<(typeof CHANNELS)[C]['response']>;
