import { useEffect, type JSX, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './documents.css'

/**
 * The shell every sheet shares: scrim, dialog box, Escape to close.
 *
 * Portalled onto `document.body` for the same reason `NewDocumentMenu` is —
 * the "+" that opens these sheets lives inside `.sidebar__header`, which is
 * styled `text-transform: uppercase` with a header's letter-spacing and
 * weight. `position: fixed` escapes the sidebar's box but NOT its inherited
 * type, so a sheet rendered in place came out shouting every word of its own
 * body text. Portalling puts it back under <body>'s type.
 */
export function Sheet({
  label,
  narrow = false,
  onClose,
  children
}: {
  label: string
  narrow?: boolean
  onClose: () => void
  children: ReactNode
}): JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="sheet__scrim" onClick={onClose} role="presentation">
      <div
        className={`sheet${narrow ? ' sheet--narrow' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}
