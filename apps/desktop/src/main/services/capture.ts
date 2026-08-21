/**
 * Region capture and the dev-only "Repair this UI" bundle (feature-plan-8
 * §2b): the services behind 'app:capture-rect', 'app:dev-info' and
 * 'ai:repair-bundle'. The capture feeds the canvas Agent section — the gold
 * selection overlay stays visible in the shot on purpose, it is how the
 * agent learns what "the selection" means — and the repair bundle is the
 * on-disk half of every UI report, present whether or not an agent CLI ever
 * runs (the bundle IS the fallback).
 */
import { BrowserWindow, app, type IpcMainInvokeEvent } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { CaptureRect } from '@suna/core'
import { pngDimensions } from './export-content'
import { allowRoot, assertInsideAllowedRoot } from './roots'

/**
 * Clamp a CSS-px rect to the window's content size. Clamps EDGES rather than
 * the origin+size pair, so a rect hanging off the top-left loses the overhang
 * instead of sliding inward. Edges are rounded to integers (capturePage wants
 * an integral Rectangle); a rect fully outside collapses to zero width or
 * height, which the caller must refuse.
 */
export function clampRect(
  rect: CaptureRect,
  content: { width: number; height: number }
): CaptureRect {
  const left = Math.min(Math.max(rect.x, 0), content.width)
  const top = Math.min(Math.max(rect.y, 0), content.height)
  const right = Math.min(Math.max(rect.x + rect.width, left), content.width)
  const bottom = Math.min(Math.max(rect.y + rect.height, top), content.height)
  const x = Math.round(left)
  const y = Math.round(top)
  return { x, y, width: Math.round(right) - x, height: Math.round(bottom) - y }
}

/**
 * Filesystem-safe bundle slug: lowercased, every non-alphanumeric run becomes
 * one '-', capped at 40 chars, and never empty ('report' when nothing
 * survives — the timestamp already makes the directory name unique).
 */
export function sanitizeSlug(slug: string): string {
  const clean = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return clean === '' ? 'report' : clean
}

/** `<yyyymmdd-hhmmss>-<slug>` in LOCAL time, so bug-reports/ sorts chronologically for whoever reads it. */
export function bundleDirName(slug: string, when: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp =
    `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}` +
    `-${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`
  return `${stamp}-${sanitizeSlug(slug)}`
}

/**
 * Where a capture goes when the caller names no target: outside any project,
 * and the ONLY directory 'ai:screen-ask-bundle' will adopt a shot from. A
 * screen-ask captures before its composer is on screen and moves the file
 * into the bundle afterwards, so that adoption needs a boundary — this is it.
 */
export function captureTempDir(): string {
  return join(tmpdir(), 'suna-captures')
}

/**
 * 'app:capture-rect': screenshot a region of the SENDER's window. `rect` is
 * CSS px in page coordinates — capturePage takes DIP, which equals CSS px
 * here. The response size is decoded from the written PNG, not echoed from
 * the rect: on a HiDPI display the PNG is rect × devicePixelRatio.
 */
export async function captureRect(
  event: IpcMainInvokeEvent,
  { rect, targetPath }: { rect: CaptureRect; targetPath?: string }
): Promise<{ path: string; width: number; height: number }> {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win === null) throw new Error('no window found for this capture request')
  const [contentWidth, contentHeight] = win.getContentSize()
  const clamped = clampRect(rect, { width: contentWidth ?? 0, height: contentHeight ?? 0 })
  if (clamped.width === 0 || clamped.height === 0) {
    throw new Error('capture rect lies entirely outside the window')
  }
  // An explicit target is root-confined like every other renderer-directed
  // write; the default lives under the OS temp dir, outside any project.
  const path =
    targetPath !== undefined
      ? assertInsideAllowedRoot(targetPath)
      : join(captureTempDir(), `cap-${Date.now()}.png`)
  const image = await event.sender.capturePage(clamped)
  const png = image.toPNG()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, png)
  const { width, height } = pngDimensions(png)
  return { path, width, height }
}

/**
 * 'app:dev-info'. The repo-root seam mirrors agentLayer.ts's: in dev the app
 * path is <checkout>/apps/desktop, two levels below the SUNA source repo.
 */
export function devInfo(): { isDev: boolean; repoRoot: string | null } {
  if (app.isPackaged) return { isDev: false, repoRoot: null }
  return { isDev: true, repoRoot: resolve(app.getAppPath(), '..', '..') }
}

/**
 * 'ai:repair-bundle': write <repoRoot>/bug-reports/<stamp>-<slug>/ with
 * context.json (verbatim) and, when `rect` is given, shot.png. Main writes
 * the bundle and nothing else — the renderer composes prompt text and sends
 * it back through 'ai:ask', keeping one writer per artifact.
 */
export async function repairBundle(
  event: IpcMainInvokeEvent,
  { slug, contextJson, rect }: { slug: string; contextJson: string; rect?: CaptureRect }
): Promise<{ bundleDir: string; shotPath: string | null }> {
  const { isDev, repoRoot } = devInfo()
  if (!isDev || repoRoot === null) {
    throw new Error('UI repair is dev-only — a packaged app has no source repo to fix')
  }
  // The follow-up 'ai:ask' runs with dir = repoRoot; allow-listing it here is
  // what lets that call (and the shot write below) pass root confinement.
  allowRoot(repoRoot)
  const bundleDir = join(repoRoot, 'bug-reports', bundleDirName(slug, new Date()))
  await mkdir(bundleDir, { recursive: true })
  // context.json first: the report must reach disk even if the capture fails.
  await writeFile(join(bundleDir, 'context.json'), contextJson, 'utf8')
  let shotPath: string | null = null
  if (rect !== undefined) {
    try {
      const shot = await captureRect(event, { rect, targetPath: join(bundleDir, 'shot.png') })
      shotPath = shot.path
    } catch (error) {
      console.warn('repair bundle screenshot failed (bundle written without it):', error)
    }
  }
  return { bundleDir, shotPath }
}
