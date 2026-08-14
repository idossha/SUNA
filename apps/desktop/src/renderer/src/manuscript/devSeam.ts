import { useManuscriptDocStore } from '../state/manuscriptDoc'

/**
 * Dev-only seam for e2e drivers (window.__sunaDev wiring lives with the
 * verifier, not in production code). Exposes the combined-document store so
 * tests can read the active section, word counts, and tab state, and drive
 * outline-click scrolling.
 */
export const manuscriptDevSeam = {
  docStore: useManuscriptDocStore
}
