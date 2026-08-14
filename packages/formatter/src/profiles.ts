import { PublisherProfileSchema, type PublisherProfile } from '@suna/core';

/**
 * Ids of the publisher profiles bundled with SUNA, one JSON document each
 * under resources/profiles/<id>.json at the repo root.
 */
export const BUNDLED_PROFILE_IDS = [
  'nature-astronomy',
  'science',
  'apj-aas',
  'mnras',
] as const;

export type BundledProfileId = (typeof BUNDLED_PROFILE_IDS)[number];

/**
 * Validate an untrusted JSON document as a PublisherProfile (v2).
 *
 * Wraps the zod parse so callers get one readable Error naming the profile
 * (when an id is present) and listing every failing field path.
 */
export function loadProfile(json: unknown): PublisherProfile {
  const result = PublisherProfileSchema.safeParse(json);
  if (result.success) {
    return result.data;
  }

  const id =
    typeof json === 'object' &&
    json !== null &&
    'id' in json &&
    typeof (json as { id: unknown }).id === 'string'
      ? ` "${(json as { id: string }).id}"`
      : '';

  const issues = result.error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
      return `  - ${path}: ${issue.message}`;
    })
    .join('\n');

  throw new Error(`Invalid publisher profile${id}:\n${issues}`);
}
