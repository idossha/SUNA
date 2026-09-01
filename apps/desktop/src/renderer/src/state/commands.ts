/**
 * App-wide command registry (DECISIONS 2026-08-14): one place any
 * feature registers `{ id, title, category, shortcut?, run, enabled? }`, and
 * the single place the command palette's `>` mode and the global shortcut
 * dispatcher both read from. The built-ins below are registered directly
 * here rather than scattered across their owning views — DECISIONS 2026-08-14
 * asked for "the app's commands" as one list, and this keeps that list
 * honest and greppable in one file.
 */
import { latestVersion, type FsNode } from '@suna/core'
import { BUNDLED_PROFILE_IDS, type BundledProfileId } from '@suna/formatter'
import { createNewFigure } from '../canvas/new-figure'
import { activeCanvasPaletteContext } from '../canvas/palette-actions'
import { exportActiveFigurePdf, exportActiveFigurePng } from '../canvas/palette-export'
import { startRepairPick } from '../shell/repair/RepairPicker'
import {
  showFloatTerminal,
  startScreenAsk,
  useFloatTerminalStore
} from '../shell/screenask/screenask'
import { scanFigures } from '../views/figures-scan'
import {
  activePanelComponent,
  activeRoundId,
  activePanelPath,
  openExportTab,
  openInSplit,
  openCompareInSide,
  openCompareTab,
  openManuscriptTab,
  openSettingsTab,
  openTrashTab
} from './dock'
import { toggleRoundSplit } from './roundFocus'
import { useProjectStore } from './project'
import { resolvePreviewProfileId, useRenderProfileStore } from './renderProfile'
import { useTerminalPanelStore } from './terminal'
import { startAppTour } from './tour'
import { runFile } from '../run/runFile'
import { runnerFor } from '../run/runners'
import { useUiStore } from './ui'
import { notifyExported } from '../export/exportToast'

export interface Command {
  id: string
  title: string
  category: string
  /** A palette/shortcuts.ts spec, e.g. "Mod-Backslash". Omitted commands are reachable only through the '>' search. */
  shortcut?: string
  run: () => void | Promise<void>
  /** Defaults to always-enabled when omitted. */
  enabled?: () => boolean
}

const registry = new Map<string, Command>()

/** Register (or replace) a command. Returns an unregister function. */
export function registerCommand(command: Command): () => void {
  registry.set(command.id, command)
  return () => {
    if (registry.get(command.id) === command) registry.delete(command.id)
  }
}

export function listCommands(): Command[] {
  return [...registry.values()]
}

export function getCommand(id: string): Command | undefined {
  return registry.get(id)
}

export function isCommandEnabled(command: Command): boolean {
  return command.enabled ? command.enabled() : true
}

/** Runs a registered, enabled command by id. Returns whether it actually ran. */
export async function runCommand(id: string): Promise<boolean> {
  const command = registry.get(id)
  if (command === undefined || !isCommandEnabled(command)) return false
  await command.run()
  return true
}

/**
 * Dev-only seam for e2e drivers (main.tsx wires it under `window.__sunaDev`):
 * lets a driver list/inspect/run registered commands without synthesizing
 * palette keystrokes for every acceptance check (e.g. `>split right`'s
 * effect can be asserted via `runCommand('split.right')` directly).
 */
export const commandsDevSeam = {
  listCommands,
  getCommand,
  isCommandEnabled,
  runCommand
}

function reportError(prefix: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  useUiStore.getState().setStatusNote(`${prefix}: ${message}`)
}

function currentRootDir(): string | null {
  return useProjectStore.getState().rootDir
}

/** A palette-triggered "New Figure" has no name prompt (`run()` takes no args) — the Figures view's inline field remains the named-figure path; this default just numbers them. */
export function nextFigureName(tree: FsNode | null): string {
  return `Figure ${scanFigures(tree).length + 1}`
}

/** Cycles to the next bundled profile, wrapping around; an unrecognized `current` starts at the first one. */
export function nextProfileId(current: BundledProfileId): BundledProfileId {
  const ids = BUNDLED_PROFILE_IDS
  const index = ids.indexOf(current)
  const next = ids[(index + 1 + ids.length) % ids.length]
  return next ?? current
}

function currentPreviewProfileId(rootDir: string): BundledProfileId {
  const override = useRenderProfileStore.getState().byProject[rootDir]
  const manifestProfile = useProjectStore.getState().manifest?.activeProfileId ?? null
  return resolvePreviewProfileId(override, manifestProfile)
}

/* --------------------------------------------------------------- built-ins */

registerCommand({
  id: 'split.right',
  title: 'Split Right',
  category: 'View',
  shortcut: 'Mod-Backslash',
  enabled: () => activePanelPath() !== null,
  run: () => {
    const path = activePanelPath()
    if (path !== null) openInSplit(path, 'right')
  }
})

