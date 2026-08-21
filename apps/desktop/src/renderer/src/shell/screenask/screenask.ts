/**
 * "Ask the agent about this screen" — the whole flow behind ⌘⇧A and the
 * palette's `AI: Ask about this screen…` command.
 *
 *   ⌘⇧A → screenshot the window → composer → Send → bundle on disk →
 *   an interactive agent CLI in a floating terminal, first turn = prompt.md
 *
 * Three things about that order are deliberate.
 *
 * **The shot is taken before the composer exists.** A screenshot with the
 * "what would you like to ask?" box in the middle of it documents the box,
 * not the screen. So the capture goes to the temp capture dir at invoke time
 * and 'ai:screen-ask-bundle' adopts the file afterwards, rather than the
 * bundle taking its own picture at Send time.
 *
 * **The terminal is interactive, not headless.** Every other AI action in
 * the app runs through 'ai:ask' and reports one answer. This one is for the
 * two cases where one answer is never enough — a developer iterating on the
 * UI, an author pushing a figure around — so it spawns a real `claude`
 * session the user can keep talking to, and hands it the prompt as its first
 * turn. The floating window is the point: it sits OVER the thing being
 * discussed, where the bottom strip would cover it.
 *
 * **The bundle is written whether or not a CLI ever runs.** shot.png,
 * context.md and prompt.md are a complete, readable record on their own —
 * the same discipline ai:repair-bundle follows, for the same reason.
 */
import { create } from 'zustand'
import { screenAskPrompt } from '../../ai/templates'
import { activeRoundId, openPanelSummaries } from '../../state/dock'
import { useProjectStore } from '../../state/project'
import { resolvePreviewProfileId, useRenderProfileStore } from '../../state/renderProfile'
import { useEditorSettings } from '../../editor/settings'
import { useUiStore } from '../../state/ui'
import { adoptTerminalTab, closeTerminalTab, createTerminalTab } from '../../terminal/sessions'
import { contextMarkdown, type ScreenContextInput } from './context'

export type ShotKind = 'window' | 'region' | 'none'

export type ScreenAskPhase =
  | { kind: 'idle' }
  /** Dragging a rectangle. The window shot is kept as the fallback if they cancel. */
  | { kind: 'region'; shotPath: string | null; shotKind: ShotKind }
  | {
      kind: 'compose'
      /** Temp-dir PNG the bundle will adopt; null when the capture failed. */
      shotPath: string | null
      shotKind: ShotKind
      sending: boolean
      error: string | null
    }

interface ScreenAskState {
  phase: ScreenAskPhase
  set: (phase: ScreenAskPhase) => void
}

export const useScreenAskStore = create<ScreenAskState>((set) => ({
  phase: { kind: 'idle' },
  set: (phase) => set({ phase })
}))

/** The floating terminal's own state: one session at a time, or none. */
interface FloatTerminalState {
  termId: string | null
  /** Absolute bundle dir behind the open session — shown in its title bar. */
  bundleDir: string | null
  minimized: boolean
  /**
   * Set when the window went away without the user closing it — the session
   * died, or main forgot the pty we tried to re-adopt. Carries the bundle
   * dir, because that is the part worth keeping: the shot, the context and
   * the prompt are on disk whether or not any CLI ever ran.
   */
  lostBundleDir: string | null
}

export const useFloatTerminalStore = create<FloatTerminalState>(() => ({
  termId: null,
  bundleDir: null,
  minimized: false,
  lostBundleDir: null
}))

/* --------------------------------------------------- surviving a reload -- */

/**
 * What the floating window needs in order to come back.
 *
 * The pty lives in the MAIN process and is killed only when the app quits;
 * everything the UI knew about it lived in the store above, which a renderer
 * reload wipes. That mismatch is what made a running agent vanish with no
 * way to reach it, so the pty id goes somewhere a reload cannot touch.
 */
const SESSION_KEY = 'suna.floatTerminal.session'

interface PersistedSession {
  ptyId: string
  bundleDir: string | null
}

function rememberSession(session: PersistedSession | null): void {
  try {
    if (session === null) window.localStorage.removeItem(SESSION_KEY)
    else window.localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // best-effort: the window still works for the life of this renderer
  }
}

function recallSession(): PersistedSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as Record<string, unknown>
    if (typeof record['ptyId'] !== 'string' || record['ptyId'] === '') return null
    const bundleDir = record['bundleDir']
    return { ptyId: record['ptyId'], bundleDir: typeof bundleDir === 'string' ? bundleDir : null }
  } catch {
    return null
  }
}

/**
 * Called once at startup. Re-adopts the agent session if its pty is still
 * alive; otherwise forgets it — and, when we had one to lose, leaves a note
 * pointing at the bundle so the ask is never simply gone.
 */
export async function restoreFloatTerminal(): Promise<void> {
  const remembered = recallSession()
  if (remembered === null) return
  const termId = await adoptTerminalTab({
    ptyId: remembered.ptyId,
    title: 'Ask about this screen',
    surface: 'float'
  })
  if (termId === null) {
    rememberSession(null)
    useFloatTerminalStore.setState({ lostBundleDir: remembered.bundleDir })
    return
  }
  useFloatTerminalStore.setState({
    termId,
    bundleDir: remembered.bundleDir,
    minimized: false,
    lostBundleDir: null
  })
}

