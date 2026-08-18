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
  /**
   * Word count for the section: its own body (heading text excluded) plus the
   * bodies of every nested subsection under it, so a parent heading reports
   * the whole branch rather than the few words before its first child.
   */
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
    words: rolledUpWords(sections, i)
  }))
}

/**
 * Words of section `index` plus every section nested under it — the ones that
 * follow it in document order until a heading at the same or a shallower
 * level. The untitled leading section (level 0) owns nothing but itself.
 */
function rolledUpWords(sections: readonly OutlineSection[], index: number): number {
  const self = sections[index]
  if (self === undefined) return 0
  let total = self.words
  if (self.level === 0) return total
  for (let i = index + 1; i < sections.length; i++) {
    const next = sections[i]
    if (next === undefined || next.level <= self.level) break
    total += next.words
  }
  return total
}
