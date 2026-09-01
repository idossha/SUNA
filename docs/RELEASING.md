# Releasing SUNA

How a version becomes installers that people can download and double-click.
This is the operator's manual; `docs/PACKAGING.md` describes what is inside the
bundle, and the website's [Building and releasing](../website/guide/building.md)
page is the same story written for someone who does not have this repository
open.

| | |
| --- | --- |
| Bump versions, date the changelog, commit, tag | `scripts/release.sh <version>` — **never pushes** |
| Build every installer, publish the Release | `.github/workflows/release.yml`, on a `v*` tag |
| Every check that gates a merge | `.github/workflows/ci.yml` |
| Build installers locally | `pnpm package` / `pnpm package:mac` |
| Prove a built bundle actually runs | `node scripts/e2e/packaged.mjs` |

---

## 1. What gets built

`apps/desktop/electron-builder.yml`. Artifact names are
`SUNA-<version>-<os>-<arch>.<ext>` on every platform and every target.

| Platform | Targets | Arch | Built on | Required |
| --- | --- | --- | --- | --- |
| macOS | `dmg`, `zip` | arm64 **and** x64 | `macos-latest` — **one** runner builds both slices | **yes** |
| Linux | `AppImage`, `deb`, `tar.gz` | x64 (AppImage also arm64) | `ubuntu-latest` | **yes** |

**macOS and Linux are the only supported platforms.** Windows is not built and
not supported.

The exact asset names at version `<v>`:

```
SUNA-<v>-mac-arm64.dmg          SUNA-<v>-mac-arm64.zip
SUNA-<v>-mac-x64.dmg            SUNA-<v>-mac-x64.zip
SUNA-<v>-linux-x86_64.AppImage
SUNA-<v>-linux-arm64.AppImage   (optional)
SUNA-<v>-linux-amd64.deb
SUNA-<v>-linux-x64.tar.gz       (optional)
latest-mac.yml  latest-linux.yml             (optional)
```

**`${arch}` resolves per target to that ecosystem's own spelling**, which
matters if you are writing a download link by hand: macOS and the `.tar.gz` get
`arm64` / `x64`, the `.AppImage` gets `x86_64`, and the `.deb` gets `amd64`. The
*pattern* is uniform; the arch token inside it is native. Hard-coding `x64`
would look tidier and would silently misname the Linux builds.

`zip` alongside `dmg` on macOS is not redundant: the `.dmg` is what a human
double-clicks, the `.zip` is what a script downloads, and the `.zip` is the only
mac artifact that unpacks without mounting an image. `tar.gz` on Linux is the
escape hatch for every distro that is neither Debian nor FUSE-capable.

The `latest*.yml` files are electron-builder's update feeds. SUNA has no
in-app updater yet, so they are attached but not required — they exist so that
adding one later does not need a re-release.

**`linux.executableName: suna` is required, not cosmetic.** electron-builder
derives the Linux binary name from `package.json`'s `name` — here the scoped
`@suna/desktop` — and then refuses it as unusable in a file path. macOS names
the binary after `productName` and never reaches that code, so the
failure is invisible until the first Linux build.

**What ships beside the app** — the bundled example project, the MCP server and
its flattened `node_modules`, the Python kernel bridge — is staged by
`scripts/packaging/stage-resources.mjs` and covered in `docs/PACKAGING.md`.

---

## 2. Before you cut

```sh
pnpm install
pnpm typecheck && pnpm test
cd python/suna_mpl && uv run pytest && cd -
```

Do not pipe the typecheck into a pager: `pnpm typecheck | tail` reports
`tail`'s exit status, not `tsc`'s, and hides a failure.

Then the thing a source-only test run cannot tell you — that the *packaged*
app works:

```sh
pnpm package:mac                  # 2 dmgs + 2 zips into release/
node scripts/e2e/packaged.mjs     # boots the real bundle, hidden
```

CI runs all of this on every pull request (`ci.yml`), including the packaging
gate on macOS, so a green pull request has already proved everything above.

---

## 3. Cutting the release

