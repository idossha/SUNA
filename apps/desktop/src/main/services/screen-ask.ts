/**
 * "Ask the agent about this screen": the on-disk half of one screen-ask run.
 *
 * A run is a directory holding three files — shot.png (what the user was
 * looking at), context.md (what the app knew it was showing) and prompt.md
 * (the composed instruction, the user's words included). The renderer then
 * starts an interactive agent CLI in a floating terminal whose first turn is
 * `prompt.md`, so the whole exchange is a normal Claude Code session the user
 * can keep talking to.
 *
 * Main opens the directory and puts the two things only it can produce into
 * it — the screenshot, and the context the renderer handed over. prompt.md is
 * written by the renderer afterwards, through 'fs:write-text', because it
 * quotes the paths this call returns and cannot be composed before them. One
 * writer per artifact, as with ai:repair-bundle, and for the same reason: the
 * bundle stays a complete, readable record even when no CLI is installed. The
 * bundle IS the fallback.
 *
 * Two targets, decided by build not by the user (the app knows which it is):
 *   'project' — a packaged app, or any run with a project open: the bundle
 *               lands in <project>/.suna/screen-asks/, already git-ignored
 *               and already hidden from the file tree (fs.ts IGNORED_NAMES).
 *   'repo'    — a dev run with no project in play: the bundle lands in the
 *               SUNA checkout so the agent can fix the UI it is looking at.
 */
import { copyFile, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { ensureGitignoreLine } from '@suna/agent'
import { SUNA_DIR } from '@suna/core'
import { captureTempDir, devInfo } from './capture'
import { allowRoot, assertInsideAllowedRoot } from './roots'

/** Directory holding every run for one root. */
export const SCREEN_ASKS_DIR = 'screen-asks'

/**
 * `<yyyymmdd-hhmmss>` in LOCAL time — the runs sort chronologically for
 * whoever opens the folder later, and two asks in the same second are the
 * one collision worth accepting for a name a human can read.
 */
export function screenAskDirName(when: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}` +
    `-${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`
  )
}

export interface ScreenAskBundleRequest {
  target: 'project' | 'repo'
  /** Required for 'project'; ignored for 'repo', which main resolves itself. */
  dir?: string
  contextMd: string
  /**
   * A shot already taken by 'app:capture-rect' into the temp capture dir,
   * moved in here as shot.png. It is taken BEFORE the composer opens — a
   * screenshot with the "what would you like to ask?" box sitting in the
   * middle of it would document the composer, not the screen — so the bundle
   * adopts a file rather than taking its own picture. Omitted when the
   * capture failed; the bundle is still written.
   */
  shotFrom?: string
}

/**
 * The one directory a shot may be adopted from. `shotFrom` is a renderer-
 * supplied path and root confinement does not cover the temp dir, so it gets
 * its own boundary: without this, 'ai:screen-ask-bundle' would copy any file
 * on disk into a project and hand its path to an agent.
 */
function assertTempCapture(path: string): string {
  const abs = resolve(path)
  const dir = captureTempDir()
  if (abs !== dir && !abs.startsWith(dir + sep)) {
    throw new Error('a screen-ask shot must be a capture under the temp capture directory')
  }
  return abs
}

/**
 * The root a bundle may be written under. A renderer-supplied `dir` is
 * root-confined like every other renderer-directed write; the 'repo' target
 * takes NO path from the renderer at all — main resolves the checkout from
 * devInfo() and allow-lists it, so a compromised renderer cannot name a
 * directory here that it could not already write to.
 */
function resolveBase(request: ScreenAskBundleRequest): string {
  if (request.target === 'repo') {
    const { isDev, repoRoot } = devInfo()
    if (!isDev || repoRoot === null) {
      throw new Error('the repo target is dev-only — a packaged app has no source checkout')
    }
    allowRoot(repoRoot)
    return repoRoot
  }
  if (request.dir === undefined) throw new Error('a project screen-ask needs a project directory')
  return assertInsideAllowedRoot(request.dir)
}

/**
 * 'ai:screen-ask-bundle'. Writes context.md first so the record reaches disk
 * even if the shot does not, then moves the already-taken capture in as
 * shot.png. A missing shot is reported as `shotPath: null` rather than
 * thrown: an ask with no picture is degraded, not dead — the prompt names the
 * screenshot only when there is one.
 */
export async function screenAskBundle(
  request: ScreenAskBundleRequest
): Promise<{ bundleDir: string; shotPath: string | null }> {
  const base = resolveBase(request)
  const bundleDir = join(base, SUNA_DIR, SCREEN_ASKS_DIR, screenAskDirName(new Date()))
  // Same guard the trash uses before it writes under `.suna/`: additive and
  // best-effort, so an ask never fails over a .gitignore line. It matters
  // most for the 'repo' target, whose checkout has no reason to have listed
  // `.suna/` before this feature existed.
  await ensureGitignoreLine(base, `${SUNA_DIR}/`).catch(() => undefined)
  await mkdir(bundleDir, { recursive: true })
  await writeFile(join(bundleDir, 'context.md'), request.contextMd, 'utf8')
  let shotPath: string | null = null
  if (request.shotFrom !== undefined) {
    // Outside the try on purpose: a path that is not a capture is a bug or an
    // attack, not a degraded screenshot, and it should be loud.
    const from = assertTempCapture(request.shotFrom)
    const to = join(bundleDir, 'shot.png')
    try {
      // rename, copy+unlink on EXDEV — the temp dir and the project are
      // routinely on different volumes. Same fallback trash.ts uses.
      await rename(from, to).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EXDEV') throw error
        await copyFile(from, to)
        await unlink(from).catch(() => undefined)
      })
      shotPath = to
    } catch (error) {
      console.warn('screen-ask shot could not be adopted (bundle written without it):', error)
    }
  }
  return { bundleDir, shotPath }
}
