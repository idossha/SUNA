import { PEER_REVIEW_FILE, peerReviewSeed } from '@suna/core'
import { existsSync } from 'node:fs'
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { SUNA_CONTEXT_FILES, SUNA_CONTEXT_HASH, SUNA_SKILL_FILE } from './docs.gen'
import { skillPath, sunaConfigDir, sunaContextDir, userContextDir } from './paths'
import {
  PROJECT_CONTEXT_DIR,
  SKILL_MARKER,
  USER_RULES_SEED,
  WHO_AM_I_SEED,
  agentStub,
  isManagedStub,
  projectTemplate,
  memoryTemplate,
  rulesTemplate
} from './templates'

/**
 * The machine-level context layer (adr-004): ~/SunaConfig holds the
 * user-owned UserContext and the app-owned SunaContext docs, re-synced from
 * the embedded module whenever the content hash changes. Both the Electron
 * main process and the standalone MCP server call ensureSunaConfig() at
 * startup and ensureProjectAgentLayer() per project, so whichever surface
 * runs first heals the layer. There is deliberately no lock: every write is
 * idempotent same-content, so concurrent app + server boots at worst write
 * identical bytes.
 */

/** How to invoke the MCP server on THIS machine — the values baked into the
 * synced docs' placeholders and into each project's .mcp.json. */
export interface McpInvocation {
  /** 'node' in dev; the app binary (with ELECTRON_RUN_AS_NODE) when packaged. */
  command: string
  /** Absolute path to the server bundle — the {{SUNA_MCP_PATH}} value. */
  serverPath: string
  env?: Record<string, string>
}

export interface EnsureResult {
  /** Relative names of files written (created or updated) by this call. */
  created: string[]
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Atomic write (tmp + rename), same discipline as the comment verbs.
 * Exported so the manuscript verbs share it — a crash mid-write must never
 * truncate the user's prose file. */
export async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temp, content, 'utf8')
    await rename(temp, path)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
}

/** Write only when the file is missing or its bytes differ; returns true when written. */
async function writeIfChanged(path: string, content: string): Promise<boolean> {
  try {
    if ((await readFile(path, 'utf8')) === content) return false
  } catch {
    // missing — write it
  }
  await writeAtomic(path, content)
  return true
}

/** Write only when the file is missing; returns true when written. */
async function writeIfMissing(path: string, content: string): Promise<boolean> {
  if (await exists(path)) return false
  await writeAtomic(path, content)
  return true
}

/** The full runnable server command for {{SUNA_MCP}} in the synced docs. */
function mcpCommandString(inv: McpInvocation): string {
  const env = Object.entries(inv.env ?? {})
    .map(([k, v]) => `${k}=${v} `)
    .join('')
  const cmd = inv.command.includes('/') ? `"${inv.command}"` : inv.command
  return `${env}${cmd} "${inv.serverPath}"`
}

function substitute(body: string, inv: McpInvocation): string {
  // Function replacements: a serverPath containing `$&`/`$$` must land
  // verbatim, not be interpreted as a replacement pattern.
  return body
    .replaceAll('{{SUNA_MCP_PATH}}', () => inv.serverPath)
    .replaceAll('{{SUNA_MCP}}', () => mcpCommandString(inv))
}

interface VersionStamp {
  hash: string
  serverPath: string
  synced: string
}

function stampPath(cfg: string): string {
  return join(sunaContextDir(cfg), '.version')
}

async function readStamp(cfg: string): Promise<VersionStamp | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(stampPath(cfg), 'utf8'))
    if (typeof raw !== 'object' || raw === null) return null
    const { hash, serverPath, synced } = raw as Record<string, unknown>
    if (typeof hash !== 'string' || typeof serverPath !== 'string') return null
    return { hash, serverPath, synced: typeof synced === 'string' ? synced : '' }
  } catch {
    return null
  }
}

/**
 * "Gone, not different": the stamp is stale only when its baked serverPath no
 * longer EXISTS. A dev checkout and a packaged app resolve different paths,
 * and a user alternating between them must not have the folder rewritten on
 * every switch — a path that no longer exists is unambiguous (no install can
 * be using it), so re-baking on that condition alone cannot churn.
 */
