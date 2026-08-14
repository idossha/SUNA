import { renderCluster } from '@suna/bib'
import type { CrossRefKind } from '@suna/markdown'
import type { CitationRender } from '../state/manuscriptDoc'
import { resolveCrossRefLabel } from './citations'

/**
 * Profile-resolved citation chips for the combined tab's section editors.
 *
 * The live-preview extension (editor zone) renders every citation cluster as
 * a raw `[key1; key2]` chip. The combined manuscript document knows more:
 * its References block computes first-appearance numbers plus the preview
 * profile's in-text style and publishes them via state/manuscriptDoc. This
 * module is the presentational bridge — a DOM pass over rendered
 * `.cm-lp-cite` widgets that swaps raw key labels for resolved text
 * ("1,3–5" or "(Gunn & Gott 1972)") without touching the editor zone's
 * widget machinery. The raw label is kept in data attributes so a chip can
 * be restored or re-resolved at any time; chips a numeric profile has not
 * numbered yet (e.g. a freshly typed, unsaved citation) keep their raw
 * label until the next publish.
 */

const CITE_KEY = /^[A-Za-z][\w:.-]*$/
const KEYS_SEP = '\u001f'

/** Data shared by resolution — everything of CitationRender except the serial. */
export type ChipRenderData = Pick<CitationRender, 'numbers' | 'entries' | 'style'>

/** Keys of a raw live-preview chip label `[key1; key2]`; null for anything else. */
export function parseRawCiteLabel(label: string | null): string[] | null {
  if (label === null || label.length < 3) return null
  if (!label.startsWith('[') || !label.endsWith(']')) return null
  const keys = label.slice(1, -1).split('; ')
  for (const key of keys) {
    if (!CITE_KEY.test(key)) return null
  }
  return keys
}

export interface ChipText {
  text: string
  /** 'superscript' keeps the chip raised; 'inline' reads as body text. */
  form: 'superscript' | 'inline'
}

/**
 * Resolved chip text for a cluster under the shared render data, or null
 * when it cannot be resolved yet (a numeric profile with an unnumbered key —
 * dropping the key silently would misrender, so the raw chip stays).
 */
export function citeChipText(
  keys: readonly string[],
  render: ChipRenderData
): ChipText | null {
  if (keys.length === 0) return null
  if (
    render.style.mode !== 'author-year' &&
    keys.some((key) => !render.numbers.has(key))
  ) {
    return null
  }
  const rendering = renderCluster(
    { keys, narrative: false },
    render.numbers,
    render.style,
    render.entries
  )
  const text = rendering.inline.map((run) => run.text).join('')
  if (text === '') return null
  return { text, form: rendering.form }
}

/**
 * One presentational pass over a host's rendered citation chips. Idempotent:
 * chips already at the render's serial are skipped, so the DOM mutations this
 * pass causes converge instead of looping the caller's MutationObserver.
 * With `render` null every touched chip is restored to its raw label.
 */
export function applyCiteChips(
  host: HTMLElement,
  render: CitationRender | null
): void {
  const signature = render === null ? 'raw' : String(render.serial)
  for (const el of host.querySelectorAll<HTMLElement>('.cm-lp-cite')) {
    let keys: string[] | null
    const stored = el.dataset['sunaKeys']
    if (stored !== undefined) {
      keys = stored.split(KEYS_SEP)
    } else {
      keys = parseRawCiteLabel(el.textContent)
      if (keys !== null) {
        el.dataset['sunaKeys'] = keys.join(KEYS_SEP)
        el.dataset['sunaRaw'] = el.textContent ?? ''
      }
    }
    if (keys === null) continue
    if (el.dataset['sunaSig'] === signature) continue
    const resolved = render === null ? null : citeChipText(keys, render)
    if (resolved === null) {
      const raw = el.dataset['sunaRaw']
      if (raw !== undefined && el.textContent !== raw) el.textContent = raw
      el.classList.remove('cm-lp-cite--resolved', 'cm-lp-cite--inline')
    } else {
      if (el.textContent !== resolved.text) el.textContent = resolved.text
      el.classList.add('cm-lp-cite--resolved')
      el.classList.toggle('cm-lp-cite--inline', resolved.form === 'inline')
    }
    el.dataset['sunaSig'] = signature
  }
}

/* ---------------------------------------------------------------------------
   Cross-reference chips (@fig:/@tbl:/@eq:/@sec:).

   The live-preview extension (editor zone) renders every crossRef as a raw
   `.cm-lp-xref` widget with textContent "kind:id" and, when a panel suffix
   was parsed, a `title="panel <suffix>"` attribute (its only place to carry
   that data without editor-zone changes). This is the same kind of
   presentational DOM pass as applyCiteChips above, resolving those widgets
   against the document's label map (manuscript/citations buildLabelMap).
   Unresolved ids keep their raw "kind:id" text — never blank — flagged with
   an 'unresolved' class instead.
   ------------------------------------------------------------------------- */

const PANEL_TITLE = /^panel (.+)$/

function isCrossRefKind(value: string): value is CrossRefKind {
  return value === 'fig' || value === 'tbl' || value === 'eq' || value === 'sec'
}

export interface RawXref {
  kind: CrossRefKind
  id: string
  suffix: string | undefined
}

