/**
 * Guided-tour state: which step is showing, and nothing else. The overlay
 * (tour/TourOverlay.tsx) owns every side effect a step has, so this store can
 * be driven from a button, a command or a test without a DOM.
 */
import { create } from 'zustand'
import { TOUR_STEPS } from '../tour/steps'
import { useProjectStore } from './project'

interface TourState {
  active: boolean
  /** Index into TOUR_STEPS; meaningless while `active` is false. */
  index: number
  /** Bumped on every entry into a step, so re-entering re-applies its setup. */
  visit: number
  start: () => void
  next: () => void
  back: () => void
  goto: (index: number) => void
  stop: () => void
}

export const useTourStore = create<TourState>((set, get) => ({
  active: false,
  index: 0,
  visit: 0,
  start: () => set((s) => ({ active: true, index: 0, visit: s.visit + 1 })),
  next: () => {
    const { index } = get()
    if (index >= TOUR_STEPS.length - 1) {
      get().stop()
      return
    }
    set((s) => ({ index: index + 1, visit: s.visit + 1 }))
  },
  back: () => {
    const { index } = get()
    if (index === 0) return
    set((s) => ({ index: index - 1, visit: s.visit + 1 }))
  },
  goto: (index) => {
    if (index < 0 || index >= TOUR_STEPS.length) return
    set((s) => ({ index, visit: s.visit + 1 }))
  },
  stop: () => set({ active: false })
}))

/**
 * The one entry point every door to the tour uses (welcome button, command
 * palette). The tour is written against the shipped example project, so it
 * opens it first — `project:open-example` reuses the user-owned copy under
 * userData, so a second run keeps whatever was done in the first.
 */
export async function startAppTour(): Promise<void> {
  await useProjectStore.getState().openExampleProject()
  useTourStore.getState().start()
}
