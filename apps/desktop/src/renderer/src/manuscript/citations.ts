import { parseSciMark } from '@suna/markdown'
import type { CrossRefKind } from '@suna/markdown'
import type { BibEntry, CitationCluster } from '@suna/bib'

/**
 * Citation collection for the combined manuscript document.
 *
 * Clusters are gathered by walking each section's SciMark AST in document
 * order, so concatenating per-section results (sections in body order) yields
 * global first-appearance order — the order assignNumbers expects.
 */

interface WalkNode {
  type?: unknown
  children?: unknown
  keys?: unknown
  narrative?: unknown
}

function walk(node: WalkNode, out: CitationCluster[]): void {
  if (node.type === 'citation' && Array.isArray(node.keys)) {
    out.push({
      keys: node.keys.filter((k): k is string => typeof k === 'string'),
      narrative: node.narrative === true
    })
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) walk(child as WalkNode, out)
  }
}

/** Citation clusters of one SciMark source, in order of appearance. */
export function collectClusters(source: string): CitationCluster[] {
  const out: CitationCluster[] = []
  walk(parseSciMark(source) as WalkNode, out)
  return out
}

/* ---------------------------------------------------------------------------
   Cross-reference label map.

   @fig:/@tbl:/@eq:/@sec: chips resolve against a document-wide map built once
   per recompute: figures and tables number by their manuscript.json array
   order (the only order manuscript.json guarantees); display equations
   number by document order across sections (concatenated in body order, like
   citation clusters above), counting every display equation so a later
   labeled one gets the right number even if earlier ones are unlabeled;
   sections resolve by a slug of their heading text since section nodes carry
   no id of their own.
   ------------------------------------------------------------------------- */

export interface LabelWords {
  /** Word before the figure number, e.g. "Fig." */
  figure: string
  /** Word before the table number, e.g. "Table" */
  table: string
}

export const DEFAULT_LABEL_WORDS: LabelWords = { figure: 'Fig.', table: 'Table' }

export interface LabelMap {
  /** Figure id -> "Fig. 1". */
  figures: ReadonlyMap<string, string>
  /** Table id -> "Table 1". */
  tables: ReadonlyMap<string, string>
  /** `{#eq:...}` label -> "equation (1)". */
  equations: ReadonlyMap<string, string>
  /**
   * `{#eq:...}` label -> its bare number. Same numbering as `equations`,
   * kept separately so the display equation's own right-margin label chip
   * can render "(1)" without re-parsing the prose form.
   */
  equationNumbers: ReadonlyMap<string, number>
  /** Slugified heading -> heading text. */
  sections: ReadonlyMap<string, string>
}

export interface LabelMapSection {
  /** Section/box heading text; null for an unheaded section (never gets a @sec: label). */
  heading: string | null
  /** Section body source, used to find display-equation labels. */
  source: string
}

/** Anything carrying a manuscript.json figure/table id, structurally. */
export interface Identified {
  id: string
}

