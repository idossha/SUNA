import type { DockviewApi, DockviewGroupPanel, IDockviewPanel } from 'dockview'
import { isFilePanelId, useOpenTabsStore } from './openTabs'

let dockApi: DockviewApi | null = null

/**
 * Push the current set of open file tabs into useOpenTabsStore, which the
 * explorer subscribes to in order to mark open/active rows. Called on every
 * dockview panel event — cheap (a walk of at most a few dozen panels) and far
 * simpler than trying to mirror adds/removes incrementally.
 */
function syncOpenTabs(): void {
  if (!dockApi) return
  const paths = new Set<string>()
  const manuscriptRoots = new Set<string>()
  for (const panel of dockApi.panels) {
    if (isFilePanelId(panel.id)) paths.add(panel.id)
    if (panel.view.contentComponent === 'manuscript') {
      const rootDir = panel.params?.['rootDir']
      if (typeof rootDir === 'string') manuscriptRoots.add(rootDir)
    }
  }
  const active = dockApi.activePanel ?? null
  const activeId = active?.id ?? null
  const activePath = activeId !== null && isFilePanelId(activeId) ? activeId : null
  const activeRoot =
    active !== null && active.view.contentComponent === 'manuscript'
      ? ((active.params?.['rootDir'] as string | undefined) ?? null)
      : null
  useOpenTabsStore.getState().setOpenTabs(paths, activePath, manuscriptRoots, activeRoot)
}

/** The welcome tab: opened once at startup, and again whenever the dock runs
 *  empty (see reopenWelcomeIfEmpty). One id, so it is always a singleton. */
const WELCOME_PANEL = { id: 'welcome', component: 'welcome', title: 'Welcome' }

/**
 * Depth of `withoutWelcomeReopen` calls in progress. A bulk close the APP
 * drives (a project switch, a driver clearing the dock) passes through an
 * empty dock on its way somewhere else; only a close the USER drives should
 * land on the welcome screen.
 */
let welcomeReopenSuppressed = 0

/**
 * Run `fn` with the empty-dock -> welcome reopen suppressed. Re-entrant, and
 * synchronous by design: the reopen fires from dockview's mutation event
 * during `fn`, so a deferred release would come too late.
 */
function withoutWelcomeReopen<T>(fn: () => T): T {
  welcomeReopenSuppressed += 1
  try {
    return fn()
  } finally {
    welcomeReopenSuppressed -= 1
  }
}

/**
 * Closing the last tab returns the user to the welcome screen rather than to
 * dockview's bare watermark — the same screen the app starts on, with the
 * recent-projects list and the "new project"/"open"/"import" entry points.
 *
 * Driven by `onDidMutateLayout`, which fires AFTER the outermost structural
 * change completes: `onDidRemovePanel` fires mid-removal (before the emptied
 * group is torn down), and adding a panel from inside that would race the
 * teardown. Adds/moves fire it too, hence the emptiness check.
 */
function reopenWelcomeIfEmpty(): void {
  if (!dockApi || welcomeReopenSuppressed > 0) return
  if (dockApi.panels.length > 0) return
  dockApi.addPanel({ ...WELCOME_PANEL })
}

export function setDockApi(api: DockviewApi): void {
  dockApi = api
  // Guarded: tests attach partial fakes (and `null` for the no-dock case).
  // Real dockview always emits all four.
  api?.onDidAddPanel?.(syncOpenTabs)
  api?.onDidRemovePanel?.(syncOpenTabs)
  api?.onDidActivePanelChange?.(syncOpenTabs)
  api?.onDidMutateLayout?.(reopenWelcomeIfEmpty)
  syncOpenTabs()
}

/** Split targets we offer: beside the reference group, or under it. */
export type SplitDirection = 'right' | 'below'

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp']

/**
 * Components openViewerInSide treats as replaceable: opening a second PDF in
 * the side group swaps the first out instead of stacking tabs, while an editor
 * the user parked there is left alone.
 */
