import type { JSX } from 'react'
import { runFile } from './runFile'
import { runnerFor } from './runners'
import './run.css'

function PlayIcon(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 1.6 10 6l-7 4.4z" fill="currentColor" />
    </svg>
  )
}

/**
 * The editor toolbar's ▶. Absent — not disabled — for files nothing can run,
 * so prose tabs keep the chrome they had. The run lands in the terminal
 * panel as a plain command line the author can read, edit and re-run.
 */
export function RunButton({ path }: { path: string }): JSX.Element | null {
  const runner = runnerFor(path)
  if (runner === null) return null
  return (
    <button
      className="run-button"
      onClick={() => void runFile(path)}
      title={`Run with ${runner.program} (⌃⏎)`}
      aria-label={`Run this file with ${runner.program}`}
      data-run-program={runner.program}
    >
      <PlayIcon />
    </button>
  )
}
