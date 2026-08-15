import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { FigureDocumentSchema, type FigureDocument } from '@suna/core'
import { writeFileAtomic } from './atomic'
import { figureDirPath, projectSubdir } from './paths'
import { assertInsideAllowedRoot } from './roots'

/**
 * Create figures/<slug>/{figure.svg,figure.json} for a brand-new figure: a
 * blank artboard at the caller-supplied width (mm, the renderer resolves the
 * active profile's double-column preset) with height = width * 0.618, and a
 * schema-valid figure.json. manuscript.json is deliberately NOT touched
 * here: the renderer registers the new figure through 'manuscript:update',
 * same split as duplicateFigure (figure-duplicate.ts).
 */

/** Blank-artboard aspect (spec: height = width * 0.618). */
const HEIGHT_RATIO = 0.618
/** 1 pt = 0.3528 mm (canvas-engine.md §2) — matches @suna/canvas's Artboard math. */
const MM_PER_PT = 0.3528

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Lowercase, ASCII, hyphen-separated; diacritics stripped, never empty. */
export function slugifyFigureName(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base === '' ? 'figure' : base
}

/** First of `base`, `base-2`, `base-3`, … not already in `taken`. */
export function uniqueFigureSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

function fmtPt(mm: number): string {
  const pt = mm / MM_PER_PT
  const rounded = Math.round(pt * 10000) / 10000
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

/**
 * Blank artboard SVG: xmlns set, viewBox in pt user units matching `width`/
 * `height`, no content — the empty-canvas affordance shows until the user
 * draws or imports something.
 */
export function blankFigureSvg(widthMm: number, heightMm: number): string {
  const w = fmtPt(widthMm)
  const h = fmtPt(heightMm)
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${w}pt" height="${h}pt" viewBox="0 0 ${w} ${h}" version="1.1">\n</svg>\n`
  )
}

/** height = width * 0.618, in mm. */
export function blankArtboardHeightMm(widthMm: number): number {
  return widthMm * HEIGHT_RATIO
}

async function listFigureIds(figuresDir: string): Promise<string[]> {
  try {
    const entries = await readdir(figuresDir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

export interface CreateFigureResult {
  figureId: string
  canvasRef: string
  svgPath: string
  jsonPath: string
  widthMm: number
  heightMm: number
}

export async function createFigure(
  dir: string,
  name: string,
  widthMm: number
): Promise<CreateFigureResult> {
  if (!(widthMm > 0)) throw new Error(`invalid figure width: ${widthMm}`)
  const root = assertInsideAllowedRoot(dir)
  const figuresDir = await projectSubdir(root, 'figures')
  const taken = new Set(await listFigureIds(figuresDir))
  const figureId = uniqueFigureSlug(slugifyFigureName(name), taken)

  const target = assertInsideAllowedRoot(await figureDirPath(root, figureId))
  if (await exists(target)) {
    throw new Error(`figure already exists: ${figureId}`)
  }

  const heightMm = blankArtboardHeightMm(widthMm)
  const svg = blankFigureSvg(widthMm, heightMm)
  const title = name.trim() === '' ? figureId : name.trim()
  const document: FigureDocument = FigureDocumentSchema.parse({
    id: figureId,
    caption: { title, body: '' },
    namespace: 'main',
    widthPreset: 'double',
    panels: [],
    provenance: null
  })

  const svgPath = join(target, 'figure.svg')
  const jsonPath = join(target, 'figure.json')
  await writeFileAtomic(svgPath, svg)
  await writeFileAtomic(jsonPath, JSON.stringify(document, null, 2) + '\n')

  return {
    figureId,
    canvasRef: `figures/${figureId}/figure.svg`,
    svgPath,
    jsonPath,
    widthMm,
    heightMm
  }
}
