import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExportOptions } from '@suna/core'
import { parseSciMark, type CrossRefKind } from '@suna/markdown'
import { cliEnv } from './lit'
import {
  collectBlockImages,
  collectTables,
  isNumericCitationMode,
  widthMmForPreset,
  type ExportContent,
  type ListNode,
  type RootChild,
  type TableNode
} from './export-content'
import { projectSubdir } from './paths'
import { assertInsideAllowedRoot } from './roots'

/**
 * OPTIONAL accelerator (feature-plan-6 §3 step 3): when the user's own
 * `docx-tools` CLI is on PATH, build via its `spec.json` → `docx-tools build`
 * pipeline instead of the bundled `docx` library — same content, the user's
 * existing tool and workflow (redline, comments, etc.). Detected, never
 * required: `exportDocx` (export-docx.ts) falls back to the bundled path on
 * any failure here, including the tool being absent.
 *
 * The spec.json shape below was learned by running `docx-tools init` and
 * reading its scaffolded spec.json/authors.json, and by reading
 * docx_tools/build.py's supported content-block types directly (there is no
 * published JSON Schema) — see that file's module docstring for the
 * authoritative list. It is a REAL but deliberately simpler pipeline than
 * export-docx.ts's own: docx-tools has no "list" block type (list items
 * flatten into bullet/numbered body paragraphs), no markdown-link support in
 * body text (links keep their visible text, lose the URL), no math
 * typesetting (LaTeX source stays literal, matching export-docx.ts's own
 * math limitation), and exactly two reference styles — 'apa' or 'ieee' — not
 * arbitrary per-profile templates, so the profile's citation MODE picks the
 * nearer of the two rather than reproducing the profile's exact entry
 * format.
 *
 * Two things it cannot express at all, which `docxToolsSupports` therefore
 * declines rather than exporting wrong (checked against docx_tools/tables.py
 * and build.py directly):
 * - PER-COLUMN TABLE ALIGNMENT. `add_table` hardcodes "first column left, the
 *   rest centred" (tables.py:117-118); there is no per-column option. A GFM
 *   `:---:` delimiter row would be silently discarded.
 * - A BLOCK IMAGE. The only image block is 'figure', and `add_figure`
 *   auto-increments its own figure counter and writes a bold "Figure N."
 *   caption (figures.py:47-57) — so a loose `![alt](x.png)` would both invent
 *   a caption and shift every managed figure's number.
 * The trade is that a document containing either loses the accelerator
 * entirely and is built by the bundled 'docx' library, which handles both.
 */

const VERSION_TIMEOUT_MS = 5_000
const BUILD_TIMEOUT_MS = 60_000

/** Injectable so detection is testable without a real child process — mirrors lit.ts's CliProbe. */
export type DocxToolsProbe = () => Promise<boolean>

async function defaultProbe(): Promise<boolean> {
  return new Promise<boolean>((resolvePromise) => {
    execFile('docx-tools', ['--version'], { timeout: VERSION_TIMEOUT_MS, env: cliEnv() }, (error) => {
      if (error === null) {
        resolvePromise(true)
        return
      }
      // ENOENT (nothing on PATH with that name) is the only outcome that
      // means "not available"; docx-tools has no --version flag of its own
      // (it answers with an argparse usage error, a non-zero exit) — any
      // OTHER exit means the binary responded, which is the actual presence
      // check the spec asks for.
      const code = (error as NodeJS.ErrnoException).code
      resolvePromise(code !== 'ENOENT')
    })
  })
}

let cachedAvailable: boolean | undefined

/** Test-only: clears the per-session cache. */
export function resetDocxToolsAvailabilityCache(): void {
  cachedAvailable = undefined
}

/** Detected once per session (module lifetime) and cached, like lit.ts's agent-CLI detection. */
export async function docxToolsAvailable(probe: DocxToolsProbe = defaultProbe): Promise<boolean> {
  if (cachedAvailable !== undefined) return cachedAvailable
  cachedAvailable = await probe()
  return cachedAvailable
}

type SpecBlock = Record<string, unknown>

function crossRefText(kind: CrossRefKind, id: string, suffix: string | undefined, content: ExportContent): string {
  const map =
    kind === 'fig'
      ? content.labels.figures
      : kind === 'tbl'
        ? content.labels.tables
        : kind === 'eq'
          ? content.labels.equations
          : content.labels.sections
  const label = map.get(id)
  if (label === undefined) return `${kind}:${id}`
  return suffix !== undefined ? `${label}${suffix}` : label
}

