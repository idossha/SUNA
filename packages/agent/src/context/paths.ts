import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The machine-level agent-context folder. A visible home directory — not
 * Electron userData — because UserContext/ is user-edited and must be
 * findable in Finder/an editor, and because the MCP server runs standalone
 * without Electron. $SUNA_CONFIG_DIR overrides it (tests point it at temp
 * dirs; a user who moves the folder exports the variable).
 */
export function sunaConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['SUNA_CONFIG_DIR']
  if (typeof override === 'string' && override.trim() !== '') return override
  return join(homedir(), 'SunaConfig')
}

export function userContextDir(cfg: string): string {
  return join(cfg, 'Context', 'UserContext')
}

export function sunaContextDir(cfg: string): string {
  return join(cfg, 'Context', 'SunaContext')
}

/** Where the pointer skill syncs to, for bare-session discovery by Claude Code. */
export function skillPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env['SUNA_SKILL_HOME'] ?? homedir()
  return join(home, '.claude', 'skills', 'suna', 'SKILL.md')
}
