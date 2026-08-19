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
  /** True when at least one deeper section nests under this one — the collapse twisty. */
  hasChildren: boolean
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
    words: rolledUpWords(sections, i),
    hasChildren: hasChildren(sections, i)
  }))
}

/** Whether the section that follows `index` is nested under it. */
function hasChildren(sections: readonly OutlineSection[], index: number): boolean {
  const self = sections[index]
  if (self === undefined || self.level === 0) return false
  const next = sections[index + 1]
  return next !== undefined && next.level > self.level
}

/**
 * Rows left visible once the sections in `collapsed` (by row key) hide their
 * branches. A collapsed row stays visible; everything indented under it, to
 * any depth, drops out until the outline returns to that level.
 */
export function visibleRows(rows: readonly OutlineRow[], collapsed: ReadonlySet<string>): OutlineRow[] {
  const out: OutlineRow[] = []
  let hiddenBelow: number | null = null
  for (const row of rows) {
    if (hiddenBelow !== null) {
      if (row.depth > hiddenBelow) continue
      hiddenBelow = null
    }
    out.push(row)
    if (row.hasChildren && collapsed.has(row.key)) hiddenBelow = row.depth
  }
  return out
}

/**
 * Key of the row that should carry the active highlight, given the section the
 * editor is currently in. Normally that section's own row — but when it is
 * hidden inside a collapsed branch, the highlight rolls up to the nearest
 * visible ancestor, so a collapsed "2. Methods" stays lit while you read 2.3.
 */
export function activeRowKey(
  rows: readonly OutlineRow[],
  visible: readonly OutlineRow[],
  activeIndex: number
): string | null {
  const active = rows[activeIndex]
  if (active === undefined) return null
  const shown = new Set(visible.map((row) => row.key))
  if (shown.has(active.key)) return active.key
  for (let i = activeIndex - 1; i >= 0; i--) {
    const row = rows[i]
    if (row === undefined) continue
    if (row.depth < active.depth && shown.has(row.key)) return row.key
  }
  return null
}

/** Total words across the whole outline — each section counted once. */
export function totalWords(sections: readonly OutlineSection[]): number {
  return sections.reduce((sum, section) => sum + section.words, 0)
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