async function stampCurrent(stamp: VersionStamp | null): Promise<boolean> {
  if (stamp === null || stamp.hash !== SUNA_CONTEXT_HASH) return false
  return exists(stamp.serverPath)
}

const AUDIT_MAX_EVENTS = 200

async function appendAudit(cfg: string, events: { action: string; detail: string }[]): Promise<void> {
  if (events.length === 0) return
  const path = join(cfg, '.sunaconfig.json')
  const now = new Date().toISOString()
  let log: { schemaVersion: string; created: string; events: unknown[] } = {
    schemaVersion: '1',
    created: now,
    events: []
  }
  try {
    const raw: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (typeof raw === 'object' && raw !== null && Array.isArray((raw as { events?: unknown }).events)) {
      log = raw as typeof log
    }
  } catch {
    // fresh log
  }
  log.events.push(...events.map((e) => ({ ts: now, ...e })))
  if (log.events.length > AUDIT_MAX_EVENTS) log.events = log.events.slice(-AUDIT_MAX_EVENTS)
  await writeAtomic(path, JSON.stringify(log, null, 2) + '\n')
}

/**
 * Seed/refresh the machine layer. Fast path is read-only. UserContext is
 * seeded once and never rewritten; SunaContext re-syncs when the embedded
 * hash changed or the stamped server path is gone, and otherwise only heals
 * MISSING files (never rewrites — see stampCurrent's anti-churn note).
 */
export async function ensureSunaConfig(
  inv: McpInvocation,
  env: NodeJS.ProcessEnv = process.env
): Promise<EnsureResult> {
  const cfg = sunaConfigDir(env)
  const userDir = userContextDir(cfg)
  const sunaDir = sunaContextDir(cfg)
  const skill = skillPath(env)
  const stamp = await readStamp(cfg)
  const upToDate = await stampCurrent(stamp)

  // Fast path: everything present and current — no writes at all.
  if (
    upToDate &&
    (await exists(join(userDir, 'WHO-AM-I.md'))) &&
    (await exists(join(userDir, 'RULES.md'))) &&
    (SUNA_SKILL_FILE === '' || (await exists(skill)))
  ) {
    const missing = Object.keys(SUNA_CONTEXT_FILES).filter(
      (name) => !existsSyncSafe(join(sunaDir, name))
    )
    if (missing.length === 0) return { created: [] }
  }

  const created: string[] = []
  const events: { action: string; detail: string }[] = []

  if (await writeIfMissing(join(userDir, 'WHO-AM-I.md'), WHO_AM_I_SEED)) {
    created.push('UserContext/WHO-AM-I.md')
    events.push({ action: 'seed-who-am-i', detail: join(userDir, 'WHO-AM-I.md') })
  }
  if (await writeIfMissing(join(userDir, 'RULES.md'), USER_RULES_SEED)) {
    created.push('UserContext/RULES.md')
    events.push({ action: 'seed-user-rules', detail: join(userDir, 'RULES.md') })
  }

  // When the hash is current, only heal MISSING files — never rewrite
  // existing ones (a dev CLI and a packaged app resolve different baked
  // paths; rewriting on every engine switch would churn the folder).
  const names = Object.keys(SUNA_CONTEXT_FILES).sort()
  let wroteDocs = 0
  for (const name of names) {
    const target = join(sunaDir, name)
    if (upToDate && (await exists(target))) continue
    const body = substitute(SUNA_CONTEXT_FILES[name] ?? '', inv)
    if (await writeIfChanged(target, body)) {
      created.push(`SunaContext/${name}`)
      wroteDocs += 1
    }
  }
  // Restamp only when something meaningful changed. In particular: a stamp
  // whose serverPath is GONE but whose fields already match this invocation
  // must not be refreshed every run — with the bundle missing (dev without a
  // dist-mcp build), a bare-timestamp rewrite would churn forever.
  const stampChanged =
    stamp === null || stamp.hash !== SUNA_CONTEXT_HASH || stamp.serverPath !== inv.serverPath
  if (wroteDocs > 0 || (!upToDate && stampChanged)) {
    const next: VersionStamp = {
      hash: SUNA_CONTEXT_HASH,
      serverPath: inv.serverPath,
      synced: new Date().toISOString()
    }
    await writeAtomic(stampPath(cfg), JSON.stringify(next, null, 2) + '\n')
    if (wroteDocs > 0) {
      events.push({
        action: 'sync-sunacontext',
        detail: `${sunaDir} (${wroteDocs} files, ${SUNA_CONTEXT_HASH})`
      })
    }
  }

  // The pointer skill: written when missing, refreshed while it still carries
  // the managed marker; a user-replaced file (no marker) is never touched.
  if (SUNA_SKILL_FILE !== '') {
    let current: string | null = null
    try {
      current = await readFile(skill, 'utf8')
    } catch {
      current = null
    }
    if (current === null || (current.includes(SKILL_MARKER) && current !== SUNA_SKILL_FILE)) {
      await writeAtomic(skill, SUNA_SKILL_FILE)
      created.push('skills/suna/SKILL.md')
      events.push({ action: 'sync-skill', detail: skill })
    }
  }

  await appendAudit(cfg, events)
  return { created }
}

