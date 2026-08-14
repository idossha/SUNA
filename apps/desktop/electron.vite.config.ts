import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Workspace packages export raw TypeScript, so they must be bundled (not
// externalized) in the main/preload builds; their own deps resolve normally.
// Workspace packages ship raw TypeScript, so every one imported by main or
// preload must be BUNDLED — externalizing them makes Node try to load .ts at
// runtime and the app dies with ERR_MODULE_NOT_FOUND. Add new packages here
// the moment the main process imports them.
const bundledWorkspaceDeps = [
  '@suna/core',
  '@suna/markdown',
  '@suna/canvas',
  '@suna/formatter',
  '@suna/agent',
  '@suna/bib'
]

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundledWorkspaceDeps })]
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: bundledWorkspaceDeps })]
  },
  renderer: {
    plugins: [react()],
    // workspace packages ship raw TS: keep them out of prebundling so edits
    // hot-reload and the renderer never runs a stale optimized copy
    optimizeDeps: { exclude: bundledWorkspaceDeps }
  }
})