/** mdast phrasing content -> docx-tools' own tiny markup subset ("**bold**", "*italic*", literal text). */
function inlineToText(nodes: readonly RootChild[], content: ExportContent): string {
  let out = ''
  for (const node of nodes as readonly (RootChild & { children?: RootChild[] })[]) {
    switch (node.type) {
      case 'text':
        out += (node as unknown as { value: string }).value
        break
      case 'strong':
        out += `**${inlineToText(node.children ?? [], content)}**`
        break
      case 'emphasis':
        out += `*${inlineToText(node.children ?? [], content)}*`
        break
      case 'delete':
        out += inlineToText(node.children ?? [], content)
        break
      case 'inlineCode':
        out += (node as unknown as { value: string }).value
        break
      case 'link':
        // docx-tools' add_formatted_text has no [text](url) markdown support — keep the visible text, drop the URL.
        out += inlineToText(node.children ?? [], content)
        break
      case 'inlineMath':
        out += `$${(node as unknown as { value: string }).value}$`
        break
      case 'citation': {
        const c = node as unknown as { keys: string[] }
        out += `[${c.keys.map((k) => `@${k}`).join('; ')}]`
        break
      }
      case 'crossRef': {
        const c = node as unknown as { kind: CrossRefKind; id: string; suffix?: string }
        out += crossRefText(c.kind, c.id, c.suffix, content)
        break
      }
      case 'footnoteReference':
        out += `[${(node as unknown as { identifier: string }).identifier}]`
        break
      case 'break':
        out += ' '
        break
      case 'image':
      case 'imageReference':
        out += (node as unknown as { alt?: string }).alt ?? ''
        break
      default:
        break
    }
  }
  return out
}

function plainTextField(text: string, content: ExportContent): string {
  if (text.trim() === '') return ''
  const root = parseSciMark(text)
  return root.children
    .filter((n): n is RootChild & { children: RootChild[] } => n.type === 'paragraph')
    .map((n) => inlineToText(n.children, content))
    .join(' ')
}

function cellText(children: readonly RootChild[], content: ExportContent): string {
  return inlineToText(children, content)
}

function figureBlocks(figureId: string, content: ExportContent): SpecBlock[] {
  const fig = content.figures.find((f) => f.figure.id === figureId)
  if (fig === undefined) return []
  const widthMm = widthMmForPreset(fig.figure.widthPreset, content.profile)
  const titleText = plainTextField(fig.figure.caption.title, content)
  const bodyText = plainTextField(fig.figure.caption.body, content)
  // NO label prefix here: docx-tools numbers figures itself and writes its own
  // bold "Figure N. " ahead of whatever caption it is given. Passing our label
  // too produced "Figure 1. Figure 1. …" in the built document.
  const caption = `${titleText}${bodyText !== '' ? ` ${bodyText}` : ''}`
  return [{ type: 'figure', image: fig.pngPath, caption, width: widthMm / 25.4 }]
}

function listBlocks(node: ListNode, content: ExportContent): SpecBlock[] {
  const out: SpecBlock[] = []
  node.children.forEach((item, i) => {
    const prefix = node.ordered === true ? `${(node.start ?? 1) + i}. ` : '• '
    const text = item.children
      .filter((c) => c.type === 'paragraph')
      .map((c) => inlineToText((c as unknown as { children: RootChild[] }).children, content))
      .join(' ')
    if (text.trim() !== '') out.push({ type: 'body', text: prefix + text })
  })
  return out
}

function tableBlocks(node: TableNode, content: ExportContent): SpecBlock[] {
  const [head, ...body] = node.children
  if (head === undefined) return []
  const headers = head.children.map((cell) => cellText(cell.children, content))
  const rows = body.map((row) => row.children.map((cell) => cellText(cell.children, content)))
  return [{ type: 'table', headers, rows }]
}

function blockOf(node: RootChild, content: ExportContent): SpecBlock[] {
  switch (node.type) {
    case 'paragraph': {
      const text = inlineToText(node.children, content)
      return text.trim() === '' ? [] : [{ type: 'body', text }]
    }
    case 'heading':
      return [{ type: 'heading', text: inlineToText(node.children, content), level: Math.min(node.depth, 3) }]
    case 'list':
      return listBlocks(node, content)
    case 'table':
      return tableBlocks(node, content)
    case 'blockquote':
      return node.children.flatMap((c) => blockOf(c, content))
    case 'code':
      return [{ type: 'body', text: node.value }]
    case 'math':
      // build.py's _render_body honours an "align" key (build.py:561-563), so
      // display math is centred here the way the bundled writer centres it.
      return [{ type: 'body', text: `$$${node.value}$$`, align: 'center' }]
    case 'figureEmbed':
      return figureBlocks(node.figureId, content)
    default:
      return []
  }
}

function levelFor(level: ExportContent['sections'][number]['level']): number {
  return level === 'A' ? 1 : level === 'B' ? 2 : 3
}

/**
 * Can this document go through the spec.json pipeline at all? False for the
 * two shapes the module doc lists as inexpressible, so `exportDocx` builds
 * them with the bundled library instead of exporting them wrong.
 */
export function docxToolsSupports(content: ExportContent): boolean {
  for (const section of content.sections) {
    if (section.root === null) continue
    if (collectBlockImages(section.root.children).length > 0) return false
    // Walked, not iterated: `blockOf` recurses into blockquotes and lists, so
    // a GFM-aligned table one level down reaches the spec too and would have
    // its delimiter row silently dropped.
    for (const table of collectTables(section.root.children)) {
      if ((table.align ?? []).some((align) => align != null)) return false
    }
  }
  return true
}

