import { access, cp, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { FigureDocumentSchema } from '@suna/core'
import { writeFileAtomic } from './atomic'
import { figureDirPath } from './paths'
import { assertInsideAllowedRoot } from './roots'

/**
 * Copy figures/<figureId> to figures/<newId>, rewriting the copy's own id.
 * manuscript.json is deliberately NOT touched here: the renderer registers the
 * new figure through 'manuscript:update', so one read-merge-validate-write
 * cycle owns every manuscript mutation.
 */

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function duplicateFigure(
  dir: string,
  figureId: string,
  newId: string
): Promise<{ figureId: string }> {
  if (!ID_PATTERN.test(newId) || newId === figureId) {
    throw new Error(`invalid new figure id: ${newId}`)
  }
  const root = assertInsideAllowedRoot(dir)
  const source = assertInsideAllowedRoot(await figureDirPath(root, figureId))
  const target = assertInsideAllowedRoot(await figureDirPath(root, newId))

  if (!(await exists(join(source, 'figure.svg')))) {
    throw new Error(`no figure to duplicate at ${source}`)
  }
  if (await exists(target)) {
    throw new Error(`figure already exists: ${newId}`)
  }

  await cp(source, target, {
    recursive: true,
    filter: (path) => basename(path) !== '.DS_Store'
  })

  // Keep the copy self-consistent: figure.json carries its own id.
  const figureJson = join(target, 'figure.json')
  if (await exists(figureJson)) {
    const raw = await readFile(figureJson, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    const document = FigureDocumentSchema.parse({
      ...(typeof parsed === 'object' && parsed !== null ? parsed : {}),
      id: newId
    })
    await writeFileAtomic(figureJson, JSON.stringify(document, null, 2) + '\n')
  }

  return { figureId: newId }
}
