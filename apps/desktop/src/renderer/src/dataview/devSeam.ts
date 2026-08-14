import { MAX_RENDERED_ROWS, detectNumericColumns, parseDataFile } from './grid'

/**
 * Dev-only seam for e2e drivers. Plain object, wired into window.__sunaDev by
 * the verifier (see main.tsx pattern) — not imported by production code.
 *
 * To expose it, add to main.tsx's __sunaDev object:
 *   dataGrid: dataviewDevSeam
 */
export const dataviewDevSeam = {
  /** text + fileName -> the exact model the grid renders. */
  parseDataFile,
  detectNumericColumns,
  /** Rows past this are dropped and the tab shows a truncation notice. */
  maxRenderedRows: MAX_RENDERED_ROWS
}
