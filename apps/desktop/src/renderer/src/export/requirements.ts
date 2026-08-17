import type { CitationMode, PublisherProfile } from '@suna/core'

/**
 * Pure derivation of the requirements panel's row data (RequirementsPanel.tsx)
 * from a publisher profile — kept DOM-free so it can be unit-tested headlessly
 * (apps/desktop has no DOM test environment; same pattern as
 * comments/railCss.test.ts and the palette helpers).
 *
 * The one schema rule that governs everything here: `null` means "the journal
 * does not state this" (ADR-002). Null never becomes an invented value — it is
 * either rendered as an explicit "not stated" status (submission-format rows)
 * or the item is omitted entirely (limits, figure rules, availability). A
 * section whose profile block states nothing at all comes back null/empty so
 * the panel can skip it.
 */

/** The journal's stance on a yes/no submission rule. */
export type RequirementStatus = 'required' | 'do-not-use' | 'not-stated'

export interface StatusRow {
  id: 'double-spacing' | 'line-numbers' | 'page-numbers'
  label: string
  status: RequirementStatus
}

/** A short "label: value" line inside a section. */
export interface Fact {
  label: string
  value: string
}

export interface ArticleTypeRow {
  id: string
  name: string
  /** Only stated limits — a null limit contributes no chip. */
  chips: string[]
}

export interface SectionChip {
  id: string
  label: string
  required: boolean
}

export interface SubmissionRequirements {
  rows: StatusRow[]
  /** Accepted upload formats, uppercased for display ("DOCX"). */
  fileTypes: string[]
}

export interface FigureRequirements {
  /** Stated column-width presets, e.g. "Single column 89 mm". */
  widthChips: string[]
  vectorFormats: string[]
  rasterFormats: string[]
  facts: Fact[]
}

export interface ProfileRequirements {
  journalName: string
  publisher: string
  lastVerified: string
  /** null when the profile states nothing about submission format. */
  submission: SubmissionRequirements | null
  articleTypes: ArticleTypeRow[]
  sections: SectionChip[]
  citations: Fact[]
  /** null when the profile states nothing about figures. */
  figures: FigureRequirements | null
  availability: Fact[]
  notes: string[]
  /** Unique official guideline URLs across all profile blocks, each with a
   *  UNIQUELY-NAMED label (hostname; disambiguated by path when a journal
   *  cites several pages on the same host). */
  sources: SourceLink[]
}

export interface SourceLink {
  url: string
  label: string
}

/** "5000" → "5,000" so word limits read the way journals print them. */
function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

export function statusOf(stated: boolean | null): RequirementStatus {
  if (stated === null) return 'not-stated'
  return stated ? 'required' : 'do-not-use'
}

export function citationModeLabel(mode: CitationMode): string {
  switch (mode) {
    case 'numeric-superscript':
      return 'Superscript numbers¹'
    case 'parenthetical-numeric':
      return 'Bracketed numbers [1]'
    case 'author-year':
      return '(Author, Year)'
  }
}

/**
 * The checkbox tag text in the export form ("SLEEP requires this") — the
 * journal's stance rendered as information, never as a lock: the user can
 * always override the stated value.
 */
export function stanceTag(journalName: string, stated: boolean | null): string | null {
  if (stated === null) return null
  return stated ? `${journalName} requires this` : `${journalName} says do not use`
}

/** "≥ 5 pt" / "≤ 7 pt" / "5–7 pt" from a nullable min/max pair; null when neither is stated. */
function rangeLabel(min: number | null, max: number | null, unit: string): string | null {
  if (min !== null && max !== null) return `${min}–${max} ${unit}`
  if (min !== null) return `≥ ${min} ${unit}`
  if (max !== null) return `≤ ${max} ${unit}`
  return null
}

function submissionRequirements(profile: PublisherProfile): SubmissionRequirements | null {
  const stated = profile.manuscript.submissionFormat
  // The schema does not model page numbering yet; profiles may gain the field
  // as an optional extension. Read it defensively — absent means not stated.
  const pageNumbers = (stated as { pageNumbers?: boolean | null }).pageNumbers ?? null
  const rows: StatusRow[] = [
    { id: 'double-spacing', label: 'Double spacing', status: statusOf(stated.doubleSpacing) },
    { id: 'line-numbers', label: 'Line numbers', status: statusOf(stated.lineNumbers) },
    { id: 'page-numbers', label: 'Page numbering', status: statusOf(pageNumbers) }
  ]
  const fileTypes = stated.acceptedFileTypes.map((t) => t.toUpperCase())
  const nothingStated = rows.every((r) => r.status === 'not-stated') && fileTypes.length === 0
  return nothingStated ? null : { rows, fileTypes }
}

