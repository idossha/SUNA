import type { PublisherProfile } from '@suna/core'

/**
 * Journal-spec raster export knobs (canvas parity spec §3.6): width presets
 * and default dpi sourced from the ACTIVE profile — never a hardcoded
 * 190mm. A profile that states `null` for a given preset still gets an
 * entry, using a generic fallback, so the dropdown is never short a row.
 */

export type WidthPresetKey = 'single' | 'onehalf' | 'double'

export interface WidthPresetOption {
  key: WidthPresetKey
  label: string
  widthMm: number
}

const PRESET_LABELS: Record<WidthPresetKey, string> = {
  single: 'Single column',
  onehalf: '1.5 column',
  double: 'Double column'
}

/** Used only when the active profile doesn't state a width for this preset. */
const FALLBACK_WIDTH_MM: Record<WidthPresetKey, number> = {
  single: 89,
  onehalf: 120,
  double: 180
}

export function widthPresetsFor(profile: PublisherProfile | null): WidthPresetOption[] {
  const stated = profile?.figures.widthPresetsMm
  return (['single', 'onehalf', 'double'] as const).map((key) => {
    const widthMm = stated?.[key] ?? FALLBACK_WIDTH_MM[key]
    return { key, widthMm, label: `${PRESET_LABELS[key]} (${widthMm} mm)` }
  })
}

export const DPI_CHOICES = [300, 600, 1200] as const

/** Default resolution: the profile's stated minimum, else 300 dpi. */
export function defaultDpi(profile: PublisherProfile | null): number {
  return profile?.figures.formats.minDpi ?? 300
}
