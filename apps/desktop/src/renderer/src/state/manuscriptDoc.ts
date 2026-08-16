import { create } from 'zustand'
import type { BibEntry, CitationStyleConfig } from '@suna/bib'
import type { OutlineSection } from '@suna/markdown'
import type { LabelMap } from '../manuscript/citations'

/**
 * Shared state between the combined manuscript tab (manuscript/ManuscriptTab)
 * and the Manuscript sidebar view: the live outline (derived from the single
 * editor's current buffer), which heading is in view, outline-click →
 * smooth-scroll requests, and the citation render data the tab's References
 * block publishes for the editor's reading-mode chips.
 *
 * `outline` and `activeSectionIndex` index into the SAME flat, document-order
 * list `@suna/markdown`'s outlineFromMarkdown returns (views/outline's
 * outlineRows projects it for display) — a heading's position in that array
 * is its "section index" everywhere in this store.
 */

/**
 * Citation render data of the combined document under the preview profile,
 * published by manuscript/ReferencesBlock after each recompute. The
 * manuscript editor resolves its reading-mode citation chips against it
 * (manuscript/citeChips).
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

interface ManuscriptDocState {
  /**
   * Outline of the combined tab's editor, recomputed (debounced) from its
   * CURRENT buffer on every edit — so the sidebar's headings/word counts
   * track unsaved typing, not just the last save. Empty while the tab is
   * unmounted; the sidebar falls back to a disk read then (ManuscriptView).
   */
  outline: OutlineSection[]
  /** Index into `outline` of the heading currently in view in the combined tab. */
  activeSectionIndex: number
  /** True while a combined manuscript tab component is mounted (owns the live outline). */
  tabMounted: boolean
  /** True while the combined manuscript tab is the frontmost dock panel. */
  tabActive: boolean
  /** Pending outline-click scroll, consumed by the combined tab. */
  scrollRequest: ScrollRequest | null
  /** Latest citation render data; null until the References block computes it. */
  citationRender: CitationRender | null
  setOutline: (outline: OutlineSection[]) => void
  setActiveSectionIndex: (index: number) => void
  setTabMounted: (mounted: boolean) => void
  setTabActive: (active: boolean) => void
  requestScroll: (index: number) => void
  consumeScrollRequest: (nonce: number) => void
  /** Publish (or clear, with null) the citation render data; serial is assigned here. */
  publishCitationRender: (render: Omit<CitationRender, 'serial'> | null) => void
}

export const useManuscriptDocStore = create<ManuscriptDocState>((set, get) => ({
  outline: [],
  activeSectionIndex: 0,
  tabMounted: false,
  tabActive: false,
  scrollRequest: null,
  citationRender: null,

  setOutline: (outline) => set({ outline }),

  setActiveSectionIndex: (index) => {
    if (get().activeSectionIndex !== index) set({ activeSectionIndex: index })
  },

  setTabMounted: (mounted) => set({ tabMounted: mounted }),
  setTabActive: (active) => set({ tabActive: active }),

  requestScroll: (index) =>
    set((s) => ({
      scrollRequest: { index, nonce: (s.scrollRequest?.nonce ?? 0) + 1 }
    })),

  consumeScrollRequest: (nonce) => {
    if (get().scrollRequest?.nonce === nonce) set({ scrollRequest: null })
  },

  publishCitationRender: (render) =>
    set((s) => ({
      citationRender:
        render === null
          ? null
          : { ...render, serial: (s.citationRender?.serial ?? 0) + 1 }
    }))
}))
