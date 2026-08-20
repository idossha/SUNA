import type { JSX } from 'react'

/**
 * The appearance-settings glyph, shared by every tab that carries a
 * SettingsPopover (the manuscript tab and the letter tab). It used to be a
 * private copy inside each of them.
 */
export function GearIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 5.2h11M2.5 10.8h11"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <circle cx="6" cy="5.2" r="1.7" stroke="currentColor" strokeWidth="1.1" fill="var(--s-bg-raised)" />
      <circle
        cx="10.4"
        cy="10.8"
        r="1.7"
        stroke="currentColor"
        strokeWidth="1.1"
        fill="var(--s-bg-raised)"
      />
    </svg>
  )
}
