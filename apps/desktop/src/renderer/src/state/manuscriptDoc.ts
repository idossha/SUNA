import { create } from 'zustand'

/**
 * Shared state between the combined manuscript tab (manuscript/ManuscriptTab)
 * and the Manuscript sidebar view: which section is in view, per-section word
 * counts, and outline-click → smooth-scroll requests.
 *
 * Section indices refer to the flattened body order (views/outline flattenBody).
 * Word counts are keyed by the section's contentPath ("sections/x.md") because
 * that key is stable across outline re-flattening.
 */

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
  /** Flattened-body index of the section currently in view in the combined tab. */
  activeSectionIndex: number
  /** Word counts keyed by contentPath. */
  wordCounts: Record<string, number>
  /** True while a combined manuscript tab component is mounted (owns word counts). */
  tabMounted: boolean
  /** True while the combined manuscript tab is the frontmost dock panel. */
  tabActive: boolean
  /** Pending outline-click scroll, consumed by the combined tab. */
  scrollRequest: ScrollRequest | null
  setActiveSectionIndex: (index: number) => void
  setWordCount: (contentPath: string, count: number) => void
  replaceWordCounts: (counts: Record<string, number>) => void
  setTabMounted: (mounted: boolean) => void
  setTabActive: (active: boolean) => void
  requestScroll: (index: number) => void
  consumeScrollRequest: (nonce: number) => void
}

export const useManuscriptDocStore = create<ManuscriptDocState>((set, get) => ({
  activeSectionIndex: 0,
  wordCounts: {},
  tabMounted: false,
  tabActive: false,
  scrollRequest: null,

  setActiveSectionIndex: (index) => {
    if (get().activeSectionIndex !== index) set({ activeSectionIndex: index })
  },

  setWordCount: (contentPath, count) => {
    const current = get().wordCounts
    if (current[contentPath] === count) return
    set({ wordCounts: { ...current, [contentPath]: count } })
  },

  replaceWordCounts: (counts) => set({ wordCounts: counts }),

  setTabMounted: (mounted) => set({ tabMounted: mounted }),
  setTabActive: (active) => set({ tabActive: active }),

  requestScroll: (index) =>
    set((s) => ({
      scrollRequest: { index, nonce: (s.scrollRequest?.nonce ?? 0) + 1 }
    })),

  consumeScrollRequest: (nonce) => {
    if (get().scrollRequest?.nonce === nonce) set({ scrollRequest: null })
  }
}))
