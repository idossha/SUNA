/**
 * Pure prefix parsing for the command palette (DECISIONS 2026-08-14): which of
 * the four modes the raw input line selects, and the text after the marker
 * that mode acts on. Kept separate from CommandPalette.tsx so it is directly
 * unit-testable without mounting anything.
 */

export type PaletteMode = 'files' | 'commands' | 'terminal' | 'ai'

export interface ParsedPaletteInput {
  mode: PaletteMode
  /** The text after the prefix marker, with at most one leading space stripped. Untouched for 'files'. */
  query: string
}

const MODE_FOR_MARKER: Record<string, PaletteMode> = {
  '>': 'commands',
  $: 'terminal',
  '?': 'ai'
}

export const PALETTE_HINT =
  'Type to search files · > commands · $ terminal · ? ask the agent'

/**
 * A leading run of whitespace before the marker is ignored (typing a stray
 * space before "> " still opens command mode); at most one space right after
 * the marker is stripped so `"> cmd"` and `">cmd"` both yield `"cmd"`, but
 * further leading spaces in the rest of the line are preserved verbatim
 * (meaningful for `$` shell text). A bare `raw` with no recognized marker
 * (including the empty string) is file-search mode over the whole string.
 */
export function parsePaletteInput(raw: string): ParsedPaletteInput {
  const trimmedStart = raw.replace(/^\s+/, '')
  const marker = trimmedStart.slice(0, 1)
  const mode = MODE_FOR_MARKER[marker]
  if (mode === undefined) return { mode: 'files', query: raw }
  const rest = trimmedStart.slice(1)
  const query = rest.startsWith(' ') ? rest.slice(1) : rest
  return { mode, query }
}
