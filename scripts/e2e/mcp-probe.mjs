#!/usr/bin/env node
/**
 * Probe the bundled MCP server (packages/agent/dist-mcp/server.mjs) over real
 * stdio JSON-RPC — the same transport an agent CLI uses. Verifies the tool
 * list and drives the comment + literature verbs against a project directory.
 *
 * Usage:
 *   node scripts/e2e/mcp-probe.mjs --project <dir> [--tools-only] [--json]
 *   node scripts/e2e/mcp-probe.mjs --project <dir> --call <tool> '<json args>'
 *
 * Exit 0 = every probe passed. Used standalone and by scripts/e2e/smoke.mjs.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SERVER = join(ROOT, 'packages', 'agent', 'dist-mcp', 'server.mjs')

/** Minimal stdio JSON-RPC client for one server process. */
export class McpClient {
  constructor(projectDir) {
    if (!existsSync(SERVER)) {
      throw new Error(`MCP bundle missing: ${SERVER} (run: cd packages/agent && node build-mcp.mjs)`)
    }
    this.proc = spawn(process.execPath, [SERVER, '--project', projectDir], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.nextId = 0
    this.pending = new Map()
    this.buffer = ''
    this.stderr = ''
    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', (chunk) => this.#onData(chunk))
    this.proc.stderr.setEncoding('utf8')
    this.proc.stderr.on('data', (chunk) => {
      this.stderr += chunk
    })
    this.proc.on('exit', (code) => {
      for (const { rej } of this.pending.values()) {
        rej(new Error(`mcp server exited (${code}): ${this.stderr.slice(0, 400)}`))
      }
      this.pending.clear()
    })
  }

  #onData(chunk) {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (line.length > 0) {
        let msg
        try {
          msg = JSON.parse(line)
        } catch {
          // Not a JSON-RPC frame (server logging); ignore.
          msg = null
        }
        if (msg !== null && msg.id !== undefined && this.pending.has(msg.id)) {
          const { res, rej } = this.pending.get(msg.id)
          this.pending.delete(msg.id)
          if (msg.error) rej(new Error(JSON.stringify(msg.error)))
          else res(msg.result)
        }
      }
      index = this.buffer.indexOf('\n')
    }
  }

  request(method, params) {
    const id = ++this.nextId
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej })
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          rej(new Error(`mcp timeout on ${method}`))
        }
      }, 30_000).unref?.()
    })
  }

  notify(method, params) {
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }

  async initialize() {
    const result = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'suna-mcp-probe', version: '0.1.0' }
    })
    this.notify('notifications/initialized', {})
    return result
  }

  async listTools() {
    const result = await this.request('tools/list', {})
    return result.tools
  }

  /** Returns the concatenated text content; throws when the tool reported an error. */
  async callTool(name, args = {}) {
    const result = await this.request('tools/call', { name, arguments: args })
    const text = (result.content ?? []).map((c) => c.text ?? '').join('\n')
    if (result.isError) throw new Error(`${name} failed: ${text}`)
    return text
  }

  close() {
    this.proc.stdin.end()
    this.proc.kill()
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

const EXPECTED_TOOLS = [
  'list_project',
  'read_manuscript',
  'write_manuscript',
  'edit_manuscript',
  'read_section',
  'write_section',
  'list_outline',
  'read_manuscript_meta',
  'check_manuscript',
  'list_figures',
  'read_figure_svg',
  'read_bib',
  'check_figure_compliance',
  'list_comments',
  'add_comment',
  'reply_comment',
  'resolve_comment',
  'search_literature',
  'lookup_doi',
  'add_reference'
]

async function main() {
  const argv = process.argv
  const projectIndex = argv.indexOf('--project')
  const project = projectIndex >= 0 ? argv[projectIndex + 1] : join(ROOT, 'examples', 'demo-paper')
  const toolsOnly = argv.includes('--tools-only')
  const asJson = argv.includes('--json')
  const log = (line) => {
    if (!asJson) console.log(line)
  }

  // Single-tool mode: print exactly the tool's text, nothing else, so a
  // caller can assert on it (scripts/e2e/smoke.mjs).
  const callIndex = argv.indexOf('--call')
  if (callIndex >= 0) {
    const tool = argv[callIndex + 1]
    const args = argv[callIndex + 2] === undefined ? {} : JSON.parse(argv[callIndex + 2])
    const one = new McpClient(project)
    try {
      await one.initialize()
      process.stdout.write(await one.callTool(tool, args))
    } finally {
      one.close()
    }
    return
  }

  const client = new McpClient(project)
  const out = {}
  try {
    const init = await client.initialize()
    log(`  ✓ initialize → ${init.serverInfo.name} ${init.serverInfo.version}`)

    const tools = await client.listTools()
    const names = tools.map((t) => t.name)
    out.tools = names
    for (const expected of EXPECTED_TOOLS) {
      assert(names.includes(expected), `tools/list missing ${expected} (got: ${names.join(', ')})`)
    }
    for (const tool of tools) {
      assert(
        tool.inputSchema && typeof tool.inputSchema === 'object',
        `${tool.name} has no JSON Schema`
      )
    }
    log(`  ✓ tools/list → ${names.length} tools, all schemas present`)

    if (toolsOnly) {
      out.ok = true
      if (asJson) console.log(JSON.stringify(out))
      return
    }

    const listed = await client.callTool('list_comments', {})
    out.listComments = listed
    log(`  ✓ list_comments → ${listed.split('\n')[0]}`)

    if (argv.includes('--add-comment')) {
      const at = argv.indexOf('--add-comment')
      const [path, quote, body] = [argv[at + 1], argv[at + 2], argv[at + 3]]
      const added = await client.callTool('add_comment', { path, quote, body })
      out.addComment = added
      log(`  ✓ add_comment → ${added}`)
    }
  } finally {
    client.close()
  }
  out.ok = true
  if (asJson) console.log(JSON.stringify(out))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`  ✗ ${error.message}`)
    process.exit(1)
  })
}
