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
  banner: {
    // An ESM bundle has no `require`, so any bundled CJS dependency that calls
    // one dies at startup: `yaml` (pulled in by @suna/core's config parsing)
    // does `require('process')` and took the whole MCP server down with
    // "Dynamic require of 'process' is not supported". Handing the bundle a
    // real `require` fixes it for every such dependency, present and future,
    // and keeps them INLINED — which matters because this file is spawned
    // from the packaged app's resources, where a runtime `node_modules`
    // lookup is not guaranteed to find anything.
    js: "#!/usr/bin/env node\nimport { createRequire as __sunaCreateRequire } from 'node:module';\nconst require = __sunaCreateRequire(import.meta.url);"
  },
  external: ['zod', 'jsdom'],
  logLevel: 'info'
})
