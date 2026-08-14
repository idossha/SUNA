#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
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

async function main(): Promise<void> {
  const root = projectRoot()
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
