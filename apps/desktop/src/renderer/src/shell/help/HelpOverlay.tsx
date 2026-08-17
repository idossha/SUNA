/**
 * "?" keyboard-shortcut overlay (feature-plan-8 §1). One dialog over
 * everything, palette-convention backdrop (z-index 200, backdrop mousedown
 * closes, inner stopPropagation), tabs per surface section from sections.ts.
 *
 * The `?` opener is a window listener owned here, NOT a Command.shortcut:
 * the palette's global dispatcher matches by event.code and has no isTyping
 * guard, so a registered Shift-Slash command would fire while typing `?`
 * into e.g. the explorer filter. This listener bails on defaultPrevented,
 * on ⌘/⌃/⌥ (⇧ is what produces `?` and must pass), and on any typing
 * surface.
 *
 * Selectors are API (feature-plan-8 §7): `.help-overlay` (dialog root, with
 * `data-help-section` = active section id), `.help-overlay__tab`.
 */
import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react'
import { activePanelComponent } from '../../state/dock'
import { useUiStore } from '../../state/ui'
import { HELP_LEGEND, SECTIONS, sectionForSurface } from './sections'
import './help.css'

/**
 * True when `target` consumes plain typing: INPUT/TEXTAREA/SELECT or
 * anything contenteditable — CodeMirror's content DOM is contenteditable,
 * so typing `?` in any editor (vim's `?` search included) never opens help.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.isContentEditable
}

export function HelpOverlay(): JSX.Element | null {
  const open = useUiStore((s) => s.helpOpen)
  const setHelpOpen = useUiStore((s) => s.setHelpOpen)
  const [sectionId, setSectionId] = useState('global')
  const dialogRef = useRef<HTMLDivElement | null>(null)
  /** Where focus was before the dialog took it — restored on close (Flux pattern). */
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== '?') return
      if (event.defaultPrevented) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTyping(event.target)) return
      event.preventDefault()
      useUiStore.getState().setHelpOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // The tab is decided in the SAME commit that opens the dialog, not in an
  // effect: an effect runs after the first render, so the dialog would paint
  // one frame carrying the section from the previous time it was open —
  // visible as a flash of the wrong keys, and a driver reading that frame
  // gets the wrong answer (measured: opening over the canvas reported
  // 'manuscript', the surface of the previous open). This is React's
  // adjust-state-when-a-prop-changes pattern: the re-render happens before
  // the browser paints. Focus has not moved yet at this point, so
  // document.activeElement is still the opener.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      const active = document.activeElement
      const explorerFocused = active !== null && active.closest('[role="tree"]') !== null
      setSectionId(sectionForSurface(activePanelComponent(), explorerFocused))
    }
  }

  // Focus only: snapshot the opener before the dialog takes focus so Esc
  // lands on its onKeyDown, and hand focus back on close (Flux pattern).
  useEffect(() => {
    if (!open) {
      const previous = restoreRef.current
      restoreRef.current = null
      if (previous !== null && previous.isConnected) previous.focus()
      return
    }
    const active = document.activeElement
    restoreRef.current = active instanceof HTMLElement ? active : null
    dialogRef.current?.focus()
  }, [open])

  if (!open) return null

  const section = SECTIONS.find((s) => s.id === sectionId) ?? SECTIONS[0]
  if (section === undefined) return null // unreachable: SECTIONS is non-empty

  const close = (): void => setHelpOpen(false)

  const onDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  return (
    <div className="help-overlay-backdrop" onMouseDown={close}>
      <div
        ref={dialogRef}
        className="help-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        data-help-section={section.id}
        tabIndex={-1}
        onMouseDown={(e: ReactMouseEvent) => e.stopPropagation()}
        onKeyDown={onDialogKeyDown}
      >
        <div className="help-overlay__tabs" role="tablist" aria-label="Shortcut surfaces">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === section.id}
              className={
                s.id === section.id
                  ? 'help-overlay__tab help-overlay__tab--active'
                  : 'help-overlay__tab'
              }
              onClick={() => setSectionId(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="help-overlay__body">
          {section.groups.map((group) => (
            <section key={group.title} className="help-overlay__group">
              <h3 className="help-overlay__group-title">{group.title}</h3>
              {group.items.map(([keys, description]) => (
                <div key={`${keys} ${description}`} className="help-overlay__row">
                  <kbd className="help-overlay__keys">{keys}</kbd>
                  <span className="help-overlay__desc">{description}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
        <div className="help-overlay__footer">{HELP_LEGEND}</div>
      </div>
    </div>
  )
}
