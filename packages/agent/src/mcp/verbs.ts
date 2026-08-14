import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { loadProjectContext, resolveInside, type ProjectContext } from './project'

/**
 * File-level manuscript verbs. These operate directly on the project on disk
 * so an agent CLI can work with or without SUNA running (flux's file-verb
 * fallback pattern). Every path is confined to the project root.
 */

export const listProjectInput = z.object({})
export const readSectionInput = z.object({ path: z.string().min(1) })
export const writeSectionInput = z.object({
  path: z.string().min(1),
  content: z.string()
})
export const readManuscriptMetaInput = z.object({})
export const listFiguresInput = z.object({})
export const readFigureSvgInput = z.object({ figureId: z.string().min(1) })
export const readBibInput = z.object({})
export const checkFigureComplianceInput = z.object({ figureId: z.string().min(1) })

const IGNORED = new Set(['.git', 'node_modules', '__pycache__', '.DS_Store', '.venv'])

async function walk(dir: string, root: string, depth: number): Promise<string[]> {
  if (depth > 6) return []
  const out: string[] = []
  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue
    const abs = join(dir, entry.name)
    const rel = abs.slice(root.length + 1)
    if (entry.isDirectory()) {
      out.push(`${rel}/`)
      out.push(...(await walk(abs, root, depth + 1)))
    } else if (entry.isFile()) {
      out.push(rel)
    }
  }
  return out
}

export async function listProject(ctx: ProjectContext): Promise<string> {
  const files = await walk(ctx.root, ctx.root, 0)
  return [
    `project: ${ctx.name ?? '(unnamed)'}`,
    `profile: ${ctx.activeProfileId ?? '(none)'}`,
    `root: ${ctx.root}`,
    '',
    ...files.sort()
  ].join('\n')
}

/** Section paths are given relative to the manuscript directory. */
export async function readSection(ctx: ProjectContext, path: string): Promise<string> {
  return readFile(resolveInside(ctx.root, ctx.dirs.manuscript, path), 'utf8')
}

export async function writeSection(
  ctx: ProjectContext,
  path: string,
  content: string
): Promise<string> {
  const abs = resolveInside(ctx.root, ctx.dirs.manuscript, path)
  if (!abs.endsWith('.md')) throw new Error('sections must be Markdown (.md) files')
  await writeFile(abs, content, 'utf8')
  return `wrote ${content.length} characters to ${path}`
}

export async function readManuscriptMeta(ctx: ProjectContext): Promise<string> {
  return readFile(resolveInside(ctx.root, ctx.dirs.manuscript, 'manuscript.json'), 'utf8')
}

export async function listFigures(ctx: ProjectContext): Promise<string> {
  const figuresDir = resolveInside(ctx.root, ctx.dirs.figures)
  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(figuresDir, { withFileTypes: true })
  } catch {
    return 'no figures directory'
  }
  const rows: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    let caption = ''
    try {
      const raw: unknown = JSON.parse(
        await readFile(join(figuresDir, entry.name, 'figure.json'), 'utf8')
      )
      const title =
        typeof raw === 'object' && raw !== null
          ? (raw as { caption?: { title?: unknown } }).caption?.title
          : undefined
      if (typeof title === 'string') caption = ` — ${title}`
    } catch {
      // figures without metadata still list
    }
    rows.push(`${entry.name}${caption}`)
  }
  return rows.length > 0 ? rows.join('\n') : 'no figures'
}

export async function readFigureSvg(ctx: ProjectContext, figureId: string): Promise<string> {
  return readFile(resolveInside(ctx.root, ctx.dirs.figures, figureId, 'figure.svg'), 'utf8')
}

export async function readBib(ctx: ProjectContext): Promise<string> {
  return readFile(resolveInside(ctx.root, ctx.dirs.manuscript, 'references.bib'), 'utf8')
}

/**
 * Compliance is checked against the project's active journal profile, so an
 * agent gets the same verdicts the app's canvas shows.
 */
export async function checkFigureCompliance(
  ctx: ProjectContext,
  figureId: string
): Promise<string> {
  const [{ checkFigureSvg, getBundledProfile }, svg] = await Promise.all([
    import('@suna/formatter'),
    readFigureSvg(ctx, figureId)
  ])
  const profile = ctx.activeProfileId ? getBundledProfile(ctx.activeProfileId) : null
  if (!profile) return 'no active publisher profile: nothing to check against'
  const diagnostics = checkFigureSvg(svg, profile, { figureId })
  if (diagnostics.length === 0) return `${figureId}: compliant with ${profile.journalName}`
  return diagnostics.map((d) => `${d.severity} ${d.id}: ${d.message}`).join('\n')
}

/** Tool metadata shared by the server and its tests. */
export const TOOLS = [
  { name: 'list_project', description: 'List every file in the SUNA project', schema: listProjectInput },
  { name: 'read_section', description: 'Read a manuscript section (path relative to manuscript/)', schema: readSectionInput },
  { name: 'write_section', description: 'Overwrite a manuscript section (.md only)', schema: writeSectionInput },
  { name: 'read_manuscript_meta', description: 'Read manuscript.json (title, authors, sections, figures)', schema: readManuscriptMetaInput },
  { name: 'list_figures', description: 'List figures with their caption titles', schema: listFiguresInput },
  { name: 'read_figure_svg', description: 'Read a figure SVG source', schema: readFigureSvgInput },
  { name: 'read_bib', description: 'Read the BibTeX bibliography', schema: readBibInput },
  { name: 'check_figure_compliance', description: "Check a figure against the journal's author guidelines", schema: checkFigureComplianceInput }
] as const

export type ToolName = (typeof TOOLS)[number]['name']

/** Dispatch a tool call by name — the transport-free core the server wraps. */
export async function callTool(
  rootDir: string,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const ctx = await loadProjectContext(rootDir)
  switch (name) {
    case 'list_project':
      return listProject(ctx)
    case 'read_section':
      return readSection(ctx, readSectionInput.parse(args).path)
    case 'write_section': {
      const input = writeSectionInput.parse(args)
      return writeSection(ctx, input.path, input.content)
    }
    case 'read_manuscript_meta':
      return readManuscriptMeta(ctx)
    case 'list_figures':
      return listFigures(ctx)
    case 'read_figure_svg':
      return readFigureSvg(ctx, readFigureSvgInput.parse(args).figureId)
    case 'read_bib':
      return readBib(ctx)
    case 'check_figure_compliance':
      return checkFigureCompliance(ctx, checkFigureComplianceInput.parse(args).figureId)
    default:
      throw new Error(`unknown tool: ${name}`)
  }
}
