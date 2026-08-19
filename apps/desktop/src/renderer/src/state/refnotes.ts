import { create } from 'zustand'
import {
  ReferenceNotesFileSchema,
  emptyReferenceNotes,
  type NoteColor,
  type PdfNote,
  type PdfNoteRun,
  type ReferenceNotesFile
} from '@suna/core'
import { readLocalAuthorName } from './comments'

/**
 * `references/notes/<citekey>.json` state (ADR-008 M2).
 *
 * One paper loaded at a time — the PDF viewer shows one document — so this is
 * a single-slot store rather than a project-wide map. That is the point of the
 * per-paper file: reading five papers costs five small files, not one growing
 * one, and a highlight rewrites only the paper it is on.
 */

function makeId(): string {
  const date = new Date().toISOString().slice(0, 10)
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
      : Math.random().toString(16).slice(2, 10)
  return `n-${date}-${random}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface RefNotesState {
  /** Project the loaded file belongs to; null when nothing is loaded. */
  rootDir: string | null
  citekey: string | null
  file: ReferenceNotesFile | null
  loading: boolean
  error: string | null

  load: (rootDir: string, citekey: string) => Promise<void>
  clear: () => void
  addNote: (runs: PdfNoteRun[], color: NoteColor, body?: string) => Promise<PdfNote | null>
  updateNote: (id: string, patch: Partial<Pick<PdfNote, 'body' | 'color' | 'tags'>>) => Promise<void>
  deleteNote: (id: string) => Promise<void>
  /** Replace runs after a re-anchor sweep; writes only when something changed. */
  applyResolvedRuns: (updates: ReadonlyMap<string, PdfNoteRun[]>) => Promise<void>
  /**
   * Regions of notes just removed, awaiting removal from the PDF too.
   *
   * Geometry alone cannot tell an annotation whose note was deleted from a
   * highlight someone made in Preview — both cover a region no note claims —
   * and guessing would delete a stranger's work. So a deletion is only ever
   * performed for a region named here, and the list is cleared once the file
   * agrees.
   */
  pendingRemovals: { page: number; rects: { left: number; top: number; width: number; height: number }[] }[]
  noteRemoved: (regions: { page: number; rects: { left: number; top: number; width: number; height: number }[] }[]) => void
  clearPendingRemovals: () => void
  /**
   * The printed page number minus the page index, set once per document.
   *
   * Needed because `getPageLabels()` answers null for arXiv and CVPR — exactly
   * the preprints researchers read most — so `p. 3` is the third sheet, which
   * on a paper whose body starts at 108 is a citation error nobody catches
   * until proof stage.
   */
  setPageLabelOffset: (offset: number, pageCount: number) => Promise<void>
}

export const useRefNotesStore = create<RefNotesState>((set, get) => ({
  rootDir: null,
  citekey: null,
  file: null,
  loading: false,
  error: null,

  load: async (rootDir, citekey) => {
    set({ rootDir, citekey, loading: true, error: null, file: null, pendingRemovals: [] })
    try {
      const { file } = await window.suna.invoke('refnotes:read', { dir: rootDir, citekey })
      // A different PDF may have been opened while this read was in flight.
      if (get().citekey !== citekey || get().rootDir !== rootDir) return
      set({ file: ReferenceNotesFileSchema.parse(file), loading: false })
    } catch (error) {
      if (get().citekey !== citekey) return
      set({ loading: false, error: errorMessage(error), file: emptyReferenceNotes(citekey) })
    }
  },

  clear: () =>
    set({ rootDir: null, citekey: null, file: null, loading: false, error: null, pendingRemovals: [] }),

  addNote: async (runs, color, body = '') => {
    const { rootDir, citekey, file } = get()
    if (rootDir === null || citekey === null || file === null || runs.length === 0) return null
    const now = new Date().toISOString()
    const note: PdfNote = {
      id: makeId(),
      color,
      runs,
      body,
      tags: [],
      author: { kind: 'human', name: readLocalAuthorName() },
      createdAt: now,
      updatedAt: now,
      ambiguous: false
    }
    await persist(set, get, { ...file, notes: [...file.notes, note] })
    return note
  },

  updateNote: async (id, patch) => {
    const { file } = get()
    if (file === null) return
    const now = new Date().toISOString()
    const notes = file.notes.map((note) =>
      note.id === id ? { ...note, ...patch, updatedAt: now } : note
    )
    await persist(set, get, { ...file, notes })
  },

  deleteNote: async (id) => {
    const { file } = get()
    if (file === null) return
    await persist(set, get, { ...file, notes: file.notes.filter((note) => note.id !== id) })
  },

  applyResolvedRuns: async (updates) => {
    const { file } = get()
    if (file === null || updates.size === 0) return
    let changed = false
    const notes = file.notes.map((note) => {
      const runs = updates.get(note.id)
      if (runs === undefined) return note
      if (JSON.stringify(runs) === JSON.stringify(note.runs)) return note
      changed = true
      return { ...note, runs }
    })
    // Reading a paper must never produce a git-modified file: when nothing
    // moved, nothing is written.
    if (!changed) return
    await persist(set, get, { ...file, notes })
  },

  pendingRemovals: [],

  noteRemoved: (regions) => {
    if (regions.length === 0) return
    set({ pendingRemovals: [...get().pendingRemovals, ...regions] })
  },

  clearPendingRemovals: () => set({ pendingRemovals: [] }),

  setPageLabelOffset: async (offset, pageCount) => {
    const { file, citekey } = get()
    if (file === null || citekey === null) return
    const existing = file.source
    const source = {
      path: existing?.path ?? `references/${citekey}.pdf`,
      sha256: existing?.sha256 ?? '',
      pageCount: existing?.pageCount ?? Math.max(1, pageCount),
      pageLabelOffset: offset,
      extractor: existing?.extractor ?? { pdfjs: PDFJS_VERSION, pageText: 1 },
      sweptAt: new Date().toISOString()
    }
    await persist(set, get, { ...file, source })
  }
}))

/**
 * The extractor version stamped into the sidecar. Bumping pdfjs-dist can
 * change how a page's text comes out, which is exactly when stored quotes
 * deserve re-checking rather than trusting.
 */
const PDFJS_VERSION = '6.2.108'

/**
 * Optimistic in-memory update, then the atomic write. A failed write rolls the
 * store back to what is actually on disk rather than leaving the UI showing a
 * highlight the file does not have.
 */
async function persist(
  set: (partial: Partial<RefNotesState>) => void,
  get: () => RefNotesState,
  next: ReferenceNotesFile
): Promise<void> {
  const { rootDir, citekey, file: previous } = get()
  if (rootDir === null || citekey === null) return
  set({ file: next, error: null })
  try {
    await window.suna.invoke('refnotes:write', { dir: rootDir, citekey, file: next })
  } catch (error) {
    set({ file: previous, error: errorMessage(error) })
  }
}
