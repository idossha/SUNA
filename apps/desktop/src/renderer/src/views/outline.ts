import type { BodyNode } from '@suna/core'

export interface OutlineRow {
  key: string
  /** Display label; boxes use their title. */
  label: string | null
  /** 'A' | 'B' | 'C' for sections, 'box' for boxes. */
  chip: string
  depth: number
  /** Path relative to the manuscript/ directory, e.g. "sections/01-intro.md". */
  contentPath: string | null
}

function chipOf(level: 'A' | 'B' | 'C-runin'): string {
  return level === 'C-runin' ? 'C' : level
}

/** Flatten the ordered manuscript body into outline rows, depth-first. */
export function flattenBody(body: readonly BodyNode[], depth = 0, prefix = ''): OutlineRow[] {
  const rows: OutlineRow[] = []
  body.forEach((node, index) => {
    const key = `${prefix}${index}`
    if (node.kind === 'section') {
      rows.push({
        key,
        label: node.heading,
        chip: chipOf(node.level),
        depth,
        contentPath: node.content
      })
      rows.push(...flattenBody(node.children, depth + 1, `${key}.`))
    } else {
      rows.push({ key, label: node.title, chip: 'box', depth, contentPath: node.content })
    }
  })
  return rows
}
