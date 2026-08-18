import { useEffect, useRef, type FormEvent, type JSX, type KeyboardEvent, type ReactNode } from 'react'
import type { InlineFieldController } from './useInlineField'

interface EditableBlockProps {
  /** Applied to BOTH the static and editing element — e.g. "msdoc__title
   *  tp__title" — so the verifier can select `.tp__title[contenteditable]`
   *  to know a field is mid-edit, and so typography never shifts between
   *  the two (box metrics come entirely from the class, never the tag). */
  className: string
  field: InlineFieldController
  ariaLabel: string
  /** Shown instead of `children` when the committed value is empty (only
   *  meaningful for nullable fields like significance). */
  placeholder?: string
  /** The rendered (KaTeX-through-TexText) static content. */
  children: ReactNode
}

/**
 * Click-to-edit block: a static display that swaps for a contentEditable div
 * on click, matching canvas/TextEditOverlay's approach (uncontrolled DOM,
 * seeded once on entering edit mode, read off input/blur — never re-set by
 * React while focused, which would fight the caret).
 *
 * The two branches carry distinct keys so React remounts rather than reusing
 * one div across the swap: the editing branch's text is written imperatively
 * (`el.textContent = seed`), which React has no vdom record of, so a reused
 * node would keep that raw text and APPEND the rendered children beside it —
 * the field showing its value twice once the edit ended.
 */
export function EditableBlock({
  className,
  field,
  ariaLabel,
  placeholder,
  children
}: EditableBlockProps): JSX.Element {
  const elRef = useRef<HTMLDivElement | null>(null)
  const seedRef = useRef(field.displayValue)
  seedRef.current = field.displayValue

  useEffect(() => {
    if (!field.editing) return
    const el = elRef.current
    if (!el) return
    el.textContent = seedRef.current
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.editing])

  if (field.editing) {
    const onInput = (e: FormEvent<HTMLDivElement>): void => {
      field.input(e.currentTarget.innerText.replace(/\n+$/, ''))
    }
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        field.cancel()
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        field.flush()
      }
    }
    return (
      <>
        <div
          key="editing"
          ref={elRef}
          className={`${className} tp__field--editing`}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          aria-label={ariaLabel}
          onInput={onInput}
          onBlur={field.flush}
          onKeyDown={onKeyDown}
        />
        {field.error !== null && <div className="tp__field-error">{field.error}</div>}
      </>
    )
  }

  const isEmpty = field.displayValue.trim() === ''
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      field.start()
    }
  }
  return (
    <div
      key="static"
      className={className}
      onClick={field.start}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Edit ${ariaLabel}`}
    >
      {isEmpty && placeholder !== undefined ? (
        <span className="tp__placeholder">{placeholder}</span>
      ) : (
        children
      )}
    </div>
  )
}
