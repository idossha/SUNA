# Building and releasing

For people working on SUNA itself. If you only want to run it, [install and run](/guide/install) is the page you want.

## The checks that gate a change

Three commands, and they are the same three CI runs on every pull request:

```bash
pnpm typecheck                       # strict TypeScript across the workspace
pnpm test                            # Vitest across the workspace
cd python/suna_mpl && uv run pytest   # the matplotlib companion
```

::: warning Never pipe the typecheck into a pager
`pnpm typecheck | tail` reports `tail`'s exit status, not `tsc`'s, and hides a failure.
:::

`pnpm build` is a prerequisite of the typecheck on a fresh clone — `packages/agent`'s MCP bundle and the workspace's emitted declarations do not arrive with a `git clone`.

### UI checks run against a hidden app

Never launch a visible window to test. The driver boots the app once with no window, no dock icon and isolated user data, and then answers in seconds:

```bash
node scripts/e2e/drive.mjs --boot --example    # boot it, hidden
node scripts/e2e/drive.mjs --shot out.png      # screenshot
node scripts/e2e/drive.mjs --eval "expr"       # evaluate in the renderer
node scripts/e2e/drive.mjs --stop
```

`pnpm dev` is the visible-window mode, and it is for a human looking at the app — not for a test.

## Continuous integration

`.github/workflows/ci.yml`, on every pull request and every push to `main`.

| Job | Runs on | What it proves |
|---|---|---|
| `test` | Linux, macOS **and** Windows | Typecheck and unit tests pass on all three. The main process branches on platform, so a path-separator or `process.platform` mistake is caught by the runner it actually breaks on. |
| `python` | Linux | `suna_mpl`'s pytest suite. |
| `package` | macOS | Builds the app, packages it, and **launches the real bundle**. |

That last job is the one worth understanding. The packaged layout — asar contents, `extraResources`, the MCP server beside its flattened `node_modules`, the Python kernel bridge — does not exist until `electron-builder` has run, so `pnpm dev` can never see a regression in it. `scripts/e2e/packaged.mjs` boots the built bundle hidden and asserts every one of those pieces actually resolved, plus that the code signature verifies. Run it yourself after a local build:

```bash
pnpm package:mac
node scripts/e2e/packaged.mjs
```

The CI packaging job builds **unsigned on purpose**: no signing secrets reach it, so it takes the ad-hoc path. Signing and notarization belong to the release workflow, and paying Apple's several-minute notary round trip on every pull request would buy nothing.

## Building installers locally

```bash
pnpm package:mac     # DMGs and zips for arm64 + x64
pnpm package         # every target configured for the current host
```

Both run `pnpm build`, then `pnpm stage:resources`, then `scripts/electron-builder.sh`. Artifacts land in `release/` at the repo root, which is git-ignored.

**Everything goes through `scripts/electron-builder.sh`**, and it exists for one conditional: whether a signing certificate is present.

| `CSC_LINK` in the environment | What you get |
|---|---|
| set | signed with the Developer ID, hardened runtime, notarized by Apple, stapled |
| not set | ad-hoc signed, hardened runtime off — a valid bundle that runs locally |

A local build is the second row, and the script says so on the first line of its output. An ad-hoc build is not notarized: it runs fine from your own disk, but if you upload it and someone downloads it in a browser, macOS will refuse it. That is the whole reason releases go through CI.

The script also unsets rather than empties the signing variables on that path. A workflow writes a `CSC_LINK` env entry from the repository secret whether or not that secret exists, so on a runner without it the variable is present and empty — and electron-builder tests it for *defined*, not for non-empty, then dies trying to read a certificate from `""`.

## Cutting a release

```bash
git switch main && git pull
# Write this release's section in CHANGELOG.md first — it becomes the body of
# the GitHub Release, and it is what someone downloading it reads.
scripts/release.sh 1.1.0 --dry-run
scripts/release.sh 1.1.0
git push origin main
git push origin v1.1.0        # this is what builds and publishes the release
```

`scripts/release.sh` bumps the version in both files that carry it, dates the changelog section, commits and tags. **It never pushes** — pushing the tag is what creates a public Release, so it stays a deliberate act.

Pushing the tag runs `.github/workflows/release.yml`, which is three stages:

1. **`create-release`** makes the GitHub Release immediately, as a **draft**, with the body taken from `CHANGELOG.md` plus a table telling a downloader which file to take.
2. **`build`** runs macOS, Linux and Windows in parallel. Each leg builds, verifies what it produced, and attaches its own assets to that draft as soon as it has them — so a slow platform never holds up the others, and a leg that fails leaves the rest already attached.
3. **`verify`** reads the assets actually attached, fails if any required one is missing, and **publishes the Release** when none is.

There is no manual publish step. A green `verify` is the same statement a maintainer used to make by eye. And because the failure mode runs both ways, neither an incomplete release nor a finished-but-forgotten draft can happen.

To rehearse without cutting anything, run the workflow from the Actions tab: `workflow_dispatch` builds the same matrix and uploads the artifacts, and every step that touches a Release is gated on the tag.

## macOS signing and notarization

Release builds are signed with a **Developer ID Application** certificate and notarized by Apple, which is what makes a downloaded `.dmg` open by double-clicking it.

The distinctions that matter, because two of them look identical until a user hits them:

- **Notarized** — Apple has scanned the build and issued a ticket, which is stapled into the app and the disk image. Opens cleanly.
- **Ad-hoc signed, not notarized** — a valid bundle, but a browser-downloaded copy carries a quarantine flag and Gatekeeper refuses it: *"Apple cannot check it for malicious software."* The user can get past that, but should not have to.
- **Not signed at all** (`identity: null`) — the bundle carries only Electron's inherited linker signature. Apple silicon rejects it as *"SUNA is damaged and can't be opened"*, with **no** override offered. This is a dead end for the user and must never ship.

The release workflow proves the claim rather than assuming it. After building it runs `codesign --verify`, `spctl -a -t install` — checking for the words *Notarized Developer ID*, not merely a zero exit — and `xcrun stapler validate` on every `.dmg`. A build that signs but fails to notarize goes red in CI instead of in someone's dialog.

Two details that cost real debugging time:

- **`electron-builder.yml` deliberately has no `identity:` key.** With one, electron-builder never looks at `CSC_LINK`, and the entire Developer ID path fails silently.
- **The `.dmg` is stapled by the workflow, not by electron-builder.** electron-builder notarizes and staples the `.app` but never submits the disk image, so the dmg carries no ticket of its own. The workflow submits each one and staples it afterwards.

The four secrets, how to set them, and the warning about retrying failed notarization sign-ins (Apple locks the account) are in [`docs/RELEASING.md`](https://github.com/idossha/SUNA/blob/main/docs/RELEASING.md) §4, in the repository.

## What is not covered

Windows and Linux builds are unsigned, and nothing in CI boots one. They are typechecked and unit-tested on their own runners, so platform-branching code is exercised, but no packaged Windows or Linux bundle is ever launched by a machine. Treat those builds as untested rather than unsupported, and say so when you report a bug on one.