interface BuiltSpec {
  spec: Record<string, unknown>
  authorsJson: Record<string, unknown>
}

export function buildSpecObjects(content: ExportContent, options: ExportOptions, bibPath: string): BuiltSpec {
  const m = content.manuscript

  const authorsJson = {
    authors: content.authors.authors.map((a) => ({
      full_name: `${a.given} ${a.family}`,
      affiliations: a.affiliationRefs
        .map((ref) => content.authors.affiliations.find((x) => x.id === ref))
        .filter((aff): aff is { id: string; text: string } => aff !== undefined)
        .map((aff) => ({ institution: aff.text })),
      corresponding: a.corresponding,
      ...(a.email !== null ? { email: a.email } : {})
    }))
  }

  const contentBlocks: SpecBlock[] = []
  contentBlocks.push({ id: 'title', type: 'title', text: plainTextField(m.title, content) })
  // 'data' is a placeholder; runDocxToolsBuild rewrites it to the real authors.json path once written to disk.
  contentBlocks.push({ id: 'authors', type: 'authors', data: 'authors.json' })
  if (m.significance != null) {
    contentBlocks.push({ type: 'heading', text: 'Significance', level: 1 })
    contentBlocks.push({ type: 'body', text: plainTextField(m.significance, content) })
  }
  contentBlocks.push({ type: 'heading', text: 'Abstract', level: 1 })
  contentBlocks.push({ type: 'body', text: plainTextField(m.abstract.content, content) })
  if (m.highlights != null && m.highlights.length > 0) {
    contentBlocks.push({ type: 'highlights', items: m.highlights.map((h) => plainTextField(h, content)) })
  }
  contentBlocks.push({ type: 'pagebreak' })

  for (const section of content.sections) {
    if (section.heading !== null) {
      contentBlocks.push({ type: 'heading', text: section.heading, level: levelFor(section.level) })
    }
    if (section.root !== null) {
      for (const node of section.root.children) contentBlocks.push(...blockOf(node, content))
    }
  }
  for (const t of content.tables) {
    const title = plainTextField(t.table.caption.title, content)
    const body = t.table.caption.body === undefined ? '' : plainTextField(t.table.caption.body, content)
    contentBlocks.push({ type: 'body', text: `${t.label}. ${title}${body !== '' ? ` ${body}` : ''}` })
  }
  contentBlocks.push({ type: 'pagebreak' })
  contentBlocks.push({ type: 'heading', text: 'References' })
  contentBlocks.push({ type: 'references', style: isNumericCitationMode(content.profile) ? 'ieee' : 'apa' })

  const spec = {
    metadata: { version: '0.1', status: 'draft', page_numbers: options.pageNumbers },
    bibliography: bibPath,
    content: contentBlocks
  }
  return { spec, authorsJson }
}

/**
 * Writes a spec.json/authors.json into a scratch subdirectory of the
 * project's output/ (cleaned up afterward, best-effort) and shells out to
 * `docx-tools build spec.json -o target`. Throws on any failure — the caller
 * (export-docx.ts) treats that as "the accelerator didn't work this time"
 * and falls back to the bundled 'docx' library, never as a fatal export
 * error.
 */
export async function buildViaDocxTools(
  dir: string,
  content: ExportContent,
  options: ExportOptions,
  target: string
): Promise<void> {
  const root = assertInsideAllowedRoot(dir)
  const manuscriptDir = await projectSubdir(root, 'manuscript')
  const bibPath = join(manuscriptDir, content.manuscript.bibliography)
  const { spec, authorsJson } = buildSpecObjects(content, options, bibPath)

  const buildDir = join(await projectSubdir(root, 'output'), '.docx-tools-build')
  await mkdir(buildDir, { recursive: true })
  const authorsPath = join(buildDir, 'authors.json')
  const specPath = join(buildDir, 'spec.json')

  try {
    await writeFile(authorsPath, JSON.stringify(authorsJson, null, 2), 'utf8')
    const specWithRealAuthorsPath = {
      ...spec,
      content: (spec['content'] as SpecBlock[]).map((block) =>
        block['type'] === 'authors' ? { ...block, data: authorsPath } : block
      )
    }
    await writeFile(specPath, JSON.stringify(specWithRealAuthorsPath, null, 2), 'utf8')

    await new Promise<void>((resolvePromise, reject) => {
      execFile(
        'docx-tools',
        ['build', specPath, '-o', target],
        { timeout: BUILD_TIMEOUT_MS, env: cliEnv() },
        (error, _stdout, stderr) => {
          if (error !== null) {
            reject(new Error(`docx-tools build failed: ${stderr || error.message}`))
            return
          }
          resolvePromise()
        }
      )
    })
  } finally {
    await rm(buildDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
