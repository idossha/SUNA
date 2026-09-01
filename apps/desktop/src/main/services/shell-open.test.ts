import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shell } from 'electron'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isRefusedForOpen, openPathWithOs, revealPath } from './shell-open'
import { allowRoot } from './roots'

/**
 * The whole point of this file: a test run must NEVER open a Finder window or
 * launch an application on the developer's screen (ARCHITECTURE §5.3). Both
 * shell entry points are mocked the way fs.test.ts mocks trashItem, and every
 * assertion stops at "was the OS asked, and with what".
 */
vi.mock('electron', () => ({
  shell: { showItemInFolder: vi.fn(), openPath: vi.fn(async () => '') }
}))

let root = ''
let outside = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'suna-shell-root-'))
  outside = await mkdtemp(join(tmpdir(), 'suna-shell-outside-'))
  allowRoot(root)
  vi.mocked(shell.showItemInFolder).mockClear()
  vi.mocked(shell.openPath).mockClear()
  vi.mocked(shell.openPath).mockResolvedValue('')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe('isRefusedForOpen', () => {
  const file = (path: string, mode = 0o644): Parameters<typeof isRefusedForOpen>[0] => ({
    path,
    isDirectory: false,
    mode
  })

  it('refuses every launchable extension', () => {
    for (const ext of ['.app', '.command', '.pkg', '.dmg', '.scpt', '.workflow', '.term']) {
      expect(isRefusedForOpen(file(`/work/paper/installer${ext}`))).toBe(true)
    }
  })

  it('matches the extension case-insensitively', () => {
    expect(isRefusedForOpen(file('/work/paper/Installer.PKG'))).toBe(true)
    expect(isRefusedForOpen(file('/work/paper/Script.Scpt'))).toBe(true)
  })

  it('refuses a launchable bundle even though it is a directory on disk', () => {
    // .app and .workflow are directories; the extension test has to win.
    expect(isRefusedForOpen({ path: '/work/paper/Thing.app', isDirectory: true, mode: 0o755 })).toBe(
      true
    )
    expect(
      isRefusedForOpen({ path: '/work/paper/Clean.workflow', isDirectory: true, mode: 0o755 })
    ).toBe(true)
  })

  it('allows a plain directory despite its execute bit', () => {
    // 0o755 is the ordinary mode of a folder — refusing it would break the
    // "open this folder in Finder" case the feature exists for.
    expect(isRefusedForOpen({ path: '/work/paper/figures', isDirectory: true, mode: 0o755 })).toBe(
      false
    )
  })

  it('refuses any file carrying the owner-execute bit', () => {
    expect(isRefusedForOpen(file('/work/paper/run', 0o755))).toBe(true)
    expect(isRefusedForOpen(file('/work/paper/run', 0o744))).toBe(true)
    expect(isRefusedForOpen(file('/work/paper/run', 0o100))).toBe(true)
  })

  it('allows an ordinary data file, including one that is only group/other executable', () => {
    expect(isRefusedForOpen(file('/work/paper/figure.svg'))).toBe(false)
    expect(isRefusedForOpen(file('/work/paper/notes.md', 0o600))).toBe(false)
    expect(isRefusedForOpen(file('/work/paper/table.csv', 0o011))).toBe(false)
    expect(isRefusedForOpen(file('/work/paper/README'))).toBe(false)
  })

  it('allows extensions that merely look scary but open in a viewer', () => {
    expect(isRefusedForOpen(file('/work/paper/build.sh'))).toBe(false)
    expect(isRefusedForOpen(file('/work/paper/analysis.py'))).toBe(false)
  })
})

describe('revealPath', () => {
  it('hands a real in-project path to the file manager', async () => {
    const path = join(root, 'fig.svg')
    await writeFile(path, '<svg/>')
    expect(await revealPath(path)).toEqual({ error: null })
    expect(shell.showItemInFolder).toHaveBeenCalledWith(path)
  })

  it('reveals an executable — showing a file cannot run it', async () => {
    const path = join(root, 'run.command')
    await writeFile(path, '#!/bin/sh\n')
    expect(await revealPath(path)).toEqual({ error: null })
    expect(shell.showItemInFolder).toHaveBeenCalledWith(path)
  })

  it('refuses a path outside every open project root without asking the OS', async () => {
    await writeFile(join(outside, 'secret.pdf'), 'x')
    await expect(revealPath(join(outside, 'secret.pdf'))).rejects.toThrow(
      /outside any open project/
    )
    expect(shell.showItemInFolder).not.toHaveBeenCalled()
  })

  it('says so when the entry is gone rather than silently doing nothing', async () => {
    const result = await revealPath(join(root, 'vanished.md'))
    expect(result.error).toMatch(/no longer on disk: vanished\.md/)
    expect(shell.showItemInFolder).not.toHaveBeenCalled()
  })
})

describe('openPathWithOs', () => {
  it('opens an ordinary file and maps the empty-string success sentinel to null', async () => {
    const path = join(root, 'notes.md')
    await writeFile(path, '# notes')
    expect(await openPathWithOs(path)).toEqual({ error: null })
    expect(shell.openPath).toHaveBeenCalledWith(path)
  })

  it('passes an OS failure message through unchanged', async () => {
    const path = join(root, 'notes.md')
    await writeFile(path, '# notes')
    vi.mocked(shell.openPath).mockResolvedValue('no application knows how to open this file')
    expect(await openPathWithOs(path)).toEqual({
      error: 'no application knows how to open this file'
    })
  })

  it('opens a directory — that is the Finder window the user asked for', async () => {
    const path = join(root, 'figures')
    await mkdir(path, { recursive: true })
    expect(await openPathWithOs(path)).toEqual({ error: null })
    expect(shell.openPath).toHaveBeenCalledWith(path)
  })

  it('refuses a launchable bundle and never asks the OS', async () => {
    const path = join(root, 'Installer.app')
    await mkdir(path, { recursive: true })
    const result = await openPathWithOs(path)
    expect(result.error).toMatch(/refusing to open an executable with the OS: Installer\.app/)
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('refuses a file made executable on disk, whatever its extension', async () => {
    // The concrete case: an agent writes a script into the project and the user
    // double-clicks it in the explorer.
    const path = join(root, 'collect-data')
    await writeFile(path, '#!/bin/sh\nrm -rf ~\n')
    await chmod(path, 0o755)
    const result = await openPathWithOs(path)
    expect(result.error).toMatch(/refusing to open an executable with the OS: collect-data/)
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('refuses a path outside every open project root without asking the OS', async () => {
    await writeFile(join(outside, 'secret.pdf'), 'x')
    await expect(openPathWithOs(join(outside, 'secret.pdf'))).rejects.toThrow(
      /outside any open project/
    )
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('says so when the entry is gone', async () => {
    const result = await openPathWithOs(join(root, 'vanished.md'))
    expect(result.error).toMatch(/no longer on disk: vanished\.md/)
    expect(shell.openPath).not.toHaveBeenCalled()
  })
})
