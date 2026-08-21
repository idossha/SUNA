import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/**
 * screen-ask.ts reaches electron only through capture.ts's devInfo/
 * captureTempDir, both of which this mock covers — so the whole bundle path
 * IS testable here, unlike capture.ts's own capturePage half. The temp
 * capture dir is redirected into a scratch directory so the confinement check
 * can be exercised for real rather than asserted about.
 */
const CAPTURE_DIR = join(tmpdir(), 'suna-screen-ask-test-captures')

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/checkout/apps/desktop' },
  BrowserWindow: { fromWebContents: () => null }
}))

vi.mock('./capture', () => ({
  captureTempDir: () => CAPTURE_DIR,
  devInfo: () => devInfoResult
}))

vi.mock('@suna/agent', () => ({
  ensureGitignoreLine: async () => undefined
}))

let devInfoResult: { isDev: boolean; repoRoot: string | null } = {
  isDev: false,
  repoRoot: null
}

const { screenAskBundle, screenAskDirName } = await import('./screen-ask')
const { allowRoot } = await import('./roots')

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'suna-screen-ask-'))
}

async function stagedShot(name: string): Promise<string> {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(CAPTURE_DIR, { recursive: true })
  const path = join(CAPTURE_DIR, name)
  await writeFile(path, 'not-really-a-png')
  return path
}

describe('screenAskDirName', () => {
  it('is a sortable local-time stamp', () => {
    expect(screenAskDirName(new Date(2026, 7, 21, 9, 4, 5))).toBe('20260821-090405')
  })

  it('pads every field, so string order is chronological order', () => {
    const early = screenAskDirName(new Date(2026, 0, 2, 3, 4, 5))
    const later = screenAskDirName(new Date(2026, 0, 2, 13, 4, 5))
    expect(early).toBe('20260102-030405')
    expect(early < later).toBe(true)
  })
})

describe('screenAskBundle', () => {
  it('writes context.md under .suna/screen-asks and adopts the shot', async () => {
    const root = await scratch()
    allowRoot(root)
    const from = await stagedShot('cap-adopt.png')
    const result = await screenAskBundle({
      target: 'project',
      dir: root,
      contextMd: '# What the user is looking at\n',
      shotFrom: from
    })
    expect(result.bundleDir.startsWith(join(root, '.suna', 'screen-asks'))).toBe(true)
    expect(result.shotPath).toBe(join(result.bundleDir, 'shot.png'))
    expect(await readFile(join(result.bundleDir, 'context.md'), 'utf8')).toContain(
      'What the user is looking at'
    )
    // Moved, not copied: the temp capture must not outlive the ask.
    await expect(readFile(from, 'utf8')).rejects.toThrow()
  })

  it('still writes the record when no shot was captured', async () => {
    const root = await scratch()
    allowRoot(root)
    const result = await screenAskBundle({ target: 'project', dir: root, contextMd: 'facts' })
    expect(result.shotPath).toBeNull()
    expect(await readFile(join(result.bundleDir, 'context.md'), 'utf8')).toBe('facts')
  })

  it('refuses a shot from outside the temp capture directory, loudly', async () => {
    const root = await scratch()
    allowRoot(root)
    const outside = join(root, 'secret.png')
    await writeFile(outside, 'private')
    // A shot that is not a capture is a bug or an attack, never a degraded
    // screenshot — so this throws where a failed MOVE only warns. The file it
    // was pointed at stays exactly where it was.
    await expect(
      screenAskBundle({ target: 'project', dir: root, contextMd: 'facts', shotFrom: outside })
    ).rejects.toThrow(/temp capture directory/)
    expect(await readFile(outside, 'utf8')).toBe('private')
  })

  it('refuses a project write outside every open root', async () => {
    const stranger = await scratch()
    await expect(
      screenAskBundle({ target: 'project', dir: join(stranger, 'nope'), contextMd: 'facts' })
    ).rejects.toThrow(/outside any open project/)
  })

  it('needs a directory for a project ask', async () => {
    await expect(screenAskBundle({ target: 'project', contextMd: 'facts' })).rejects.toThrow(
      /needs a project directory/
    )
  })

  it('takes no path from the caller for a repo ask, and allow-lists the checkout itself', async () => {
    const repo = await scratch()
    devInfoResult = { isDev: true, repoRoot: repo }
    const result = await screenAskBundle({
      target: 'repo',
      dir: '/somewhere/else/entirely',
      contextMd: 'facts'
    })
    expect(result.bundleDir.startsWith(join(repo, '.suna', 'screen-asks'))).toBe(true)
    devInfoResult = { isDev: false, repoRoot: null }
  })

  it('refuses a repo ask when packaged', async () => {
    devInfoResult = { isDev: false, repoRoot: null }
    await expect(screenAskBundle({ target: 'repo', contextMd: 'facts' })).rejects.toThrow(
      /dev-only/
    )
  })
})