/** Forget the running session (the caller has already ended or lost it). */
export function forgetFloatTerminal(lostBundleDir: string | null = null): void {
  rememberSession(null)
  useFloatTerminalStore.setState({
    termId: null,
    bundleDir: null,
    minimized: false,
    lostBundleDir
  })
}

/**
 * `AI: Show the agent terminal` — un-collapse and re-reveal the window.
 * The command exists because "I can't find it" needs an answer that is not
 * "start another ask": a second ask replaces the first, ending a
 * conversation the user only wanted to look at again.
 */
export function showFloatTerminal(): void {
  if (useFloatTerminalStore.getState().termId === null) return
  useFloatTerminalStore.setState({ minimized: false })
  resetFloatTerminalGeometry()
}

/**
 * Set by FloatingTerminal so the command above can put a window that drifted
 * somewhere unhelpful back in its default corner.
 */
let resetGeometry: (() => void) | null = null

export function setFloatGeometryReset(reset: (() => void) | null): void {
  resetGeometry = reset
}

export function resetFloatTerminalGeometry(): void {
  resetGeometry?.()
}

/* ------------------------------------------------------------- pure bits -- */

/**
 * Which repository the agent is cd'd into.
 *
 * A packaged app is somebody writing a paper: the answer is their project,
 * always. A dev run is somebody working on SUNA itself, and what they point
 * at is the app's own UI — so it is the checkout. Build type is the proxy for
 * "who is holding the keyboard", which is the question that actually decides
 * this. Kept as one pure function precisely because that proxy is a policy
 * choice and policies get revisited.
 *
 * A dev run with no checkout to be found (or a project-less packaged run)
 * falls back to whichever root does exist; null means neither does, and the
 * caller refuses the ask rather than running an agent in some arbitrary cwd.
 */
export function screenAskTarget(input: {
  isDev: boolean
  repoRoot: string | null
  rootDir: string | null
}): { target: 'project' | 'repo'; cwd: string } | null {
  if (input.isDev && input.repoRoot !== null) return { target: 'repo', cwd: input.repoRoot }
  if (input.rootDir !== null) return { target: 'project', cwd: input.rootDir }
  if (input.repoRoot !== null) return { target: 'repo', cwd: input.repoRoot }
  return null
}

/**
 * POSIX single-quoting, for the one command line this feature builds. Both
 * paths in it are app-generated, but "app-generated" is not "safe": a project
 * living under a directory with an apostrophe in its name would otherwise
 * produce a command that silently runs the wrong thing.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * `cd <cwd> && claude "$(cat <promptPath>)"`.
 *
 * The prompt is delivered through `cat` rather than inlined: it carries the
 * user's own words plus a context block with newlines and quotes in it, and
 * argv is the wrong place for either. `cd` is explicit because the pty
 * inherits the PROJECT as its cwd (terminal/sessions.ts), which is the wrong
 * directory for a repo-target ask.
 */
export function screenAskCommand(cwd: string, promptPath: string, cli: string): string {
  return `cd ${shellQuote(cwd)} && ${cli} "$(cat ${shellQuote(promptPath)})"`
}

/** Full-window capture rect, in the page coordinates 'app:capture-rect' wants. */
export function windowRect(): { x: number; y: number; width: number; height: number } {
  return {
    x: window.scrollX,
    y: window.scrollY,
    width: window.innerWidth,
    height: window.innerHeight
  }
}

/* ------------------------------------------------------------------ flow -- */

/** Two frames, so anything React is unmounting is really gone before we shoot. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

async function captureTo(
  rect: { x: number; y: number; width: number; height: number }
): Promise<string | null> {
  if (rect.width < 1 || rect.height < 1) return null
  try {
    const shot = await window.suna.invoke('app:capture-rect', { rect })
    return shot.path
  } catch (error) {
    console.warn('screen-ask capture failed:', error)
    return null
  }
}

/**
 * Entry point for the command and the shortcut. Shoots first — the palette
 * that launched this is still unmounting, and a shot of the palette would
 * document the palette — then opens the composer.
 */
export async function startScreenAsk(): Promise<void> {
  useScreenAskStore.getState().set({
    kind: 'compose',
    shotPath: null,
    shotKind: 'none',
    sending: false,
    error: null
  })
  await nextPaint()
  const shotPath = await captureTo(windowRect())
  const phase = useScreenAskStore.getState().phase
  // The user may have hit Escape while the capture was in flight.
  if (phase.kind !== 'compose') return
  useScreenAskStore
    .getState()
    .set({ ...phase, shotPath, shotKind: shotPath === null ? 'none' : 'window' })
}

/** "Region ⌥R": hide the composer, let them drag, come back with a tighter shot. */
export function startRegionPick(): void {
  const phase = useScreenAskStore.getState().phase
  if (phase.kind !== 'compose') return
  useScreenAskStore
    .getState()
    .set({ kind: 'region', shotPath: phase.shotPath, shotKind: phase.shotKind })
}

