import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertRepoPath,
  gitApplyHunk,
  gitCommit,
  gitDiffFile,
  gitDiscard,
  gitInit,
  gitStage,
  gitStatus,
  gitUnstage,
  parseDiffHunks,
  parsePorcelainZ
} from './git'
import { allowRoot } from './roots'

const run = promisify(execFile)

describe('parsePorcelainZ', () => {
  const z = (...entries: string[]): string => entries.join('\0') + '\0'

  it('puts an index-only change on the staged side', () => {
    const { staged, unstaged } = parsePorcelainZ(z('M  paper.md'))
    expect(staged).toEqual([{ path: 'paper.md', status: 'modified' }])
    expect(unstaged).toEqual([])
  })

  it('puts a worktree-only change on the unstaged side', () => {
    const { staged, unstaged } = parsePorcelainZ(z(' M paper.md'))
    expect(staged).toEqual([])
    expect(unstaged).toEqual([{ path: 'paper.md', status: 'modified' }])
  })

  it('lists a file staged AND edited again on both sides', () => {
    const { staged, unstaged } = parsePorcelainZ(z('MM paper.md'))
    expect(staged).toEqual([{ path: 'paper.md', status: 'modified' }])
    expect(unstaged).toEqual([{ path: 'paper.md', status: 'modified' }])
  })

  it('treats untracked as unstaged only', () => {
    const { staged, unstaged } = parsePorcelainZ(z('?? new.md'))
    expect(staged).toEqual([])
    expect(unstaged).toEqual([{ path: 'new.md', status: 'untracked' }])
  })

  it('lists a conflict once, as a conflict, on neither index nor worktree twice', () => {
    const { staged, unstaged } = parsePorcelainZ(z('UU paper.md'))
    expect(staged).toEqual([])
    expect(unstaged).toEqual([{ path: 'paper.md', status: 'conflicted' }])
  })

  it('consumes the origin path that follows a rename entry', () => {
    const { staged, unstaged } = parsePorcelainZ(z('R  new.md', 'old.md', ' M other.md'))
    expect(staged).toEqual([{ path: 'new.md', status: 'renamed' }])
    // 'old.md' must not be mistaken for its own entry
    expect(unstaged).toEqual([{ path: 'other.md', status: 'modified' }])
  })
})

describe('parseDiffHunks', () => {
  const diff = [
    'diff --git a/paper.md b/paper.md',
    'index 111..222 100644',
    '--- a/paper.md',
    '+++ b/paper.md',
    '@@ -1,3 +1,4 @@',
    ' one',
    '+added near the top',
    ' two',
    ' three',
    '@@ -20,3 +21,4 @@',
    ' twenty',
    '+added near the bottom',
    ' twentyone',
    ''
  ].join('\n')

  it('separates the file header from the hunks', () => {
    const parsed = parseDiffHunks(diff)
    expect(parsed.fileHeader).toContain('diff --git a/paper.md b/paper.md')
    expect(parsed.fileHeader).not.toContain('@@')
    expect(parsed.hunks).toHaveLength(2)
  })

  it('keeps each hunk\u2019s own header and body together', () => {
    const parsed = parseDiffHunks(diff)
    expect(parsed.hunks[0]?.header).toBe('@@ -1,3 +1,4 @@')
    expect(parsed.hunks[0]?.text).toContain('added near the top')
    expect(parsed.hunks[0]?.text).not.toContain('added near the bottom')
    expect(parsed.hunks[1]?.text).toContain('added near the bottom')
  })

  it('stops at a second file\u2019s diff', () => {
    const two = `${diff}diff --git a/other.md b/other.md\n@@ -1 +1,2 @@\n+elsewhere\n`
    const parsed = parseDiffHunks(two)
    expect(parsed.hunks).toHaveLength(2)
    expect(parsed.hunks[1]?.text).not.toContain('elsewhere')
  })

  it('reports no hunks for an empty diff', () => {
    expect(parseDiffHunks('').hunks).toEqual([])
  })
})

describe('assertRepoPath', () => {
  it('refuses an escape out of the repository', () => {
    expect(() => assertRepoPath('/work/paper', '../secrets.txt')).toThrow()
  })

  it('refuses a path git would read as an option', () => {
    expect(() => assertRepoPath('/work/paper', '--cached')).toThrow(/may not start with/)
  })
})

