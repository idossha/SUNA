import { app } from 'electron'
import { join, resolve } from 'node:path'
import {
  ensureProjectAgentLayer,
  ensureSunaConfig,
  type McpInvocation
} from '@suna/agent'

/**
 * The app side of the agent context layer (ARCHITECTURE §15.4): resolve how THIS
 * install runs the MCP server, and heal the machine folder + a project's
 * agent files wherever a project becomes "the open one". The MCP server
 * performs the same heal on boot, so whichever surface runs first wins and
 * the other finds nothing to do.
 */

/**
 * How agent CLIs should spawn the bundled MCP server. Packaged, the app
 * runs its own binary as Node (ELECTRON_RUN_AS_NODE) so no system `node` is
 * required; in dev the repo's dist-mcp bundle runs under plain `node`.
 */
export function appMcpInvocation(): McpInvocation {
  if (app.isPackaged) {
    return {
      command: process.execPath,
      serverPath: join(process.resourcesPath, 'mcp', 'server.mjs'),
      env: { ELECTRON_RUN_AS_NODE: '1' }
    }
  }
  return {
    command: 'node',
    serverPath: resolve(app.getAppPath(), '..', '..', 'packages', 'agent', 'dist-mcp', 'server.mjs')
  }
}

/**
 * Heal everything, best-effort: a project must always open even when the
 * agent layer cannot be written (read-only volume, odd permissions). Returns
 * whether the heal fully succeeded, for surfaces that report it (the
 * scaffold progress list).
 */
export async function healProjectAgentLayer(dir: string): Promise<boolean> {
  try {
    const inv = appMcpInvocation()
    await ensureSunaConfig(inv)
    await ensureProjectAgentLayer(dir, inv)
    return true
  } catch (error) {
    console.warn('agent layer heal failed (continuing):', error)
    return false
  }
}
