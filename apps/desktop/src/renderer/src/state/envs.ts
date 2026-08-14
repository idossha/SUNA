import { create } from 'zustand'

/**
 * Python environment selection for the open project, backed by the frozen
 * env:detect / env:select / env:selected IPC contracts. The selection is
 * persisted by the main process per project dir; new terminals read it via
 * `selectedEnvPathFor` when building their term:create request.
 */
export interface PythonEnv {
  kind: 'uv' | 'venv' | 'conda'
  name: string
  path: string
  python: string | null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface EnvsState {
  /** Project dir the selection below was loaded for. */
  dir: string | null
  selectedPath: string | null
  envs: PythonEnv[]
  detecting: boolean
  error: string | null
  /** Load the persisted selection for a project (cheap; on project open). */
  loadSelected: (dir: string) => Promise<void>
  /** Scan the project for envs (on demand, when the picker opens). */
  detect: (dir: string) => Promise<void>
  /** Persist a selection (null = no env) and update local state. */
  select: (dir: string, envPath: string | null) => Promise<void>
}

export const useEnvsStore = create<EnvsState>((set) => ({
  dir: null,
  selectedPath: null,
  envs: [],
  detecting: false,
  error: null,

  loadSelected: async (dir) => {
    try {
      const { envPath } = await window.suna.invoke('env:selected', { dir })
      set({ dir, selectedPath: envPath, error: null })
    } catch (error) {
      set({ dir, selectedPath: null, error: errorMessage(error) })
    }
  },

  detect: async (dir) => {
    set({ detecting: true, error: null })
    try {
      const { envs } = await window.suna.invoke('env:detect', { dir })
      set({ envs, detecting: false })
    } catch (error) {
      set({ envs: [], detecting: false, error: errorMessage(error) })
    }
  },

  select: async (dir, envPath) => {
    try {
      await window.suna.invoke('env:select', { dir, envPath })
      set({ dir, selectedPath: envPath, error: null })
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  }
}))

/** The env to activate in a NEW terminal for `dir` (null if none selected). */
export function selectedEnvPathFor(dir: string): string | null {
  const state = useEnvsStore.getState()
  return state.dir === dir ? state.selectedPath : null
}

/** Short display name for the status-bar chip. */
export function envLabelFor(path: string | null, envs: PythonEnv[]): string {
  if (path === null) return 'no env'
  const found = envs.find((env) => env.path === path)
  if (found) return found.name
  const segments = path.split('/').filter((s) => s !== '')
  return segments[segments.length - 1] ?? path
}
