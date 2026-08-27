# Packaging and releases

SUNA ships as a downloadable desktop app built with `electron-builder`.
Configuration lives in `apps/desktop/electron-builder.yml`; artifacts land in
`release/` at the repo root (git-ignored).

## Building locally

```sh
pnpm package:mac     # DMGs for arm64 + x64
pnpm package         # every target configured for the current host
```

Both run three steps: `pnpm build` (workspace + `electron-vite build` +
the MCP bundle), `pnpm stage:resources`, then `electron-builder`.

## What ships beside the app

The main process resolves three things from `process.resourcesPath` when
packaged, so `scripts/packaging/stage-resources.mjs` stages them into
`apps/desktop/build/resources/` before `electron-builder` copies that
directory verbatim into `Contents/Resources`:

| Path | Used by | Purpose |
| --- | --- | --- |
| `examples/hello-suna` | `main/ipc.ts` | the "open example project" command |
| `mcp/server.mjs` + `mcp/node_modules` | `main/services/agentLayer.ts` | the MCP server agent CLIs spawn |
| `python/suna_kernel` | `main/services/kernel.ts` | the notebook kernel bridge |

`build-mcp.mjs` deliberately leaves `zod` and `jsdom` external, so the staging
script flattens their dependency closure out of pnpm's symlink store into a
plain `node_modules` beside the bundle. Where two packages need different
versions of the same dependency (jsdom's tree does, for `whatwg-url`) the
second copy is nested under its dependent, exactly as Node resolution expects.

`node-pty` is a native module and is unpacked from the asar
(`asarUnpack` in the builder config) so it can be loaded at runtime.

## Verifying a build

```sh
node scripts/e2e/packaged.mjs            # defaults to release/mac-arm64/SUNA.app
node scripts/e2e/packaged.mjs --app /path/to/SUNA.app
```

This boots the real bundle hidden (`SUNA_HIDDEN=1`, isolated userData), opens
the bundled example project through the same IPC the menu uses, and asserts
every `process.resourcesPath` dependency actually resolved. `pnpm dev` cannot
catch these regressions — the packaged layout only exists after a build.

## Signing

There is no Apple Developer identity configured, so macOS builds are ad-hoc
signed (`identity: '-'`) under the hardened runtime, with
`build/entitlements.mac.plist` granting the library-validation exemption
ad-hoc signing requires. Windows builds are unsigned.

`identity: null` is NOT the same thing: it skips signing entirely, leaving the
bundle with only Electron's inherited linker signature, and Apple silicon then
rejects it as *"SUNA is damaged and can't be opened"* — a dead end for the
user, since there is no "open anyway". `scripts/e2e/packaged.mjs` asserts the
signature verifies so this cannot regress silently.

Ad-hoc signing still is not notarization, so a downloaded build carries the
quarantine attribute and macOS refuses the first launch. Users must right-click
→ Open, or run:

```sh
xattr -dr com.apple.quarantine /Applications/SUNA.app
```

Adding a Developer ID certificate plus notarization credentials to the release
workflow removes that step; swap `identity`, drop the library-validation
entitlement, and nothing else in the config needs to change.

## Releases

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds on
macOS, Windows and Linux runners and uploads every artifact to a draft GitHub
Release. Publish the draft once the artifacts look right.