registerCommand({
  id: 'split.down',
  title: 'Split Down',
  category: 'View',
  shortcut: 'Mod-Shift-Backslash',
  enabled: () => activePanelPath() !== null,
  run: () => {
    const path = activePanelPath()
    if (path !== null) openInSplit(path, 'below')
  }
})

// The round workspace's own split, which is NOT split.right: that opens a
// second dock group for a second FILE, and there is only one round file. This
// puts a second pane on the round already in front of you, so two of its
// points can be read at once. Enabled only on a round tab — elsewhere the
// keystroke would toggle a pane nobody can see.
registerCommand({
  id: 'review.compare.toggle',
  title: 'Compare Two Reviewer Points',
  category: 'Peer review',
  shortcut: 'Mod-Alt-Backslash',
  enabled: () => activePanelComponent() === 'round',
  run: () => toggleRoundSplit()
})

// Deliberately not Mod-KeyB, the shortcut a VS Code user reaches for first:
// editor/keymap.ts binds it to bold at Prec.high and the global dispatcher
// bails on defaultPrevented (palette/CommandPalette.tsx), so ⌘B here would
// work everywhere except inside the app's primary surface.
// Two ways in, because "what changed since they read it" is asked from two
// places: from a round (which knows its own baseline) and from the manuscript
// (where the answer is "since the last version I logged"). Both open the same
// panel; the difference is only which pair of sides it starts on.
registerCommand({
  id: 'review.diff.round',
  title: 'Compare With What the Reviewers Read',
  category: 'Peer review',
  enabled: () => currentRootDir() !== null && activeRoundId() !== null,
  run: () => {
    const rootDir = currentRootDir()
    const roundId = activeRoundId()
    if (rootDir === null || roundId === null) return
    openCompareInSide(rootDir, `round:${roundId}`, 'working')
  }
})

registerCommand({
  id: 'review.diff.versions',
  title: 'Compare Versions',
  category: 'Peer review',
  enabled: () => currentRootDir() !== null,
  run: async () => {
    const rootDir = currentRootDir()
    if (rootDir === null) return
    // The newest logged version against the working copy: the comparison an
    // author asking this question from the manuscript almost always wants,
    // and every other pair is one picker away inside the panel.
    const { versions } = await window.suna.invoke('version:list', { dir: rootDir })
    const newest = latestVersion(versions)
    openCompareTab(rootDir, newest === null ? 'working' : `version:${newest.id}`, 'working')
  }
})

registerCommand({
  id: 'view.sidebar.toggle',
  title: 'Toggle Sidebar',
  category: 'View',
  shortcut: 'Mod-Shift-KeyB',
  run: () => useUiStore.getState().toggleSidebar()
})

registerCommand({
  id: 'view.leftnav.toggle',
  // 'Toggle', not 'Hide': the hidden state persists across launches, and
  // Command.title is a plain string the palette searches verbatim — a
  // directional label would describe the opposite of what pressing it does
  // for the one user who needs it most, the one whose nav is already gone.
  title: 'Toggle Left Nav Bar',
  category: 'View',
  shortcut: 'Mod-Alt-KeyB',
  run: () => useUiStore.getState().toggleLeftNav()
})

registerCommand({
  id: 'figure.new',
  title: 'New Figure',
  category: 'Figures',
  enabled: () => currentRootDir() !== null,
  run: async () => {
    const rootDir = currentRootDir()
    if (rootDir === null) return
    const name = nextFigureName(useProjectStore.getState().tree)
    await createNewFigure(rootDir, name)
  }
})

// Ctrl-` is TerminalPanel's own always-mounted listener (terminal/TerminalPanel.tsx);
// no `shortcut` here so the two never both fire on the same keypress.
registerCommand({
  id: 'terminal.toggle',
  title: 'Toggle Terminal',
  category: 'View',
  run: () => useTerminalPanelStore.getState().toggle()
})

registerCommand({
  id: 'terminal.focus',
  title: 'Focus Terminal',
  category: 'View',
  run: () => useTerminalPanelStore.getState().setOpen(true)
})

// Ctrl-Enter, the notebook/REPL convention, and free of the ⌘-prefixed
// space the editor's own keymap owns. Enabled only when the FRONT panel is a
// file something knows how to run, so the palette never offers a dead entry.
registerCommand({
  id: 'run.file',
  title: 'Run File',
  category: 'Run',
  shortcut: 'Ctrl-Enter',
  enabled: () => {
    const path = activePanelPath()
    return path !== null && runnerFor(path) !== null
  },
  run: () => {
    const path = activePanelPath()
    if (path !== null) void runFile(path)
  }
})

registerCommand({
  id: 'settings.open',
  title: 'Open Settings',
  category: 'App',
  run: () => openSettingsTab()
})