// access() is async everywhere else; the fast path wants one synchronous
// existence sweep without pulling fs callbacks in — a tiny local shim.
function existsSyncSafe(path: string): boolean {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

/**
 * Heal one project's agent layer: the AGENTS.md/CLAUDE.md stubs, the
 * context/ memory files, the .gitignore's `.mcp.json` line, and the
 * machine-local .mcp.json itself. Additive and existence-guarded throughout:
 * user-authored files (no stub marker) are never touched, and .mcp.json is
 * left byte-untouched while its baked server path still exists.
 */
export async function ensureProjectAgentLayer(
  root: string,
  inv: McpInvocation,
  opts: { projectName?: string } = {}
): Promise<EnsureResult> {
  // Never scaffold agent files into a directory that is not a SUNA project.
  let manifestRaw: string
  try {
    manifestRaw = await readFile(join(root, 'suna.json'), 'utf8')
  } catch {
    return { created: [] }
  }
  let projectName = opts.projectName ?? ''
  try {
    const parsed: unknown = JSON.parse(manifestRaw)
    const name = (parsed as { name?: unknown } | null)?.name
    if (typeof name === 'string' && name.trim() !== '') projectName = name
  } catch {
    // unparseable manifest — the layer still heals with the fallback name
  }

  const created: string[] = []

  const contextDir = join(root, PROJECT_CONTEXT_DIR)
  // Projects scaffolded before the rename carry the old names; move the
  // user's content across rather than leaving it orphaned beside a fresh
  // empty template. Only when the new name is not already taken.
  const renames: [string, string][] = [
    ['MISSION.md', 'PROJECT.md'],
    ['NOTEBOOK.md', 'MEMORY.md']
  ]
  for (const [old, next] of renames) {
    const from = join(contextDir, old)
    const to = join(contextDir, next)
    if (existsSync(from) && !existsSync(to)) {
      try {
        await rename(from, to)
      } catch {
        // a failed migration just means the template gets written below
      }
    }
  }
  const memory: [string, string][] = [
    ['PROJECT.md', projectTemplate(projectName)],
    ['MEMORY.md', memoryTemplate()],
    ['RULES.md', rulesTemplate()],
    [PEER_REVIEW_FILE, peerReviewSeed()]
  ]
  for (const [name, body] of memory) {
    if (await writeIfMissing(join(contextDir, name), body)) {
      created.push(`${PROJECT_CONTEXT_DIR}/${name}`)
    }
  }

  const stub = agentStub()
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    const target = join(root, name)
    let current: string | null = null
    try {
      current = await readFile(target, 'utf8')
    } catch {
      current = null
    }
    if (current === null || (isManagedStub(current) && current !== stub)) {
      await writeAtomic(target, stub)
      created.push(name)
    }
  }

  if (await ensureGitignoreLine(root, '.mcp.json')) created.push('.gitignore')
  if (await ensureMcpJson(root, inv)) created.push('.mcp.json')

  return { created }
}

