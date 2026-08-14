import type { JSX } from 'react'
import type { interact } from '@suna/canvas'

interface ToolRailProps {
  tool: interact.ToolId
  onSelectTool: (tool: interact.ToolId) => void
}

const TOOLS: { id: interact.ToolId; label: string; shortcut: string; icon: JSX.Element }[] = [
  {
    id: 'select',
    label: 'Select',
    shortcut: 'V',
    icon: <path d="M5 3l7.5 7.2-4.6.6 2.6 5-1.8.9-2.6-5L3 15z" fill="currentColor" stroke="none" />
  },
  {
    id: 'rect',
    label: 'Rectangle',
    shortcut: 'R',
    icon: <rect x="3.5" y="4.5" width="11" height="9" rx="0.5" />
  },
  {
    id: 'ellipse',
    label: 'Ellipse',
    shortcut: 'O',
    icon: <ellipse cx="9" cy="9" rx="5.7" ry="4.6" />
  },
  {
    id: 'line',
    label: 'Line',
    shortcut: 'L',
    icon: <path d="M4 14L14 4" />
  },
  {
    id: 'arrow',
    label: 'Arrow',
    shortcut: 'A',
    icon: (
      <>
        <path d="M4 14L13 5" />
        <path d="M8.5 4.5H13.5V9.5" />
      </>
    )
  },
  {
    id: 'text',
    label: 'Text',
    shortcut: 'T',
    icon: <path d="M4.5 5.5V4h9v1.5M9 4v10M7.2 14h3.6" />
  }
]

/** Left-edge tool rail (spec §1): V/R/O/L/A/T with active state + shortcuts. */
export function ToolRail({ tool, onSelectTool }: ToolRailProps): JSX.Element {
  return (
    <div className="canvas-toolrail" role="toolbar" aria-label="Canvas tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className="canvas-toolrail__tool"
          data-tool={t.id}
          aria-pressed={tool === t.id}
          title={`${t.label} (${t.shortcut})`}
          onClick={() => onSelectTool(t.id)}
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
            {t.icon}
          </svg>
        </button>
      ))}
    </div>
  )
}
