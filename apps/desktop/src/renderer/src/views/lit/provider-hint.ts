import type { LitProviderId } from '@suna/core'

/**
 * ERROR HONESTY (feature-plan-2 §4): a provider error always renders with a
 * concrete way forward, never leaves the panel looking like an empty,
 * silently-failed search. Crossref is the keyless, always-available
 * fallback, so every non-Crossref suggestion points back to it.
 */
export function suggestionFor(provider: LitProviderId): string {
  return provider === 'crossref'
    ? 'Crossref usually recovers on its own — try again in a moment.'
    : 'Try Crossref instead — no key needed. Or add a key for this provider in Settings.'
}