/**
 * Ensure .gitignore contains `line` exactly; additive append, never rewrites.
 *
 * Exported since feature-plan-12 §2a: creating a cover letter has to ignore
 * the private-letter glob under manuscript/ (suggested and excluded
 * reviewers carry other people's names, emails and conflict reasons)
 * BEFORE it writes the file, and a project scaffolded before that feature
 * never gains the stanza on its own — PROJECT_GITIGNORE is written only at
 * scaffold and at import.
 */
export async function ensureGitignoreLine(root: string, line: string): Promise<boolean> {
  const path = join(root, '.gitignore')
  let current: string | null = null
  try {
    current = await readFile(path, 'utf8')
  } catch {
    current = null
  }
  if (current === null) {
    await writeAtomic(path, `${line}\n`)
    return true
  }
  // Match git's semantics: trailing whitespace (and CRLF's \r) is stripped,
  // but LEADING whitespace in a gitignore pattern is literal — an indented
  // ".mcp.json" line does not actually ignore the file, so it doesn't count.
  if (current.split('\n').some((l) => l.trimEnd() === line)) return false
  const sep = current.endsWith('\n') || current === '' ? '' : '\n'
  await writeAtomic(path, `${current}${sep}${line}\n`)
  return true
}

/**
 * Write/refresh the machine-local .mcp.json, preserving any OTHER servers
 * the user added. Gone-not-different: while the existing suna entry's baked
 * server path still exists on disk AND its `--project` argument still names
 * this root, the file is left byte-untouched across installs (dev ↔ packaged
 * alternation must not churn it) — but an entry from THIS install (same
 * serverPath) is also re-baked when its command/env drifted (e.g. the legacy
 * plain-`node` entry in a packaged app). An unparseable file is preserved
 * beside the fresh one as `.mcp.json.invalid`, never silently destroyed.
 */
async function ensureMcpJson(root: string, inv: McpInvocation): Promise<boolean> {
  const path = join(root, '.mcp.json')
  let existing: Record<string, unknown> = {}
  let rawText: string | null = null
  let unparseable = false
  try {
    rawText = await readFile(path, 'utf8')
  } catch {
    rawText = null
  }
  if (rawText !== null) {
    try {
      const raw: unknown = JSON.parse(rawText)
      if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        existing = raw as Record<string, unknown>
      }
    } catch {
      unparseable = true
    }
  }

  if (!unparseable) {
    const servers = existing['mcpServers']
    const suna =
      typeof servers === 'object' && servers !== null
        ? ((servers as Record<string, unknown>)['suna'] as
            | { command?: unknown; args?: unknown; env?: unknown }
            | undefined)
        : undefined
    const args = suna !== undefined && Array.isArray(suna.args) ? (suna.args as unknown[]) : null
    const stampedPath = args !== null && typeof args[0] === 'string' ? args[0] : null
    const project = args !== null && typeof args[2] === 'string' ? args[2] : null
    if (
      suna !== undefined &&
      args !== null &&
      args.length === 3 &&
      stampedPath !== null &&
      (await exists(stampedPath)) &&
      args[1] === '--project' &&
      project !== null &&
      resolve(project) === resolve(root)
    ) {
      if (stampedPath !== inv.serverPath) return false // other live install — never churn
      const envSame = JSON.stringify(suna.env ?? null) === JSON.stringify(inv.env ?? null)
      if (suna.command === inv.command && envSame) return false
    }
  }

  if (unparseable && rawText !== null) {
    // Keep the broken bytes reviewable rather than destroying user content.
    await writeAtomic(`${path}.invalid`, rawText)
    existing = {}
  }

  const servers =
    typeof existing['mcpServers'] === 'object' && existing['mcpServers'] !== null
      ? (existing['mcpServers'] as Record<string, unknown>)
      : {}
  const config = {
    ...existing,
    mcpServers: {
      ...servers,
      suna: {
        command: inv.command,
        args: [inv.serverPath, '--project', root],
        ...(inv.env !== undefined ? { env: inv.env } : {})
      }
    }
  }
  const next = JSON.stringify(config, null, 2) + '\n'
  // Byte-compare so a heal that cannot converge (e.g. the target bundle
  // itself is missing) stops rewriting an identical file on every open.
  if (rawText === next) return false
  await writeAtomic(path, next)
  return true
}