const VIEWER_COMPONENTS = new Set(['pdf', 'image', 'html', 'docx'])

/** Which dock component owns a file, by extension. Default: the editor. */
export function componentForFile(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.svg')) return 'canvas'
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) return 'dataview'
  if (lower.endsWith('.pdf')) return 'pdf'
  // Exports are meant to be LOOKED at: an .html or .docx in output/ opens as
  // the page/document it is, not as its markup or as a zip the editor cannot
  // read. Both viewers offer the source (HTML) or the real app (Word).
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (lower.endsWith('.docx')) return 'docx'
  if (IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'image'
  return 'editor'
}

function titleForFile(path: string): string {
  return path.split('/').pop() ?? path
}

export function openFileTab(path: string): void {
  if (!dockApi) return
  const existing = dockApi.getPanel(path)
  if (existing) {
    existing.api.setActive()
    return
  }
  dockApi.addPanel({
    id: path,
    component: componentForFile(path),
    title: titleForFile(path),
    params: { path }
  })
}

/** Onboarding wizard entry points (feature-plan-5 §5). */
export interface OnboardingParams {
  mode: 'create' | 'setup'
  /** 'setup' only: the existing folder missing suna.json, run steps 2-7 against it. */
  dir?: string
}

/**
 * Open (or focus) the onboarding wizard tab. One tab per target: a fresh
 * 'create' wizard is singleton (re-opening it just focuses the one in
 * progress), while 'setup' is keyed by directory so setting up two different
 * folders can be in flight as separate tabs.
 */
export function openOnboardingTab(params: OnboardingParams): void {
  if (!dockApi) return
  const id = params.mode === 'setup' && params.dir ? `onboarding:${params.dir}` : 'onboarding:create'
  const existing = dockApi.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  dockApi.addPanel({
    id,
    component: 'onboarding',
    title: params.mode === 'setup' ? 'Set up project' : 'New project',
    params
  })
}

/**
 * Open (or focus) the DOCX Import Review tab (feature-plan-6 §2), keyed by
 * the source file's path so importing two different .docx files can be in
 * flight as separate tabs — same pattern as the onboarding wizard's 'setup'
 * mode being keyed by directory.
 */
export function openDocxImportTab(path: string): void {
  if (!dockApi) return
  const id = `docx-import:${path}`
  const existing = dockApi.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  dockApi.addPanel({
    id,
    component: 'docx-import',
    title: `Import ${path.split('/').pop() ?? path}`,
    params: { path }
  })
}

/** Open (or focus) the global Settings tab. */
export function openSettingsTab(): void {
  if (!dockApi) return
  const existing = dockApi.getPanel('settings')
  if (existing) {
    existing.api.setActive()
    return
  }
  dockApi.addPanel({ id: 'settings', component: 'settings', title: 'Settings' })
}

/**
 * Open (or focus) the project's Trash tab. Keyed by rootDir like the other
 * project-scoped tabs: the trash lives in the project, so a panel left over
 * from the previous project would list files that are not there any more.
 */
export function openTrashTab(rootDir: string): void {
  if (!dockApi) return
  const id = `trash:${rootDir}`
  const existing = dockApi.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  dockApi.addPanel({ id, component: 'trash', title: 'Trash', params: { rootDir } })
}

/** Open (or focus) the cross-paper reading notes tab (ADR-008). */
export function openReadingNotesTab(rootDir: string): void {
  if (!dockApi) return
  const id = `reading-notes:${rootDir}`
  const existing = dockApi.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  dockApi.addPanel({
    id,
    component: 'reading-notes',
    title: 'Reading notes',
    params: { rootDir }
  })
}

/** Open (or focus) the combined manuscript document tab for a project. */
export function openManuscriptTab(rootDir: string): void {
  if (!dockApi) return
  const id = `manuscript:${rootDir}`
  const existing = dockApi.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  dockApi.addPanel({
    id,
    component: 'manuscript',
    title: 'Manuscript',
    params: { rootDir }
  })
}