function articleTypeRows(profile: PublisherProfile): ArticleTypeRow[] {
  return profile.manuscript.articleTypes.map((t) => {
    const chips: string[] = []
    if (t.wordLimit !== null) chips.push(`≤ ${formatCount(t.wordLimit.max)} words`)
    if (t.abstractWordLimit !== null) chips.push(`abstract ≤ ${formatCount(t.abstractWordLimit)}`)
    if (t.titleLimitChars !== null) chips.push(`title ≤ ${formatCount(t.titleLimitChars)} chars`)
    if (t.maxDisplayItems !== null) {
      chips.push(t.maxDisplayItems === 1 ? '≤ 1 display item' : `≤ ${t.maxDisplayItems} display items`)
    }
    if (t.maxReferences !== null) chips.push(`≤ ${t.maxReferences} refs`)
    return { id: t.id, name: t.name, chips }
  })
}

function citationFacts(profile: PublisherProfile): Fact[] {
  const c = profile.citations
  const facts: Fact[] = [{ label: 'In-text citations', value: citationModeLabel(c.mode) }]
  if (c.collapseRanges) facts.push({ label: 'Citation clusters', value: 'ranges collapsed [1–4]' })
  facts.push({
    label: 'Reference list',
    value: c.referenceList.sortOrder === 'appearance' ? 'in citation order' : 'alphabetical'
  })
  const trunc = c.referenceList.authorTruncation
  if (trunc.etAlAllowed === false) {
    facts.push({ label: 'Author lists', value: 'all authors listed — no et al.' })
  } else if (trunc.etAlAllowed === true) {
    if (trunc.truncateWhenMoreThan !== null) {
      const keep = trunc.keepFirstN !== null ? `, first ${trunc.keepFirstN} kept` : ''
      facts.push({
        label: 'Author lists',
        value: `et al. when more than ${trunc.truncateWhenMoreThan} authors${keep}`
      })
    } else {
      facts.push({ label: 'Author lists', value: 'et al. permitted' })
    }
  }
  if (c.maxReferences !== null) {
    facts.push({ label: 'Reference cap', value: `≤ ${formatCount(c.maxReferences)} references` })
  }
  return facts
}

function figureRequirements(profile: PublisherProfile): FigureRequirements | null {
  const f = profile.figures
  const widthChips: string[] = []
  if (f.widthPresetsMm.single !== null) widthChips.push(`Single column ${f.widthPresetsMm.single} mm`)
  if (f.widthPresetsMm.onehalf !== null) widthChips.push(`1.5 column ${f.widthPresetsMm.onehalf} mm`)
  if (f.widthPresetsMm.double !== null) widthChips.push(`Double column ${f.widthPresetsMm.double} mm`)

  const vectorFormats = f.formats.vectorPreferred.map((x) => x.toUpperCase())
  const rasterFormats = f.formats.rasterAccepted.map((x) => x.toUpperCase())

  const facts: Fact[] = []
  if (f.formats.minDpi !== null) {
    facts.push({ label: 'Raster resolution', value: `min ${f.formats.minDpi} dpi` })
  }
  const fontWindow = rangeLabel(f.minFontPt, f.maxFontPt, 'pt')
  if (fontWindow !== null) facts.push({ label: 'Label font size', value: `labels ${fontWindow}` })
  if (f.maxHeightMm !== null) facts.push({ label: 'Max height', value: `${f.maxHeightMm} mm` })
  const lineWeight = rangeLabel(f.lineWeightPt.min, f.lineWeightPt.max, 'pt')
  if (lineWeight !== null) facts.push({ label: 'Line weight', value: lineWeight })
  if (f.preferredFontFamilies !== null && f.preferredFontFamilies.length > 0) {
    facts.push({ label: 'Fonts', value: f.preferredFontFamilies.join(', ') })
  }
  if (f.palette.requirement === 'colorblind-safe-required') {
    facts.push({ label: 'Palette', value: 'colorblind-safe required' })
  } else if (f.palette.requirement === 'colorblind-safe-recommended') {
    facts.push({ label: 'Palette', value: 'colorblind-safe recommended' })
  }

  const nothingStated =
    widthChips.length === 0 && vectorFormats.length === 0 && rasterFormats.length === 0 && facts.length === 0
  return nothingStated ? null : { widthChips, vectorFormats, rasterFormats, facts }
}

