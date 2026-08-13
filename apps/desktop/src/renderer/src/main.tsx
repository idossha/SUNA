import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { openFileTab } from './state/dock'
import { useProjectStore } from './state/project'
import { useUiStore } from './state/ui'
import './styles/app.css'
import 'katex/dist/katex.min.css'

// Dev-only seam for e2e drivers (CDP): bypasses native dialogs.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __sunaDev: { openFileTab, projectStore: useProjectStore, uiStore: useUiStore }
  })
}

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('missing #root element')

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
