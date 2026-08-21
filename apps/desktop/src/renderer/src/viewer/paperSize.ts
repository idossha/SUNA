/**
 * Naming the paper a rendered document is on. The Word viewer reports the
 * page setup it actually printed at (read from the file's own OOXML), and
 * "A4" tells a reader more than "8.27 × 11.69 in" does — but only when the
 * page really is A4, so an unusual size is reported as its measurements
 * rather than rounded into the nearest famous name.
 */

export interface PaperGeometry {
  widthIn: number
  heightIn: number
}

/** Half a millimetre in inches: Word writes whole twips, so a named size
 *  never misses by more than rounding. */
const TOLERANCE_IN = 0.02

const NAMED: readonly { name: string; widthIn: number; heightIn: number }[] = [
  { name: 'US Letter', widthIn: 8.5, heightIn: 11 },
  { name: 'US Legal', widthIn: 8.5, heightIn: 14 },
  { name: 'A4', widthIn: 8.268, heightIn: 11.693 },
  { name: 'A5', widthIn: 5.827, heightIn: 8.268 },
  { name: 'B5', widthIn: 6.929, heightIn: 9.843 }
]

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCE_IN
}

/** A short label for a page size: a standard name, landscape marked, or the
 *  measurements when it is neither. */
export function paperLabel({ widthIn, heightIn }: PaperGeometry): string {
  for (const paper of NAMED) {
    if (near(widthIn, paper.widthIn) && near(heightIn, paper.heightIn)) return paper.name
    if (near(widthIn, paper.heightIn) && near(heightIn, paper.widthIn)) return `${paper.name} landscape`
  }
  const round = (value: number): string => (Math.round(value * 100) / 100).toString()
  return `${round(widthIn)} × ${round(heightIn)} in`
}
