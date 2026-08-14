import { useTerminalPanelStore } from '../state/terminal'
import {
  closeTerminalTab,
  createTerminalTab,
  openTerminalWithCommand,
  setActiveTerminalTab,
  useTerminalTabsStore
} from './sessions'

/**
 * Dev-only seam for e2e drivers (wired into window.__sunaDev by the verifier;
 * not imported by production code).
 */
export const terminalDevSeam = {
  tabsStore: useTerminalTabsStore,
  panelStore: useTerminalPanelStore,
  createTerminalTab,
  closeTerminalTab,
  setActiveTerminalTab,
  openTerminalWithCommand
}