/**
 * Open (or focus) a document tab by registry id (feature-plan-12 §1).
 *
 * `openManuscriptTab` stays as the alias for the primary document so the
 * three unconditional callers in state/project.ts do not change.
 */
export function openDocumentTab(
  rootDir: string,
  documentId: string,
  kind?: string,
  file?: string | null,
  /** The registry title, for kinds whose tab is named after the document. */
  title?: string
): void {
  if (!dockApi) return
  if (documentId === 'manuscript' || kind === 'manuscript') {
    openManuscriptTab(rootDir)
    return
  }
  // The supplement is a document in its own right (it is written, read and
  // exported like the manuscript), so it gets the manuscript's instrument
  // rather than a raw editor tab.
  if (kind === 'supplement') {
    openSupplementTab(
      rootDir,
      documentId,
      file ?? 'supplementary.md',
      title ?? 'Supplementary Information'
    )
    return
  }
  // A cover letter is the only other kind with a purpose-built tab so far.
  // Every other kind opens its prose in the ordinary editor rather than in a
  // view that does not understand it — an honest fallback beats a tab that
  // renders wrong.
  if (kind !== undefined && kind !== 'cover-letter') {
    if (file != null) openFileTab(`${rootDir}/manuscript/${file}`)
    return
  }
  const id = `document:${rootDir}:${documentId}`
  const existing = dockApi.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  dockApi.addPanel({
    id,
    component: 'letter',
    title: documentId,
    params: { rootDir, documentId }
  })
}

/** Open (or focus) the Supplementary Information tab. */
export function openSupplementTab(
  rootDir: string,
  documentId = 'supplement',
  file = 'supplementary.md',
  title = 'Supplementary Information'
): void {
  if (!dockApi) return
  const id = `document:${rootDir}:${documentId}`
  const existing = dockApi.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  dockApi.addPanel({
    id,
    component: 'supplement',
    title,
    params: { rootDir, documentId, file, title }
  })
}

/**
 * Open (or focus) a logged version, read-only.
 *
 * A separate component from the manuscript tab on purpose: an archived
 * version has no editing surface at all, so there is nothing to disable and
 * no way for a keystroke to reach a file under archive/.
 */
export function openVersionTab(rootDir: string, versionId: string): void {
  if (!dockApi) return
  const id = `version:${rootDir}:${versionId}`
  const existing = dockApi.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  dockApi.addPanel({
    id,
    component: 'version',
    title: versionId,
    params: { rootDir, versionId }
  })
}

/** Open (or focus) the reviewer-comment import screen. */
export function openReviewImportTab(rootDir: string): void {
  if (!dockApi) return
  const id = `review-import:${rootDir}`
  const existing = dockApi.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  dockApi.addPanel({
    id,
    component: 'review-import',
    title: 'Import reviews',
    params: { rootDir }
  })
}

/**
 * Open (or focus) a version comparison (feature-plan-14 §4).
 *
 * One panel per pair of sides, so "Round 2 vs the working copy" and "v1.1 vs
 * v2.1" are two tabs rather than one tab that keeps changing under you — the
 * comparison you had open while writing a reply must still be there when you
 * come back to it.
 */
export function openCompareTab(rootDir: string, base: string, head: string): void {
  if (!dockApi) return
  const id = `compare:${rootDir}:${base}:${head}`
  const existing = dockApi.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  dockApi.addPanel({
    id,
    component: 'compare',
    title: 'Compare',
    params: { rootDir, base, head }
  })
}

/**
 * The same comparison, in the group beside the one you are in — the split the
 * response workspace opens so the reviewer's point, your reply and the change
 * you made for them are all on screen at once.
 */