/** Lowercase, hyphen-joined slug for `@sec:` resolution against heading text. */
export function slugifyHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Captures the bare id after "eq:" — the same id a `@eq:stripping` crossRef
 * carries (splitCrossRef in @suna/markdown's parser strips the kind prefix),
 * so labels built here look up directly under crossRef.id with no prefix
 * juggling at resolve time.
 */
const EQ_LABEL = /^\{#eq:([A-Za-z][\w:.-]*)\}$/

interface MathWalkNode {
  type?: unknown
  children?: unknown
  meta?: unknown
}

function walkEquationLabels(node: MathWalkNode, out: (string | undefined)[]): void {
  if (node.type === 'math') {
    const meta = typeof node.meta === 'string' ? node.meta.trim() : ''
    out.push(EQ_LABEL.exec(meta)?.[1])
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) walkEquationLabels(child as MathWalkNode, out)
  }
}

/**
 * Display-equation label ids of one SciMark source, in document order.
 * `undefined` marks an unlabeled equation — it still occupies a number.
 */
export function collectEquationLabels(source: string): (string | undefined)[] {
  const out: (string | undefined)[] = []
  walkEquationLabels(parseSciMark(source) as unknown as MathWalkNode, out)
  return out
}

const EMBED_RE = /!\[\[(fig|tbl):([A-Za-z][\w.-]*)\]\]/g

/**
 * The manuscript's figures/tables reordered by first `![[fig:id]]` /
 * `![[tbl:id]]` embed appearance in the prose — the order that drives
 * numbering (derived at render time, never stored), matching the export
 * side's orderByEmbedAppearance exactly. Items the prose never embeds keep
 * their manifest order, after the embedded ones.
 */
export function orderByEmbedAppearance<T extends Identified>(
  items: readonly T[],
  source: string,
  kind: 'fig' | 'tbl'
): T[] {
  const rank = new Map<string, number>()
  for (const match of source.matchAll(EMBED_RE)) {
    if (match[1] !== kind) continue
    const id = match[2] as string
    if (!rank.has(id)) rank.set(id, rank.size)
  }
  return [...items].sort((a, b) => {
    const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER
    const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER
    return ra === rb ? 0 : ra - rb
  })
}

/**
 * The document-wide cross-reference label map. `sections` is every body
 * section/box in document order, paired with its already-read source text.
 */
export function buildLabelMap(
  figures: readonly Identified[],
  tables: readonly Identified[],
  sections: readonly LabelMapSection[],
  words: LabelWords = DEFAULT_LABEL_WORDS
): LabelMap {
  const figureMap = new Map<string, string>()
  figures.forEach((figure, i) => figureMap.set(figure.id, `${words.figure} ${i + 1}`))

  const tableMap = new Map<string, string>()
  tables.forEach((table, i) => tableMap.set(table.id, `${words.table} ${i + 1}`))

  const equationMap = new Map<string, string>()
  const equationNumberMap = new Map<string, number>()
  let eqNumber = 0
  for (const section of sections) {
    for (const label of collectEquationLabels(section.source)) {
      eqNumber += 1
      if (label !== undefined) {
        equationMap.set(label, `equation (${eqNumber})`)
        equationNumberMap.set(label, eqNumber)
      }
    }
  }

  const sectionMap = new Map<string, string>()
  for (const section of sections) {
    if (section.heading === null) continue
    const slug = slugifyHeading(section.heading)
    if (slug.length === 0 || sectionMap.has(slug)) continue
    sectionMap.set(slug, section.heading)
  }

  return {
    figures: figureMap,
    tables: tableMap,
    equations: equationMap,
    equationNumbers: equationNumberMap,
    sections: sectionMap
  }
}

function mapFor(kind: CrossRefKind, labels: LabelMap): ReadonlyMap<string, string> {
  switch (kind) {
    case 'fig':
      return labels.figures
    case 'tbl':
      return labels.tables
    case 'eq':
      return labels.equations
    case 'sec':
      return labels.sections
  }
}

export interface ResolvedCrossRef {
  text: string
  resolved: boolean
}

/**
 * Resolve one crossRef chip against the label map. Unresolvable ids fall back
 * to the widget's raw `"kind:id"` text (never blank) with `resolved: false`
 * so the caller can flag it instead of misrendering silently.
 */
export function resolveCrossRefLabel(
  kind: CrossRefKind,
  id: string,
  suffix: string | undefined,
  labels: LabelMap
): ResolvedCrossRef {
  const label = mapFor(kind, labels).get(id)
  if (label === undefined) return { text: `${kind}:${id}`, resolved: false }
  return { text: suffix !== undefined ? `${label}${suffix}` : label, resolved: true }
}

export interface ReferenceRow {
  key: string
  /** Undefined when the key is cited but missing from references.bib. */
  entry: BibEntry | undefined
  /** First-appearance number (1-based); shown only by numeric profiles. */
  number: number
}

function alphaKey(entry: BibEntry): string {
  const first = entry.authors[0]
  const name =
    first === undefined ? '' : first.kind === 'person' ? first.family : first.literal
  return `${name.toLowerCase()} ${entry.year ?? ''} ${entry.title.toLowerCase()}`
}

/**
 * The reference list in display order. `appearance` orders by citation number;
 * `alphabetical` (author-year profiles) sorts resolvable entries by first
 * author / year / title. Unknown keys always sink to the end, in appearance
 * order, so they can be rendered as flagged chips.
 */
export function orderedReferences(
  numbers: ReadonlyMap<string, number>,
  entryMap: ReadonlyMap<string, BibEntry>,
  sortOrder: 'appearance' | 'alphabetical'
): ReferenceRow[] {
  const rows: ReferenceRow[] = [...numbers.entries()].map(([key, number]) => ({
    key,
    entry: entryMap.get(key),
    number
  }))
  const known = rows.filter((r) => r.entry !== undefined)
  const unknown = rows.filter((r) => r.entry === undefined)
  if (sortOrder === 'alphabetical') {
    known.sort((a, b) => {
      if (a.entry === undefined || b.entry === undefined) return 0
      return alphaKey(a.entry) < alphaKey(b.entry) ? -1 : 1
    })
  } else {
    known.sort((a, b) => a.number - b.number)
  }
  unknown.sort((a, b) => a.number - b.number)
  return [...known, ...unknown]
}
