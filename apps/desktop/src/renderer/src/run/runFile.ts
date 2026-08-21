import { flushDirtySessions } from '../state/docSessions'
import { selectedEnvPathFor } from '../state/envs'
import { useProjectStore } from '../state/project'
import { useUiStore } from '../state/ui'
import { openTerminalWithCommand } from '../terminal/sessions'
import { runCommandFor } from './runners'

/**
 * Run one source file in the terminal panel. Unsaved buffers in the project
 * are flushed first — running a file the author can see but the interpreter
 * cannot is the single most confusing thing a run button can do.
 *
 * Returns the command that was run, or null when the file has no runner.
 */
export async function runFile(path: string): Promise<string | null> {
  const rootDir = useProjectStore.getState().rootDir
  const hasEnv = rootDir !== null && selectedEnvPathFor(rootDir) !== null
  const run = runCommandFor(path, rootDir, hasEnv)
  if (run === null) {
    useUiStore.getState().pushToast(`No runner knows how to run ${path.slice(path.lastIndexOf('/') + 1)}`)
    return null
  }
  if (rootDir !== null) await flushDirtySessions(rootDir)
  openTerminalWithCommand(run.command, run.title)
  return run.command
}