export function openCompareInSide(rootDir: string, base: string, head: string): void {
  if (!dockApi) return
  const api = dockApi
  const id = `compare:${rootDir}:${base}:${head}`
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  const target = sideGroup()
  if (target) {
    api.addPanel({
      id,
      component: 'compare',
      title: 'Compare',
      params: { rootDir, base, head },
      position: { referenceGroup: target }
    })
    return
  }
  const reference = api.activePanel ?? api.panels[0]
  if (!reference) {
    openCompareTab(rootDir, base, head)
    return
  }
  api.addPanel({
    id,
    component: 'compare',
    title: 'Compare',
    params: { rootDir, base, head },
    position: { referencePanel: reference.id, direction: 'right' }
  })
}

/** Open (or focus) a round's response workspace. */
export function openRoundTab(rootDir: string, roundId: string): void {
  if (!dockApi) return
  const id = `round:${rootDir}:${roundId}`
  const existing = dockApi.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  dockApi.addPanel({
    id,
    component: 'round',
    title: roundId,
    params: { rootDir, roundId }
  })
}

/**
 * Components whose panels point into a specific project's directory —
 * closed by closeProjectTabs (feature-plan-7 §3) when the app switches to a
 * different project, so no stale editor/viewer survives pointing at the
 * directory that is no longer open. The combined manuscript tab is handled
 * separately below since it keys off `params.rootDir`, not a file path.
 */
const PROJECT_SCOPED_PATH_COMPONENTS = new Set([
  'editor',
  'canvas',
  'dataview',
  'pdf',
  'image',
  'html',
  'docx'
])

/**
 * Close every open tab scoped to `rootDir`: editor/canvas/dataview/pdf/image
 * panels whose path falls inside it, plus the combined manuscript tab for it.
 * Called by state/project.ts's openProjectAt right after the project store
 * switches to a different directory — the one place project-scoped tabs are
 * closed on a switch (feature-plan-7 §3). Deliberately narrower than "every
 * panel": settings/export/docx-import/onboarding tabs are left open, since
 * none of them silently misrepresents data from the old project the way a
 * stale editor tab would.
 */
export function closeProjectTabs(rootDir: string): void {
  if (!dockApi) return
  const api = dockApi
  const prefix = `${rootDir}/`
  // Suppressed: the caller (adoptProject) opens the new project's manuscript
  // right after, so the empty dock in between is a transition, not a
  // destination — without this the switch would leave a stray welcome tab.
  withoutWelcomeReopen(() => {
    for (const panel of [...api.panels]) {
      const component = panel.view.contentComponent
      // rootDir-keyed panels: they carry the project in params, not in a path,
      // so a stale one would silently show the previous project's content.
      if (
        component === 'manuscript' ||
        component === 'letter' ||
        component === 'round' ||
        component === 'version' ||
        component === 'compare' ||
        component === 'review-import' ||
        component === 'trash'
      ) {
        if (panel.params?.['rootDir'] === rootDir) api.removePanel(panel)
        continue
      }
      if (!PROJECT_SCOPED_PATH_COMPONENTS.has(component)) continue
      const path = panel.params?.['path']
      if (typeof path === 'string' && (path === rootDir || path.startsWith(prefix))) {
        api.removePanel(panel)
      }
    }
  })
}

/**
 * Follow a file or directory that moved on disk: every open tab showing
 * `from` — or showing something INSIDE it, when `from` is a directory —
 * reopens at the matching path under `to`. Returns how many panels it
 * rewrote. Called after each successful `fs:move`, and after `fs:rename`,
 * which without it leaves the tab pointing at a path that no longer exists
 * (feature-plan-9 measurement 5).
 *
 * "Rewrites" means close-and-re-add rather than an in-place patch, and two
 * things force that: DockHost renders a panel's React component ONCE from
 * `parameters.params` (dockview-core has no re-render on `update`), and for a
 * file tab the panel ID *is* the path — which is what useOpenTabsStore keys
 * the explorer's open/active markers off. Neither survives a mutation. The
 * replacement is added at the original's group and tab index BEFORE the
 * original is removed, so a retarget can never collapse a split by closing a
 * group's last panel.
 *
 * A dirty buffer does not come along: doc sessions are keyed by path, and the
 * one at `from` stays behind (docSessions keeps a dirty session alive past its
 * last view). Saving before moving is still the only way to carry unsaved
 * edits across — the same as before this existed, minus the dead tab.
 */
