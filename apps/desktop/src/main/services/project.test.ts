import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AuthorsFileSchema,
  CoverLetterMetaSchema,
  DEFAULT_PROJECT_DIRS,
  LETTER_PRIVATE_GITIGNORE_LINE,
  LetterPrivateSchema,
  ManuscriptSchema,
  ReviewerReportSchema,
  RoundSchema,
  RoundsIndexSchema,
  SunaProjectManifestSchema,
  documentPaths,
  reportIsFaithful,
  resolveDocuments,
  unansweredIn
} from '@suna/core'
import { outlineFromMarkdown } from '@suna/markdown'
import {
  checkScaffoldTarget,
  scaffoldProject,
  updateProjectSettings
} from './project'
import { allowRoot } from './roots'

let dir = ''
let manifestFile = ''

const baseManifest = {
  schemaVersion: 1,
  name: 'my-paper',
  activeProfileId: 'nature',
  directories: DEFAULT_PROJECT_DIRS,
  createdAt: '2026-08-13T09:30:00.000Z'
}

async function writeManifest(value: unknown): Promise<void> {
  await writeFile(manifestFile, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

async function readManifest(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(manifestFile, 'utf8')) as Record<string, unknown>
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suna-project-settings-'))
  allowRoot(dir)
  manifestFile = join(dir, 'suna.json')
  await writeManifest(baseManifest)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('suna.json compatibility', () => {
  it('still parses the shipped demo project, which predates the settings block', async () => {
    const path = fileURLToPath(
      new URL('../../../../../examples/demo-paper/suna.json', import.meta.url)
    )
    const parsed = SunaProjectManifestSchema.safeParse(
      JSON.parse(await readFile(path, 'utf8')) as unknown
    )
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.settings).toBeUndefined()
  })
})

describe('updateProjectSettings', () => {
  it('adds a settings block and leaves every other manifest key alone', async () => {
    const manifest = await updateProjectSettings(dir, { editor: { contentWidthCh: 90 } })
    expect(manifest.settings?.editor?.contentWidthCh).toBe(90)
    const onDisk = await readManifest()
    expect(onDisk['settings']).toEqual({ editor: { contentWidthCh: 90 } })
    expect(onDisk['name']).toBe('my-paper')
    expect(onDisk['createdAt']).toBe(baseManifest.createdAt)
  })

  it('merges a second key into the existing block', async () => {
    await updateProjectSettings(dir, { editor: { contentWidthCh: 90 } })
    await updateProjectSettings(dir, { editor: { fontSizePx: 18 } })
    expect((await readManifest())['settings']).toEqual({
      editor: { contentWidthCh: 90, fontSizePx: 18 }
    })
  })

  it('deletes a key on null and prunes the block when it empties', async () => {
    await updateProjectSettings(dir, { editor: { contentWidthCh: 90, fontSizePx: 18 } })
    await updateProjectSettings(dir, { editor: { contentWidthCh: null } })
    expect((await readManifest())['settings']).toEqual({ editor: { fontSizePx: 18 } })
    await updateProjectSettings(dir, { editor: { fontSizePx: null } })
    expect('settings' in (await readManifest())).toBe(false)
  })

  it('re-reads the file, so a concurrent external edit is never clobbered', async () => {
    await updateProjectSettings(dir, { editor: { contentWidthCh: 90 } })
    // An agent (or the user, in the editor) renames the project on disk.
    await writeManifest({
      ...baseManifest,
      name: 'renamed-by-an-agent',
      settings: { editor: { contentWidthCh: 90 } }
    })
    const manifest = await updateProjectSettings(dir, { editor: { fontSizePx: 18 } })
    expect(manifest.name).toBe('renamed-by-an-agent')
    expect((await readManifest())['name']).toBe('renamed-by-an-agent')
  })

  it('preserves manifest keys the schema does not know about', async () => {
    await writeManifest({ ...baseManifest, futureKey: { keepMe: true } })
    await updateProjectSettings(dir, { editor: { fontSizePx: 18 } })
    expect((await readManifest())['futureKey']).toEqual({ keepMe: true })
  })

  it('rejects an out-of-range value and leaves the file untouched', async () => {
    const before = await readFile(manifestFile, 'utf8')
    await expect(updateProjectSettings(dir, { editor: { fontSizePx: 400 } })).rejects.toThrow()
    expect(await readFile(manifestFile, 'utf8')).toBe(before)
  })

  it('refuses a manifest that is already invalid rather than half-fixing it', async () => {
    await writeManifest({ ...baseManifest, schemaVersion: 2 })
    await expect(updateProjectSettings(dir, { editor: { fontSizePx: 18 } })).rejects.toThrow()
  })

  it('reports unparseable JSON honestly', async () => {
    await writeFile(manifestFile, '{ not json', 'utf8')
    await expect(updateProjectSettings(dir, {})).rejects.toThrow(/not valid JSON/)
  })

  it('refuses a directory that is not a project', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'suna-not-a-project-'))
    allowRoot(empty)
    await expect(updateProjectSettings(empty, {})).rejects.toThrow(/no suna\.json/)
    await rm(empty, { recursive: true, force: true })
  })

  it('refuses a path outside every open project root', async () => {
    await expect(updateProjectSettings('/definitely/not/open', {})).rejects.toThrow(
      /outside any open project/
    )
  })

  it('writes atomically, leaving no temp files behind', async () => {
    await updateProjectSettings(dir, { editor: { fontSizePx: 18 } })
    const entries = await readdir(dir)
    expect(entries.filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})

describe('checkScaffoldTarget', () => {
  it('reports the resolved path, exists:false, and a writable parent', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'suna-onboard-parent-'))
    const result = await checkScaffoldTarget(parent, 'my-new-paper')
    expect(result).toEqual({
      path: join(parent, 'my-new-paper'),
      exists: false,
      parentWritable: true
    })
    await rm(parent, { recursive: true, force: true })
  })

  it('reports exists:true when the target directory is already there', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'suna-onboard-parent-'))
    await mkdir(join(parent, 'taken'))
    const result = await checkScaffoldTarget(parent, 'taken')
    expect(result.exists).toBe(true)
    await rm(parent, { recursive: true, force: true })
  })

  it('reports parentWritable:false for a parent that does not exist', async () => {
    const result = await checkScaffoldTarget('/definitely/does/not/exist/anywhere', 'x')
    expect(result.parentWritable).toBe(false)
  })
})

