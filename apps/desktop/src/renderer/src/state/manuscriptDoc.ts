import { create } from 'zustand'
import type { BibEntry, CitationStyleConfig } from '@suna/bib'
import type { OutlineSection } from '@suna/markdown'
import type { LabelMap } from '../manuscript/citations'

/**
 * Shared state between a document tab (manuscript/ManuscriptTab and, from
 * feature-plan-12, every other structured-document tab) and the Documents
 * sidebar view: the live outline (derived from that tab's current buffer),
 * which heading is in view, outline-click → smooth-scroll requests, and the
 * citation render data the tab's References block publishes for the editor's
 * reading-mode chips.
 *
 * `outline` and `activeSectionIndex` index into the SAME flat, document-order
 * list `@suna/markdown`'s outlineFromMarkdown returns (views/outline's
 * outlineRows projects it for display) — a heading's position in that array
 * is its "section index" everywhere in this store.
 *
 * **Keyed by document id (feature-plan-12 gap 4).** This was one global slot
 * until the registry landed, which meant two open document tabs would
 * overwrite each other's outline, scroll target and citation map. Each
 * document now owns a slice; the sidebar reads whichever slice
 * `activeDocumentId` names.
 */

/**
 * Citation render data of one document under the preview profile, published
 * by manuscript/ReferencesBlock after each recompute. The editor resolves its
 * reading-mode citation chips against it (manuscript/citeChips).
 */
export interface CitationRender {
  /** First-appearance citation numbers across the document, keyed by cite key. */
  numbers: ReadonlyMap<string, number>
  /** Bib entries keyed by cite key — needed for author-year chip text. */
  entries: ReadonlyMap<string, BibEntry>
  /** In-text citation style of the preview profile. */
  style: CitationStyleConfig
  /** Document-wide cross-reference label map (figures/tables/equations/sections). */
  labels: LabelMap
  /** Monotonic publish counter; chip passes skip chips already at this serial. */
  serial: number
}

export interface ScrollRequest {
  index: number
  /** Monotonic; a new click to the same index still triggers a scroll. */
  nonce: number
}

export function countWords(text: string): number {
  const words = text.trim().split(/\s+/)
  return words.filter((w) => w !== '').length
}

/** The per-document slice. One of these exists per open document tab. */
export interface DocSlice {
  /**
   * Outline of this document's editor, recomputed (debounced) from its
   * CURRENT buffer on every edit — so the sidebar's headings/word counts
   * track unsaved typing, not just the last save. Empty while the tab is
   * unmounted; the sidebar falls back to a disk read then.
   */
  outline: OutlineSection[]
  /** Index into `outline` of the heading currently in view in this tab. */
  activeSectionIndex: number
  /** True while this document's tab component is mounted (owns the live outline). */
  tabMounted: boolean
  /** True while this document's tab is the frontmost dock panel. */
  tabActive: boolean
  /** Pending outline-click scroll, consumed by this document's tab. */
  scrollRequest: ScrollRequest | null
  /** Latest citation render data; null until the References block computes it. */
  citationRender: CitationRender | null
}

/** The id the primary manuscript's slice is filed under (ADR-009). */
export const PRIMARY_DOC_SLICE = 'manuscript'

export const EMPTY_SLICE: DocSlice = Object.freeze({
  outline: [],
  activeSectionIndex: 0,
  tabMounted: false,
  tabActive: false,
  scrollRequest: null,
  citationRender: null
})

interface ManuscriptDocState {
  byDoc: Record<string, DocSlice>
  /**
   * The document the sidebar follows — the most recently activated document
   * tab. Null before any tab mounts.
   */
  activeDocumentId: string | null
  setOutline: (docId: string, outline: OutlineSection[]) => void
  setActiveSectionIndex: (docId: string, index: number) => void
  setTabMounted: (docId: string, mounted: boolean) => void
  setTabActive: (docId: string, active: boolean) => void
  requestScroll: (docId: string, index: number) => void
  consumeScrollRequest: (docId: string, nonce: number) => void
  /** Publish (or clear, with null) citation render data; serial is assigned here. */
  publishCitationRender: (docId: string, render: Omit<CitationRender, 'serial'> | null) => void
  /** Drop a document's slice — called when its tab closes or the project switches. */
  forgetDocument: (docId: string) => void
  /** Drop every slice. Called on project switch. */
  reset: () => void
}

const sliceOf = (s: ManuscriptDocState, docId: string): DocSlice => s.byDoc[docId] ?? EMPTY_SLICE

/** Read one document's slice; returns the frozen empty slice when unknown. */
export function docSlice(state: ManuscriptDocState, docId: string | null): DocSlice {
  return docId === null ? EMPTY_SLICE : sliceOf(state, docId)
}

/** Read the slice the sidebar should show — the active document's. */
export function activeSlice(state: ManuscriptDocState): DocSlice {
  return docSlice(state, state.activeDocumentId)
}

export const useManuscriptDocStore = create<ManuscriptDocState>((set, get) => {
  const patch = (docId: string, next: Partial<DocSlice>): void =>
    set((s) => ({ byDoc: { ...s.byDoc, [docId]: { ...sliceOf(s, docId), ...next } } }))

  return {
    byDoc: {},
    activeDocumentId: null,

    setOutline: (docId, outline) => patch(docId, { outline }),

    setActiveSectionIndex: (docId, index) => {
      if (sliceOf(get(), docId).activeSectionIndex !== index) patch(docId, { activeSectionIndex: index })
    },

    setTabMounted: (docId, mounted) => patch(docId, { tabMounted: mounted }),

    setTabActive: (docId, active) => {
      patch(docId, { tabActive: active })
      // The sidebar follows the most recently activated tab. Deactivation does
      // not clear it: closing the frontmost tab should leave the sidebar on
      // the document the user was last looking at, not blank it.
      if (active) set({ activeDocumentId: docId })
    },

    requestScroll: (docId, index) =>
      patch(docId, {
        scrollRequest: { index, nonce: (sliceOf(get(), docId).scrollRequest?.nonce ?? 0) + 1 }
      }),

    consumeScrollRequest: (docId, nonce) => {
      if (sliceOf(get(), docId).scrollRequest?.nonce === nonce) patch(docId, { scrollRequest: null })
    },

    publishCitationRender: (docId, render) =>
      patch(docId, {
        citationRender:
          render === null
            ? null
            : { ...render, serial: (sliceOf(get(), docId).citationRender?.serial ?? 0) + 1 }
      }),

    forgetDocument: (docId) =>
      set((s) => {
        if (!(docId in s.byDoc)) return s
        const next = { ...s.byDoc }
        delete next[docId]
        return {
          byDoc: next,
          activeDocumentId: s.activeDocumentId === docId ? null : s.activeDocumentId
        }
      }),

    reset: () => set({ byDoc: {}, activeDocumentId: null })
  }
})
