import { jsonParseLinter } from '@codemirror/lang-json'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { Diagnostic } from '@codemirror/lint'
import {
  FigureDocumentSchema,
  ManuscriptSchema,
  SunaProjectManifestSchema
} from '@suna/core'

/**
 * Structural view of a zod schema — desktop does not depend on zod directly,
 * so we type only what we use. The @suna/core schemas all satisfy this.
 */
export interface SchemaLike {
  safeParse(data: unknown):
    | { success: true }
    | {
        success: false
        error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }
      }
}

/** Well-known SUNA JSON files get validated against their core schema. */
export function schemaForFile(fileName: string): SchemaLike | undefined {
  const base = fileName.split('/').pop()?.toLowerCase() ?? fileName.toLowerCase()
  switch (base) {
    case 'suna.json':
      return SunaProjectManifestSchema
    case 'manuscript.json':
      return ManuscriptSchema
    case 'figure.json':
      return FigureDocumentSchema
    default:
      return undefined
  }
}

/** @lezer/common is not a direct dependency; derive its node type structurally. */
type SyntaxNode = ReturnType<typeof syntaxTree>['topNode']

/** lezer-json trees include punctuation tokens; these are the value nodes. */
const JSON_VALUE_NODES = new Set(['Object', 'Array', 'String', 'Number', 'True', 'False', 'Null'])

/** Strip quotes/escapes from a lezer-json PropertyName token. */
function parsePropertyName(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'string' ? parsed : text
  } catch {
    return text.replace(/^"|"$/g, '')
  }
}

/**
 * Map a zod issue path onto a document range by walking the lezer JSON tree.
 * Falls back to the deepest node that could be matched (clamped to its first
 * line so diagnostics on large objects stay readable).
 */
export function offsetForJsonPath(
  state: EditorState,
  path: readonly PropertyKey[]
): { from: number; to: number } {
  const tree = ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state)
  let node: SyntaxNode | null = tree.topNode.firstChild
  if (node === null) return { from: 0, to: 0 }

  for (const rawSegment of path) {
    const segment = String(rawSegment)
    let next: SyntaxNode | null = null
    if (node.name === 'Object') {
      for (let prop: SyntaxNode | null = node.firstChild; prop !== null; prop = prop.nextSibling) {
        if (prop.name !== 'Property') continue
        const nameNode = prop.getChild('PropertyName')
        if (nameNode === null) continue
        if (parsePropertyName(state.sliceDoc(nameNode.from, nameNode.to)) === segment) {
          const value: SyntaxNode | null = prop.lastChild
          next = value !== null && JSON_VALUE_NODES.has(value.name) ? value : nameNode
          break
        }
      }
    } else if (node.name === 'Array') {
      const index = Number(segment)
      if (Number.isInteger(index) && index >= 0) {
        let position = 0
        for (let child: SyntaxNode | null = node.firstChild; child !== null; child = child.nextSibling) {
          if (!JSON_VALUE_NODES.has(child.name)) continue
          if (position === index) {
            next = child
            break
          }
          position += 1
        }
      }
    }
    if (next === null) break
    node = next
  }

  const lineEnd = state.doc.lineAt(node.from).to
  return { from: node.from, to: Math.min(node.to, lineEnd) }
}

/**
 * JSON lint source: JSON.parse errors first (via @codemirror/lang-json's
 * linter); when the document parses and the file is one of the well-known
 * SUNA documents, zod schema issues are surfaced as diagnostics too.
 */
export function sunaJsonLinter(fileName: string): (view: EditorView) => Diagnostic[] {
  const parseLint = jsonParseLinter()
  const schema = schemaForFile(fileName)

  return (view) => {
    const parseDiagnostics = parseLint(view)
    if (parseDiagnostics.length > 0 || schema === undefined) return parseDiagnostics

    let data: unknown
    try {
      data = JSON.parse(view.state.doc.toString())
    } catch {
      return []
    }
    const result = schema.safeParse(data)
    if (result.success) return []
    return result.error.issues.map((issue): Diagnostic => {
      const { from, to } = offsetForJsonPath(view.state, issue.path)
      const where = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)'
      return {
        from,
        to,
        severity: 'error',
        source: 'suna-schema',
        message: `${where}: ${issue.message}`
      }
    })
  }
}
