/** Pure ruler-tick math (canvas parity spec §2): 1mm minor / 10mm major. */

export interface RulerTick {
  mm: number
  major: boolean
}

/** Ticks from 0..lengthMm inclusive, stepped by `minorStepMm`. */
export function rulerTicks(lengthMm: number, minorStepMm = 1, majorStepMm = 10): RulerTick[] {
  if (!Number.isFinite(lengthMm) || lengthMm <= 0 || minorStepMm <= 0) return []
  // Float-safe count: 25.4 / 1 must yield 25, not 24 from a stray epsilon.
  const count = Math.floor(lengthMm / minorStepMm + 1e-9)
  const ticks: RulerTick[] = []
  for (let i = 0; i <= count; i++) {
    const mm = i * minorStepMm
    ticks.push({ mm, major: Math.abs(mm % majorStepMm) < 1e-9 })
  }
  return ticks
}