/** Parses a raw live-preview crossRef widget's "kind:id" text (+ panel title), or null. */
export function parseRawXref(textContent: string | null, title: string): RawXref | null {
  if (textContent === null) return null
  const colon = textContent.indexOf(':')
  if (colon <= 0) return null
  const kind = textContent.slice(0, colon)
  const id = textContent.slice(colon + 1)
  if (!isCrossRefKind(kind) || id.length === 0) return null
  const suffix = PANEL_TITLE.exec(title)?.[1]
  return { kind, id, suffix }
}

/** Data shared by crossRef resolution. */
export type XrefRenderData = Pick<CitationRender, 'labels'>

/**
 * One presentational pass over a host's rendered crossRef chips, mirroring
 * applyCiteChips: idempotent per render.serial, raw text/suffix stashed in
 * data attributes on first sight so later passes (and restoring to raw with
 * `render: null`) don't need the original widget title.
 */
export function applyCrossRefChips(
  host: HTMLElement,
  render: (XrefRenderData & { serial: number }) | null
): void {
  const signature = render === null ? 'raw' : String(render.serial)
  for (const el of host.querySelectorAll<HTMLElement>('.cm-lp-xref')) {
    let parsed: RawXref | null
    const storedKind = el.dataset['sunaXrefKind']
    const storedId = el.dataset['sunaXrefId']
    if (storedKind !== undefined && storedId !== undefined && isCrossRefKind(storedKind)) {
      parsed = { kind: storedKind, id: storedId, suffix: el.dataset['sunaXrefSuffix'] }
    } else {
      parsed = parseRawXref(el.textContent, el.title)
      if (parsed !== null) {
        el.dataset['sunaXrefKind'] = parsed.kind
        el.dataset['sunaXrefId'] = parsed.id
        if (parsed.suffix !== undefined) el.dataset['sunaXrefSuffix'] = parsed.suffix
        el.dataset['sunaXrefRaw'] = el.textContent ?? ''
      }
    }
    if (parsed === null) continue
    if (el.dataset['sunaXrefSig'] === signature) continue
    if (render === null) {
      const raw = el.dataset['sunaXrefRaw']
      if (raw !== undefined && el.textContent !== raw) el.textContent = raw
      el.classList.remove('cm-lp-xref--resolved', 'cm-lp-xref--unresolved')
    } else {
      const resolved = resolveCrossRefLabel(parsed.kind, parsed.id, parsed.suffix, render.labels)
      if (el.textContent !== resolved.text) el.textContent = resolved.text
      el.classList.toggle('cm-lp-xref--resolved', resolved.resolved)
      el.classList.toggle('cm-lp-xref--unresolved', !resolved.resolved)
    }
    el.dataset['sunaXrefSig'] = signature
  }
}

/* ---------------------------------------------------------------------------
   Display-equation label chips.

   The live-preview extension renders a `$$ … $$ {#eq:stripping}` block with a
   right-margin `.cm-lp-eq-label` chip whose text is the *raw* label,
   "(eq:stripping)" — the editor zone has no document-wide numbering, so that
   is all it can know on its own. In the combined manuscript document the same
   label map that turns `@eq:stripping` into "equation (1)" also knows the
   bare number, so this pass replaces the raw chip with "(1)" and the two stop
   contradicting each other on screen.
   ------------------------------------------------------------------------- */

const RAW_EQ_LABEL = /^\(eq:(.+)\)$/

/** The `{#eq:<id>}` id behind a raw "(eq:<id>)" label chip, or null. */
export function parseRawEqLabel(textContent: string | null): string | null {
  const id = RAW_EQ_LABEL.exec(textContent ?? '')?.[1]
  return id !== undefined && id.length > 0 ? id : null
}

/** Data shared by equation-label resolution. */
export type EqLabelRenderData = Pick<CitationRender, 'labels'>

/**
 * One presentational pass over a host's display-equation label chips,
 * mirroring applyCiteChips/applyCrossRefChips: idempotent per render.serial,
 * raw text stashed on first sight, `render: null` restores it.
 */
export function applyEquationLabels(
  host: HTMLElement,
  render: (EqLabelRenderData & { serial: number }) | null
): void {
  const signature = render === null ? 'raw' : String(render.serial)
  for (const el of host.querySelectorAll<HTMLElement>('.cm-lp-eq-label')) {
    let id = el.dataset['sunaEqId'] ?? null
    if (id === null) {
      id = parseRawEqLabel(el.textContent)
      if (id !== null) {
        el.dataset['sunaEqId'] = id
        el.dataset['sunaEqRaw'] = el.textContent ?? ''
      }
    }
    if (id === null) continue
    if (el.dataset['sunaEqSig'] === signature) continue
    const number = render === null ? undefined : render.labels.equationNumbers.get(id)
    if (number === undefined) {
      const raw = el.dataset['sunaEqRaw']
      if (raw !== undefined && el.textContent !== raw) el.textContent = raw
      el.classList.remove('cm-lp-eq-label--numbered')
    } else {
      const text = `(${number})`
      if (el.textContent !== text) el.textContent = text
      el.classList.add('cm-lp-eq-label--numbered')
    }
    el.dataset['sunaEqSig'] = signature
  }
}
