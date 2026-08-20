import type { OversizedBlock } from '@suna/core'

/**
 * Wording for a block the printed page cannot hold (feature-plan-13 §A4).
 *
 * The exporter keeps tables and figures whole across a page boundary right up
 * to the point where the block is taller than the page itself — then there is
 * nowhere for it to go and it breaks. Nothing the exporter can do fixes that;
 * only the author can, by moving the table to the supplement or cutting
 * columns. So the message names the overrun and the two remedies, and says
 * what the export did in the meantime, rather than reading as a failure.
 *
 * One place, because the same sentence appears in the live preview (where you
 * can still act on it) and in the export toast (where you have already
 * exported), and two wordings for one fact would read as two problems.
 */

/** "1.4× the printable page height" — the overrun, at the precision we measured it. */
export function overrunLabel(block: OversizedBlock): string {
  return `${block.heightRatio.toFixed(1)}× the printable page height`
}

/** The full sentence for one block, as the preview panel shows it. */
export function oversizedMessage(block: OversizedBlock): string {
  const remedy =
    block.kind === 'table'
      ? 'Its header row repeats on the continuation. Consider moving it to the supplement, or reducing its columns.'
      : 'Consider a smaller width preset, or moving it to the supplement.'
  return `${block.label} is ${overrunLabel(block)}. It will break across pages. ${remedy}`
}

/**
 * The one-line form for the export toast, which has room for a clause and not
 * a paragraph. Counts rather than names when several blocks overrun.
 */
export function oversizedToastDetail(blocks: readonly OversizedBlock[]): string | undefined {
  if (blocks.length === 0) return undefined
  if (blocks.length === 1) {
    const only = blocks[0] as OversizedBlock
    return `${only.label} overruns the page`
  }
  return `${blocks.length} blocks overrun the page`
}
