import { create } from 'zustand'
import {
  AuthorsFileSchema,
  ManuscriptSchema,
  emptyAuthorsFile,
  type AuthorsFile,
  type Manuscript
} from '@suna/core'
import { useProjectStore } from './project'

interface ManuscriptState {
  manuscript: Manuscript | null
  /** Set when manuscript.json exists but cannot be parsed/validated. */
  error: string | null
  /**
   * The byline (manuscript/authors.json), loaded alongside manuscript.json.
   * A missing or unparsable file reads as `emptyAuthorsFile()` — the title
   * page still renders (with no authors) rather than blocking on it, since
   * a brand-new project may legitimately have no authors.json yet.
   */
  authors: AuthorsFile
  /** Set when authors.json exists but cannot be parsed/validated. */
  authorsError: string | null
  refresh: () => Promise<void>
}

async function loadAuthorsFile(rootDir: string): Promise<{ authors: AuthorsFile; error: string | null }> {
  let content: string
  try {
    const res = await window.suna.invoke('fs:read-text', {
      path: `${rootDir}/manuscript/authors.json`
    })
    content = res.content
  } catch {
    // no authors.json yet — a valid state, not an error
    return { authors: emptyAuthorsFile(), error: null }
  }
  let json: unknown
  try {
    json = JSON.parse(content)
  } catch {
    return { authors: emptyAuthorsFile(), error: 'authors.json is not valid JSON.' }
  }
  const parsed = AuthorsFileSchema.safeParse(json)
  if (!parsed.success) {
    return { authors: emptyAuthorsFile(), error: 'authors.json does not match the schema.' }
  }
  return { authors: parsed.data, error: null }
}

export const useManuscriptStore = create<ManuscriptState>((set) => ({
  manuscript: null,
  error: null,
  authors: emptyAuthorsFile(),
  authorsError: null,

  refresh: async () => {
    const { rootDir } = useProjectStore.getState()
    if (!rootDir) {
      set({ manuscript: null, error: null, authors: emptyAuthorsFile(), authorsError: null })
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
      set({ manuscript: null, error: null, authors: emptyAuthorsFile(), authorsError: null })
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
    const { authors, error: authorsError } = await loadAuthorsFile(rootDir)
    // the project may have switched while the authors.json read was in flight
    if (useProjectStore.getState().rootDir !== rootDir) return
    set({ manuscript: parsed.data, error: null, authors, authorsError })
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
