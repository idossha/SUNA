import { it, expect } from 'vitest'
/**
 * The shipped example project (examples/hello-suna) is the first SUNA project
 * most people open, and it is a FIXTURE for the export suite, the smoke run
 * and the website screenshots. A file in it that no longer parses under the
 * schema it claims to follow is therefore a broken example, a broken test
 * suite and a broken docs build at once — so every JSON in it is parsed here,
 * by the same schemas the app uses, rather than trusted to have been written
 * correctly by hand.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  SunaProjectManifestSchema, ManuscriptSchema, AuthorsFileSchema,
  CoverLetterMetaSchema, RoundSchema, RoundsIndexSchema, ReviewerReportSchema,
  FigureDocumentSchema, baselineVersionFor,
  reportIsFaithful, resolveDocuments, documentPaths
} from '@suna/core'

const E = resolve(import.meta.dirname, '..', '..', '..', '..', '..', 'examples', 'hello-suna')
const read = async (p: string): Promise<unknown> => JSON.parse(await readFile(join(E, p), 'utf8'))

it('every JSON in the shipped example parses under its schema', async () => {
  const manifest = SunaProjectManifestSchema.parse(await read('suna.json'))
  ManuscriptSchema.parse(await read('manuscript/manuscript.json'))
  AuthorsFileSchema.parse(await read('manuscript/authors.json'))
  CoverLetterMetaSchema.parse(await read('manuscript/letters/cover.json'))
  for (const id of ['hello', 'timesheet']) FigureDocumentSchema.parse(await read(`figures/${id}/figure.json`))

  // The round ledger lives at the project root, not under manuscript/
  // (ADR-009: "manuscript/ is prose you edit; rounds/ is the ledger"), and the
  // version log — when a project has one — lives at manuscript/archive/,
  // because it holds copies of prose. The shipped example logs no version, so
  // its round resolves its baseline by date rather than by pointer.
  const index = RoundsIndexSchema.parse(await read('rounds/index.json'))
  for (const roundId of index.rounds) {
    const round = RoundSchema.parse(await read(`rounds/${roundId}/round.json`))
    expect(baselineVersionFor(round, [])).toBeNull()
    for (const f of await readdir(join(E, 'rounds', roundId, 'reviewers'))) {
      const report = ReviewerReportSchema.parse(await read(`rounds/${roundId}/reviewers/${f}`))
      expect(reportIsFaithful(report)).toBe(true)
    }
  }

  for (const doc of resolveDocuments(manifest)) {
    const paths = documentPaths(join(E, 'manuscript'), doc)
    if (paths.prose !== null) expect((await readFile(paths.prose, 'utf8')).length).toBeGreaterThan(0)
    if (paths.meta !== null) expect((await readFile(paths.meta, 'utf8')).length).toBeGreaterThan(0)
  }
})
