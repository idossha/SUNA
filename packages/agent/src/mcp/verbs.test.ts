import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PROJECT_DIRS } from '@suna/core'
import {
  callTool,
  checkManuscriptCompliance,
  editManuscript,
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

/**
 * feature-plan-11 §11d. The race: the agent reads the manuscript, thinks for
 * half a minute, and writes the whole file back — while the author has been
 * typing in SUNA the entire time. A blind overwrite erases their paragraphs
 * with nothing anywhere recording that it happened.
 */
describe('writeManuscript — compare-and-swap against a stale read', () => {
  const prose = () => readFile(join(dir, 'manuscript', 'manuscript.md'), 'utf8')

  it('allows a write when nothing moved since the read', async () => {
    await readManuscript(ctx)
    await writeManuscript(ctx, '# New\n\nReplaced.\n')
    expect(await prose()).toBe('# New\n\nReplaced.\n')
  })

  it('refuses a write when the file changed after the read, and changes nothing', async () => {
    await readManuscript(ctx)
    // the author types in SUNA while the agent is still thinking
    await writeFile(join(dir, 'manuscript', 'manuscript.md'), '# Introduction\n\nHello world, edited by a human.\n', 'utf8')

    await expect(writeManuscript(ctx, '# Agent\n\nWholesale rewrite.\n')).rejects.toThrow(
      /changed on disk after you read it/
    )
    expect(await prose()).toContain('edited by a human')
  })

  it('names the recovery in the refusal, so the agent can act on it', async () => {
    await readManuscript(ctx)
    await writeFile(join(dir, 'manuscript', 'manuscript.md'), 'moved\n', 'utf8')
    await expect(writeManuscript(ctx, 'x\n')).rejects.toThrow(/edit_manuscript/)
  })

  it('allows a first write from a session that never read the file', async () => {
    // Nothing to be stale against — refusing here would break legitimate
    // wholesale authoring.
    await writeManuscript(ctx, '# Fresh\n\nWritten blind.\n')
    expect(await prose()).toBe('# Fresh\n\nWritten blind.\n')
  })

  it('does not mistake our OWN edit_manuscript for someone else\'s change', async () => {
    await readManuscript(ctx)
    await editManuscript(ctx, 'Hello world.', 'Hello galaxy.')
    await writeManuscript(ctx, '# After\n\nOur own sequence.\n')
    expect(await prose()).toBe('# After\n\nOur own sequence.\n')
  })

  it('does not mistake our own previous write either', async () => {
    await readManuscript(ctx)
    await writeManuscript(ctx, 'first\n')
    await writeManuscript(ctx, 'second\n')
    expect(await prose()).toBe('second\n')
  })
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

describe('editManuscript', () => {
  it('replaces a unique match and names the containing section', async () => {
    const out = await editManuscript(ctx, 'Hello world.', 'Hello there, world.')
    expect(out).toContain('section "Introduction"')
    expect(await readFile(join(dir, 'manuscript', 'manuscript.md'), 'utf8')).toContain(
      'Hello there, world.'
    )
  })

  it('rejects a find that matches nothing, hinting when only whitespace differs', async () => {
    await expect(editManuscript(ctx, 'Hello  world.', 'x')).rejects.toThrow(
      /ignoring whitespace/
    )
    await expect(editManuscript(ctx, 'not in the file', 'x')).rejects.toThrow(
      /matched nothing/
    )
  })

  it('rejects an ambiguous find, listing each match with context', async () => {
    await writeFile(
      join(dir, 'manuscript', 'manuscript.md'),
      '# A\n\nthe result\n\n# B\n\nthe result\n',
      'utf8'
    )
    await expect(editManuscript(ctx, 'the result', 'x')).rejects.toThrow(/matched at 2 positions/)
  })

  it('routes through callTool', async () => {
    const out = await callTool(dir, 'edit_manuscript', {
      find: 'More text follows here.',
      replace: 'Rewritten.'
    })
    expect(out).toContain('section "Results"')
  })
})

describe('checkManuscriptCompliance', () => {
  /** Minimal schema-valid manuscript.json, the starter scaffold's shape. */
  const meta = {
    title: 'T',
    articleType: 'article',
    doi: null,
    openAccess: null,
    history: { received: null, accepted: null, publishedOnline: null },
    abstract: { content: 'An abstract.' },
    manuscriptFile: 'manuscript.md',
    figures: [],
    tables: [],
    availability: { data: '', code: '' },
    backMatter: {
      acknowledgements: null,
      authorContributions: null,
      funding: [],
      competingInterests: null,
      peerReview: null,
      supplementaryInfo: null
    },
    bibliography: 'references.bib'
  }

  it('reports "nothing to check" without an active profile', async () => {
    expect(await checkManuscriptCompliance(ctx)).toContain('no active publisher profile')
  })

  it('returns diagnostics (or a compliant verdict) against a bundled profile', async () => {
    await writeFile(join(dir, 'manuscript', 'manuscript.json'), JSON.stringify(meta), 'utf8')
    const out = await checkManuscriptCompliance({ ...ctx, activeProfileId: 'nature-astronomy' })
    // The tiny fixture is under every limit but misses required sections /
    // availability statements — either way the checker must speak, not throw.
    expect(out).toMatch(/compliant with|error |warning /)
  })

  it('routes through callTool', async () => {
    await writeFile(join(dir, 'manuscript', 'manuscript.json'), JSON.stringify(meta), 'utf8')
    expect(await callTool(dir, 'check_manuscript', {})).toMatch(
      /no active publisher profile|compliant with|error |warning /
    )
  })
})

describe('TOOLS', () => {
  it('lists the new manuscript verbs and keeps the deprecated aliases', () => {
    const names = TOOLS.map((t) => t.name)
    expect(names).toContain('read_manuscript')
    expect(names).toContain('write_manuscript')
    expect(names).toContain('edit_manuscript')
    expect(names).toContain('check_manuscript')
    expect(names).toContain('list_outline')
    expect(names).toContain('read_section')
    expect(names).toContain('write_section')
  })
})
