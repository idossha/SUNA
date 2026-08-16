import { useEffect, useRef, useState } from 'react'
import { commitAuthorsPatch, type AuthorsCommitResult } from './commit'

const COMMIT_DEBOUNCE_MS = 400

export interface ArrayFieldController<T> {
  /** Local working copy — always what's on screen, optimistic. */
  list: T[]
  error: string | null
  /** Free-text edit: update the local list immediately, commit ~400ms later. */
  edit: (next: T[]) => void
  /** Structural edit (add/remove/reorder/toggle): update + commit immediately. */
  mutate: (next: T[]) => void
  /** Blur on a text input: cancel the pending debounce and commit now. */
  flush: () => void
}

/**
 * One authors.json array field (authors, affiliations — feature-plan-7 §1
 * moved the byline out of manuscript.json) edited as a whole: every change
 * here is a full-array patch, committed through `commitAuthorsPatch`'s own
 * read-merge-validate-write. Local `list` is authoritative once mounted; it
 * only re-syncs from the incoming prop while nothing is pending (see the
 * effect below), so an in-progress edit is never clobbered by an unrelated
 * save elsewhere on the page bumping saveBump → refresh.
 */
export function useArrayField<T>(args: {
  rootDir: string
  value: readonly T[]
  buildPatch: (list: readonly T[]) => Record<string, unknown>
  validate: (list: readonly T[]) => string | null
}): ArrayFieldController<T> {
  const { rootDir, value } = args
  const buildPatchRef = useRef(args.buildPatch)
  buildPatchRef.current = args.buildPatch
  const validateRef = useRef(args.validate)
  validateRef.current = args.validate

  const [list, setList] = useState<T[]>(() => [...value])
  const [error, setError] = useState<string | null>(null)
  const pendingRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const seqRef = useRef(0)

  useEffect(() => {
    if (!pendingRef.current) setList([...value])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const clearTimer = (): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const commit = async (next: T[]): Promise<void> => {
    const problem = validateRef.current(next)
    if (problem !== null) {
      setError(problem)
      return // pendingRef stays true — the unsaved draft must not be clobbered
    }
    const mySeq = ++seqRef.current
    const result: AuthorsCommitResult = await commitAuthorsPatch(rootDir, buildPatchRef.current(next))
    if (mySeq !== seqRef.current) return
    if (result.ok) {
      pendingRef.current = false
      setError(null)
    } else {
      setError(result.error)
    }
  }

  return {
    list,
    error,
    edit: (next) => {
      setList(next)
      pendingRef.current = true
      clearTimer()
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        void commit(next)
      }, COMMIT_DEBOUNCE_MS)
    },
    mutate: (next) => {
      setList(next)
      pendingRef.current = true
      clearTimer()
      void commit(next)
    },
    flush: () => {
      if (!pendingRef.current) return
      clearTimer()
      void commit(list)
    }
  }
}
