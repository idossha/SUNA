import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { ensureProjectAgentLayer, ensureSunaConfig, type McpInvocation } from '../context/ensure'
import { callTool, TOOLS } from './verbs'

/**
 * SUNA's MCP server: manuscript verbs over stdio, so subscription-billed
 * agent CLIs (Claude Code, Codex) can read and edit the project through the
 * same validated operations the app uses. Runs without the app open.
 *
 * usage: node server.mjs --project /path/to/project
 */
function projectRoot(): string {
  const index = process.argv.indexOf('--project')
  const value = index >= 0 ? process.argv[index + 1] : undefined
  return value ?? process.cwd()
}

function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  // MCP wants JSON Schema; zod v4 emits it directly.
  return z.toJSONSchema(schema) as Record<string, unknown>
}

/** This very process, as an invocation others can reuse: whatever node-like
 * binary is running us, pointed at this script (the bundle path once built).
 * When we are the packaged app binary running as Node, that marker MUST ride
 * along — without it the baked command would launch the Electron GUI, and
 * the gone-not-different rule would then pin the broken config forever. */
function selfInvocation(): McpInvocation {
  const serverPath = fileURLToPath(import.meta.url)
  const runAsNode =
    process.env['ELECTRON_RUN_AS_NODE'] !== undefined || process.versions['electron'] !== undefined
  return {
    command: process.execPath,
    serverPath,
    ...(runAsNode ? { env: { ELECTRON_RUN_AS_NODE: '1' } } : {})
  }
}

async function main(): Promise<void> {
  const root = projectRoot()

  // Heal the machine context layer and this project's agent files before
  // serving (ARCHITECTURE §15.4). Best-effort: a failed heal must never stop the server
  // — the verbs work regardless.
  try {
    const inv = selfInvocation()
    await ensureSunaConfig(inv)
    await ensureProjectAgentLayer(root, inv)
  } catch (error) {
    process.stderr.write(`suna context heal failed (continuing): ${String(error)}\n`)
  }

  const server = new Server(
    { name: 'suna', version: '0.1.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: jsonSchemaFor(tool.schema)
    }))
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const text = await callTool(root, request.params.name, request.params.arguments ?? {})
      return { content: [{ type: 'text', text }] }
    } catch (error) {
      return {
        content: [
          { type: 'text', text: error instanceof Error ? error.message : String(error) }
        ],
        isError: true
      }
    }
  })

  await server.connect(new StdioServerTransport())
}

main().catch((error: unknown) => {
  process.stderr.write(`suna mcp server failed: ${String(error)}\n`)
  process.exit(1)
})
