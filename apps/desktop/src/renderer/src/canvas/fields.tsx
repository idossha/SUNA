import { useEffect, useState, type JSX } from 'react'
import { fmt } from './canvas-util'

/**
 * Small form controls shared by the properties-rail sections (canvas parity
 * spec §3). Kept framework-free beyond React so Align/Figure/Palette/Export
 * can all reuse one commit-on-blur number field.
 */

/** Number input that commits on Enter/blur (never per keystroke). */
export function NumberField(props: {
  label: string
  value: number | null
  onCommit: (n: number) => void
  step?: number
  invalid?: string | null
  disabled?: boolean
}): JSX.Element {
  const shown = props.value === null ? '' : fmt(props.value)
  const [text, setText] = useState(shown)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setText(shown)
  }, [shown, editing])
  const commit = (): void => {
    setEditing(false)
    const n = Number(text)
    if (text.trim() === '' || Number.isNaN(n)) return
    if (props.value !== null && Math.abs(n - props.value) < 1e-6) return
    props.onCommit(n)
  }
  return (
    <label
      className={`canvas-props__field${props.invalid ? ' canvas-props__field--invalid' : ''}`}
      title={props.invalid ?? undefined}
    >
      <span>{props.label}</span>
      <input
        type="number"
        value={text}
        step={props.step ?? 1}
        disabled={props.disabled ?? false}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
    </label>
  )
}
