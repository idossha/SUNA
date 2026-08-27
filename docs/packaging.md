# Packaging and releases

SUNA ships as a downloadable desktop app built with `electron-builder`.
Configuration lives in `apps/desktop/electron-builder.config.cjs`, which loads the static `electron-builder.base.yml` and decides signing from the environment; artifacts land in
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

There is no Apple Developer identity configured, so macOS builds are ad-hoc
signed (`identity: '-'`) under the hardened runtime, with
`build/entitlements.mac.plist` granting the library-validation exemption
ad-hoc signing requires. Windows builds are unsigned.

`identity: null` is NOT the same thing: it skips signing entirely, leaving the
bundle with only Electron's inherited linker signature, and Apple silicon then
rejects it as *"SUNA is damaged and can't be opened"* — a dead end for the
user, since there is no "open anyway". `scripts/e2e/packaged.mjs` asserts the
signature verifies so this cannot regress silently.

Ad-hoc signing is not notarization, and on current macOS that distinction is
absolute: an app carrying the quarantine flag that Apple cannot check is
reported as **"damaged"**, and neither right-click → Open nor the Gatekeeper
override in System Settings is offered. Signing correctly did not change the
dialog the user sees — it only means the bundle is no longer *also* broken.

The flag is attached by the downloading browser, not by the file, so the
supported install path is `scripts/install-macos.sh`, which fetches the DMG
with `curl` (no quarantine attached), installs to `/Applications` and clears
the attribute if one is present. Users who already downloaded through a
browser can run:

```sh
xattr -dr com.apple.quarantine /Applications/SUNA.app
```

**A Developer ID certificate plus notarization is the only thing that makes a
double-clicked download work.** It needs a paid Apple Developer account.

`apps/desktop/electron-builder.config.cjs` already switches on the
environment: it loads `electron-builder.base.yml`, then ad-hoc signs when no certificate
is present and signs + notarizes when one is. Nothing in the config needs
editing — add these repository secrets and the next tagged build is notarized:

| Secret | What it is |
| --- | --- |
| `MAC_CERT_P12` | base64 of the exported *Developer ID Application* certificate (`base64 -i cert.p12 \| pbcopy`) |
| `MAC_CERT_PASSWORD` | the password set when exporting that .p12 |
| `APPLE_ID` | the Apple ID that owns the developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | an app-specific password from appleid.apple.com (not the account password) |
| `APPLE_TEAM_ID` | the 10-character team id from the developer portal |

Getting the certificate: in the Apple Developer portal create a *Developer ID
Application* certificate, download and install it, then export it from
Keychain Access as a `.p12` with a password. Notarization adds a few minutes
to the mac job while Apple's service scans the build.

Once notarized, drop `com.apple.security.cs.disable-library-validation` from
`build/entitlements.mac.plist` — it exists only because ad-hoc signing needs
it — and the install script becomes a convenience rather than a requirement.

## Releases

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds on
macOS, Windows and Linux runners and uploads every artifact to a draft GitHub
Release. Publish the draft once the artifacts look right.