describe('scaffoldProject', () => {
  let parent = ''
  let target = ''

  beforeEach(async () => {
    parent = await mkdtemp(join(tmpdir(), 'suna-scaffold-parent-'))
    target = join(parent, 'new-paper')
  })

  afterEach(async () => {
    await rm(parent, { recursive: true, force: true })
  })

  it('refuses a directory that is already a SUNA project', async () => {
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'suna.json'), JSON.stringify(baseManifest))
    await expect(
      scaffoldProject({
        dir: target,
        name: 'x',
        activeProfileId: 'nature',
        scaffold: 'blank',
        settings: {}
      })
    ).rejects.toThrow(/already a SUNA project/)
  })

  it('writes a schema-valid, git-initialized blank project with no demo prose', async () => {
    const result = await scaffoldProject({
      dir: target,
      name: 'My New Paper',
      activeProfileId: 'science',
      scaffold: 'blank',
      settings: {}
    })
    expect(result.manifest.activeProfileId).toBe('science')
    expect(result.manifest.settings).toBeUndefined()
    expect(result.gitInitialized).toBe(true)
    expect(result.warnings).toEqual([])

    const manifestOnDisk = SunaProjectManifestSchema.parse(
      JSON.parse(await readFile(join(target, 'suna.json'), 'utf8'))
    )
    expect(manifestOnDisk.name).toBe('My New Paper')

    const manuscript = ManuscriptSchema.parse(
      JSON.parse(await readFile(join(target, 'manuscript', 'manuscript.json'), 'utf8'))
    )
    expect(manuscript.manuscriptFile).toBe('manuscript.md')
    expect(await readFile(join(target, 'manuscript', 'manuscript.md'), 'utf8')).toBe('')
    // Flat layout: four files, no sections/ directory (feature-plan-7 §1).
    expect((await readdir(join(target, 'manuscript'))).sort()).toEqual([
      'authors.json',
      'manuscript.json',
      'manuscript.md',
      'references.bib'
    ])
    const authors = AuthorsFileSchema.parse(
      JSON.parse(await readFile(join(target, 'manuscript', 'authors.json'), 'utf8'))
    )
    expect(authors.authors).toHaveLength(1)
    expect(authors.affiliations).toHaveLength(1)

    const gitEntries = await readdir(join(target, '.git'))
    expect(gitEntries.length).toBeGreaterThan(0)
  })

  it('writes the starter demo manuscript for scaffold "starter"', async () => {
    const result = await scaffoldProject({
      dir: target,
      name: 'Starter Paper',
      activeProfileId: 'nature',
      scaffold: 'starter',
      settings: {}
    })
    expect(result.warnings).toEqual([])
    const prose = await readFile(join(target, 'manuscript', 'manuscript.md'), 'utf8')
    expect(prose).toContain('Hello,\n\nThis starter manuscript')
    // One file, three sections: an unheaded intro plus two Markdown headings.
    expect(outlineFromMarkdown(prose).map((s) => [s.level, s.title])).toEqual([
      [0, ''],
      [1, 'Results'],
      [1, 'Methods']
    ])
    const manuscript = ManuscriptSchema.parse(
      JSON.parse(await readFile(join(target, 'manuscript', 'manuscript.json'), 'utf8'))
    )
    expect(manuscript.manuscriptFile).toBe('manuscript.md')
  })

  it('starter: every embed and citation in the prose has something real behind it', async () => {
    await scaffoldProject({
      dir: target,
      name: 'Starter Paper',
      activeProfileId: 'suna',
      scaffold: 'starter',
      settings: {}
    })
    const read = (...parts: string[]): Promise<string> => readFile(join(target, ...parts), 'utf8')
    const prose = await read('manuscript', 'manuscript.md')
    const manuscript = ManuscriptSchema.parse(JSON.parse(await read('manuscript', 'manuscript.json')))

    // The figure the prose embeds is registered AND present on disk — a
    // starter that ships a dangling ![[fig:…]] teaches the wrong lesson.
    expect(prose).toContain('![[fig:hello]]')
    expect(manuscript.figures.map((f) => f.id)).toEqual(['hello'])
    const svg = await read(manuscript.figures[0]!.canvasRef)
    expect(svg).toContain('<svg')
    const figureDoc = JSON.parse(await read('figures', 'hello', 'figure.json')) as { id: string }
    expect(figureDoc.id).toBe('hello')

    // Same for the table and both citations.
    expect(prose).toContain('![[tbl:hello]]')
    expect(manuscript.tables.map((t) => t.id)).toEqual(['hello'])
    const bib = await read('manuscript', 'references.bib')
    for (const key of ['knuth1984', 'wong2011']) {
      expect(prose).toContain(`@${key}`)
      expect(bib).toContain(`{${key},`)
    }
  })

  it('writes the requested project-level settings block onto the manifest', async () => {
    const result = await scaffoldProject({
      dir: target,
      name: 'Configured Paper',
      activeProfileId: 'nature',
      scaffold: 'blank',
      settings: { editor: { contentWidthCh: 90, fontSizePx: 18 } }
    })
    expect(result.manifest.settings).toEqual({ editor: { contentWidthCh: 90, fontSizePx: 18 } })
  })
})