/** Staging against a real repository — the plumbing is the thing under test. */
describe('staging', () => {
  let dir: string

  const write = (name: string, text: string): Promise<void> =>
    writeFile(join(dir, name), text, 'utf8')

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'suna-staging-'))
    allowRoot(dir)
    await write('paper.md', '# Title\n')
    await write('notes.md', 'notes\n')
    await gitInit(dir)
    await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    await run('git', ['config', 'user.name', 'Test'], { cwd: dir })
    await run('git', ['commit', '--allow-empty', '-m', 'base'], { cwd: dir })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('stages one file and leaves the others alone', async () => {
    await write('paper.md', '# Title\n\nEdit.\n')
    await write('notes.md', 'notes\nmore\n')

    await gitStage(dir, ['paper.md'])
    const status = await gitStatus(dir)
    expect(status.staged.map((c) => c.path)).toEqual(['paper.md'])
    expect(status.unstaged.map((c) => c.path)).toEqual(['notes.md'])
  })

  it('shows a file on both sides once it is edited again after staging', async () => {
    await write('paper.md', '# Title\n\nOne.\n')
    await gitStage(dir, ['paper.md'])
    await write('paper.md', '# Title\n\nOne.\nTwo.\n')

    const status = await gitStatus(dir)
    expect(status.staged.map((c) => c.path)).toEqual(['paper.md'])
    expect(status.unstaged.map((c) => c.path)).toEqual(['paper.md'])
  })

  it('gives each side its own diff', async () => {
    await write('paper.md', '# Title\n\nStaged line.\n')
    await gitStage(dir, ['paper.md'])
    await write('paper.md', '# Title\n\nStaged line.\nWorktree line.\n')

    const staged = await gitDiffFile(dir, 'paper.md', 'staged')
    const unstaged = await gitDiffFile(dir, 'paper.md', 'unstaged')
    expect(staged.diff).toContain('Staged line.')
    expect(staged.diff).not.toContain('Worktree line.')
    expect(unstaged.diff).toContain('Worktree line.')
  })

  it('shows an untracked file as wholly added rather than a blank diff', async () => {
    await write('fresh.md', 'brand new\n')
    const { diff } = await gitDiffFile(dir, 'fresh.md', 'unstaged')
    expect(diff).toContain('brand new')
  })

  it('unstages without touching the working tree', async () => {
    await write('paper.md', '# Title\n\nEdit.\n')
    await gitStage(dir, ['paper.md'])
    await gitUnstage(dir, ['paper.md'])

    const status = await gitStatus(dir)
    expect(status.staged).toEqual([])
    expect(status.unstaged.map((c) => c.path)).toEqual(['paper.md'])
    expect(await readFile(join(dir, 'paper.md'), 'utf8')).toContain('Edit.')
  })

  it('unstages a file staged before the first commit exists', async () => {
    const fresh = await mkdtemp(join(tmpdir(), 'suna-staging-empty-'))
    allowRoot(fresh)
    try {
      await run('git', ['init', '-b', 'main', fresh])
      await writeFile(join(fresh, 'a.md'), 'a\n', 'utf8')
      await gitStage(fresh, ['a.md'])
      expect((await gitStatus(fresh)).staged.map((c) => c.path)).toEqual(['a.md'])

      // No HEAD to reset against — this is the `rm --cached` path.
      await gitUnstage(fresh, ['a.md'])
      const status = await gitStatus(fresh)
      expect(status.staged).toEqual([])
      expect(status.unstaged).toEqual([{ path: 'a.md', status: 'untracked' }])
    } finally {
      await rm(fresh, { recursive: true, force: true })
    }
  })

  it('commits only what is staged', async () => {
    await write('paper.md', '# Title\n\nIn the commit.\n')
    await write('notes.md', 'not in the commit\n')
    await gitStage(dir, ['paper.md'])

    await gitCommit(dir, 'Only the paper', false)
    const status = await gitStatus(dir)
    expect(status.staged).toEqual([])
    expect(status.unstaged.map((c) => c.path)).toEqual(['notes.md'])
  })

  it('discards a tracked file back to the index, keeping the staged version', async () => {
    await write('paper.md', '# Title\n\nStaged.\n')
    await gitStage(dir, ['paper.md'])
    await write('paper.md', '# Title\n\nStaged.\nUnwanted.\n')

    const res = await gitDiscard(dir, ['paper.md'], false)
    expect(res.reverted).toEqual(['paper.md'])
    const text = await readFile(join(dir, 'paper.md'), 'utf8')
    expect(text).toContain('Staged.')
    expect(text).not.toContain('Unwanted.')
  })

  it('deletes an untracked file only when told to', async () => {
    await write('scratch.md', 'temporary\n')

    const kept = await gitDiscard(dir, ['scratch.md'], false)
    expect(kept.deleted).toEqual([])
    expect(existsSync(join(dir, 'scratch.md'))).toBe(true)

    const removed = await gitDiscard(dir, ['scratch.md'], true)
    expect(removed.deleted).toEqual(['scratch.md'])
    expect(existsSync(join(dir, 'scratch.md'))).toBe(false)
  })

  it('stages one hunk and leaves the rest of the file unstaged', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`)
    await write('long.md', `${lines.join('\n')}\n`)
    await gitStage(dir, ['long.md'])
    await gitCommit(dir, 'add long file', false)

    // Two edits, far enough apart to be separate hunks.
    const edited = [...lines]
    edited[1] = 'line 2 CHANGED AT TOP'
    edited[27] = 'line 28 CHANGED AT BOTTOM'
    await write('long.md', `${edited.join('\n')}\n`)
    expect(parseDiffHunks((await gitDiffFile(dir, 'long.md', 'unstaged')).diff).hunks).toHaveLength(2)

    await gitApplyHunk(dir, 'long.md', 0, 'stage')

    const staged = await gitDiffFile(dir, 'long.md', 'staged')
    expect(staged.diff).toContain('CHANGED AT TOP')
    expect(staged.diff).not.toContain('CHANGED AT BOTTOM')

    const unstaged = await gitDiffFile(dir, 'long.md', 'unstaged')
    expect(unstaged.diff).toContain('CHANGED AT BOTTOM')
    expect(unstaged.diff).not.toContain('CHANGED AT TOP')

    // and the file on disk still has both edits — staging never rewrites it
    const text = await readFile(join(dir, 'long.md'), 'utf8')
    expect(text).toContain('CHANGED AT TOP')
    expect(text).toContain('CHANGED AT BOTTOM')
  })

  it('unstages one hunk back out of the index', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`)
    await write('long.md', `${lines.join('\n')}\n`)
    await gitStage(dir, ['long.md'])
    await gitCommit(dir, 'add long file', false)

    const edited = [...lines]
    edited[1] = 'line 2 TOP'
    edited[27] = 'line 28 BOTTOM'
    await write('long.md', `${edited.join('\n')}\n`)
    await gitStage(dir, ['long.md'])

    await gitApplyHunk(dir, 'long.md', 0, 'unstage')
    const staged = await gitDiffFile(dir, 'long.md', 'staged')
    expect(staged.diff).not.toContain('TOP')
    expect(staged.diff).toContain('BOTTOM')
  })

  it('discards one hunk from the working tree, keeping the other edit', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`)
    await write('long.md', `${lines.join('\n')}\n`)
    await gitStage(dir, ['long.md'])
    await gitCommit(dir, 'add long file', false)

    const edited = [...lines]
    edited[1] = 'line 2 KEEP'
    edited[27] = 'line 28 THROW AWAY'
    await write('long.md', `${edited.join('\n')}\n`)

    await gitApplyHunk(dir, 'long.md', 1, 'discard')
    const text = await readFile(join(dir, 'long.md'), 'utf8')
    expect(text).toContain('KEEP')
    expect(text).not.toContain('THROW AWAY')
  })

  it('refuses a hunk index that no longer exists', async () => {
    await write('paper.md', '# Title\n\nOne edit.\n')
    await expect(gitApplyHunk(dir, 'paper.md', 7, 'stage')).rejects.toThrow(/no longer there/)
  })

  it('refuses to act on a path outside the repository', async () => {
    await expect(gitStage(dir, ['../escape.md'])).rejects.toThrow()
    await expect(gitDiscard(dir, ['../escape.md'], true)).rejects.toThrow()
  })
})
