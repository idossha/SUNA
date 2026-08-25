import { useEffect } from 'react'
import { getResolved } from '../state/settings'
import { useUiStore } from '../state/ui'
import { useVimModeStore } from '../state/vimMode'
import { focusActivePanel } from '../state/dock'
import {
  ARROW_FOR_DIRECTION,
  directionForCode,
  moveRegion,
  type NavDirection,
  type NavRegion
} from './vimNav'

/**
 * Ctrl-h / Ctrl-l hop sideways between the view rail, the sidebar and the
 * editor while vim motions are on, and plain h/j/k/l then drives whichever
 * chrome region the hop landed in (feature: vim users never leave the home
 * row to reach the file tree or the view rail).
 *
 * One document-level capture listener rather than per-region React handlers:
 * the hop has to work FROM the editor, whose CodeMirror keymap would otherwise
 * swallow the chord before React saw it, and the regions it lands in are
 * scattered across three components.
 *
 * Gated on `editor.vimMotions` so a non-vim user's Ctrl-l (or a chrome
 * button's own h) is never stolen, and — inside the dock only — on the vim
 * mode NOT being insert, where Ctrl-h is backspace and h is a letter.
 */

const REGION_SELECTOR = '[data-vim-region]'

/** Focusables we hand a region's focus to, in DOM order. */
const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/** Regions whose plain h/j/k/l is a roving walk over their own buttons. */
const ROVING: Partial<Record<NavRegion, 'vertical' | 'horizontal'>> = {
  rail: 'vertical'
}

function regionOf(node: Element | null): NavRegion | null {
  const host = node?.closest(REGION_SELECTOR) ?? null
  const name = host?.getAttribute('data-vim-region') ?? null
  return name as NavRegion | null
}

function regionElement(region: NavRegion): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-vim-region="${region}"]`)
}

/** The part of a region a hop should land in, rather than its chrome. */
const REGION_BODY: Partial<Record<NavRegion, string>> = {
  sidebar: '.sidebar__body'
}

/**
 * A view's own header strip. Its buttons CREATE things ("New figure", the
 * explorer's new-file "+"); a navigation keystroke must not land one Enter
 * away from them, so a hop skips the header and lands on the content — the
 * rows, cards or tree the user came to move through. `__header` is the
 * repo-wide class convention for these strips, which is why one selector
 * covers every sidebar view rather than each view declaring a target.
 */
const HEADER_SELECTOR = '[class*="__header"]'

function focusables(region: NavRegion, forLanding = false): HTMLElement[] {
  const host = regionElement(region)
  if (host === null) return []
  const bodySelector = forLanding ? REGION_BODY[region] : undefined
  const body = bodySelector === undefined ? null : host.querySelector(bodySelector)
  const scope = body ?? host
  const all = [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)]
  if (!forLanding) return all
  const content = all.filter((el) => el.closest(HEADER_SELECTOR) === null)
  return content.length > 0 ? content : all
}

/**
 * The element focus left the dock from, so `Ctrl-l` puts the caret back where
 * the user was rather than at the top of some other panel. Cleared implicitly:
 * a detached element is ignored.
 */
let lastDockFocus: HTMLElement | null = null

function focusRegion(region: NavRegion): boolean {
  if (region === 'dock') {
    if (lastDockFocus?.isConnected === true) {
      lastDockFocus.focus()
      return true
    }
    return focusActivePanel()
  }
  const items = focusables(region, true)
  // The rail's pressed item is the view the user is looking at; starting
  // anywhere else would make `l` open a different one than the sidebar shows.
  const pressed = items.find((el) => el.getAttribute('aria-pressed') === 'true')
  const target = pressed ?? items[0]
  if (target === undefined) return false
  target.focus()
  return true
}

function rove(region: NavRegion, direction: NavDirection, axis?: 'vertical' | 'horizontal'): boolean {
  const on = axis ?? ROVING[region]
  if (on === undefined) return false
  const forward = direction === 'j' || direction === 'l'
  const onAxis =
    on === 'vertical' ? direction === 'j' || direction === 'k' : direction === 'h' || direction === 'l'
  if (!onAxis) return false
  const items = focusables(region)
  const index = items.indexOf(document.activeElement as HTMLElement)
  if (index === -1) return false
  const next = items[index + (forward ? 1 : -1)]
  if (next === undefined) return true // clamp at the ends rather than wrapping
  next.focus()
  return true
}

/** Is this a typing surface where a bare letter must stay a letter? */
function isTextInput(el: Element | null): boolean {
  if (el === null) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function inInsertMode(): boolean {
  const mode = useVimModeStore.getState().mode
  return mode !== null && mode.startsWith('insert')
}

export function useVimNav(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey || event.metaKey) return
      if (getResolved('editor.vimMotions').value !== true) return
      const direction = directionForCode(event.code)
      if (direction === null) return

      const active = document.activeElement
      if (isTextInput(active)) return
      const from = regionOf(active)
      if (from === null) return
      // Inside the editor a bare letter is a vim motion and Ctrl-h is
      // backspace; only the chord, and only outside insert mode, is ours.
      if (from === 'dock' && (!event.ctrlKey || inInsertMode())) return

      if (event.ctrlKey) {
        const ui = useUiStore.getState()
        const to = moveRegion(from, direction, {
          rail: ui.railVisible,
          sidebar: ui.sidebarVisible
        })
        if (to === null || to === from) return
        if (from === 'dock') lastDockFocus = active instanceof HTMLElement ? active : null
        if (!focusRegion(to)) return
        event.preventDefault()
        event.stopPropagation()
        return
      }

      // Plain h/j/k/l inside chrome: a roving walk where the region is a
      // button strip, otherwise the arrow key that region already handles
      // (the explorer's own tree navigation, unchanged).
      if (rove(from, direction)) {
        event.preventDefault()
        return
      }
      const target = active as HTMLElement
      event.preventDefault()
      const consumed = !target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: ARROW_FOR_DIRECTION[direction],
          code: ARROW_FOR_DIRECTION[direction],
          bubbles: true,
          cancelable: true,
          shiftKey: event.shiftKey
        })
      )
      // Views that answer arrows themselves (the explorer's tree, which keeps
      // one focused ROW inside a single focusable element) call preventDefault
      // and are done. The rest are plain button lists — document rows, figure
      // cards — where j/k has to move focus between the buttons instead.
      if (!consumed) rove(from, direction, 'vertical')
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
