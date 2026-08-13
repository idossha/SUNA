import { z } from 'zod';

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

/** suna.json — the project manifest at the root of a SUNA research project. */
export const SunaProjectManifestSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  activeProfileId: z.string().min(1),
  directories: z.record(ProjectDirKeySchema, z.string().min(1)),
  createdAt: z.iso.datetime(),
});
export type SunaProjectManifest = z.infer<typeof SunaProjectManifestSchema>;
