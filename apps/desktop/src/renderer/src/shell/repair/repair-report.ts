/**
 * Pure halves of "Repair this UI" (DECISIONS 2026-08-17), kept out of
 * RepairPicker.tsx so they are unit-testable without a DOM: the tag.class
 * identity/path formatting for context.json and the picker label, and the
 * bundle slug derived from the user's report.
 */

/** One element on the path, target-first: RepairPicker snapshots these from the DOM. */
export interface DomPathEntry {
  tag: string
  classes: readonly string[]
}

/** How many path elements (target + ancestors) the context keeps — plan §5. */
export const DOM_PATH_MAX = 6

/** How much of the report survives into the bundle directory name. */
export const SLUG_MAX = 40

/** 'button.cmt__btn.cmt__btn--ai' — the identity of one element. */
export function entryLabel(entry: DomPathEntry): string {
  return entry.tag + entry.classes.map((c) => `.${c}`).join('')
}

/**
 * Root-most → target, ' > '-joined, capped at DOM_PATH_MAX entries counted
 * from the TARGET end — when the path is deeper than the cap it is the far
 * ancestors that go, never the element the user pointed at.
 */
export function formatDomPath(entries: readonly DomPathEntry[]): string {
  return entries.slice(0, DOM_PATH_MAX).map(entryLabel).reverse().join(' > ')
}

/**
 * Directory-name slug from the report text: lowercase alphanumeric runs,
 * '-'-joined, clipped to SLUG_MAX without a trailing '-'. Empty/symbol-only
 * reports fall back to 'ui-repair' — 'ai:repair-bundle' requires a non-empty
 * slug.
 */
export function slugForReport(report: string): string {
  const slug = report
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '')
  return slug === '' ? 'ui-repair' : slug
}
