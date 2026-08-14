import { useProjectStore } from './project'

/**
 * Dev seam for zones outside state/**.
 *
 * The editor's save path (EditorTab, after a successful `fs:write-text`)
 * should call `devSeam.noteFileSaved(path)` so sidebar views that cache file
 * contents (Manuscript outline, References) re-read their data.
 */
export const devSeam = {
  noteFileSaved(path: string): void {
    useProjectStore.getState().noteFileSaved(path)
  }
}
