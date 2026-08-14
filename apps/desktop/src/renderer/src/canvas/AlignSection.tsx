import type { JSX } from 'react'
import type { CanvasCommand } from '@suna/core'

/**
 * Align & distribute (canvas parity spec §3.1): 6 align buttons + Distribute
 * H/V, wired directly to the engine's existing `align`/`distribute`
 * commands. Always visible in the rail (unlike the selection-only sections
 * below it) so the requirement is discoverable even with nothing selected.
 */

interface AlignSectionProps {
  selectedIds: string[]
  apply: (command: CanvasCommand, label: string) => boolean
}

type AlignKind = 'left' | 'h-center' | 'right' | 'top' | 'v-middle' | 'bottom'

const ALIGN_BUTTONS: { kind: AlignKind; label: string; axis: 'x' | 'y'; mode: 'start' | 'center' | 'end' }[] = [
  { kind: 'left', label: 'Align left', axis: 'x', mode: 'start' },
  { kind: 'h-center', label: 'Align center', axis: 'x', mode: 'center' },
  { kind: 'right', label: 'Align right', axis: 'x', mode: 'end' },
  { kind: 'top', label: 'Align top', axis: 'y', mode: 'start' },
  { kind: 'v-middle', label: 'Align middle', axis: 'y', mode: 'center' },
  { kind: 'bottom', label: 'Align bottom', axis: 'y', mode: 'end' }
]

/** Small stroke-style icons matching the ToolRail's 18×18 viewBox convention. */
function AlignIcon({ kind }: { kind: AlignKind | 'distribute-h' | 'distribute-v' }): JSX.Element {
  switch (kind) {
    case 'left':
      return (
        <>
          <line x1="3" y1="2" x2="3" y2="16" />
          <rect x="3" y="4" width="6" height="3.5" />
          <rect x="3" y="10.5" width="10" height="3.5" />
        </>
      )
    case 'h-center':
      return (
        <>
          <line x1="9" y1="2" x2="9" y2="16" />
          <rect x="6" y="4" width="6" height="3.5" />
          <rect x="4" y="10.5" width="10" height="3.5" />
        </>
      )
    case 'right':
      return (
        <>
          <line x1="15" y1="2" x2="15" y2="16" />
          <rect x="9" y="4" width="6" height="3.5" />
          <rect x="5" y="10.5" width="10" height="3.5" />
        </>
      )
    case 'top':
      return (
        <>
          <line x1="2" y1="3" x2="16" y2="3" />
          <rect x="4" y="3" width="3.5" height="6" />
          <rect x="10.5" y="3" width="3.5" height="10" />
        </>
      )
    case 'v-middle':
      return (
        <>
          <line x1="2" y1="9" x2="16" y2="9" />
          <rect x="4" y="6" width="3.5" height="6" />
          <rect x="10.5" y="4" width="3.5" height="10" />
        </>
      )
    case 'bottom':
      return (
        <>
          <line x1="2" y1="15" x2="16" y2="15" />
          <rect x="4" y="9" width="3.5" height="6" />
          <rect x="10.5" y="5" width="3.5" height="10" />
        </>
      )
    case 'distribute-h':
      return (
        <>
          <rect x="2" y="6" width="3" height="6" />
          <rect x="7.5" y="6" width="3" height="6" />
          <rect x="13" y="6" width="3" height="6" />
        </>
      )
    case 'distribute-v':
      return (
        <>
          <rect x="6" y="2" width="6" height="3" />
          <rect x="6" y="7.5" width="6" height="3" />
          <rect x="6" y="13" width="6" height="3" />
        </>
      )
  }
}

function AlignButton(props: {
  kind: AlignKind | 'distribute-h' | 'distribute-v'
  label: string
  disabledReason: string | null
  onClick: () => void
}): JSX.Element {
  return (
    <button
      className="canvas-align__button"
      aria-label={props.label}
      title={props.disabledReason ?? props.label}
      disabled={props.disabledReason !== null}
      onClick={props.onClick}
    >
      <svg
        viewBox="0 0 18 18"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <AlignIcon kind={props.kind} />
      </svg>
    </button>
  )
}

export function AlignSection(props: AlignSectionProps): JSX.Element {
  const { selectedIds, apply } = props
  const alignDisabled =
    selectedIds.length < 2 ? 'Select at least 2 objects to align' : null
  const distributeDisabled =
    selectedIds.length < 3 ? 'Select at least 3 objects to distribute' : null

  return (
    <div className="canvas-props__section">
      <div className="canvas-props__title">Align</div>
      <div className="canvas-align__row">
        {ALIGN_BUTTONS.map((b) => (
          <AlignButton
            key={b.kind}
            kind={b.kind}
            label={b.label}
            disabledReason={alignDisabled}
            onClick={() =>
              apply({ kind: 'align', targets: [...selectedIds], axis: b.axis, mode: b.mode }, b.label)
            }
          />
        ))}
      </div>
      <div className="canvas-align__row canvas-align__row--distribute">
        <AlignButton
          kind="distribute-h"
          label="Distribute horizontally"
          disabledReason={distributeDisabled}
          onClick={() =>
            apply(
              { kind: 'distribute', targets: [...selectedIds], axis: 'x' },
              'Distribute horizontally'
            )
          }
        />
        <AlignButton
          kind="distribute-v"
          label="Distribute vertically"
          disabledReason={distributeDisabled}
          onClick={() =>
            apply(
              { kind: 'distribute', targets: [...selectedIds], axis: 'y' },
              'Distribute vertically'
            )
          }
        />
      </div>
    </div>
  )
}
