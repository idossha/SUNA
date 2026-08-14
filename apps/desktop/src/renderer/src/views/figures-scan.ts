import type { FsNode } from '@suna/core'

export interface FigureHit {
  /** Directory name, e.g. "fig-spectrum". */
  id: string
  dirPath: string
  svgPath: string
  jsonPath: string
}

/** Find figures/<id>/figure.svg entries in the project tree. */
export function scanFigures(root: FsNode | null): FigureHit[] {
  if (!root || root.kind !== 'dir') return []
  const figuresDir = root.children.find((c) => c.kind === 'dir' && c.name === 'figures')
  if (!figuresDir || figuresDir.kind !== 'dir') return []
  const hits: FigureHit[] = []
  for (const child of figuresDir.children) {
    if (child.kind !== 'dir') continue
    const svg = child.children.find((f) => f.kind === 'file' && f.name === 'figure.svg')
    if (!svg) continue
    hits.push({
      id: child.name,
      dirPath: child.path,
      svgPath: svg.path,
      jsonPath: `${child.path}/figure.json`
    })
  }
  return hits
}

export interface FigureMeta {
  captionTitle: string | null
  widthPreset: 'single' | 'double' | null
}

/** Tolerant reader of figure.json content — absence/garbage yields nulls. */
export function parseFigureMeta(content: string): FigureMeta {
  let json: unknown
  try {
    json = JSON.parse(content)
  } catch {
    return { captionTitle: null, widthPreset: null }
  }
  if (typeof json !== 'object' || json === null) return { captionTitle: null, widthPreset: null }
  const obj = json as Record<string, unknown>
  const caption = obj['caption']
  let captionTitle: string | null = null
  if (typeof caption === 'object' && caption !== null) {
    const title = (caption as Record<string, unknown>)['title']
    if (typeof title === 'string' && title !== '') captionTitle = title
  }
  const preset = obj['widthPreset']
  const widthPreset = preset === 'single' || preset === 'double' ? preset : null
  return { captionTitle, widthPreset }
}

/** Data URL for a small, style-isolated SVG thumbnail. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
