import { create } from 'zustand'
import { ManuscriptSchema, type Manuscript } from '@suna/core'
import { useProjectStore } from './project'

interface ManuscriptState {
  manuscript: Manuscript | null
  /** Set when manuscript.json exists but cannot be parsed/validated. */
  error: string | null
  refresh: () => Promise<void>
}

export const useManuscriptStore = create<ManuscriptState>((set) => ({
  manuscript: null,
  error: null,

  refresh: async () => {
    const { rootDir } = useProjectStore.getState()
    if (!rootDir) {
      set({ manuscript: null, error: null })
      return
    }
    let content: string
    try {
      const res = await window.suna.invoke('fs:read-text', {
        path: `${rootDir}/manuscript/manuscript.json`
      })
      content = res.content
    } catch {
      // no manuscript.json in this project — a valid state, not an error
      set({ manuscript: null, error: null })
      return
    }
    let json: unknown
    try {
      json = JSON.parse(content)
    } catch {
      set({ manuscript: null, error: 'manuscript.json is not valid JSON.' })
      return
    }
    const parsed = ManuscriptSchema.safeParse(json)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      const where = first && first.path.length > 0 ? ` (${first.path.map(String).join('.')})` : ''
      set({
        manuscript: null,
        error: `manuscript.json does not match the schema${where}.`
      })
      return
    }
    set({ manuscript: parsed.data, error: null })
  }
}))

/** Best-effort manuscript title for the agent's system prompt. */
export async function currentManuscriptTitle(): Promise<string | null> {
  if (!useProjectStore.getState().rootDir) return null
  const state = useManuscriptStore.getState()
  if (state.manuscript) return state.manuscript.title
  await state.refresh()
  return useManuscriptStore.getState().manuscript?.title ?? null
}