describe('the starter scaffold ships a letter and a review round', () => {
  let parent = ''
  let target = ''

  beforeEach(async () => {
    parent = await mkdtemp(join(tmpdir(), 'suna-starter-'))
    target = join(parent, 'starter-paper')
  })

  afterEach(async () => {
    await rm(parent, { recursive: true, force: true })
  })

  async function makeStarter(): Promise<void> {
    await scaffoldProject({
      dir: target,
      name: 'My Starter Paper',
      activeProfileId: 'science',
      scaffold: 'starter',
      settings: {}
    })
  }

  it('declares a registry naming the manuscript and the letter', async () => {
    await makeStarter()
    const manifest = SunaProjectManifestSchema.parse(
      JSON.parse(await readFile(join(target, 'suna.json'), 'utf8'))
    )
    const docs = resolveDocuments(manifest)
    expect(docs.map((d) => `${d.id}:${d.kind}`)).toEqual(['manuscript:manuscript', 'cover:cover-letter'])
    // Every registered prose/meta path is a file that actually exists — a
    // registry pointing at nothing is a project that fails to open.
    for (const doc of docs) {
      const paths = documentPaths(join(target, DEFAULT_PROJECT_DIRS.manuscript), doc)
      if (paths.prose !== null) expect((await readFile(paths.prose, 'utf8')).length).toBeGreaterThan(0)
      if (paths.meta !== null) expect((await readFile(paths.meta, 'utf8')).length).toBeGreaterThan(0)
    }
  })

  it('writes a letter whose answered assertion is placed and whose unanswered one is marked', async () => {
    await makeStarter()
    const dirName = join(target, DEFAULT_PROJECT_DIRS.manuscript, 'letters')
    const meta = CoverLetterMetaSchema.parse(JSON.parse(await readFile(join(dirName, 'cover.json'), 'utf8')))
    const prose = await readFile(join(dirName, 'cover.md'), 'utf8')

    expect(meta.targetProfileId).toBe('science')
    expect(meta.covers[0]?.title).toBe('My Starter Paper')

    // Both are placed as directives…
    for (const a of meta.assertions) expect(prose).toContain(`::assert{${a.id}}`)
    // …but exactly one is answered, and the other shows the marker the
    // checker looks for. A starter that answered both would teach nothing.
    expect(meta.assertions.filter((a) => a.text !== null).map((a) => a.id)).toEqual([
      'competingInterests'
    ])
    expect(unansweredIn(prose)).toEqual(['dataLocation'])
  })

  it('ships a confidential sidecar, and ignores it before writing it', async () => {
    await makeStarter()
    expect(await readFile(join(target, '.gitignore'), 'utf8')).toContain(
      LETTER_PRIVATE_GITIGNORE_LINE
    )
    const dirName = join(target, DEFAULT_PROJECT_DIRS.manuscript, 'letters')
    const priv = LetterPrivateSchema.parse(
      JSON.parse(await readFile(join(dirName, 'cover.private.json'), 'utf8'))
    )
    expect(priv.suggestedReviewers.length).toBeGreaterThan(0)
    // A bare name is not a case an editor can act on, so the demonstration
    // exclusion carries the reason a real one has to carry.
    expect(priv.excludedReviewers.length).toBeGreaterThan(0)
    for (const r of priv.excludedReviewers) expect(r.reason).not.toBeNull()
    // The names are jokes; what matters is that the file the letter points at
    // is really there, and that the letter says where it is.
    const prose = await readFile(join(dirName, 'cover.md'), 'utf8')
    expect(prose).toContain('cover.private.json')
  })

  it('writes a round whose reviewer points are faithful slices of the source', async () => {
    await makeStarter()
    const roundsDir = join(target, 'rounds')
    const index = RoundsIndexSchema.parse(JSON.parse(await readFile(join(roundsDir, 'index.json'), 'utf8')))
    expect(index.rounds).toEqual(['round-1'])

    const round = RoundSchema.parse(
      JSON.parse(await readFile(join(roundsDir, 'round-1', 'round.json'), 'utf8'))
    )
    const names = (await readdir(join(roundsDir, 'round-1', 'reviewers'))).sort()
    expect(names).toEqual(['1.json', '2.json', '3.json'])

    const pointIds: string[] = []
    for (const name of names) {
      const report = ReviewerReportSchema.parse(
        JSON.parse(await readFile(join(roundsDir, 'round-1', 'reviewers', name), 'utf8'))
      )
      expect(reportIsFaithful(report)).toBe(true)
      for (const p of report.points) {
        expect(report.sourceText.slice(p.from, p.to)).toBe(p.verbatim)
        pointIds.push(p.id)
      }
    }

    // Every point has state, and the round arrives part-answered so the tab
    // opens on a real counter rather than an empty one.
    expect(round.pointStates.map((s) => s.pointId).sort()).toEqual([...pointIds].sort())
    const written = round.pointStates.filter((s) => s.status !== 'unaddressed')
    expect(written.length).toBeGreaterThan(1)
    for (const s of written) expect(s.reply.length).toBeGreaterThan(0)
    // All four statuses are demonstrated — a starter that only ever showed
    // Done would quietly teach that conceding is the only move.
    expect(new Set(round.pointStates.map((s) => s.status))).toEqual(
      new Set(['unaddressed', 'drafted', 'done', 'rebutted'])
    )
    // Some point still needs answering, so the completeness check has
    // something to report the first time the response is exported.
    expect(round.pointStates.some((s) => s.status === 'unaddressed')).toBe(true)

    // A reply that links into the manuscript links to text that is really
    // there — the export resolves the quote against the live document.
    const prose = await readFile(
      join(target, DEFAULT_PROJECT_DIRS.manuscript, 'manuscript.md'),
      'utf8'
    )
    for (const state of round.pointStates) {
      for (const link of state.links) {
        expect(link.documentId).toBe('manuscript')
        expect(prose).toContain(link.quote)
      }
    }
  })

  it('gives no other scaffold a registry, a letter or a round', async () => {
    for (const scaffold of ['blank', 'document'] as const) {
      const dirName = join(parent, `plain-${scaffold}`)
      await scaffoldProject({
        dir: dirName,
        name: 'Plain',
        activeProfileId: 'science',
        scaffold,
        settings: {}
      })
      const raw = await readFile(join(dirName, 'suna.json'), 'utf8')
      // Absent, not empty: a manifest with `documents: []` is a different
      // thing on disk from one that never mentions documents at all.
      expect(raw).not.toContain('documents')
      await expect(readdir(join(dirName, 'rounds'))).rejects.toThrow()
      await expect(
        readdir(join(dirName, DEFAULT_PROJECT_DIRS.manuscript, 'letters'))
      ).rejects.toThrow()
    }
  })
})
