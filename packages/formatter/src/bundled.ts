import type { PublisherProfile } from '@suna/core';
import { BUNDLED_RAW, loadProfile } from './profiles';

const cache = new Map<string, PublisherProfile>();

/** Profiles shipped with the app, validated (and `extends`-resolved) at first access. */
export function getBundledProfile(id: string): PublisherProfile | null {
  const cached = cache.get(id);
  if (cached) return cached;
  const raw = BUNDLED_RAW[id];
  if (raw === undefined) return null;
  const profile = loadProfile(raw);
  cache.set(id, profile);
  return profile;
}
