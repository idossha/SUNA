import {
  cancelScreenAsk,
  finishRegionPick,
  sendScreenAsk,
  startRegionPick,
  startScreenAsk,
  useFloatTerminalStore,
  useScreenAskStore
} from './screenask'
import { closeTerminalTab, createTerminalTab } from '../../terminal/sessions'

/**
 * Dev-only seam for e2e drivers (wired into window.__sunaDev by main.tsx; not
 * imported by production code).
 *
 * `openFloatWith` exists because the real path ends in spawning `claude`, and
 * a driver checking that the floating window drags, resizes and closes should
 * not have to start a paid agent session to do it. It builds the same float
 * session the ask would, around whatever command the driver names.
 */
export const screenAskDevSeam = {
  askStore: useScreenAskStore,
  floatStore: useFloatTerminalStore,
  startScreenAsk,
  startRegionPick,
  finishRegionPick,
  sendScreenAsk,
  cancelScreenAsk,
  openFloatWith: (command: string): string => {
    const previous = useFloatTerminalStore.getState().termId
    if (previous !== null) closeTerminalTab(previous)
    const termId = createTerminalTab({ command, title: 'Ask about this screen', surface: 'float' })
    useFloatTerminalStore.setState({ termId, bundleDir: null, minimized: false })
    return termId
  }
}
