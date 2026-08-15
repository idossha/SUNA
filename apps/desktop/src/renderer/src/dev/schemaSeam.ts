import {
  CommentsFileSchema,
  FigureDocumentSchema,
  ManuscriptSchema,
  type ChannelName
} from '@suna/core'

/**
 * Dev-only seam letting an e2e driver schema-validate a file the app just
 * wrote, using the REAL @suna/core schemas.
 *
 * Workspace packages ship raw TypeScript with extensionless imports, so a
 * plain `node -e "import { FigureDocumentSchema } from '@suna/core'"` in a
 * driver script dies on module resolution. The renderer already has these
 * schemas bundled, so the driver reads the file off disk, hands the parsed
 * JSON to `window.__sunaDev.validateDoc(...)`, and gets the same verdict the
 * app itself would reach — no second bundling step, no drifting copy of the
 * schema in the test harness.
 */

const SCHEMAS = {
  figure: FigureDocumentSchema,
  manuscript: ManuscriptSchema,
  comments: CommentsFileSchema
} as const

export type DevSchemaKind = keyof typeof SCHEMAS

export interface DevValidationResult {
  ok: boolean
  /** First few issues, already flattened to `path: message` strings. */
  issues: string[]
}

export function validateDoc(kind: DevSchemaKind, value: unknown): DevValidationResult {
  const schema = SCHEMAS[kind]
  if (schema === undefined) return { ok: false, issues: [`unknown schema kind: ${String(kind)}`] }
  const result = schema.safeParse(value)
  if (result.success) return { ok: true, issues: [] }
  return {
    ok: false,
    issues: result.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
  }
}

/** Read a project file through the app's own IPC and validate it in one call. */
export async function validateFile(kind: DevSchemaKind, path: string): Promise<DevValidationResult> {
  const channel: ChannelName = 'fs:read-text'
  const res = await window.suna.invoke(channel, { path })
  try {
    return validateDoc(kind, JSON.parse(res.content))
  } catch (error) {
    return { ok: false, issues: [`not JSON: ${error instanceof Error ? error.message : String(error)}`] }
  }
}

export const schemaDevSeam = { validateDoc, validateFile, kinds: Object.keys(SCHEMAS) }
