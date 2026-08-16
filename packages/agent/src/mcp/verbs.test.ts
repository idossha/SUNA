import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PROJECT_DIRS } from '@suna/core'
import {
  callTool,
  listOutline,
  readManuscript,
  readManuscriptMeta,
  readSection,
  TOOLS,
  writeManuscript,
  writeSection
} from './verbs'
import type { ProjectContext } from './project'

/**
 * feature-plan-7 §1 realignment: the manuscript is one flat manuscript.md
 * (no more manuscript/sections/*.md), so `read_section`/`write_section`
 * become thin aliases over `read_manuscript`/`write_manuscript`, and
 * `list_outline`/the byline in `read_manuscript_meta` are new.
 */

let dir = ''
let ctx: ProjectContext

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'suna-mcp-verbs-'))
  await mkdir(join(dir, 'manuscript'), { recursive: true })
  await writeFile(
    join(dir, 'manuscript', 'manuscript.json'),
    JSON.stringify({ manuscriptFile: 'manuscript.md' }),
    'utf8'
  )
  await writeFile(
    join(dir, 'manuscript', 'manuscript.md'),
    '# Introduction\n\nHello world.\n\n# Results\n\nMore text follows here.\n',
    'utf8'
  )
  await writeFile(
    join(dir, 'manuscript', 'authors.json'),
    JSON.stringify({ schemaVersion: 1, authors: [], affiliations: [] }, null, 2),
    'utf8'
  )
  ctx = { root: dir, name: 'test', activeProfileId: null, dirs: { ...DEFAULT_PROJECT_DIRS } }
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('readManuscript / writeManuscript', () => {
  it('reads the file named by manuscript.json\'s manuscriptFile', async () => {
    expect(await readManuscript(ctx)).toContain('Hello world.')
  })

  it('falls back to manuscript.md when manuscript.json has no manuscriptFile field', async () => {
    await writeFile(join(dir, 'manuscript', 'manuscript.json'), '{}', 'utf8')
    expect(await readManuscript(ctx)).toContain('Hello world.')
  })

  it('falls back to manuscript.md when manuscript.json does not exist at all', async () => {
    await rm(join(dir, 'manuscript', 'manuscript.json'))
    expect(await readManuscript(ctx)).toContain('Hello world.')
  })

  it('overwrites the whole prose file', async () => {
    const out = await writeManuscript(ctx, '# New\n\nReplaced.\n')
    expect(out).toContain('manuscript.md')
    expect(await readFile(join(dir, 'manuscript', 'manuscript.md'), 'utf8')).toBe('# New\n\nReplaced.\n')
  })
})

describe('read_section / write_section (deprecated aliases)', () => {
  it('ignore the given path and read the whole manuscript file', async () => {
    expect(await readSection(ctx, 'sections/01-intro.md')).toContain('Hello world.')
  })

  it('ignore the given path and overwrite the whole manuscript file', async () => {
    await writeSection(ctx, 'sections/01-intro.md', 'Replaced entirely.\n')
    expect(await readFile(join(dir, 'manuscript', 'manuscript.md'), 'utf8')).toBe('Replaced entirely.\n')
  })
})

describe('listOutline', () => {
  it('lists headings with depth and word counts', async () => {
    const out = await listOutline(ctx)
    expect(out).toContain('Introduction')
    expect(out).toContain('Results')
    expect(out).toMatch(/\d+ words?/)
  })

  it('reports an empty manuscript rather than an empty string', async () => {
    await writeFile(join(dir, 'manuscript', 'manuscript.md'), '', 'utf8')
    expect(await listOutline(ctx)).toBe('no sections (empty manuscript)')
  })

  it('lists an untitled leading section when the prose starts before any heading', async () => {
    await writeFile(join(dir, 'manuscript', 'manuscript.md'), 'Lead-in prose with no heading yet.\n', 'utf8')
    expect(await listOutline(ctx)).toContain('(untitled leading section)')
  })
})

describe('readManuscriptMeta', () => {
  it('surfaces both manuscript.json and authors.json', async () => {
    const out = await readManuscriptMeta(ctx)
    expect(out).toContain('manuscript.json:')
    expect(out).toContain('authors.json:')
    expect(out).toContain('schemaVersion')
  })

  it('falls back to an empty authors.json when the file does not exist yet', async () => {
    await rm(join(dir, 'manuscript', 'authors.json'))
    const out = await readManuscriptMeta(ctx)
    expect(out).toContain('"authors": []')
    expect(out).toContain('"affiliations": []')
  })
})

describe('callTool dispatch', () => {
  it('routes read_manuscript / write_manuscript end to end', async () => {
    expect(await callTool(dir, 'read_manuscript', {})).toContain('Hello world.')
    await callTool(dir, 'write_manuscript', { content: 'Replaced.\n' })
    expect(await readFile(join(dir, 'manuscript', 'manuscript.md'), 'utf8')).toBe('Replaced.\n')
  })

  it('routes list_outline end to end', async () => {
    expect(await callTool(dir, 'list_outline', {})).toContain('Introduction')
  })

  it('routes the deprecated read_section/write_section names to the whole file', async () => {
    expect(await callTool(dir, 'read_section', { path: 'sections/anything.md' })).toContain('Hello world.')
    await callTool(dir, 'write_section', { path: 'sections/anything.md', content: 'via alias\n' })
    expect(await readFile(join(dir, 'manuscript', 'manuscript.md'), 'utf8')).toBe('via alias\n')
  })
})

describe('TOOLS', () => {
  it('lists the new manuscript verbs and keeps the deprecated aliases', () => {
    const names = TOOLS.map((t) => t.name)
    expect(names).toContain('read_manuscript')
    expect(names).toContain('write_manuscript')
    expect(names).toContain('list_outline')
    expect(names).toContain('read_section')
    expect(names).toContain('write_section')
  })
})
