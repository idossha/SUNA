/**
 * App-wide command registry (feature-plan-4 §5 BUILD step 2): one place any
 * feature registers `{ id, title, category, shortcut?, run, enabled? }`, and
 * the single place the command palette's `>` mode and the global shortcut
 * dispatcher both read from. The built-ins below are registered directly
 * here rather than scattered across their owning views — feature-plan-4
 * asked for "the app's commands" as one list, and this keeps that list
 * honest and greppable in one file.
 */
import type { FsNode } from '@suna/core'
import { BUNDLED_PROFILE_IDS, type BundledProfileId } from '@suna/formatter'
import { createNewFigure } from '../canvas/new-figure'
import { activeCanvasPaletteContext } from '../canvas/palette-actions'
import { exportActiveFigurePdf, exportActiveFigurePng } from '../canvas/palette-export'
import { scanFigures } from '../views/figures-scan'
import { activePanelPath, openExportTab, openInSplit, openManuscriptTab, openSettingsTab } from './dock'
import { useProjectStore } from './project'
import { resolvePreviewProfileId, useRenderProfileStore } from './renderProfile'
import { useTerminalPanelStore } from './terminal'
import { useUiStore } from './ui'

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

// Deliberately not Mod-KeyB, the shortcut a VS Code user reaches for first:
// editor/keymap.ts binds it to bold at Prec.high and the global dispatcher
// bails on defaultPrevented (palette/CommandPalette.tsx), so ⌘B here would
// work everywhere except inside the app's primary surface.
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

registerCommand({
  id: 'settings.open',
  title: 'Open Settings',
  category: 'App',
  run: () => openSettingsTab()
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
      const path = await exportActiveFigurePng(context)
      useUiStore.getState().setStatusNote(`Exported PNG → ${path}`)
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
      const path = await exportActiveFigurePdf(context)
      useUiStore.getState().setStatusNote(`Exported PDF → ${path}`)
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
