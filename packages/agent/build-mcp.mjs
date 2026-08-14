// Bundle the MCP server to a standalone ESM script agent CLIs can spawn.
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
await build({
  entryPoints: [join(here, 'src/mcp/server.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: join(here, 'dist-mcp/server.mjs'),
  banner: { js: '#!/usr/bin/env node' },
  external: ['zod', 'jsdom'],
  logLevel: 'info'
})