```sh
git switch main && git pull
# Write the release's section in CHANGELOG.md first — it becomes the body of
# the GitHub Release, and it is what a downloader reads.
scripts/release.sh 1.1.0 --dry-run      # prints what would change
scripts/release.sh 1.1.0
```

That rewrites the version in **both** places that carry it — the root
`package.json` and `apps/desktop/package.json` — dates the changelog section,
commits `chore(release): 1.1.0` and creates the annotated tag `v1.1.0`.

A partial bump is the failure this exists to prevent:
`apps/desktop/package.json` is the file electron-builder reads for
`${version}`, so a tree that is 1.1.0 everywhere except there ships
`SUNA-1.0.5-mac-arm64.dmg` out of a 1.1.0 release — and `verify` then fails on
assets that are all present under the wrong name.

**`release.sh` does not push, and neither should an agent.** Pushing the tag is
what creates a Release, so it stays a deliberate act:

```sh
git push origin main
git push origin v1.1.0        # <- this builds the matrix and publishes the Release
```

### What the tag push does

1. **`create-release`** — makes the GitHub Release for the tag immediately, as
   a **draft**, with the body taken from `CHANGELOG.md`'s section for this
   version (`scripts/changelog-section.mjs`) plus a download table, and
   GitHub's generated commit summary appended underneath.
2. **`build`** — two parallel jobs (macOS, Linux). Each installs,
   builds, packages, verifies what it produced, uploads a workflow artifact and
   then **attaches its own files to that Release**. Creating the Release first
   is what lets each platform publish as soon as it is ready instead of waiting
   for the slowest.
3. **`verify`** — reads the assets actually attached and fails if any
   *required* one is missing. This is the check a green matrix does not give
   you: a leg can succeed and upload nothing. When it passes, its last step
   **publishes the Release and marks it Latest.**

The draft therefore lasts only as long as the build. A missing required asset
leaves `verify` red and the Release a draft, so an incomplete release is never
public — and a release nobody remembers to publish, which is its own failure,
cannot happen.

After it lands, do the check a machine cannot: download the `.dmg` for your own
machine **in a browser** and double-click it. The workflow proves Gatekeeper
accepts the bundle on the runner; only a browser download proves the quarantine
path a real user takes.

If `verify` fails, the Release stays a draft. Re-run the failed `build` leg —
`verify` then publishes it — or delete the draft and the tag
(`git push origin :refs/tags/v1.1.0`) and cut it again.

To rehearse without a tag, run `release.yml` from the Actions tab.
`workflow_dispatch` builds the same matrix and uploads workflow artifacts,
while `create-release`, the attach steps and `verify` are all `if:`-gated on
`refs/tags/v` and do not run.

---

## 4. Signing and notarization (macOS)

This is the part that decides whether a download opens or is refused, so it is
worth understanding rather than copying.

`apps/desktop/electron-builder.yml` describes the **signed** build:
`hardenedRuntime: true`, `gatekeeperAssess: false`, `notarize: true`,
`entitlements` / `entitlementsInherit: build/entitlements.mac.plist`, and
deliberately **no `identity:` key** — with one, electron-builder never looks at
`CSC_LINK` and the whole Developer ID path dies silently. electron-builder 26
signs from `CSC_LINK` and notarizes through the `APPLE_*` variables by itself;
`@electron/notarize` is its own dependency, not one of ours.

**Whether that config is used as written is decided in one place:
`scripts/electron-builder.sh`.** Every packaging path goes through it —
`pnpm package`, `ci.yml`'s package gate, `release.yml`'s build step:

| `CSC_LINK` | What happens |
| --- | --- |
| set | signed with the Developer ID, hardened, notarized, stapled |
| empty | `--config.mac.identity=- --config.mac.hardenedRuntime=false --config.mac.notarize=false` — an ad-hoc signed build, no error |

