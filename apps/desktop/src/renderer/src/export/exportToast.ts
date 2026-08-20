/**
 * The one post-export affordance in the app.
 *
 * Every export — manuscript DOCX/PDF/HTML, cover letter, reading notes,
 * figure SVG/PDF/PNG/TIFF — ends the same way: a bottom-center toast naming
 * the file it wrote, with "Open" (hand it to the OS's default application)
 * and the platform's reveal wording beside it. Before this, each surface had
 * invented its own ending — an inline "Exported → /long/path" line here, a
 * status note there, a bespoke Open / Show in folder strip in the notes tab —
 * so the same act had three different endings depending on where you started.
 *
 * The toast is deliberately transient and non-modal: exporting is often two
 * or three formats in a row, and a Finder window per format is noise. The
 * actions are offered, never taken automatically.
 */
import { useUiStore } from '../state/ui'
import { openWithOs, osActionLabels, revealInOs } from '../shell/os-actions'

/** Exports get a longer TTL than an Undo toast — the actions are a choice, not a race. */
export const EXPORT_TOAST_TTL_MS = 12000

/** Last path segment, tolerating either separator (Windows paths reach here too). */
export function exportedBaseName(path: string): string {
  const segments = path.split(/[/\\]/).filter((segment) => segment !== '')
  return segments[segments.length - 1] ?? path
}

/**
 * The toast line. `detail` is the place for anything the surface knows and
 * the file name does not — "3 assertions still unanswered", "1200×800",
 * "figures at 150 dpi JPEG".
 */
export function exportToastMessage(path: string, detail?: string): string {
  const base = `Exported ${exportedBaseName(path)}`
  return detail !== undefined && detail.trim() !== '' ? `${base} — ${detail.trim()}` : base
}

/**
 * Announce a finished export. Call it with the absolute path the main-process
 * writer returned; failures still belong in the surface's own error slot,
 * since a toast that vanishes is the wrong home for something that went wrong.
 */
export function notifyExported(path: string, detail?: string): number {
  const labels = osActionLabels(window.suna.platform)
  return useUiStore.getState().pushToast(exportToastMessage(path, detail), {
    ttlMs: EXPORT_TOAST_TTL_MS,
    actions: [
      { label: 'Open', run: () => void openWithOs(path) },
      { label: labels.reveal, run: () => void revealInOs(path) }
    ]
  })
}
