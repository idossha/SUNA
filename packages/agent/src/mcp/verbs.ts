import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { ManuscriptSchema, emptyAuthorsFile } from '@suna/core'
import { outlineFromMarkdown, parseSciMark } from '@suna/markdown'
import { writeAtomic } from '../context/ensure'
import { loadProjectContext, resolveInside, type ProjectContext } from './project'
import {
  addComment,
  addCommentInput,
  listComments,
  listCommentsInput,
  replyComment,
  replyCommentInput,
  resolveComment,
  resolveCommentInput
} from './comments'
import {
  addReference,
  addReferenceInput,
  lookupDoiInput,
  lookupDoiTool,
  searchLiteratureInput,
  searchLiteratureTool
} from './lit'

/**
 * File-level manuscript verbs. These operate directly on the project on disk
 * so an agent CLI can work with or without SUNA running (flux's file-verb
 * fallback pattern). Every path is confined to the project root.
 */

export const listProjectInput = z.object({})
export const readManuscriptInput = z.object({})
export const writeManuscriptInput = z.object({ content: z.string() })
export const editManuscriptInput = z.object({
  /** Exact text to replace — must occur exactly once in the manuscript. */
  find: z.string().min(1),
  replace: z.string()
})
export const checkManuscriptInput = z.object({})
/** Kept only so an agent mid-session that still calls the old name doesn't break — see TOOLS below. */
export const readSectionInput = z.object({ path: z.string().min(1) })
export const writeSectionInput = z.object({
  path: z.string().min(1),
  content: z.string()
})
export const listOutlineInput = z.object({})
export const readManuscriptMetaInput = z.object({})
export const listFiguresInput = z.object({})
export const readFigureSvgInput = z.object({ figureId: z.string().min(1) })
export const readBibInput = z.object({})
export const checkFigureComplianceInput = z.object({ figureId: z.string().min(1) })

const IGNORED = new Set(['.git', 'node_modules', '__pycache__', '.DS_Store', '.venv'])

import type { Dirent } from 'node:fs'

type DirEntries = Dirent<string>[]

