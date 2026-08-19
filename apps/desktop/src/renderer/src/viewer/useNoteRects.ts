import { useEffect, useState } from 'react'
import type { PdfNote } from '@suna/core'
import { rectsForOffsets, type HighlightRect } from './pdfGeometry'
import type { RenderedPage } from './pdfSelection'
import { pageTextsOf, resolveRun } from './resolveRuns'

/**
 * Where every note sits, resolved once and shared (ADR-008).
 *
 * One computation feeds two consumers that must not disagree: the overlay the
 * reader sees, and the `/QuadPoints` written into the PDF itself. Computing
 * them separately would let SUNA paint a highlight in one place and embed it
 * in another — a difference nobody would notice until the paper was opened in
 * Preview.
 */

/** Painted rectangles for one note, grouped by the page they landed on. */
export type NoteRects = ReadonlyMap<number, HighlightRect[]>

export interface ResolvedNotes {
  /** note id -> page -> rectangles, in page-relative CSS pixels. */
  byNote: ReadonlyMap<string, NoteRects>
  /** Note ids whose runs matched several equally-good places. */
  ambiguous: ReadonlySet<string>
  /** Note ids no longer found anywhere in the rendered text. */
  detached: ReadonlySet<string>
  /** Bumped whenever the map is rebuilt, so consumers can depend on it. */
  epoch: number
}

const EMPTY: ResolvedNotes = {
  byNote: new Map(),
  ambiguous: new Set(),
  detached: new Set(),
  epoch: 0
}

/**
 * Resolve and measure every note against the pages currently rendered.
 *
 * Rebuilt on scale change because the rectangles are CSS pixels; rebuilt on
 * `textEpoch` because a page scrolling into view brings new text to resolve
 * against, and a note anchored there has been waiting to appear.
 */
export function useNoteRects(
  notes: readonly PdfNote[],
  rendered: readonly RenderedPage[],
  pageElFor: (page: number) => HTMLElement | null,
  scale: number,
  textEpoch: number
): ResolvedNotes {
  const [resolved, setResolved] = useState<ResolvedNotes>(EMPTY)

  useEffect(() => {
    if (notes.length === 0 || rendered.length === 0) {
      setResolved((prev) => (prev.byNote.size === 0 ? prev : { ...EMPTY, epoch: prev.epoch + 1 }))
      return
    }

    const pageTexts = pageTextsOf(rendered)
    const byPage = new Map(rendered.map((entry) => [entry.page, entry]))
    const byNote = new Map<string, Map<number, HighlightRect[]>>()
    const ambiguous = new Set<string>()
    const detached = new Set<string>()

    for (const note of notes) {
      const pages = new Map<number, HighlightRect[]>()
      let anyResolved = false

      for (const run of note.runs) {
        if (run.detached) continue
        const resolution = resolveRun(run, pageTexts)
        if (resolution.kind === 'detached' || resolution.offsets === undefined) continue
        anyResolved = true
        if (resolution.kind === 'ambiguous') ambiguous.add(note.id)

        const entry = byPage.get(resolution.page)
        const host = pageElFor(resolution.page)
        if (entry === undefined || host === null) continue

        const rects = rectsForOffsets(entry, host, resolution.offsets.from, resolution.offsets.to)
        if (rects.length === 0) continue
        const existing = pages.get(resolution.page)
        if (existing) existing.push(...rects)
        else pages.set(resolution.page, rects)
      }

      if (!anyResolved) detached.add(note.id)
      if (pages.size > 0) byNote.set(note.id, pages)
    }

    setResolved((prev) => ({ byNote, ambiguous, detached, epoch: prev.epoch + 1 }))
    // `pageElFor` is a stable ref-reader from the caller; including it would
    // rebuild on every render for no gain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, rendered, scale, textEpoch])

  return resolved
}