export function retargetPanels(from: string, to: string): number {
  if (!dockApi || from === to) return 0
  const api = dockApi
  const prefix = `${from}/`
  const activeId = api.activePanel?.id ?? null
  let rewritten = 0
  for (const panel of [...api.panels]) {
    if (!PROJECT_SCOPED_PATH_COMPONENTS.has(panel.view.contentComponent)) continue
    const current = panel.params?.['path']
    if (typeof current !== 'string') continue
    // The separator is the whole guard: a bare startsWith(from) also matches
    // /a/data2 when /a/data is what moved.
    const next =
      current === from
        ? to
        : current.startsWith(prefix)
          ? `${to}/${current.slice(prefix.length)}`
          : null
    if (next === null) continue
    api.addPanel({
      id: freePanelId(next),
      component: componentForFile(next),
      title: titleForFile(next),
      params: { ...panel.params, path: next },
      position: {
        referencePanel: panel.id,
        direction: 'within',
        index: panel.group.panels.indexOf(panel)
      },
      // Re-adding always activates; only the tab that WAS frontmost may take
      // the focus back, or moving a background file would steal it.
      inactive: panel.id !== activeId
    })
    api.removePanel(panel)
    rewritten += 1
  }
  return rewritten
}

/** Open (or focus) the DOCX/PDF export dialog for a project (feature-plan-6 §3/§4). */
export function openExportTab(rootDir: string): void {
  if (!dockApi) return
  const id = `export:${rootDir}`
  const existing = dockApi.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  dockApi.addPanel({
    id,
    component: 'export',
    title: 'Export',
    params: { rootDir }
  })
}

/**
 * The secondary ("side") group, or null while the dock has a single group.
 * `api.groups` is creation-ordered, so the first group is the one the app's
 * own tabs opened into and everything after it is a split the user (or
 * openInSplit) made. Reusing it is what keeps ⌘\ from splitting endlessly.
 */
function sideGroup(): DockviewGroupPanel | null {
  if (!dockApi) return null
  const groups = dockApi.groups
  if (groups.length < 2) return null
  return groups[1] ?? null
}

/** Id of the existing side group, or null when the dock has only one group. */
export function sideGroupId(): string | null {
  return sideGroup()?.id ?? null
}

/**
 * The active panel's file path (its `params.path`), or null when nothing is
 * active or the active panel is a special tab with no `path` param (welcome,
 * settings, the combined manuscript view — those key off `rootDir` instead).
 * Feeds the split commands (feature-plan-4 §1/§5): "duplicate the ACTIVE tab".
 */
export function activePanelPath(): string | null {
  const panel = dockApi?.activePanel
  if (!panel) return null
  const value = panel.params?.['path']
  return typeof value === 'string' ? value : null
}

/**
 * The active panel's dock component kind ('editor', 'canvas', 'manuscript',
 * 'pdf', …), or null when nothing is active. The help overlay feeds this to
 * sectionForSurface for its initial tab (feature-plan-8 §1); the repair
 * picker records it in context.json (§5).
 */
export function activePanelComponent(): string | null {
  return dockApi?.activePanel?.view.contentComponent ?? null
}

/**
 * The round the user is working in: the frontmost round workspace, or — when
 * the front panel is something else, which it is the moment they open the
 * comparison beside it — the round one of the open workspaces is on.
 *
 * Read from the dock rather than from a store because the dock is the thing
 * that knows what is actually open: a selection store outlives the tab that
 * set it, and a command that acted on a closed round would be worse than one
 * that is greyed out.
 */
