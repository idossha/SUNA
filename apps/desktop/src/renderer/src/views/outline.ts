import type { OutlineSection } from '@suna/markdown'

export interface OutlineRow {
  key: string
  /** Heading text; null for the untitled leading section (prose before the first heading). */
  label: string | null
  /** 'A' | 'B' | 'C' for a heading; '' for the untitled leading section. */
  chip: string
  /** Indentation level for the sidebar list, derived from Markdown heading depth. */
  depth: number
  /** Document offset of the heading line — the scroll-spy / click-to-scroll target. */
  headingFrom: number
  /** Word count of the section's body (heading text excluded), from outlineFromMarkdown. */
  words: number
}

/** Typographic chip for a Markdown heading depth: 1 → 'A', 2 → 'B', 3+ → 'C'. */
function chipFor(level: number): string {
  if (level <= 0) return ''
  if (level === 1) return 'A'
  if (level === 2) return 'B'
  return 'C'
}

/**
 * Project the manuscript's derived Markdown outline (@suna/markdown's
 * outlineFromMarkdown) into display rows for the sidebar list and the
 * combined tab's scroll-spy. Pure and flat — nesting is read off `depth`
 * (heading level - 1), there is no tree.
 */
export function outlineRows(sections: readonly OutlineSection[]): OutlineRow[] {
  return sections.map((section, i) => ({
    key: `s${i}`,
    label: section.level === 0 ? null : section.title,
    chip: chipFor(section.level),
    depth: Math.max(0, section.level - 1),
    headingFrom: section.headingFrom,
    words: section.words
  }))
}
