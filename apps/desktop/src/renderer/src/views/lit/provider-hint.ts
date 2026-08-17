import type { UiLitProviderId } from '@suna/core'

/**
 * ERROR HONESTY (feature-plan-2 §4): a provider error always renders with a
 * concrete way forward, never leaves the panel looking like an empty,
 * silently-failed search. Crossref is the keyless, always-available
 * fallback, so every non-Crossref suggestion points back to it.
 */
export function suggestionFor(provider: UiLitProviderId): string {
  if (provider === 'crossref') {
    return 'Crossref usually recovers on its own — try again in a moment.'
  }
  if (provider === 'ai-cli') {
    return 'Try Crossref instead — no key needed. Or check Claude Code/Codex is installed and signed in.'
  }
  return 'Try Crossref instead — no key needed. Or add a key for this provider in Settings.'
}

/**
 * Short badge shown next to each provider in the picker (feature-plan-3 §2
 * BUILD step 4) — a cost/latency hint, not the longer per-provider note
 * (@suna/core's LIT_PROVIDER_META.note) shown once the provider is selected.
 */
const HINTS: Record<UiLitProviderId, string> = {
  'ai-cli': 'uses your Claude/Codex subscription · ~30–60s',
  crossref: 'free, no key',
  openalex: 'metered',
  biorxiv: 'free, preprints',
  arxiv: 'free, best-effort'
}

export function hintFor(provider: UiLitProviderId): string {
  return HINTS[provider]
}
