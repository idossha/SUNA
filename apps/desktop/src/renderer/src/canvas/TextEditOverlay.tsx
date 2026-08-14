import { useEffect, useRef, type JSX } from 'react'

export interface TextEditLayout {
  left: number
  top: number
  fontSizePx: number
  fontFamily: string
  fontWeight: string
  color: string
}

interface TextEditOverlayProps {
  layout: TextEditLayout
  initialText: string
  /** New elements open with their placeholder selected so typing replaces it. */
  selectAll: boolean
  onCommit: (text: string) => void
  onCancel: () => void
}

/**
 * Positioned contenteditable matching the text element's font, scaled by zoom
 * (spec §7). Commit on blur/⌘Enter/Enter → set-text; Escape cancels. The host
 * hides the mirror's text element while this is open.
 */
export function TextEditOverlay(props: TextEditOverlayProps): JSX.Element {
  const divRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef(false)

  useEffect(() => {
    const div = divRef.current
    if (!div) return
    div.textContent = props.initialText
    div.focus()
    const range = document.createRange()
    range.selectNodeContents(div)
    if (!props.selectAll) range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finish = (commit: boolean): void => {
    if (doneRef.current) return
    doneRef.current = true
    if (commit) props.onCommit(divRef.current?.innerText.replace(/\n+$/, '') ?? '')
    else props.onCancel()
  }

  return (
    <div
      ref={divRef}
      className="canvas-text-edit"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      style={{
        left: props.layout.left,
        top: props.layout.top,
        fontSize: props.layout.fontSizePx,
        fontFamily: props.layout.fontFamily,
        fontWeight: props.layout.fontWeight,
        color: props.layout.color
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') {
          e.preventDefault()
          finish(false)
        } else if (e.key === 'Enter' && !e.shiftKey) {
          // Single-line v1: Enter (and ⌘Enter) commits, ⇧Enter is ignored.
          e.preventDefault()
          finish(true)
        }
      }}
      onBlur={() => finish(true)}
    />
  )
}
