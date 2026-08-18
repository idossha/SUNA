import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SUNA_CONTEXT_FILES, SUNA_CONTEXT_HASH, SUNA_SKILL_FILE } from './docs.gen'
import { ensureProjectAgentLayer, ensureSunaConfig, type McpInvocation } from './ensure'
import { agentStub, isManagedStub } from './templates'
import { TOOLS } from '../mcp/verbs'
import type { ZodObject, ZodRawShape, ZodType } from 'zod'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

/* ------------------------------------------------------------------ */
/* Drift gates: source docs ↔ generated module ↔ verb registry          */
/* ------------------------------------------------------------------ */

/** A verb row: second cell is an input shape like {figureId} or {}. */
const VERB_ROW = /^\| [a-z][a-z_]* \| \{/

function verbOf(row: string): string {
  return (row.split('|')[1] ?? '').trim()
}

/**
 * The MCP.md ↔ TOOLS comparison, factored out of the gate so the gate itself
 * can be tested — a drift gate nobody has watched fail is a comment.
 *
 * ADR-004 §Drift gates promises the table equals the registry in "names and
 * count". The Set comparison this replaces delivered only the first half:
 * duplicating a row left the two Sets equal, so an MCP.md listing
 * `cite_study` twice — 24 rows against 23 verbs, reading to the agent as if
 * there were two different verbs — shipped green. Sorted arrays pin both, and
 * the message names what actually moved so the failure is actionable.
 */
function verbTableDrift(mcp: string, registry: string[]): string | null {
  const rows = mcp.split('\n').filter((line) => VERB_ROW.test(line)).map(verbOf)
  const sortedRows = [...rows].sort()
  const sortedRegistry = [...registry].sort()
  if (
    sortedRows.length === sortedRegistry.length &&
    sortedRows.every((verb, index) => verb === sortedRegistry[index])
  ) {
    return null
  }
  const duplicated = [...new Set(sortedRows.filter((verb, i) => i > 0 && verb === sortedRows[i - 1]))]
  const missing = sortedRegistry.filter((verb) => !rows.includes(verb))
  const extra = [...new Set(sortedRows.filter((verb) => !registry.includes(verb)))]
  return [
    `MCP.md's verb table has ${rows.length} row${rows.length === 1 ? '' : 's'}, TOOLS has ${registry.length} verb${registry.length === 1 ? '' : 's'}`,
    duplicated.length > 0 ? `duplicated rows: ${duplicated.join(', ')}` : null,
    missing.length > 0 ? `missing from the table: ${missing.join(', ')}` : null,
    extra.length > 0 ? `in the table but not in TOOLS: ${extra.join(', ')}` : null
  ]
    .filter((line) => line !== null)
    .join('; ')
}

/** The `{…}` cell of a verb row, as the names it declares: `{doi, provider?}` -> `['doi', 'provider?']`. */
function documentedInputs(row: string): string[] {
  const cell = (row.split('|')[2] ?? '').trim()
  return cell
    .replace(/^\{|\}$/g, '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
}

/** The same, read off the zod schema the verb actually parses its arguments with. */
function schemaInputs(schema: unknown): string[] {
  const shape = (schema as ZodObject<ZodRawShape>).shape
  return Object.entries(shape).map(([key, field]) =>
    // A field that accepts `undefined` is one the caller may omit — the `?` the
    // table uses. Asking the schema beats reading `.isOptional()` off a zod
    // internal that changes shape between majors.
    (field as ZodType).safeParse(undefined).success ? `${key}?` : key
  )
}

/**
 * The second half of the MCP.md ↔ TOOLS promise: every verb row declares the
 * inputs its verb actually accepts, each with the same optional marker.
 *
 * The name-and-count gate above cannot see this. `fetch_pdf` gained `accept`
 * — the only way a human can take a local match whose evidence was too thin to
 * copy unasked — while its row went on saying `{citekey?, doi?, policy?}`, and
 * the suite stayed green. An agent reads MCP.md to learn what it may send, so
 * an undocumented input is an input nobody will ever pass: the verb's whole
 * escape hatch was invisible while the ladder kept reporting candidates it
 * refused to copy. Compared sorted, so re-ordering a row for readability is
 * not a failure; every name and every `?` still has to match.
 */
function verbInputDrift(mcp: string, tools: readonly { name: string; schema: unknown }[]): string | null {
  const problems: string[] = []
  for (const row of mcp.split('\n').filter((line) => VERB_ROW.test(line))) {
    const name = verbOf(row)
    const tool = tools.find((t) => t.name === name)
    if (tool === undefined) continue // the name gate owns this failure
    const documented = documentedInputs(row).sort()
    const actual = schemaInputs(tool.schema).sort()
    const undocumented = actual.filter((input) => !documented.includes(input))
    const invented = documented.filter((input) => !actual.includes(input))
    if (undocumented.length === 0 && invented.length === 0) continue
    problems.push(
      [
        `${name} documents {${documented.join(', ')}} but accepts {${actual.join(', ')}}`,
        undocumented.length > 0 ? `accepted but undocumented: ${undocumented.join(', ')}` : null,
        invented.length > 0 ? `documented but not accepted: ${invented.join(', ')}` : null
      ]
        .filter((part) => part !== null)
        .join(' — ')
    )
  }
  return problems.length === 0 ? null : problems.join('; ')
}

describe('docs.gen drift gates', () => {
  it('is byte-identical to what gen-suna-context.mjs generates from resources/', async () => {
    const { generate } = (await import(
      join(repoRoot, 'scripts', 'gen-suna-context.mjs')
    )) as { generate: () => { content: string; hash: string } }
    const fresh = generate()
    const checkedIn = await readFile(
      join(repoRoot, 'packages', 'agent', 'src', 'context', 'docs.gen.ts'),
      'utf8'
    )
    expect(checkedIn).toBe(fresh.content)
    expect(SUNA_CONTEXT_HASH).toBe(fresh.hash)
  })

  it('keeps the install-time placeholders in MCP.md and nowhere else', () => {
    const mcp = SUNA_CONTEXT_FILES['MCP.md'] ?? ''
    expect(mcp).toContain('{{SUNA_MCP_PATH}}')
    expect(mcp).toContain('{{SUNA_MCP}}')
    for (const [name, body] of Object.entries(SUNA_CONTEXT_FILES)) {
      if (name === 'MCP.md') continue
      expect(body, `${name} must carry no {{…}} placeholders`).not.toMatch(/\{\{[A-Z_]+\}\}/)
    }
  })

  it('carries no machine-specific paths in any source doc or the skill', () => {
    for (const [name, body] of Object.entries({ ...SUNA_CONTEXT_FILES, 'SKILL.md': SUNA_SKILL_FILE })) {
      expect(body, `${name} must not name /Users/ or /home/ paths`).not.toMatch(/\/Users\/|\/home\/[a-z]/)
    }
  })

  it('MCP.md verb table matches the TOOLS registry exactly — names AND count', () => {
    const mcp = SUNA_CONTEXT_FILES['MCP.md'] ?? ''
    const registry = TOOLS.map((t) => t.name)
    expect(verbTableDrift(mcp, registry)).toBeNull()
    // and the doc's advertised count stays honest
    expect(mcp).toContain(`${registry.length} verbs`)
  })

  it('catches a duplicated verb row, which a Set comparison waves through', () => {
    const mcp = SUNA_CONTEXT_FILES['MCP.md'] ?? ''
    const registry = TOOLS.map((t) => t.name)
    const row = mcp.split('\n').find((line) => VERB_ROW.test(line)) ?? ''
    expect(row, 'MCP.md must have at least one verb row to duplicate').not.toBe('')

    const drift = verbTableDrift(mcp.replace(row, `${row}\n${row}`), registry)
    expect(drift).not.toBeNull()
    expect(drift).toContain('duplicated')
    expect(drift).toContain(verbOf(row))
  })

  it('catches a verb row that went missing', () => {
    const mcp = SUNA_CONTEXT_FILES['MCP.md'] ?? ''
    const registry = TOOLS.map((t) => t.name)
    const row = mcp.split('\n').find((line) => VERB_ROW.test(line)) ?? ''
    const drift = verbTableDrift(mcp.replace(`${row}\n`, ''), registry)
    expect(drift).not.toBeNull()
    expect(drift).toContain('missing from the table')
    expect(drift).toContain(verbOf(row))
  })

  it('MCP.md declares every input each verb actually accepts', () => {
    const mcp = SUNA_CONTEXT_FILES['MCP.md'] ?? ''
    expect(verbInputDrift(mcp, TOOLS)).toBeNull()
  })

  it('catches an input a verb accepts but the table never mentions', () => {
    const mcp = SUNA_CONTEXT_FILES['MCP.md'] ?? ''
    const row = mcp.split('\n').find((line) => line.startsWith('| fetch_pdf |')) ?? ''
    expect(row, 'MCP.md must have a fetch_pdf row').not.toBe('')

    const drift = verbInputDrift(mcp.replace(row, row.replace(', accept?}', '}')), TOOLS)
    expect(drift).not.toBeNull()
    expect(drift).toContain('fetch_pdf')
    expect(drift).toContain('accepted but undocumented: accept?')
  })

  it('catches a table that promises an input the verb would reject', () => {
    const mcp = SUNA_CONTEXT_FILES['MCP.md'] ?? ''
    const row = mcp.split('\n').find((line) => line.startsWith('| read_bib |')) ?? ''
    expect(row, 'MCP.md must have a read_bib row').not.toBe('')

    const drift = verbInputDrift(mcp.replace(row, row.replace('| {} |', '| {format?} |')), TOOLS)
    expect(drift).not.toBeNull()
    expect(drift).toContain('documented but not accepted: format?')
  })

  it('catches a required input the table advertises as optional', () => {
    const mcp = SUNA_CONTEXT_FILES['MCP.md'] ?? ''
    const row = mcp.split('\n').find((line) => line.startsWith('| add_comment |')) ?? ''
    expect(row, 'MCP.md must have an add_comment row').not.toBe('')

    // Calling a required input optional is the drift that costs most: the agent
    // omits it, the verb throws, and the doc is where it learned to.
    const drift = verbInputDrift(mcp.replace(row, row.replace('{path, quote, body}', '{path?, quote, body}')), TOOLS)
    expect(drift).not.toBeNull()
    expect(drift).toContain('accepted but undocumented: path')
    expect(drift).toContain('documented but not accepted: path?')
  })

  it('every doc the skill and README point at actually ships', () => {
    const names = Object.keys(SUNA_CONTEXT_FILES)
    for (const referenced of ['README.md', 'WORKFLOW.md', 'PROJECT-GUIDE.md', 'MANUSCRIPT.md', 'COMMENTS.md', 'FIGURES.md', 'MCP.md']) {
      expect(names).toContain(referenced)
    }
    expect(SUNA_SKILL_FILE).toContain('README.md')
    expect(SUNA_SKILL_FILE).toContain('WORKFLOW.md')
  })
})

/* ------------------------------------------------------------------ */
/* ensureSunaConfig                                                     */
/* ------------------------------------------------------------------ */

let cfgDir = ''
let skillHome = ''
let projectDir = ''
let serverFile = ''
let inv: McpInvocation
let env: NodeJS.ProcessEnv

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'suna-context-'))
  cfgDir = join(base, 'SunaConfig')
  skillHome = join(base, 'home')
  projectDir = join(base, 'project')
  serverFile = join(base, 'server.mjs')
  await mkdir(projectDir, { recursive: true })
  await writeFile(serverFile, '// pretend bundle\n', 'utf8')
  inv = { command: 'node', serverPath: serverFile }
  env = { SUNA_CONFIG_DIR: cfgDir, SUNA_SKILL_HOME: skillHome }
})

