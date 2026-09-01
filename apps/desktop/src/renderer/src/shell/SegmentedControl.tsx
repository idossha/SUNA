import type { JSX } from 'react'
import './segmented.css'

/**
 * A segmented control: two or more mutually exclusive options, all visible,
 * one lit.
 *
 * Introduced for the document tabs' view switch (ARCHITECTURE §13). It
 * replaced a single button that CYCLED — a control that showed the mode you
 * were in but not the modes you could reach, so "what else is there?" could
 * only be answered by clicking and finding out. With three modes rather than
 * two that stopped being a small annoyance: reaching Pages from Source meant
 * two clicks through a state you did not want, and nothing on screen said so.
 *
 * The shape deliberately matches the round workspace's Focus / Continuous
 * switch (documents.css `.round__modes`), which is the same gesture — pick a
 * way of viewing this document — so the app answers it the same way twice.
 * It is a separate component rather than a reuse of those classes because
 * `.round__*` belongs to the round workspace; a manuscript borrowing it would
 * couple two surfaces that have nothing else in common.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  className
}: {
  value: T
  options: readonly { value: T; label: string; title?: string }[]
  onChange: (value: T) => void
  /** Names the group for screen readers — "View", "Mode". */
  label: string
  className?: string
}): JSX.Element {
  return (
    <div className={`seg${className === undefined ? '' : ` ${className}`}`} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`seg__option${option.value === value ? ' is-on' : ''}`}
          // The lit segment is the current state, not a disabled button: it
          // stays clickable so a mis-click costs nothing, and announces
          // itself rather than relying on colour alone.
          aria-pressed={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