async function walk(dir: string, root: string, depth: number): Promise<string[]> {
  if (depth > 6) return []
  const out: string[] = []
  let entries: DirEntries
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const DEFAULT_MANUSCRIPT_FILE = 'manuscript.md'

/**
 * manuscript.json's `manuscriptFile` field names the one prose file
 * (feature-plan-7 §1 — the flat layout has no `sections/` directory
 * anymore). Read fresh on every call, same as the rest of this module's
 * "no restart needed" philosophy; a missing or unparsable manuscript.json
 * falls back to the default name rather than failing the whole verb.
 */
async function manuscriptFileName(ctx: ProjectContext): Promise<string> {
  try {
    const raw: unknown = JSON.parse(
      await readFile(resolveInside(ctx.root, ctx.dirs.manuscript, 'manuscript.json'), 'utf8')
    )
    const name = isRecord(raw) ? raw['manuscriptFile'] : undefined
    if (typeof name === 'string' && name !== '') return name
  } catch {
    // no manuscript.json yet, or it doesn't parse — the default name still works
  }
  return DEFAULT_MANUSCRIPT_FILE
}

/** The whole manuscript prose file (feature-plan-7 §1: one flat manuscript.md, sections are Markdown headings). */
export async function readManuscript(ctx: ProjectContext): Promise<string> {
  const name = await manuscriptFileName(ctx)
  return readFile(resolveInside(ctx.root, ctx.dirs.manuscript, name), 'utf8')
}

/** Overwrites the whole manuscript prose file (atomically — a crash
 * mid-write must never truncate the user's prose). */
export async function writeManuscript(ctx: ProjectContext, content: string): Promise<string> {
  const name = await manuscriptFileName(ctx)
  await writeAtomic(resolveInside(ctx.root, ctx.dirs.manuscript, name), content)
  return `wrote ${content.length} characters to ${name}`
}

function allIndicesOf(text: string, find: string): number[] {
  if (find.length === 0) return [] // same convention as @suna/core's anchor.ts
  const out: number[] = []
  let at = text.indexOf(find)
  while (at !== -1) {
    out.push(at)
    // Advance by 1, not by find.length: self-overlapping anchors (find "nono"
    // in "nonono") must count as ambiguous, never as a single clean match.
    at = text.indexOf(find, at + 1)
  }
  return out
}

/** One line of context around a match, for the ambiguity error. */
function matchContext(text: string, at: number, length: number): string {
  const lineStart = text.lastIndexOf('\n', at) + 1
  const lineEndRaw = text.indexOf('\n', at + length)
  const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw
  const line = text.slice(lineStart, lineEnd)
  return line.length > 160 ? `${line.slice(0, 160)}…` : line
}

/** The section (by derived outline) whose range contains offset `at`. */
function sectionLabelAt(md: string, at: number): string {
  const sections = outlineFromMarkdown(md)
  if (sections.length === 0) return '(empty manuscript)'
  // A whitespace-only lead emits no level-0 section, so an offset before the
  // first heading belongs to the start of the file, not to "no manuscript".
  let label = '(start of file)'
  for (const s of sections) {
    if (s.headingFrom > at) break
    label = s.level === 0 ? '(untitled leading section)' : s.title
  }
  return label
}

/**
 * The anchored edit primitive: replace one exact occurrence of `find`, or
 * fail loudly. An edit from a stale read fails (0 matches) instead of
 * silently clobbering concurrent changes — the same discipline the app's own
 * editor applies — which is why this, not write_manuscript, is the verb the
 * shipped agent docs teach for routine edits.
 */
export async function editManuscript(
  ctx: ProjectContext,
  find: string,
  replace: string
): Promise<string> {
  const name = await manuscriptFileName(ctx)
  const path = resolveInside(ctx.root, ctx.dirs.manuscript, name)
  const text = await readFile(path, 'utf8')
  const matches = allIndicesOf(text, find)
  if (matches.length === 0) {
    const fuzzyHit = text.replace(/\s+/g, ' ').includes(find.replace(/\s+/g, ' '))
    throw new Error(
      `find matched nothing in ${name}` +
        (fuzzyHit
          ? ' — it DOES match ignoring whitespace; re-read the manuscript and resend find with its exact whitespace'
          : ' — re-read the manuscript and copy the text exactly')
    )
  }
  if (matches.length > 1) {
    const shown = matches
      .slice(0, 5)
      .map((at) => `  at ${at}: ${matchContext(text, at, find.length)}`)
      .join('\n')
    throw new Error(
      `find matched at ${matches.length} positions (overlaps counted) in ${name} — extend it until it is unique:\n${shown}` +
        (matches.length > 5 ? `\n  … and ${matches.length - 5} more` : '')
    )
  }
  const at = matches[0] as number
  const next = text.slice(0, at) + replace + text.slice(at + find.length)
  await writeAtomic(path, next)
  return `replaced ${find.length} chars with ${replace.length} chars at offset ${at} in section "${sectionLabelAt(next, at)}"`
}

/**
 * `read_section`/`write_section` predate the flat layout, when the prose was
 * split across `manuscript/sections/*.md` and `path` picked which file. That
 * split is gone — there is exactly one prose file now — so these are thin
 * aliases over `read_manuscript`/`write_manuscript` that ignore whatever
 * `path` an old caller still sends, rather than erroring, so an agent
 * mid-session against a pre-migration prompt does not break outright.
 */
export async function readSection(ctx: ProjectContext, _path: string): Promise<string> {
  return readManuscript(ctx)
}

export async function writeSection(ctx: ProjectContext, _path: string, content: string): Promise<string> {
  return writeManuscript(ctx, content)
}

/**
 * The derived section outline (`@suna/markdown`'s `outlineFromMarkdown`) —
 * an agent's only way to see manuscript structure without reading the whole
 * file, matching what the sidebar shows.
 */
export async function listOutline(ctx: ProjectContext): Promise<string> {
  const md = await readManuscript(ctx)
  const sections = outlineFromMarkdown(md)
  if (sections.length === 0) return 'no sections (empty manuscript)'
  return sections
    .map((s) => {
      const indent = '  '.repeat(Math.max(0, s.level - 1))
      const label = s.level === 0 ? '(untitled leading section)' : s.title
      return `${indent}${label} — ${s.words} word${s.words === 1 ? '' : 's'}`
    })
    .join('\n')
}

/**
 * manuscript.json (title, figures, tables, back matter, …) plus
 * authors.json (feature-plan-7 §1 moved the byline out of manuscript.json
 * into its own file, so the two are surfaced together here rather than
 * leaving an agent to guess it needs a second read).
 */
export async function readManuscriptMeta(ctx: ProjectContext): Promise<string> {
  const manuscriptJson = await readFile(resolveInside(ctx.root, ctx.dirs.manuscript, 'manuscript.json'), 'utf8')
  let authorsJson: string
  try {
    authorsJson = await readFile(resolveInside(ctx.root, ctx.dirs.manuscript, 'authors.json'), 'utf8')
  } catch {
    authorsJson = JSON.stringify(emptyAuthorsFile(), null, 2)
  }
  return `manuscript.json:\n${manuscriptJson}\n\nauthors.json:\n${authorsJson}`
}

export async function listFigures(ctx: ProjectContext): Promise<string> {
  const figuresDir = resolveInside(ctx.root, ctx.dirs.figures)
  let entries: DirEntries
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
 * The figure checker parses SVG through the canvas engine, which needs DOM
 * globals. Node has none, so a jsdom window supplies them once per process.
 */
async function ensureDom(): Promise<void> {
  if ('DOMParser' in globalThis) return
  const { JSDOM } = await import('jsdom')
  const { window } = new JSDOM('')
  const g = globalThis as unknown as Record<string, unknown>
  g['DOMParser'] = window.DOMParser
  g['XMLSerializer'] = window.XMLSerializer
  g['Node'] = window.Node
  g['Element'] = window.Element
  g['Document'] = window.Document
}

/**
 * Compliance is checked against the project's active journal profile, so an
 * agent gets the same verdicts the app's canvas shows.
 */
export async function checkFigureCompliance(
  ctx: ProjectContext,
  figureId: string
): Promise<string> {
  await ensureDom()
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

/**
 * Distinct cited keys in the prose — the same number the app's export
 * compliance check derives (assignNumbers over the citation clusters has one
 * entry per distinct key), without pulling the whole bib engine in.
 */
function citedKeyCount(md: string): number {
  const keys = new Set<string>()
  const visit = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return
    const n = node as { type?: unknown; keys?: unknown; children?: unknown }
    if (n.type === 'citation' && Array.isArray(n.keys)) {
      for (const key of n.keys) if (typeof key === 'string') keys.add(key)
    }
    if (Array.isArray(n.children)) for (const child of n.children) visit(child)
  }
  visit(parseSciMark(md))
  return keys.size
}

/**
 * Manuscript-side compliance against the active profile — word/abstract/
 * section limits, required sections, availability statements, and prose ↔
 * figure referential integrity. Mirrors the app's export-time check: one
 * flat prose file as the only section text, and the profile's first declared
 * article type as its primary research-article type.
 */
export async function checkManuscriptCompliance(ctx: ProjectContext): Promise<string> {
  const [{ checkManuscript, getBundledProfile }, prose] = await Promise.all([
    import('@suna/formatter'),
    readManuscript(ctx)
  ])
  const profile = ctx.activeProfileId ? getBundledProfile(ctx.activeProfileId) : null
  if (!profile) return 'no active publisher profile: nothing to check against'
  const articleTypeId = profile.manuscript.articleTypes[0]?.id
  if (articleTypeId === undefined) {
    return `profile ${profile.id} declares no article types: nothing to check against`
  }
  // Name the file in every failure mode — a bare ENOENT or zod issue dump
  // gives an agent nothing to act on (same discipline as readCommentsFile).
  const metaPath = resolveInside(ctx.root, ctx.dirs.manuscript, 'manuscript.json')
  let metaRaw: string
  try {
    metaRaw = await readFile(metaPath, 'utf8')
  } catch {
    throw new Error(`manuscript.json is missing (${metaPath}): nothing to check against`)
  }
  let metaJson: unknown
  try {
    metaJson = JSON.parse(metaRaw)
  } catch (error) {
    throw new Error(
      `manuscript.json is not valid JSON (${metaPath}): ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const parsed = ManuscriptSchema.safeParse(metaJson)
  if (!parsed.success) {
    throw new Error(
      `manuscript.json does not match the manuscript schema (${metaPath}): ${parsed.error.message}`
    )
  }
  const manuscript = parsed.data
  const name = await manuscriptFileName(ctx)
  const diagnostics = checkManuscript(
    { manuscript, sectionTexts: { [name]: prose }, referenceCount: citedKeyCount(prose) },
    profile,
    articleTypeId
  )
  if (diagnostics.length === 0) return `manuscript: compliant with ${profile.journalName}`
  return diagnostics.map((d) => `${d.severity} ${d.id}: ${d.message}`).join('\n')
}

/** Tool metadata shared by the server and its tests. */
export const TOOLS = [
  { name: 'list_project', description: 'List every file in the SUNA project', schema: listProjectInput },
  { name: 'read_manuscript', description: 'Read the whole manuscript prose file (manuscript/manuscript.md)', schema: readManuscriptInput },
  {
    name: 'write_manuscript',
    description:
      'Overwrite the whole manuscript prose file (manuscript/manuscript.md) — for wholesale restructures; prefer edit_manuscript for routine edits',
    schema: writeManuscriptInput
  },
  {
    name: 'edit_manuscript',
    description:
      'Replace one exact occurrence of `find` with `replace` in the manuscript prose — errors if `find` matches zero or several times (with per-match context so you can extend it)',
    schema: editManuscriptInput
  },
  {
    name: 'read_section',
    description: 'DEPRECATED alias for read_manuscript — the manuscript is one flat file now, so `path` is ignored and the whole file is returned',
    schema: readSectionInput
  },
  {
    name: 'write_section',
    description: 'DEPRECATED alias for write_manuscript — the manuscript is one flat file now, so `path` is ignored and the whole file is overwritten',
    schema: writeSectionInput
  },
  { name: 'list_outline', description: 'List the manuscript\'s derived section outline (heading, depth, word count)', schema: listOutlineInput },
  {
    name: 'read_manuscript_meta',
    description: 'Read manuscript.json (title, figures, tables, back matter) and authors.json (byline)',
    schema: readManuscriptMetaInput
  },
  { name: 'list_figures', description: 'List figures with their caption titles', schema: listFiguresInput },
  { name: 'read_figure_svg', description: 'Read a figure SVG source', schema: readFigureSvgInput },
  { name: 'read_bib', description: 'Read the BibTeX bibliography', schema: readBibInput },
  { name: 'check_figure_compliance', description: "Check a figure against the journal's author guidelines", schema: checkFigureComplianceInput },
  {
    name: 'check_manuscript',
    description:
      "Check the manuscript against the journal's author guidelines (word/abstract/section limits, required sections, availability statements, figure-reference integrity)",
    schema: checkManuscriptInput
  },
  { name: 'list_comments', description: 'List review comments, optionally filtered by resolved status or section path', schema: listCommentsInput },
  { name: 'add_comment', description: 'Add a review comment anchored to an exact quote in a manuscript section', schema: addCommentInput },
  { name: 'reply_comment', description: 'Reply to an existing review comment thread', schema: replyCommentInput },
  { name: 'resolve_comment', description: 'Mark a review comment resolved or open', schema: resolveCommentInput },
  { name: 'search_literature', description: 'Search a literature provider (default Crossref, keyless)', schema: searchLiteratureInput },
  { name: 'lookup_doi', description: 'Look up one work by DOI on a literature provider', schema: lookupDoiInput },
  { name: 'add_reference', description: 'Look up a DOI and append it to references.bib', schema: addReferenceInput }
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
    case 'read_manuscript':
      readManuscriptInput.parse(args)
      return readManuscript(ctx)
    case 'write_manuscript':
      return writeManuscript(ctx, writeManuscriptInput.parse(args).content)
    case 'edit_manuscript': {
      const input = editManuscriptInput.parse(args)
      return editManuscript(ctx, input.find, input.replace)
    }
    case 'read_section':
      return readSection(ctx, readSectionInput.parse(args).path)
    case 'write_section': {
      const input = writeSectionInput.parse(args)
      return writeSection(ctx, input.path, input.content)
    }
    case 'list_outline':
      listOutlineInput.parse(args)
      return listOutline(ctx)
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
    case 'check_manuscript':
      checkManuscriptInput.parse(args)
      return checkManuscriptCompliance(ctx)
    case 'list_comments':
      return listComments(ctx, listCommentsInput.parse(args))
    case 'add_comment':
      return addComment(ctx, addCommentInput.parse(args))
    case 'reply_comment':
      return replyComment(ctx, replyCommentInput.parse(args))
    case 'resolve_comment':
      return resolveComment(ctx, resolveCommentInput.parse(args))
    case 'search_literature':
      return searchLiteratureTool(searchLiteratureInput.parse(args))
    case 'lookup_doi':
      return lookupDoiTool(lookupDoiInput.parse(args))
    case 'add_reference':
      return addReference(ctx, addReferenceInput.parse(args))
    default:
      throw new Error(`unknown tool: ${name}`)
  }
}