registerCommand({
  id: 'trash.open',
  title: 'Open Trash',
  category: 'App',
  enabled: () => useProjectStore.getState().rootDir !== null,
  run: () => {
    const rootDir = useProjectStore.getState().rootDir
    if (rootDir !== null) openTrashTab(rootDir)
  }
})

registerCommand({
  id: 'figure.compliance',
  title: 'Run Compliance Check',
  category: 'Figures',
  enabled: () => activeCanvasPaletteContext() !== null,
  run: () => {
    activeCanvasPaletteContext()?.runCompliance()
  }
})

registerCommand({
  id: 'figure.export.png',
  title: 'Export Figure as PNG',
  category: 'Figures',
  enabled: () => activeCanvasPaletteContext() !== null,
  run: async () => {
    const context = activeCanvasPaletteContext()
    if (context === null) return
    try {
      notifyExported(await exportActiveFigurePng(context))
    } catch (error) {
      reportError('PNG export failed', error)
    }
  }
})

registerCommand({
  id: 'figure.export.pdf',
  title: 'Export Figure as PDF',
  category: 'Figures',
  enabled: () => activeCanvasPaletteContext() !== null,
  run: async () => {
    const context = activeCanvasPaletteContext()
    if (context === null) return
    try {
      notifyExported(await exportActiveFigurePdf(context))
    } catch (error) {
      reportError('PDF export failed', error)
    }
  }
})

registerCommand({
  id: 'manuscript.open',
  title: 'Open Full Manuscript',
  category: 'Manuscript',
  enabled: () => currentRootDir() !== null,
  run: () => {
    const rootDir = currentRootDir()
    if (rootDir !== null) openManuscriptTab(rootDir)
  }
})

registerCommand({
  id: 'manuscript.export',
  title: 'Export Manuscript (Word/PDF)…',
  category: 'Manuscript',
  enabled: () => currentRootDir() !== null,
  run: () => {
    const rootDir = currentRootDir()
    if (rootDir !== null) openExportTab(rootDir)
  }
})

// The shortcut is ⌘⇧/ (rendered ⌘?), NOT a bare Shift-Slash: '?' stays with
// HelpOverlay's own window listener, which has the isTyping guard this
// dispatcher lacks — a Shift-Slash Command here would fire while typing '?'
// into the explorer filter (DECISIONS 2026-08-17).
//
// There is deliberately no chord here either. Help has exactly two doors:
// '?' everywhere it is not being typed, and ':help' inside a vim buffer,
// where NORMAL mode swallows '?' as search-backward before any listener
// sees it (DECISIONS 2026-08-17). The palette still lists this command.
registerCommand({
  id: 'help.tour',
  title: 'Take the App Tour',
  category: 'View',
  run: () => startAppTour()
})

registerCommand({
  id: 'help.shortcuts',
  title: 'Keyboard Shortcuts…',
  category: 'View',
  run: () => useUiStore.getState().setHelpOpen(true)
})

// Screenshot the window, take a question, hand both to an interactive agent
// in the floating terminal. Not gated on a project: in a dev run it targets
// the SUNA checkout, which is exactly the case where no project is open.
registerCommand({
  id: 'ai.screenAsk',
  title: 'AI: Ask about this screen…',
  category: 'App',
  shortcut: 'Mod-Shift-KeyA',
  run: () => startScreenAsk()
})

// The way back to a floating terminal the user lost track of — collapsed,
// or dragged somewhere a saved geometry no longer suits. Deliberately NOT
// folded into the ask above: a second ask replaces the running session, so
// "where did my agent go?" needs an answer that does not end the
// conversation it is asking about.
registerCommand({
  id: 'ai.showAgentTerminal',
  title: 'AI: Show the agent terminal',
  category: 'App',
  shortcut: 'Mod-Shift-KeyT',
  enabled: () => useFloatTerminalStore.getState().termId !== null,
  run: () => showFloatTerminal()
})

// Dev-only (DECISIONS 2026-08-17): 'ai:repair-bundle' rejects when packaged,
// and a packaged app has no source repo to repair.
registerCommand({
  id: 'ai.repairUi',
  title: 'AI: Report / repair this UI…',
  category: 'App',
  enabled: () => import.meta.env.DEV,
  run: () => startRepairPick()
})

registerCommand({
  id: 'profile.switch',
  title: "Switch 'Rendered As' Profile",
  category: 'Manuscript',
  enabled: () => currentRootDir() !== null,
  run: () => {
    const rootDir = currentRootDir()
    if (rootDir === null) return
    const next = nextProfileId(currentPreviewProfileId(rootDir))
    useRenderProfileStore.getState().setPreviewProfile(rootDir, next)
    useUiStore.getState().setStatusNote(`Rendered as: ${next}`)
  }
})
