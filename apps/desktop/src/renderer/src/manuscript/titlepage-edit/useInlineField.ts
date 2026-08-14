import { useEffect, useRef, useState } from 'react'
import { commitManuscriptPatch, type CommitResult } from './commit'

const COMMIT_DEBOUNCE_MS = 400

export interface InlineFieldController {
  /** True while the field shows its contentEditable form. */
  editing: boolean
  /** The value to render when not editing (last committed value, or an
   *  optimistic override right after a successful commit — see `useEffect`
   *  below for why the override can't rely on reference equality for arrays,
   *  which is why this hook is scalar-string only). */
  displayValue: string
  error: string | null
  /** Click/keyboard activation on the static display: enter edit mode. */
  start: () => void
  /** Called on every input while editing: never writes immediately —
   *  schedules a commit ~400ms after the last keystroke. */
  input: (raw: string) => void
  /** Blur / Cmd-Enter: cancel any pending debounce and commit now, exiting
   *  edit mode on success (staying open with an inline error otherwise). */
  flush: () => void
  /** Escape: discard the in-progress draft and exit without writing. */
  cancel: () => void
}

/**
 * One scalar manuscript.json field (title, shortTitle, abstract.content,
 * significance) edited in place. The contentEditable DOM itself is
 * uncontrolled (see EditableBlock) — this hook only tracks editing/error
 * state and drives commits through `commitManuscriptPatch`.
 */
export function useInlineField(args: {
  rootDir: string
  value: string
  validate: (raw: string) => string | null
  buildPatch: (raw: string) => Record<string, unknown>
}): InlineFieldController {
  const { rootDir, value } = args
  const [editing, setEditing] = useState(false)
  const [override, setOverride] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Latest callbacks without re-creating the debounce timer machinery below.
  const validateRef = useRef(args.validate)
  validateRef.current = args.validate
  const buildPatchRef = useRef(args.buildPatch)
  buildPatchRef.current = args.buildPatch

  const draftRef = useRef(value)
  const timerRef = useRef<number | null>(null)
  const seqRef = useRef(0)
  // Set by cancel() so a blur that the DOM fires while React unmounts the
  // just-cancelled contentEditable node doesn't re-run flush() and silently
  // write the discarded draft (mirrors canvas/TextEditOverlay's doneRef).
  const suppressNextFlushRef = useRef(false)

  // Once the prop catches up to a value we already optimistically showed
  // (our own successful commit landing back via saveBump → refresh), drop
  // the override so future external changes are visible again.
  useEffect(() => {
    if (override !== null && value === override) setOverride(null)
  }, [value, override])

  const clearTimer = (): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const runCommit = async (raw: string, exitOnSuccess: boolean): Promise<void> => {
    const problem = validateRef.current(raw)
    if (problem !== null) {
      setError(problem)
      return
    }
    const mySeq = ++seqRef.current
    const result: CommitResult = await commitManuscriptPatch(rootDir, buildPatchRef.current(raw))
    if (mySeq !== seqRef.current) return // superseded by a newer edit/cancel
    if (result.ok) {
      setError(null)
      setOverride(raw)
      if (exitOnSuccess) setEditing(false)
    } else {
      setError(result.error)
    }
  }

  return {
    editing,
    displayValue: override ?? value,
    error,
    start: () => {
      draftRef.current = override ?? value
      setError(null)
      setEditing(true)
    },
    input: (raw: string) => {
      draftRef.current = raw
      clearTimer()
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        void runCommit(raw, false)
      }, COMMIT_DEBOUNCE_MS)
    },
    flush: () => {
      if (suppressNextFlushRef.current) {
        suppressNextFlushRef.current = false
        return
      }
      clearTimer()
      void runCommit(draftRef.current, true)
    },
    cancel: () => {
      clearTimer()
      suppressNextFlushRef.current = true
      seqRef.current++
      setError(null)
      setEditing(false)
    }
  }
}
