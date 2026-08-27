// Stage everything the packaged app expects under Contents/Resources.
//
// The main process resolves three things by `process.resourcesPath` when
// packaged (see ipc.ts, agentLayer.ts, kernel.ts):
//   resources/examples/hello-suna   - the "open example project" command
//   resources/mcp/server.mjs        - the MCP server agents spawn
//   resources/python/suna_kernel    - the notebook kernel bridge
// electron-builder copies this staging directory verbatim, so anything the
// app needs at runtime has to land here first.
import { cp, mkdir, rm, readdir, readFile, realpath } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const stage = join(repo, 'apps/desktop/build/resources')

await rm(stage, { recursive: true, force: true })
await mkdir(stage, { recursive: true })

// 1. Example project
await cp(join(repo, 'examples/hello-suna'), join(stage, 'examples/hello-suna'), {
  recursive: true,
  filter: (src) => !src.includes('/.git/')
})

// 2. Python kernel bridge
await cp(join(repo, 'python/suna_kernel'), join(stage, 'python/suna_kernel'), {
  recursive: true,
  filter: (src) => !/__pycache__|\.pyc$/.test(src)
})

// 3. MCP server bundle
const mcpBundle = join(repo, 'packages/agent/dist-mcp/server.mjs')
if (!existsSync(mcpBundle)) {
  throw new Error('packages/agent/dist-mcp/server.mjs missing - run `pnpm --filter @suna/agent build:mcp` first')
}
await mkdir(join(stage, 'mcp'), { recursive: true })
await cp(mcpBundle, join(stage, 'mcp/server.mjs'))

// zod and jsdom are deliberately left external by build-mcp.mjs, so the
// bundle needs a real node_modules beside it. pnpm's store is a graph of
// symlinks; flatten the reachable closure into one directory so plain Node
// resolution finds every transitive dependency.
const require = createRequire(join(repo, 'packages/agent/package.json'))
const out = join(stage, 'mcp/node_modules')

async function pkgDir(name, from) {
  try {
    return dirname(require.resolve(`${name}/package.json`, { paths: [from] }))
  } catch {
    // Packages without a package.json export map: walk up from the entry.
    let dir = dirname(require.resolve(name, { paths: [from] }))
    while (dir !== '/' && !existsSync(join(dir, 'package.json'))) dir = dirname(dir)
    return dir
  }
}

// `placed` records the name@version occupying each staged node_modules. A
// flat top-level layout serves almost the whole tree; where two packages
// genuinely need different versions of the same dependency (jsdom's tree does,
// for whatwg-url), the second one is nested inside the dependent that asked
// for it, which is exactly what Node's resolution expects.
const placed = new Map()

async function stagePackage(name, from, nm) {
  const dir = await realpath(await pkgDir(name, from))
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  // A few packages ship a package.json with no `name`; the requested
  // specifier is the reliable key.
  const pkgName = manifest.name ?? name
  const key = `${pkgName}@${manifest.version}`

  const seen = placed.get(nm) ?? new Map()
  placed.set(nm, seen)
  if (seen.get(pkgName) === key) return
  if (seen.has(pkgName)) {
    throw new Error(`unresolvable conflict in ${nm}: ${seen.get(pkgName)} vs ${key}`)
  }
  seen.set(pkgName, key)

  const staged = join(nm, pkgName)
  await cp(dir, staged, { recursive: true, dereference: true })
  for (const dep of Object.keys(manifest.dependencies ?? {})) {
    // Prefer the shared top level; fall back to a private node_modules when
    // that slot is already taken by a different version.
    const top = placed.get(out)
    const depDir = await realpath(await pkgDir(dep, dir))
    const depVersion = JSON.parse(await readFile(join(depDir, 'package.json'), 'utf8')).version
    const clash = top?.has(dep) && top.get(dep) !== `${dep}@${depVersion}`
    await stagePackage(dep, dir, clash ? join(staged, 'node_modules') : out)
  }
}

for (const root of ['zod', 'jsdom']) {
  await stagePackage(root, join(repo, 'packages/agent'), out)
}

const entries = await readdir(out)
console.log(`staged ${entries.length} MCP runtime packages into build/resources/mcp/node_modules`)
