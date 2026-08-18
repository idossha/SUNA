/**
 * Pure list/filter logic for the insert-figure picker (FigurePicker.tsx),
 * the figure counterpart of bibFilter.ts. Kept JSX-free so it's directly
 * importable from a plain `.test.ts` file — the repo has no jsdom/React test
 * harness set up.
 *
 * Two sources, deliberately merged rather than one picked over the other:
 *
 * - `manuscript.json` is the ordering truth (figure numbering is derived from
 *   array order at format time, never stored), and the only place a caption
 *   lives. Those figures come first, in their manuscript order, so the list
 *   reads the way the paper does.
 * - the file tree catches `figures/<id>/figure.svg` directories the manuscript
 *   does not list yet — a figure the canvas just created, or one an agent
 *   dropped in. Leaving them out would make the picker quietly disagree with
 *   the Figures view about what exists, so they are listed too, flagged, and
 *   sorted by id after the manuscript's own.
 */
import type { ManuscriptFigure } from '@suna/core'
import type { FigureHit } from '../views/figures-scan'

export interface FigureChoice {
  /** The id the cross-reference/embed names: `fig:<id>`. */
  id: string
  /** Caption title from manuscript.json; null for a disk-only figure. */
  title: string | null
  /** Absolute path of the figure's SVG, for the picker's thumbnail. */
  svgPath: string | null
  /**
   * False when the figure exists on disk but manuscript.json does not list
   * it — insertable, but it will not be numbered or captioned until it is
   * added to the manuscript.
   */
  inManuscript: boolean
}

/**
 * Where a manuscript figure's SVG lives. `canvasRef` is project-relative by
 * schema (it only has to end in `.svg`), so it is joined onto the root; a
 * figure with no usable ref falls back to the conventional location, which
 * is where `figure:duplicate` and "New figure" both put one.
 */
function svgPathFor(rootDir: string | null, figure: ManuscriptFigure): string | null {
  if (rootDir === null) return null
  const ref = figure.canvasRef.trim()
  if (ref === '') return `${rootDir}/figures/${figure.id}/figure.svg`
  return ref.startsWith('/') ? ref : `${rootDir}/${ref}`
}

/**
 * The pickable figures: manuscript order first, then any figure directory on
 * disk the manuscript does not name, by id. A manuscript figure whose id
 * repeats (schema-legal, numbering-hostile) is listed once, at its first
 * position.
 */
export function figureChoices(
  rootDir: string | null,
  figures: readonly ManuscriptFigure[],
  hits: readonly FigureHit[]
): FigureChoice[] {
  const seen = new Set<string>()
  const choices: FigureChoice[] = []
  const onDisk = new Map(hits.map((hit) => [hit.id, hit]))
  for (const figure of figures) {
    if (seen.has(figure.id)) continue
    seen.add(figure.id)
    const title = figure.caption.title.trim()
    choices.push({
      id: figure.id,
      title: title === '' ? null : title,
      svgPath: onDisk.get(figure.id)?.svgPath ?? svgPathFor(rootDir, figure),
      inManuscript: true
    })
  }
  const extras = hits.filter((hit) => !seen.has(hit.id)).sort((a, b) => a.id.localeCompare(b.id))
  for (const hit of extras) {
    choices.push({ id: hit.id, title: null, svgPath: hit.svgPath, inManuscript: false })
  }
  return choices
}

/** Case-insensitive substring match over id and caption title. */
export function filterFigureChoices(
  choices: readonly FigureChoice[],
  query: string
): FigureChoice[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return [...choices]
  return choices.filter(
    (choice) =>
      choice.id.toLowerCase().includes(q) || (choice.title?.toLowerCase().includes(q) ?? false)
  )
}
