import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react'

interface EditableGroupProps {
  /** Class for the static (journal-rendered) wrapper, e.g. "msdoc__authors". */
  className: string
  /** e.g. "authors" — used for the aria-label on both states. */
  ariaLabel: string
  /** Journal-style rendering shown until the group is clicked. */
  display: ReactNode
  /** The row editor shown while editing. */
  children: ReactNode
}

/**
 * Click-to-edit for the two title-page blocks that need real controls
 * (authors, affiliations) rather than a contentEditable span: the journal
 * rendering — including the DERIVED affiliation superscripts — stays on
 * screen until you click it, then the compact row editor takes over in
 * place. Nothing is a modal.
 *
 * Closing blurs whatever input is focused *first*, so a text field's
 * commit-on-blur runs before the editor unmounts and a half-typed rename is
 * never dropped.
 */
export function EditableGroup({
  className,
  ariaLabel,
  display,
  children
}: EditableGroupProps): JSX.Element {
  const [editing, setEditing] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  const close = (): void => {
    const active = document.activeElement
    if (active instanceof HTMLElement && boxRef.current?.contains(active)) active.blur()
    window.setTimeout(() => setEditing(false), 0)
  }

  // Clicking anywhere outside the open editor closes it (same dismissal the
  // rest of the app's popovers use), as does Escape.
  useEffect(() => {
    if (!editing) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && boxRef.current?.contains(target)) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [editing])

  if (!editing) {
    return (
      <div
        className={`${className} tp__group`}
        role="button"
        tabIndex={0}
        aria-label={`Edit ${ariaLabel}`}
        onClick={() => setEditing(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setEditing(true)
          }
        }}
      >
        {display}
      </div>
    )
  }

  return (
    <div ref={boxRef} className={`${className} tp__group tp__group--editing`} aria-label={ariaLabel}>
      {children}
      <button type="button" className="tp__group-done" onClick={close}>
        Done
      </button>
    </div>
  )
}