afterEach(async () => {
  await rm(dirname(cfgDir), { recursive: true, force: true })
})

describe('ensureSunaConfig', () => {
  it('creates the full layout: seeds, docs with substituted placeholders, stamp, skill', async () => {
    const result = await ensureSunaConfig(inv, env)
    expect(result.created.length).toBeGreaterThan(0)

    const who = await readFile(join(cfgDir, 'Context', 'UserContext', 'WHO-AM-I.md'), 'utf8')
    expect(who).toContain('not filled out yet')

    const mcpDoc = await readFile(join(cfgDir, 'Context', 'SunaContext', 'MCP.md'), 'utf8')
    expect(mcpDoc).toContain(serverFile)
    expect(mcpDoc).not.toContain('{{SUNA_MCP_PATH}}')

    const stamp = JSON.parse(
      await readFile(join(cfgDir, 'Context', 'SunaContext', '.version'), 'utf8')
    ) as { hash: string; serverPath: string }
    expect(stamp.hash).toBe(SUNA_CONTEXT_HASH)
    expect(stamp.serverPath).toBe(serverFile)

    const skill = await readFile(join(skillHome, '.claude', 'skills', 'suna', 'SKILL.md'), 'utf8')
    expect(skill).toBe(SUNA_SKILL_FILE)
  })

  it('is a no-op on the second run', async () => {
    await ensureSunaConfig(inv, env)
    const again = await ensureSunaConfig(inv, env)
    expect(again.created).toEqual([])
  })

  it('never rewrites user-edited UserContext files', async () => {
    await ensureSunaConfig(inv, env)
    const whoPath = join(cfgDir, 'Context', 'UserContext', 'WHO-AM-I.md')
    await writeFile(whoPath, 'I am a sleep neuroscientist.\n', 'utf8')
    // force the full (non-fast) path by deleting the stamp
    await rm(join(cfgDir, 'Context', 'SunaContext', '.version'))
    await ensureSunaConfig(inv, env)
    expect(await readFile(whoPath, 'utf8')).toBe('I am a sleep neuroscientist.\n')
  })

  it('anti-churn: does not rewrite an edited doc while the stamp is current', async () => {
    await ensureSunaConfig(inv, env)
    const docPath = join(cfgDir, 'Context', 'SunaContext', 'README.md')
    await writeFile(docPath, 'locally modified\n', 'utf8')
    await ensureSunaConfig(inv, env)
    expect(await readFile(docPath, 'utf8')).toBe('locally modified\n')
  })

  it('gone-not-different: re-syncs docs when the stamped server path no longer exists', async () => {
    await ensureSunaConfig(inv, env)
    const docPath = join(cfgDir, 'Context', 'SunaContext', 'README.md')
    await writeFile(docPath, 'stale content from a deleted install\n', 'utf8')
    await rm(serverFile)
    const newServer = join(dirname(serverFile), 'server-2.mjs')
    await writeFile(newServer, '// new bundle\n', 'utf8')
    await ensureSunaConfig({ ...inv, serverPath: newServer }, env)
    expect(await readFile(docPath, 'utf8')).not.toContain('stale content')
    const stamp = JSON.parse(
      await readFile(join(cfgDir, 'Context', 'SunaContext', '.version'), 'utf8')
    ) as { serverPath: string }
    expect(stamp.serverPath).toBe(newServer)
  })

  it('leaves a user-replaced skill (no managed marker) alone', async () => {
    await ensureSunaConfig(inv, env)
    const path = join(skillHome, '.claude', 'skills', 'suna', 'SKILL.md')
    await writeFile(path, 'my own skill\n', 'utf8')
    await rm(join(cfgDir, 'Context', 'SunaContext', '.version'))
    await ensureSunaConfig(inv, env)
    expect(await readFile(path, 'utf8')).toBe('my own skill\n')
  })

  it('substitutes a serverPath containing $-replacement patterns verbatim', async () => {
    const trickyPath = join(dirname(serverFile), 'a$&b$$c.mjs')
    await writeFile(trickyPath, '// bundle\n', 'utf8')
    await ensureSunaConfig({ command: 'node', serverPath: trickyPath }, env)
    const mcpDoc = await readFile(join(cfgDir, 'Context', 'SunaContext', 'MCP.md'), 'utf8')
    expect(mcpDoc).toContain(trickyPath)
    expect(mcpDoc).not.toContain('{{SUNA_MCP_PATH}}')
  })

  it('converges when the server path itself is missing: no restamp churn', async () => {
    await ensureSunaConfig(inv, env)
    await rm(serverFile) // the baked bundle disappears and nothing replaces it
    await ensureSunaConfig(inv, env)
    const stampPath = join(cfgDir, 'Context', 'SunaContext', '.version')
    const afterSecond = await readFile(stampPath, 'utf8')
    const third = await ensureSunaConfig(inv, env)
    expect(third.created).toEqual([])
    expect(await readFile(stampPath, 'utf8')).toBe(afterSecond)
  })
})

