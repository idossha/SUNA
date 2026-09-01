import type { WizardState } from './types'

/**
 * Dev-only seam so an e2e driver can walk the onboarding wizard (DECISIONS 2026-08-15)
 * without the native folder picker. Step 1's "Choose folder…" goes through
 * `dialog:pick-directory`, which opens an OS dialog CDP cannot drive — the same
 * wall "Attach PDF…" hits (see docs/TESTING.md). Rather than bypassing the wizard's
 * own logic, the driver patches the *state* the picker would have produced and
 * then drives real buttons: gating, validation, the Review preview and Create
 * all run exactly as they do for a user.
 *
 * Every mounted OnboardingTab registers a provider; `main.tsx` exposes the
 * stable `onboardingSeam` object as `window.__sunaDev.onboarding`. Providers
 * are a stack resolved through `isVisible()` (the canvas seam's reasoning:
 * dockview keeps hidden panels mounted, and a 'create' plus a 'setup' wizard
 * can be open at once).
 */
export interface OnboardingProvider {
  getState(): WizardState
  /** Shallow-merge into the wizard state, exactly as a step component's `update` does. */
  patch(next: Partial<WizardState>): void
  /** Close the tab — the same call the Cancel button and Escape make. */
  close(): void
  /** False while this tab is mounted but hidden behind another dock panel. */
  isVisible(): boolean
}

const providers: OnboardingProvider[] = []

function active(): OnboardingProvider | null {
  for (let i = providers.length - 1; i >= 0; i--) {
    const provider = providers[i]
    if (provider && provider.isVisible()) return provider
  }
  return null
}

export const onboardingSeam = {
  /** The visible wizard's state, or null when no wizard tab is on screen. */
  getState: (): WizardState | null => active()?.getState() ?? null,
  patch: (next: Partial<WizardState>): void => active()?.patch(next),
  close: (): void => active()?.close(),
  isOpen: (): boolean => active() !== null
}

/** Register a mounted OnboardingTab; returns an unregister function. */
export function registerOnboardingProvider(provider: OnboardingProvider): () => void {
  providers.push(provider)
  return () => {
    const at = providers.indexOf(provider)
    if (at >= 0) providers.splice(at, 1)
  }
}
