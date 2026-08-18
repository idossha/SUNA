/**
 * Whether editing surfaces save themselves after a pause — the global
 * 'editor.autosave' setting, mirrored into a module with no imports at all.
 *
 * The mirror exists for one reason: the editing surfaces that read this
 * (state/docSessions.ts and canvas/CanvasTab.tsx) sit UNDER the project store
 * in the import graph, and state/settings.ts sits above it and runs
 * subscriptions at module scope. A direct docSessions → settings edge closes
 * that loop and settings.ts then runs against a half-initialised project
 * store. A leaf module both sides can depend on breaks the cycle without
 * reordering anything.
 *
 * state/settings.ts owns the value and pushes it here (`mirrorAutosave`);
 * everyone else only reads. The default matches GLOBAL_SETTINGS_DEFAULTS and
 * covers the window before settings have loaded from the main process.
 */

/** Shipped default: on. Keep in step with GLOBAL_SETTINGS_DEFAULTS. */
const DEFAULT_AUTOSAVE = true

let enabled = DEFAULT_AUTOSAVE

/**
 * Read at the moment a save would fire, never subscribed to, so turning the
 * setting off stops the very next scheduled save with no re-wiring.
 */
export function autosaveEnabled(): boolean {
  return enabled
}

/** Called by state/settings.ts whenever the global settings change. */
export function mirrorAutosave(on: boolean): void {
  enabled = on
}

/** Test seam: put the flag back to what a fresh app would use. */
export function resetAutosaveMirror(): void {
  enabled = DEFAULT_AUTOSAVE
}
