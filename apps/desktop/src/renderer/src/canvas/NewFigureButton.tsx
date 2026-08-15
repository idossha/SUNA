import { useState, type JSX, type KeyboardEvent } from 'react'
import { createNewFigure } from './new-figure'

/**
 * "New Figure" affordance: a plain button that turns into an inline text
 * field on click (no modal) — Enter creates+opens the figure, Escape or
 * blur-with-no-text cancels. Shared by the Figures view header and the
 * canvas tab's own "+" (feature-plan-3 §4).
 */
export function NewFigureButton(props: {
  rootDir: string
  className: string
  inputClassName: string
  title?: string
  label?: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const start = (): void => {
    setName('')
    setOpen(true)
  }

  const cancel = (): void => {
    setOpen(false)
    setName('')
  }

  const commit = async (): Promise<void> => {
    if (busy) return
    const trimmed = name.trim()
    if (trimmed === '') {
      cancel()
      return
    }
    setBusy(true)
    await createNewFigure(props.rootDir, trimmed)
    setBusy(false)
    setOpen(false)
    setName('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    event.stopPropagation()
    if (event.key === 'Enter') void commit()
    else if (event.key === 'Escape') cancel()
  }

  if (open) {
    return (
      <input
        autoFocus
        className={props.inputClassName}
        placeholder="Figure name…"
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => void commit()}
      />
    )
  }
  return (
    <button className={props.className} title={props.title ?? 'New figure'} onClick={start}>
      {props.label ?? '+'}
    </button>
  )
}
