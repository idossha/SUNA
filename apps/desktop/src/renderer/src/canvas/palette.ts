import type { PublisherProfile } from '@suna/core'
import { toHexColor } from './canvas-util'

/** Palette section (canvas parity spec §4): named swatch ramps. */

export interface PaletteRamp {
  name: string
  colors: string[]
}

/** Fixed neutral ramps every profile gets, matching the flux reference rail. */
export const NEUTRAL_RAMPS: PaletteRamp[] = [
  { name: 'Gray', colors: ['#f4f4f5', '#d4d4d8', '#a1a1aa', '#71717a', '#3f3f46', '#18181b'] },
  { name: 'Red', colors: ['#fee2e2', '#fca5a5', '#ef4444', '#b91c1c', '#7f1d1d'] },
  { name: 'Orange', colors: ['#ffedd5', '#fdba74', '#f97316', '#c2410c', '#7c2d12'] },
  { name: 'Yellow', colors: ['#fef9c3', '#fde047', '#eab308', '#a16207', '#713f12'] },
  { name: 'Cyan', colors: ['#cffafe', '#67e8f9', '#06b6d4', '#0e7490', '#164e63'] },
  { name: 'Olive', colors: ['#ecfccb', '#bef264', '#84cc16', '#4d7c0f', '#3f6212'] }
]

/**
 * Swatch ramps for the palette section: the active profile's suggested
 * palette first when it states one (Wong order for the Nature family), then
 * the fixed neutral ramps every project gets, then any custom ramps the
 * project has imported.
 */
export function buildPaletteRamps(
  profile: PublisherProfile | null,
  customRamps: readonly PaletteRamp[] = []
): PaletteRamp[] {
  const suggested = profile?.figures.palette.suggestedHex
  const ramps: PaletteRamp[] = []
  if (suggested && suggested.length > 0) ramps.push({ name: 'Journal', colors: suggested })
  return [...ramps, ...NEUTRAL_RAMPS, ...customRamps]
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** Validate + normalize a JSON value as an imported hex-color ramp; null if invalid or empty. */
export function parseImportedPalette(json: unknown): string[] | null {
  if (!Array.isArray(json) || json.length === 0) return null
  const colors: string[] = []
  for (const entry of json) {
    if (typeof entry !== 'string' || !HEX_RE.test(entry.trim())) return null
    const hex = toHexColor(entry.trim())
    if (hex === null) return null
    colors.push(hex)
  }
  return colors
}
