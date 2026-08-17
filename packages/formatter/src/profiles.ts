import { PublisherProfileSchema, type PublisherProfile } from '@suna/core';
import apjAas from '../../../resources/profiles/apj-aas.json';
import mnras from '../../../resources/profiles/mnras.json';
import natureAstronomy from '../../../resources/profiles/nature-astronomy.json';
import science from '../../../resources/profiles/science.json';
import nature from '../../../resources/profiles/nature.json';
import neuron from '../../../resources/profiles/neuron.json';
import pnas from '../../../resources/profiles/pnas.json';
import brainStimulation from '../../../resources/profiles/brain-stimulation.json';
import sleep from '../../../resources/profiles/sleep.json';
import sleepAdvances from '../../../resources/profiles/sleep-advances.json';
import jne from '../../../resources/profiles/jne.json';
import jneurosci from '../../../resources/profiles/jneurosci.json';
import suna from '../../../resources/profiles/suna.json';

/**
 * Ids of the publisher profiles bundled with SUNA, one JSON document each
 * under resources/profiles/<id>.json at the repo root.
 */
export const BUNDLED_PROFILE_IDS = [
  // The house style comes first: it is what a new project drafts in, and the
  // only entry here that is NOT derived from a journal's author guidelines.
  'suna',
  'nature-astronomy',
  'science',
  'apj-aas',
  'mnras',
  'nature',
  'neuron',
  'pnas',
  'brain-stimulation',
  'sleep',
  'sleep-advances',
  'jne',
  'jneurosci',
] as const;

export type BundledProfileId = (typeof BUNDLED_PROFILE_IDS)[number];

/**
 * Profiles temporarily HIDDEN from every profile picker (export dialog,
 * settings, onboarding, references view) — removed from the UI "for now" at
 * the user's request, NOT deleted: they stay bundled, loadable and valid, so
 * an existing project pointing at one keeps working and its picker shows the
 * hidden entry as the current selection. Restore by deleting from this list.
 */
export const HIDDEN_PROFILE_IDS = ['nature-astronomy', 'apj-aas', 'mnras'] as const satisfies readonly BundledProfileId[];

/** What profile pickers actually offer: the bundled list minus the hidden set. */
export const PICKER_PROFILE_IDS = BUNDLED_PROFILE_IDS.filter(
  (id) => !(HIDDEN_PROFILE_IDS as readonly string[]).includes(id)
);

/** Raw (unvalidated) bundled profile documents, keyed by id — the default `extends` registry. */
export const BUNDLED_RAW: Readonly<Record<string, unknown>> = {
  suna,
  'apj-aas': apjAas,
  mnras,
  'nature-astronomy': natureAstronomy,
  science,
  nature,
  neuron,
  pnas,
  'brain-stimulation': brainStimulation,
  sleep,
  'sleep-advances': sleepAdvances,
  jne,
  jneurosci,
};

export interface LoadProfileOptions {
  /**
   * Registry of raw profile documents used to resolve `extends` chains.
   * Defaults to the bundled profiles. A complete replacement, not an
   * overlay — include BUNDLED_RAW entries yourself if you need both.
   */
  registry?: Readonly<Record<string, unknown>>;
}

function describeId(json: unknown): string {
  return typeof json === 'object' &&
    json !== null &&
    'id' in json &&
    typeof (json as { id: unknown }).id === 'string'
    ? ` "${(json as { id: string }).id}"`
    : '';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Deep merge for `extends` resolution: plain objects merge key by key with
 * the child winning; everything else — arrays, scalars, null — is replaced
 * wholesale by the child value.
 */
function deepMerge(parent: unknown, child: unknown): unknown {
  if (isPlainObject(parent) && isPlainObject(child)) {
    const out: Record<string, unknown> = { ...parent };
    for (const [key, value] of Object.entries(child)) {
      out[key] = key in parent ? deepMerge(parent[key], value) : value;
    }
    return out;
  }
  return child;
}

/**
 * Resolve a document's `extends` chain against the registry, deepest parent
 * first. `seen` carries every id already on the chain so cycles (including
 * self-extension) fail loudly instead of recursing forever.
 */
function resolveExtends(
  json: unknown,
  registry: Readonly<Record<string, unknown>>,
  seen: string[],
): unknown {
  if (!isPlainObject(json)) return json;
  const parentId = json['extends'];
  if (typeof parentId !== 'string') return json;

  const ownId = typeof json['id'] === 'string' ? (json['id'] as string) : null;
  if (ownId !== null && !seen.includes(ownId)) seen.push(ownId);
  if (seen.includes(parentId)) {
    throw new Error(
      `Circular "extends" chain in publisher profiles: ${[...seen, parentId].join(' -> ')}`,
    );
  }
  const parentRaw = registry[parentId];
  if (parentRaw === undefined) {
    throw new Error(
      `Unknown parent profile "${parentId}" in "extends" of publisher profile${describeId(json)}`,
    );
  }
  seen.push(parentId);
  const parent = resolveExtends(parentRaw, registry, seen);
  return deepMerge(parent, json);
}

/**
 * Validate an untrusted JSON document as a PublisherProfile (v3).
 *
 * A document carrying `extends` is resolved against the registry first
 * (bundled profiles by default): the parent chain is deep-merged beneath it,
 * child values override, arrays replace. Cycles and unknown parents throw.
 * The merged document is then validated; on failure callers get one readable
 * Error naming the profile (when an id is present) and listing every failing
 * field path.
 */
export function loadProfile(json: unknown, options?: LoadProfileOptions): PublisherProfile {
  const resolved = resolveExtends(json, options?.registry ?? BUNDLED_RAW, []);
  const result = PublisherProfileSchema.safeParse(resolved);
  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
      return `  - ${path}: ${issue.message}`;
    })
    .join('\n');

  throw new Error(`Invalid publisher profile${describeId(json)}:\n${issues}`);
}
