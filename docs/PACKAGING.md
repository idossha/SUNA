# Packaging and releases

SUNA ships as a downloadable desktop app built with `electron-builder`.
Configuration lives in `apps/desktop/electron-builder.yml`; the one conditional
it cannot express — whether a signing certificate is present — lives in
`scripts/electron-builder.sh`, which every packaging path goes through.
Artifacts land in `release/` at the repo root (git-ignored).

Cutting an actual release is `docs/RELEASING.md`. This page is about what goes
*inside* the bundle.

## Building locally

```sh
pnpm package:mac     # DMGs for arm64 + x64
pnpm package         # every target configured for the current host
```

Both run three steps: `pnpm build` (workspace + `electron-vite build` +
the MCP bundle), `pnpm stage:resources`, then `scripts/electron-builder.sh`.
Without a `CSC_LINK` in the environment that last step builds ad-hoc signed and
says so — see `docs/RELEASING.md` §4.

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
(`asarUnpack` in the base config) so it can be loaded at runtime.

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

Signing and notarization are covered in full in **`docs/RELEASING.md` §4** —
the two-path rule in `scripts/electron-builder.sh`, why the ad-hoc fallback
must still sign, why the `.dmg` is stapled by the workflow rather than by
electron-builder, and the four secrets. The short version:

- Release builds are signed with the **Developer ID Application** certificate
  of team `3BMY24SA43`, hardened, notarized by Apple, and stapled. A downloaded
  `.dmg` opens by double-clicking it, with no `xattr` step.
- Builds without a certificate — a fork, a contributor, CI's packaging gate —
  are **ad-hoc signed** (`--config.mac.identity=-`) with the hardened runtime
  off. The bundle is valid and runs locally; a *browser download* of one is
  still refused by Gatekeeper.
- `identity: null` must never be used. It skips signing entirely, and Apple
  silicon then rejects the app as *"SUNA is damaged and can't be opened"* with
  no override offered. `scripts/e2e/packaged.mjs` asserts the signature
  verifies so this cannot regress silently.
- Windows builds are unsigned; SmartScreen warns about an unknown publisher.

## Releases

Pushing a `v*` tag runs `.github/workflows/release.yml`: it creates a draft
Release, builds macOS, Linux and Windows in parallel with each leg attaching its
own assets, and a final `verify` job publishes the Release once every required
asset is actually attached. There is no manual publish step, and an incomplete
release never becomes public. `docs/RELEASING.md` is the operator's manual.
