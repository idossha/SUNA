import type { PublisherProfile } from '@suna/core';
import { loadProfile } from './profiles';
import apjAas from '../../../resources/profiles/apj-aas.json';
import mnras from '../../../resources/profiles/mnras.json';
import natureAstronomy from '../../../resources/profiles/nature-astronomy.json';
import science from '../../../resources/profiles/science.json';

/** Profiles shipped with the app, validated at first access. */
const RAW: Record<string, unknown> = {
  'apj-aas': apjAas,
  mnras,
  'nature-astronomy': natureAstronomy,
  science,
};

const cache = new Map<string, PublisherProfile>();

export function getBundledProfile(id: string): PublisherProfile | null {
  const cached = cache.get(id);
  if (cached) return cached;
  const raw = RAW[id];
  if (raw === undefined) return null;
  const profile = loadProfile(raw);
  cache.set(id, profile);
  return profile;
}
