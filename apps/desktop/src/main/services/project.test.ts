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
  listImportableFiles,
  scaffoldProject,
  updateProjectSettings
} from './project'
import { allowRoot } from './roots'

let dir = ''
let manifestFile = ''

const baseManifest = {
  schemaVersion: 1,
  name: 'my-paper',
  activeProfileId: 'nature-astronomy',
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

describe('listImportableFiles', () => {
  it('finds .md/.tex/.bib files (including nested), skipping .git and everything else', async () => {
    const src = await mkdtemp(join(tmpdir(), 'suna-import-src-'))
    await writeFile(join(src, 'intro.md'), '# intro')
    await writeFile(join(src, 'paper.tex'), '\\documentclass{article}')
    await writeFile(join(src, 'refs.bib'), '@article{a,}')
    await writeFile(join(src, 'notes.txt'), 'not imported')
    await mkdir(join(src, '.git'))
    await writeFile(join(src, '.git', 'HEAD'), 'ref: refs/heads/main')
    await mkdir(join(src, 'sub'))
    await writeFile(join(src, 'sub', 'appendix.md'), '# appendix')

    const files = await listImportableFiles(src)
    expect(files.map((f) => f.name).sort()).toEqual([
      'appendix.md',
      'intro.md',
      'paper.tex',
      'refs.bib'
    ])
    expect(files.every((f) => f.path.startsWith(src))).toBe(true)
    expect(files.find((f) => f.name === 'refs.bib')?.ext).toBe('bib')
    await rm(src, { recursive: true, force: true })
  })

  it('returns an empty list for a directory with nothing importable', async () => {
    const src = await mkdtemp(join(tmpdir(), 'suna-import-empty-'))
    await writeFile(join(src, 'data.csv'), 'a,b\n1,2')
    expect(await listImportableFiles(src)).toEqual([])
    await rm(src, { recursive: true, force: true })
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
        activeProfileId: 'nature-astronomy',
        scaffold: 'blank',
        importDir: null,
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
      importDir: null,
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
      activeProfileId: 'nature-astronomy',
      scaffold: 'starter',
      importDir: null,
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
      importDir: null,
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
      activeProfileId: 'nature-astronomy',
      scaffold: 'blank',
      importDir: null,
      settings: { editor: { contentWidthCh: 90, fontSizePx: 18 } }
    })
    expect(result.manifest.settings).toEqual({ editor: { contentWidthCh: 90, fontSizePx: 18 } })
  })

  it('copies imported files into manuscript/imported and points bibliography at the imported .bib', async () => {
    const importSrc = await mkdtemp(join(tmpdir(), 'suna-import-src-'))
    await writeFile(join(importSrc, 'draft.md'), '# Draft')
    await writeFile(join(importSrc, 'refs.bib'), '@article{a,}')

    const result = await scaffoldProject({
      dir: target,
      name: 'Imported Paper',
      activeProfileId: 'nature-astronomy',
      scaffold: 'import',
      importDir: importSrc,
      settings: {}
    })
    expect(result.warnings).toEqual([])
    const imported = await readdir(join(target, 'manuscript', 'imported'))
    expect(imported.sort()).toEqual(['draft.md', 'refs.bib'])
    const manuscript = ManuscriptSchema.parse(
      JSON.parse(await readFile(join(target, 'manuscript', 'manuscript.json'), 'utf8'))
    )
    expect(manuscript.bibliography).toBe('imported/refs.bib')

    await rm(importSrc, { recursive: true, force: true })
  })

  it('warns instead of failing when the import folder has nothing importable', async () => {
    const importSrc = await mkdtemp(join(tmpdir(), 'suna-import-empty-'))
    const result = await scaffoldProject({
      dir: target,
      name: 'Empty Import',
      activeProfileId: 'nature-astronomy',
      scaffold: 'import',
      importDir: importSrc,
      settings: {}
    })
    expect(result.warnings).toEqual([`No .md/.tex/.bib files found in ${importSrc}`])
    const manuscript = ManuscriptSchema.parse(
      JSON.parse(await readFile(join(target, 'manuscript', 'manuscript.json'), 'utf8'))
    )
    expect(manuscript.bibliography).toBe('references.bib')
    await rm(importSrc, { recursive: true, force: true })
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
      importDir: null,
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

  it('ignores the confidential letter sidecar before any letter is written', async () => {
    await makeStarter()
    expect(await readFile(join(target, '.gitignore'), 'utf8')).toContain(
      LETTER_PRIVATE_GITIGNORE_LINE
    )
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
    expect(names).toEqual(['1.json', '2.json'])

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

    // Every point has state, and exactly one arrives answered so the tab
    // opens on a real counter rather than an empty one.
    expect(round.pointStates.map((s) => s.pointId).sort()).toEqual([...pointIds].sort())
    const done = round.pointStates.filter((s) => s.status === 'done')
    expect(done).toHaveLength(1)
    expect(done[0]?.reply.length).toBeGreaterThan(0)
  })

  it('gives no other scaffold a registry, a letter or a round', async () => {
    for (const scaffold of ['blank', 'import'] as const) {
      const dirName = join(parent, `plain-${scaffold}`)
      await scaffoldProject({
        dir: dirName,
        name: 'Plain',
        activeProfileId: 'science',
        scaffold,
        importDir: null,
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