The script **unsets** the five variables on that path rather than leaving them
empty. A workflow writes `CSC_LINK: ${{ secrets.CSC_LINK }}` unconditionally,
so on a runner without the secret the variable exists and is `""` — and
electron-builder tests it for *defined*, not for non-empty. It then resolves
`""` as a certificate path and dies with `⨯ apps/desktop not a file`, an error
naming neither signing nor the empty variable. That is what killed 1.0.4's mac
job.

**The ad-hoc fallback must still sign.** `identity: null` is not the same
thing: it skips signing entirely, leaving only Electron's inherited linker
signature, and Apple silicon rejects that outright as *"SUNA is damaged and
can't be opened"* — a dead end, because no *open anyway* is offered. Ad-hoc
signing (`identity: '-'`) keeps the bundle valid. It is **not** notarization: a
browser download of an ad-hoc build is still quarantined and refused, just with
the softer *"Apple cannot check it for malicious software"* wording.

**The `.dmg` is stapled by the workflow, not by electron-builder.**
electron-builder notarizes and staples the `.app`; it never submits the disk
image, so the dmg itself carries no ticket. A dmg without a ticket still opens
— Gatekeeper finds the app's stapled ticket once the image is mounted — but it
fails an offline check on the image. `release.yml`'s *Notarize and staple the
dmg* step runs `notarytool submit --wait` and `stapler staple` on each dmg, and
the *Signature, Gatekeeper and staple* gate then holds. A local
`pnpm package:mac` skips that step: its dmgs open fine, but `stapler validate`
on them reports no ticket.

### 4.1 The four secrets

`release.yml`'s build step passes these on every leg and tolerates all of them
being empty. `APPLE_TEAM_ID` is public and is written in the workflow
(`3BMY24SA43`) rather than kept as a secret.

| Secret | What it is | Where it comes from |
| --- | --- | --- |
| `CSC_LINK` | the Developer ID **Application** certificate, base64 of a `.p12` | Keychain Access → export the identity as `.p12`, then `base64 -i cert.p12 \| pbcopy` |
| `CSC_KEY_PASSWORD` | the password set when exporting that `.p12` | you chose it during the export |
| `APPLE_ID` | the Apple ID that owns the developer account | `idohaber.apple@gmail.com` |
| `APPLE_APP_SPECIFIC_PASSWORD` | an app-specific password, **not** the account password | appleid.apple.com → Sign-In and Security → App-Specific Passwords |

To set them from a Mac that already has the identity in its login keychain:

```sh
PASS=$(openssl rand -hex 16)
security export -k ~/Library/Keychains/login.keychain-db -t identities \
  -f pkcs12 -P "$PASS" -o /tmp/devid.p12          # approve the keychain prompt
base64 -i /tmp/devid.p12 | tr -d '\n' | gh secret set CSC_LINK
printf '%s' "$PASS"                     | gh secret set CSC_KEY_PASSWORD
printf '%s' "idohaber.apple@gmail.com"  | gh secret set APPLE_ID
printf '%s' "<app-specific-password>"   | gh secret set APPLE_APP_SPECIFIC_PASSWORD
rm -f /tmp/devid.p12
```

**Check the credentials before you rely on them, and do not retry blindly.**

```sh
xcrun notarytool history --apple-id idohaber.apple@gmail.com \
  --password "<app-specific-password>" --team-id 3BMY24SA43
```

`release.yml` runs exactly this as its first macOS step, *before* the build,
for a reason: a bad password fails in seconds with Apple's own message, whereas
the same failure inside electron-builder costs the whole build first. And every
failed sign-in counts against the Apple ID — a few in a row locks it
(`HTTP status code: 401. Your Apple ID has been locked`), which no workflow
re-run can fix. If that step goes red, fix the credentials; do not press
*Re-run*.

The same certificate serves `idossha/TI-Toolbox` and `idossha/tetravox`, which
use the same four secret names.

---

## 5. Linux

Linux packages are not signed; they carry no signature by convention.

CI typechecks and tests on Linux, so platform-branching code is exercised, but
Linux has no packaged-launch gate the way macOS does: nothing in the
matrix boots a Linux bundle. Treat those builds as untested rather
than unsupported.
