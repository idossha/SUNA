import type { JSX } from 'react'
import type { Round } from '@suna/core'
import { openRoundTab } from '../state/dock'
import './documents.css'

/**
 * The lower panel while Peer review is selected: the rounds, listed the way
 * Letters lists letters. Picking one opens its workspace AND hands this panel
 * that round's point-by-point outline.
 */
export function RoundList({
  rounds,
  rootDir,
  onPick
}: {
  rounds: readonly Round[]
  rootDir: string | null
  onPick: (roundId: string) => void
}): JSX.Element {
  if (rounds.length === 0) {
    return (
      <div className="docout">
        <p className="docout__empty">No review rounds in this project.</p>
      </div>
    )
  }

  return (
    <div className="docout">
      <ul className="docout__list">
        {rounds.map((round) => (
          <li key={round.id}>
            <button
              className="letters__row"
              disabled={rootDir === null}
              onClick={() => {
                if (rootDir !== null) openRoundTab(rootDir, round.id)
                onPick(round.id)
              }}
              title={round.venue ?? round.label}
            >
              <span className="letters__row-title">{round.label}</span>
              <span className="letters__row-sub">
                {round.kind === 'external' ? 'External' : 'Internal'} ·{' '}
                {round.decision ?? round.state}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