function availabilityFacts(profile: PublisherProfile): Fact[] {
  const a = profile.manuscript.availabilityStatements
  const facts: Fact[] = []
  if (a.data !== null) {
    facts.push({ label: 'Data availability', value: a.data ? 'statement required' : 'statement not required' })
  }
  if (a.code !== null) {
    facts.push({ label: 'Code availability', value: a.code ? 'statement required' : 'statement not required' })
  }
  return facts
}

const GENERIC_PATH_SEGMENTS = new Set(['pages', 'page', 'publish', 'journal', 'journals', 'about', 'info', 'content'])

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Meaningful, humanized path segments of a URL, generic hops dropped. */
function meaningfulSegments(url: string): string[] {
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    return []
  }
  return path
    .split('/')
    .map((seg) =>
      decodeURIComponent(seg)
        .replace(/\.(html?|pdf|aspx?)$/i, '')
        .replace(/[-_]+/g, ' ')
        .trim()
    )
    .filter((seg) => seg !== '' && !GENERIC_PATH_SEGMENTS.has(seg.toLowerCase()))
}

/**
 * Unique, readable labels for a set of guideline URLs. A lone URL on a host
 * is just the host; when a journal cites several pages on one host, each
 * gets "host — <path segment(s)>", extending leftward through the path until
 * the labels differ (last resort: a numeric suffix). Pure; exported for the
 * headless unit tests.
 */
export function sourceLinks(urls: readonly string[]): SourceLink[] {
  const unique = [...new Set(urls)]
  const labels = new Map<string, string>()
  const byHost = new Map<string, string[]>()
  for (const url of unique) {
    const host = hostOf(url)
    byHost.set(host, [...(byHost.get(host) ?? []), url])
  }
  for (const [host, hostUrls] of byHost) {
    if (hostUrls.length === 1) {
      labels.set(hostUrls[0] as string, host)
      continue
    }
    // several pages on one host: take path segments from the right, widening
    // until every label in the group is distinct
    for (let width = 1; width <= 4; width++) {
      for (const url of hostUrls) {
        const segs = meaningfulSegments(url)
        const tail = segs.slice(-width).join(' / ')
        labels.set(url, tail === '' ? host : `${host} — ${tail}`)
      }
      const seen = new Set(hostUrls.map((u) => labels.get(u)))
      if (seen.size === hostUrls.length) break
    }
    // identical paths (or no paths) — number them so the links stay distinct
    const counts = new Map<string, number>()
    for (const url of hostUrls) {
      const label = labels.get(url) as string
      const n = (counts.get(label) ?? 0) + 1
      counts.set(label, n)
      const total = hostUrls.filter((u) => labels.get(u) === label).length
      if (total > 1) labels.set(url, `${label} (${n})`)
    }
  }
  return unique.map((url) => ({ url, label: labels.get(url) as string }))
}

function uniqueSources(profile: PublisherProfile): SourceLink[] {
  return sourceLinks([
    ...profile.citations.sources,
    ...profile.figures.sources,
    ...profile.manuscript.sources
  ])
}

/** Everything RequirementsPanel renders, derived in one pass from the profile. */
export function profileRequirements(profile: PublisherProfile): ProfileRequirements {
  return {
    journalName: profile.journalName,
    publisher: profile.publisher,
    lastVerified: profile.lastVerified,
    submission: submissionRequirements(profile),
    articleTypes: articleTypeRows(profile),
    sections: profile.manuscript.requiredSections.map((s) => ({
      id: s.id,
      label: s.label,
      required: s.required
    })),
    citations: citationFacts(profile),
    figures: figureRequirements(profile),
    availability: availabilityFacts(profile),
    notes: profile.notes,
    sources: uniqueSources(profile)
  }
}