export function activeRoundId(): string | null {
  if (!dockApi) return null
  const active = dockApi.activePanel
  if (active?.view.contentComponent === 'round') {
    const id = active.params?.['roundId']
    if (typeof id === 'string') return id
  }
  for (const panel of dockApi.panels) {
    if (panel.view.contentComponent !== 'round') continue
    const id = panel.params?.['roundId']
    if (typeof id === 'string') return id
  }
  return null
}

/** A panel in `group` already showing `path`, if there is one. */
function panelForPath(group: DockviewGroupPanel, path: string): IDockviewPanel | null {
  for (const panel of group.panels) {
    const param = panel.params?.['path']
    if (panel.id === path || (typeof param === 'string' && param === path)) return panel
  }
  return null
}

/**
 * A free panel id for `path`. Panel ids are unique per dock, so splitting a
 * file that is already open needs a second id — `path`, then `path::2`, …
 */
function freePanelId(path: string): string {
  if (!dockApi || !dockApi.getPanel(path)) return path
  for (let n = 2; n < 1000; n += 1) {
    const id = `${path}::${n}`
    if (!dockApi.getPanel(id)) return id
  }
  return `${path}::${Date.now()}`
}

/**
 * Open `path` in the group beside/below the active one, creating that group on
 * the first call and reusing it afterwards (feature-plan-4 §1). Calling it
 * twice for the same file leaves exactly two groups, the second focused on it.
 */
export function openInSplit(path: string, direction: SplitDirection): void {
  if (!dockApi) return
  const api = dockApi
  const target = sideGroup()

  if (target) {
    const existing = panelForPath(target, path)
    if (existing) {
      existing.api.setActive()
      return
    }
    api.addPanel({
      id: freePanelId(path),
      component: componentForFile(path),
      title: titleForFile(path),
      params: { path },
      position: { referenceGroup: target }
    })
    return
  }

  const reference = api.activePanel ?? api.panels[0]
  if (!reference) {
    // Nothing to split from yet — the first tab has to exist somewhere.
    openFileTab(path)
    return
  }
  api.addPanel({
    id: freePanelId(path),
    component: componentForFile(path),
    title: titleForFile(path),
    params: { path },
    position: { referencePanel: reference.id, direction }
  })
}

/**
 * Show `path` in the side group as *the* viewer there: any PDF/image tab
 * already in that group is closed once the new one is in place, so clicking
 * three references in a row leaves one tab showing the last (feature-plan-4
 * §4). The new panel is added before the old ones are closed — closing the
 * group's last panel would destroy the group and collapse the split.
 */
export function openViewerInSide(path: string): void {
  if (!dockApi) return
  openInSplit(path, 'right')

  const target = sideGroup()
  if (!target) return
  const keep = panelForPath(target, path)
  if (!keep) return
  for (const panel of [...target.panels]) {
    if (panel.id === keep.id) continue
    if (VIEWER_COMPONENTS.has(panel.view.contentComponent)) panel.api.close()
  }
  keep.api.setActive()
}

/**
 * Dev-only seam for e2e drivers (main.tsx wires it under `window.__sunaDev`):
 * split/side-viewer commands plus the group/panel readouts the split-view
 * acceptance checks need ("still exactly 2 groups", "one PDF tab").
 */