/* ------------------------------------------------------------------ */
/* ensureProjectAgentLayer                                              */
/* ------------------------------------------------------------------ */

describe('ensureProjectAgentLayer', () => {
  beforeEach(async () => {
    await writeFile(join(projectDir, 'suna.json'), JSON.stringify({ name: 'My Paper' }), 'utf8')
  })

  it('refuses a directory without suna.json', async () => {
    const bare = join(dirname(projectDir), 'not-a-project')
    await mkdir(bare, { recursive: true })
    const result = await ensureProjectAgentLayer(bare, inv)
    expect(result.created).toEqual([])
    await expect(stat(join(bare, 'AGENTS.md'))).rejects.toThrow()
  })

  it('creates stubs, context files, .gitignore line, and .mcp.json', async () => {
    const result = await ensureProjectAgentLayer(projectDir, inv)
    expect(result.created).toContain('AGENTS.md')
    expect(result.created).toContain('CLAUDE.md')
    expect(result.created).toContain('context/MISSION.md')

    const agents = await readFile(join(projectDir, 'AGENTS.md'), 'utf8')
    expect(isManagedStub(agents)).toBe(true)
    expect(agents).toBe(await readFile(join(projectDir, 'CLAUDE.md'), 'utf8'))

    expect(await readFile(join(projectDir, 'context', 'MISSION.md'), 'utf8')).toContain('My Paper')

    const gitignore = await readFile(join(projectDir, '.gitignore'), 'utf8')
    expect(gitignore.split('\n').filter((l) => l.trim() === '.mcp.json')).toHaveLength(1)

    const mcp = JSON.parse(await readFile(join(projectDir, '.mcp.json'), 'utf8')) as {
      mcpServers: { suna: { command: string; args: string[] } }
    }
    expect(mcp.mcpServers.suna.command).toBe('node')
    expect(mcp.mcpServers.suna.args).toEqual([serverFile, '--project', projectDir])
  })

  it('is idempotent, including the .gitignore line', async () => {
    await ensureProjectAgentLayer(projectDir, inv)
    const again = await ensureProjectAgentLayer(projectDir, inv)
    expect(again.created).toEqual([])
    const gitignore = await readFile(join(projectDir, '.gitignore'), 'utf8')
    expect(gitignore.split('\n').filter((l) => l.trim() === '.mcp.json')).toHaveLength(1)
  })

  it('appends the .mcp.json line to an existing .gitignore without rewriting it', async () => {
    await writeFile(join(projectDir, '.gitignore'), 'output/\n', 'utf8')
    await ensureProjectAgentLayer(projectDir, inv)
    expect(await readFile(join(projectDir, '.gitignore'), 'utf8')).toBe('output/\n.mcp.json\n')
  })

  it('never touches a user-authored AGENTS.md (no marker)', async () => {
    await writeFile(join(projectDir, 'AGENTS.md'), '# My own instructions\n', 'utf8')
    await ensureProjectAgentLayer(projectDir, inv)
    expect(await readFile(join(projectDir, 'AGENTS.md'), 'utf8')).toBe('# My own instructions\n')
  })

  it('replaces an outdated managed stub (marker present)', async () => {
    await writeFile(
      join(projectDir, 'AGENTS.md'),
      '<!-- suna:agent-stub v0 — old -->\nold pointer\n',
      'utf8'
    )
    await ensureProjectAgentLayer(projectDir, inv)
    expect(await readFile(join(projectDir, 'AGENTS.md'), 'utf8')).toBe(agentStub())
  })

  it('never touches user memory files once they exist', async () => {
    await ensureProjectAgentLayer(projectDir, inv)
    const notebook = join(projectDir, 'context', 'NOTEBOOK.md')
    await writeFile(notebook, '# Notebook\n\nreal memory\n', 'utf8')
    await ensureProjectAgentLayer(projectDir, inv)
    expect(await readFile(notebook, 'utf8')).toContain('real memory')
  })

  it('.mcp.json: untouched while its server path exists, rewritten when dangling, other servers preserved', async () => {
    const config = {
      mcpServers: {
        other: { command: 'foo', args: ['bar'] },
        suna: { command: 'node', args: [serverFile, '--project', projectDir] }
      }
    }
    const raw = JSON.stringify(config, null, 4) + '\n' // odd formatting on purpose
    await writeFile(join(projectDir, '.mcp.json'), raw, 'utf8')

    await ensureProjectAgentLayer(projectDir, inv)
    expect(await readFile(join(projectDir, '.mcp.json'), 'utf8')).toBe(raw)

    await rm(serverFile)
    const newServer = join(dirname(serverFile), 'server-3.mjs')
    await writeFile(newServer, '// bundle\n', 'utf8')
    await ensureProjectAgentLayer(projectDir, { ...inv, serverPath: newServer })
    const next = JSON.parse(await readFile(join(projectDir, '.mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[] }>
    }
    expect(next.mcpServers['other']).toEqual({ command: 'foo', args: ['bar'] })
    expect(next.mcpServers['suna']?.args[0]).toBe(newServer)
  })

  it('a leading-whitespace ".mcp.json" gitignore line does not count (git treats it literally)', async () => {
    await writeFile(join(projectDir, '.gitignore'), '  .mcp.json\n', 'utf8')
    await ensureProjectAgentLayer(projectDir, inv)
    const lines = (await readFile(join(projectDir, '.gitignore'), 'utf8')).split('\n')
    expect(lines.some((l) => l === '.mcp.json')).toBe(true)
  })

  it('re-bakes .mcp.json when its --project argument names a different root (moved project)', async () => {
    const stale = {
      mcpServers: { suna: { command: 'node', args: [serverFile, '--project', '/somewhere/else'] } }
    }
    await writeFile(join(projectDir, '.mcp.json'), JSON.stringify(stale, null, 2) + '\n', 'utf8')
    await ensureProjectAgentLayer(projectDir, inv)
    const next = JSON.parse(await readFile(join(projectDir, '.mcp.json'), 'utf8')) as {
      mcpServers: { suna: { args: string[] } }
    }
    expect(next.mcpServers.suna.args[2]).toBe(projectDir)
  })

  it('re-bakes a same-install entry whose command/env drifted (legacy plain-node packaged entry)', async () => {
    const legacy = {
      mcpServers: { suna: { command: 'node', args: [serverFile, '--project', projectDir] } }
    }
    await writeFile(join(projectDir, '.mcp.json'), JSON.stringify(legacy, null, 2) + '\n', 'utf8')
    await ensureProjectAgentLayer(projectDir, {
      command: '/Applications/SUNA.app/Contents/MacOS/SUNA',
      serverPath: serverFile,
      env: { ELECTRON_RUN_AS_NODE: '1' }
    })
    const next = JSON.parse(await readFile(join(projectDir, '.mcp.json'), 'utf8')) as {
      mcpServers: { suna: { command: string; env?: Record<string, string> } }
    }
    expect(next.mcpServers.suna.command).toBe('/Applications/SUNA.app/Contents/MacOS/SUNA')
    expect(next.mcpServers.suna.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
  })

  it('stops rewriting .mcp.json when the heal cannot converge (target bundle missing)', async () => {
    await rm(serverFile)
    const first = await ensureProjectAgentLayer(projectDir, inv)
    expect(first.created).toContain('.mcp.json')
    const second = await ensureProjectAgentLayer(projectDir, inv)
    expect(second.created).toEqual([])
  })

  it('preserves an unparseable .mcp.json beside the fresh one instead of destroying it', async () => {
    await writeFile(join(projectDir, '.mcp.json'), '{ not json', 'utf8')
    await ensureProjectAgentLayer(projectDir, inv)
    expect(await readFile(join(projectDir, '.mcp.json.invalid'), 'utf8')).toBe('{ not json')
    const fresh = JSON.parse(await readFile(join(projectDir, '.mcp.json'), 'utf8')) as {
      mcpServers: { suna: { args: string[] } }
    }
    expect(fresh.mcpServers.suna.args[0]).toBe(serverFile)
  })

  it('bakes packaged env (ELECTRON_RUN_AS_NODE) into .mcp.json when given', async () => {
    await ensureProjectAgentLayer(projectDir, {
      ...inv,
      command: '/Applications/SUNA.app/Contents/MacOS/SUNA',
      env: { ELECTRON_RUN_AS_NODE: '1' }
    })
    const mcp = JSON.parse(await readFile(join(projectDir, '.mcp.json'), 'utf8')) as {
      mcpServers: { suna: { env?: Record<string, string> } }
    }
    expect(mcp.mcpServers.suna.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
  })
})
