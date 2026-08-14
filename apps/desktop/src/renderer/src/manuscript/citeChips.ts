import { renderCluster } from '@suna/bib'
import type { CitationRender } from '../state/manuscriptDoc'

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
