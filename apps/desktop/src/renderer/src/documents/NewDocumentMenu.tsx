import { useLayoutEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import './documents.css'

/**
 * The Documents "+" menu.
 *
 * Portalled onto `document.body` and positioned `fixed` off the anchor
 * button's own rect — the same thing `shell/ProjectMenu.tsx` does, and for
 * the same reason. An absolutely-positioned menu inside the sidebar is
 * clipped by it: the panel is ~220 px wide, the menu is wider than the button
 * it hangs off, and anchoring it to the button's right edge pushes it off the
 * panel's left edge where it is cut in half.
 *
 * Positions are clamped to the viewport after measuring, so the menu cannot
 * open off-screen at any sidebar width.
 */

const MENU_MARGIN = 8

export interface NewDocumentMenuItem {
  label: string
  onSelect: () => void
}

export function NewDocumentMenu({
  anchorEl,
  items,
  onClose
}: {
  anchorEl: HTMLElement
  items: readonly NewDocumentMenuItem[]
  onClose: () => void
}): JSX.Element {
  const menuRef = useRef<HTMLUListElement>(null)
  const [pos, setPos] = useState(() => {
    const rect = anchorEl.getBoundingClientRect()
    return { left: rect.left, top: rect.bottom + 4 }
  })

  useLayoutEffect(() => {
    const el = menuRef.current
    const rect = anchorEl.getBoundingClientRect()
    const width = el?.offsetWidth ?? 220
    const height = el?.offsetHeight ?? 120
    setPos({
      left: Math.min(Math.max(MENU_MARGIN, rect.left), window.innerWidth - width - MENU_MARGIN),
      top: Math.min(
        Math.max(MENU_MARGIN, rect.bottom + 4),
        window.innerHeight - height - MENU_MARGIN
      )
    })
  }, [anchorEl, items.length])

  return createPortal(
    <>
      <div className="docs__menu-scrim" onClick={onClose} role="presentation" />
      <ul
        ref={menuRef}
        className="docs__menu"
        role="menu"
        style={{ left: pos.left, top: pos.top }}
      >
        {items.map((item) => (
          <li key={item.label}>
            <button
              role="menuitem"
              onClick={() => {
                onClose()
                item.onSelect()
              }}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </>,
    document.body
  )
}
