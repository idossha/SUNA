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
  /**
   * The sidecar exists but could not be read.
   *
   * Nothing is written while this is set. The renderer used to substitute an
   * empty file on a parse failure and the next highlight persisted it, so one
   * merge-conflict marker in `references/notes/<key>.json` silently destroyed
   * every note on that paper.
   */
  loadFailed: boolean
  /**
   * Bumped on every successful write.
   *
   * The cross-paper view reads every paper's notes, but the store only ever
   * holds the paper on screen — so it cannot learn about a new highlight by
   * watching the notes themselves. A counter is the whole signal it needs, and
   * it costs nothing: `saveBump` would have worked too, but every bump makes
   * `referencePdfs` rescan the whole references directory and re-parse the
   * bibliography, which is a lot to pay for one highlight.
   */
  revision: number

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
  pendingRemovals: { page: number; quads: number[] }[]
  noteRemoved: (regions: { page: number; quads: number[] }[]) => void
  /**
   * Drop the removals that were actually performed, keeping any the reconcile
   * could not match.
   *
   * Clearing the whole array threw away removals queued WHILE a sync was in
   * flight — delete two highlights a second apart on a large paper and the
   * second one is gone from the UI and permanent in the PDF. And a removal
   * that matched nothing must survive to be retried rather than be reported
   * as done.
   */
  clearPendingRemovals: (
    consumed?: readonly { page: number; quads: readonly number[] }[],
    unmatched?: readonly { page: number; quads: readonly number[] }[]
  ) => void
  /**
   * Record where each note's annotation ended up in the PDF, in user space.
   *
   * Written after every sync, for notes that were already correct as well as
   * ones just created, so a sidecar predating this backfills the moment its
   * page is viewed — and a later removal never has to consult the DOM.
   */
  recordEmbeds: (located: readonly { noteId: string; page: number; quads: readonly number[] }[]) => Promise<void>
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
  loadFailed: false,
  revision: 0,

  load: async (rootDir, citekey) => {
    set({
      rootDir,
      citekey,
      loading: true,
      error: null,
      loadFailed: false,
      file: null,
      pendingRemovals: []
    })
    try {
      const { file } = await window.suna.invoke('refnotes:read', { dir: rootDir, citekey })
      // A different PDF may have been opened while this read was in flight.
      if (get().citekey !== citekey || get().rootDir !== rootDir) return
      set({ file: ReferenceNotesFileSchema.parse(file), loading: false })
    } catch (error) {
      if (get().citekey !== citekey) return
      // Show the notes as empty so the viewer still works, but refuse to
      // WRITE: overwriting an unreadable sidecar would destroy whatever is in
      // it, which is the opposite of what the read guard is for.
      set({
        loading: false,
        error: errorMessage(error),
        loadFailed: true,
        file: emptyReferenceNotes(citekey)
      })
    }
  },

  clear: () =>
    set({
      rootDir: null,
      citekey: null,
      file: null,
      loading: false,
      error: null,
      loadFailed: false,
      pendingRemovals: []
    }),

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
      ambiguous: false,
      embed: []
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

  clearPendingRemovals: (consumed = [], unmatched = []) => {
    const id = (r: { page: number; quads: readonly number[] }): string =>
      `${r.page}:${r.quads.join(',')}`
    const done = new Set(consumed.map(id))
    for (const miss of unmatched) done.delete(id(miss))
    // Keep anything this sync did not see (queued while it was in flight) and
    // anything it saw but could not match (so it is retried, not lost).
    set({ pendingRemovals: get().pendingRemovals.filter((r) => !done.has(id(r))) })
  },

  recordEmbeds: async (located) => {
    const { file } = get()
    if (file === null || located.length === 0) return
    const byNote = new Map<string, { page: number; quads: number[] }[]>()
    for (const one of located) {
      const list = byNote.get(one.noteId) ?? []
      list.push({ page: one.page, quads: [...one.quads] })
      byNote.set(one.noteId, list)
    }
    let changed = false
    const notes = file.notes.map((note) => {
      const fresh = byNote.get(note.id)
      if (fresh === undefined) return note
      // MERGE by page rather than replace. `located` only covers pages that
      // were rendered, so replacing dropped the other half of a note whose
      // runs span a page break — and that half then became unremovable.
      const merged = [...note.embed.filter((e) => !fresh.some((f) => f.page === e.page)), ...fresh]
      merged.sort((a, b) => a.page - b.page)
      if (JSON.stringify(merged) === JSON.stringify(note.embed)) return note
      changed = true
      return { ...note, embed: merged }
    })
    // Reading a paper must never produce a git-modified file: when the record
    // already matches, nothing is written.
    if (!changed) return
    await persist(set, get, { ...file, notes })
  },

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
  const { rootDir, citekey, file: previous, loadFailed } = get()
  if (rootDir === null || citekey === null) return
  if (loadFailed) {
    set({ error: 'This paper\'s notes file could not be read, so nothing is being written to it.' })
    return
  }
  set({ file: next, error: null })
  try {
    await window.suna.invoke('refnotes:write', { dir: rootDir, citekey, file: next })
    set({ revision: get().revision + 1 })
  } catch (error) {
    set({ file: previous, error: errorMessage(error) })
  }
}