/** Region drag finished. A null rect (cancelled) keeps the window shot. */
export async function finishRegionPick(
  rect: { x: number; y: number; width: number; height: number } | null
): Promise<void> {
  const phase = useScreenAskStore.getState().phase
  if (phase.kind !== 'region') return
  const back = (shotPath: string | null, shotKind: ShotKind): void => {
    useScreenAskStore.getState().set({ kind: 'compose', shotPath, shotKind, sending: false, error: null })
  }
  if (rect === null) {
    back(phase.shotPath, phase.shotKind)
    return
  }
  await nextPaint()
  const shotPath = await captureTo(rect)
  back(shotPath ?? phase.shotPath, shotPath === null ? phase.shotKind : 'region')
}

export function cancelScreenAsk(): void {
  useScreenAskStore.getState().set({ kind: 'idle' })
}

/** Everything the context block needs, read from the stores at Send time. */
function gatherContext(
  target: 'project' | 'repo',
  cwd: string,
  shotKind: ShotKind
): ScreenContextInput {
  const project = useProjectStore.getState()
  const rootDir = project.rootDir
  const profileId =
    rootDir === null
      ? null
      : resolvePreviewProfileId(
          useRenderProfileStore.getState().byProject[rootDir],
          project.manifest?.activeProfileId ?? null
        )
  return {
    target,
    cwd,
    rootDir,
    projectName: project.manifest?.name ?? null,
    panels: openPanelSummaries().map((panel) => ({
      component: panel.component,
      title: panel.title,
      path: panel.path,
      active: panel.active
    })),
    activeView: useUiStore.getState().activeView,
    activeRoundId: activeRoundId(),
    profileId,
    editorTheme: useEditorSettings.getState().editorTheme,
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    shot: shotKind,
    platform: window.suna.platform
  }
}

/**
 * Write the bundle and start the session. Errors surface IN the composer
 * rather than the status bar: the user is looking straight at it, and a
 * failure they can retype into is better than one that closes the box and
 * leaves a note at the bottom of the screen.
 */
export async function sendScreenAsk(question: string): Promise<void> {
  const trimmed = question.trim()
  const phase = useScreenAskStore.getState().phase
  if (trimmed === '' || phase.kind !== 'compose' || phase.sending) return
  const fail = (message: string): void => {
    const current = useScreenAskStore.getState().phase
    if (current.kind === 'compose') {
      useScreenAskStore.getState().set({ ...current, sending: false, error: message })
    }
  }
  useScreenAskStore.getState().set({ ...phase, sending: true, error: null })

  try {
    const dev = await window.suna.invoke('app:dev-info', {})
    const rootDir = useProjectStore.getState().rootDir
    const resolved = screenAskTarget({ isDev: dev.isDev, repoRoot: dev.repoRoot, rootDir })
    if (resolved === null) {
      fail('Open a project first — there is nowhere for the agent to work.')
      return
    }
    const contextInput = gatherContext(resolved.target, resolved.cwd, phase.shotKind)
    const contextMd = contextMarkdown(contextInput)

    // The bundle opens first: the prompt quotes the absolute shot.png path,
    // and only main knows where the adopted capture landed.
    const bundle = await window.suna.invoke('ai:screen-ask-bundle', {
      target: resolved.target,
      ...(resolved.target === 'project' ? { dir: resolved.cwd } : {}),
      contextMd,
      ...(phase.shotPath === null ? {} : { shotFrom: phase.shotPath })
    })

    const promptPath = `${bundle.bundleDir}/prompt.md`
    await window.suna.invoke('fs:write-text', {
      path: promptPath,
      content: screenAskPrompt({
        target: resolved.target,
        bundleDir: bundle.bundleDir,
        shotPath: bundle.shotPath,
        contextMd,
        question: trimmed
      })
    })

    const { available } = await window.suna.invoke('lit:cli-status', {})
    if (!available.includes('claude')) {
      fail(
        `No Claude Code CLI on PATH. The screenshot and prompt are saved at ${bundle.bundleDir} — install \`claude\` and run it there.`
      )
      return
    }

    // One floating terminal, one conversation. A second ask replaces the
    // first rather than stacking windows — and the outgoing pty is killed
    // here, because dropping its id from the store would leave a `claude`
    // process running with nothing on screen attached to it.
    const previous = useFloatTerminalStore.getState().termId
    if (previous !== null) closeTerminalTab(previous)
    const termId = createTerminalTab({
      command: screenAskCommand(resolved.cwd, promptPath, 'claude'),
      title: 'Ask about this screen',
      surface: 'float',
      // Remembered as soon as the pty exists, so a reload one second later
      // can still find it.
      onPty: (ptyId) => rememberSession({ ptyId, bundleDir: bundle.bundleDir })
    })
    useFloatTerminalStore.setState({
      termId,
      bundleDir: bundle.bundleDir,
      minimized: false,
      lostBundleDir: null
    })
    useScreenAskStore.getState().set({ kind: 'idle' })
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
}