export const dockDevSeam = {
  componentForFile,
  openFileTab,
  openInSplit,
  openViewerInSide,
  /** feature-plan-5 §5: open the wizard the way the welcome screen's buttons do. */
  openOnboardingTab,
  openSettingsTab,
  /**
   * feature-plan-6 §2: open the DOCX import review for a path directly. The
   * Welcome tab's "Import .docx…" button goes through the NATIVE file picker
   * ('dialog:pick-file'), which CDP cannot drive — this is the bypass, same
   * role the onboarding seam plays for the native folder picker.
   */
  openDocxImportTab,
  /** feature-plan-6 §3/§4: open the export dialog for a project. */
  openExportTab,
  /**
   * feature-plan-8 probes: open-or-focus the combined manuscript tab
   * directly. The UI route (activity-bar click) TOGGLES when the view is
   * already active, so a driver cannot use it idempotently.
   */
  openManuscriptTab,
  /**
   * feature-plan-13 §B: open a typed document's own tab — a cover letter's,
   * in practice. Its UI route is the Documents sidebar list, which a driver
   * can only reach by matching row text, and a probe that cannot open a
   * letter deterministically ends up asserting against whatever tab happened
   * to be focused instead.
   */
  openDocumentTab,
  /** The supplement tab. Reached in the UI only from the Writing sidebar. */
  openSupplementTab,
  openReadingNotesTab,
  /**
   * feature-plan-12 §6: open the reviewer-import screen. Its UI route is a
   * menu item behind a "+" button that is not mounted in every project view,
   * so a driver cannot reach the screen at all without this seam.
   */
  openReviewImportTab,
  /**
   * The response workspace for one round. Reached in the UI only by clicking
   * a round in the sidebar's document list, which is not mounted in every
   * view — same problem the import screen has.
   */
  openRoundTab,
  /**
   * feature-plan-14: the version comparison, full-window and beside the
   * current group. Its UI routes are the round header's "Changes since
   * v1.3" and a hover control in the sidebar's version list, neither of
   * which is mounted in every view — the same reason the round tab is here.
   */
  openCompareTab,
  openCompareInSide,
  /** feature-plan-7 §3: close every tab scoped to a project directory. */
  closeProjectTabs,
  sideGroupId,
  activePanelPath,
  /**
   * The surface the help overlay keys its section off. Seamed because
   * `activePanelPath` answers null for every panel without a file path
   * (the combined manuscript tab among them), so a driver cannot tell
   * "no active panel" from "an active panel that is not a file".
   */
  activePanelComponent,
  groupCount: (): number => dockApi?.groups.length ?? 0,
  /** Panel ids per group, in dock order — groups()[0] is the primary group. */
  groupPanelIds: (): string[][] =>
    (dockApi?.groups ?? []).map((group) => group.panels.map((panel) => panel.id)),
  /** Component name per open panel id — lets a driver tell a 'pdf' tab from
   *  an 'editor' one without re-deriving it from the path. */
  panelComponents: (): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const panel of dockApi?.panels ?? []) out[panel.id] = panel.view.contentComponent
    return out
  },
  /**
   * Close every panel, leaving one empty group. Splitting is defined against
   * "the group the app's own tabs opened into" (see `sideGroup`), so a driver
   * measuring "⌘\ yields exactly 2 groups" needs a known starting dock rather
   * than whatever the previous step left behind.
   */
  clearDock: (): void => {
    // Suppressed: the contract here is "one empty group", and a driver that
    // asked for an empty dock would not expect a welcome tab back in it.
    withoutWelcomeReopen(() => dockApi?.clear())
  },
  /** Close one panel by id — how a driver proves "cancelling writes nothing". */
  closePanel: (id: string): void => {
    const panel = dockApi?.getPanel(id)
    if (panel) dockApi?.removePanel(panel)
  },
  /**
   * Re-open the welcome tab. The app adds it once at startup and reopens it
   * whenever the user empties the dock, but `clearDock()` deliberately does
   * not — so a driver measuring the welcome screen's recent-projects list
   * (feature-plan-5 §1) after a project is already open needs a way back.
   */
  openWelcomeTab: (): void => {
    if (!dockApi) return
    const existing = dockApi.getPanel('welcome')
    if (existing) {
      existing.api.setActive()
      return
    }
    dockApi.addPanel({ ...WELCOME_PANEL })
  }
}
