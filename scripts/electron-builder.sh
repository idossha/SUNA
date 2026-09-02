#!/usr/bin/env bash
# electron-builder, plus the ONE conditional that macOS code signing needs.
# Every packaging path goes through here: `pnpm package`, `pnpm package:mac`,
# ci.yml's package gate and release.yml's build matrix.
#
#   scripts/electron-builder.sh                 # this host's default targets
#   scripts/electron-builder.sh --mac           # both mac slices
#   scripts/electron-builder.sh --linux --x64
#
# WHY A SCRIPT AND NOT TWO CONFIGS. `apps/desktop/electron-builder.yml`
# describes the *signed* build — hardened runtime, entitlements,
# `notarize: true`, and deliberately no `identity:` key — because that is what
# a release must be. A fork, a contributor running `pnpm package`, and CI's
# package gate have no certificate, and for them every one of those settings is
# wrong in a way that is worse than unsigned. So the rule is written once, here:
#
#   CSC_LINK set    → sign and notarize exactly as the config says.
#   CSC_LINK empty  → ad-hoc sign, hardened runtime and notarization off.
#
# THE UNSIGNED PATH MUST STILL SIGN. `--config.mac.identity=-` is ad-hoc
# signing and is load-bearing: skipping signing altogether leaves the bundle
# carrying only Electron's inherited linker signature, and Apple silicon
# rejects that outright as "SUNA is damaged and can't be opened" — a dead end,
# because no "open anyway" is offered. Ad-hoc keeps the bundle valid. It is not
# notarization: a browser download is still quarantined and refused.
#
# The five variables are UNSET, not merely emptied. A workflow writes
# `CSC_LINK: ${{ secrets.CSC_LINK }}` unconditionally, so on a runner without
# the secret the variable exists and is `""` — and electron-builder tests these
# for *defined*, not for non-empty. It then resolves `""` as a certificate path
# and dies with `⨯ apps/desktop not a file`, an error naming neither signing
# nor the empty variable. That is what killed SUNA 1.0.4's mac job.
#
# `CSC_IDENTITY_AUTO_DISCOVERY=false` keeps a *developer's* Mac deterministic:
# without it electron-builder finds whatever Developer ID happens to be in the
# login keychain, so `pnpm package` behaves differently for two people on the
# same commit.
#
# `--publish never` is set here for everyone and is load-bearing:
# electron-builder reads `CI=true` as consent to publish, and otherwise builds
# every artifact and *then* dies with `⨯ GitHub Personal Access Token is not
# set`. Attaching assets is release.yml's own explicit step.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/apps/desktop"

extra=()
if [ "$(uname -s)" = "Darwin" ] && [ -z "${CSC_LINK:-}" ]; then
  echo "==> no CSC_LINK: building AD-HOC SIGNED (no hardened runtime, no notarization)"
  echo "    downloads of this build will be refused by Gatekeeper — see docs/RELEASING.md §4"
  unset CSC_LINK CSC_KEY_PASSWORD CSC_NAME APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID
  export CSC_IDENTITY_AUTO_DISCOVERY=false
  extra=(
    --config.mac.identity=-
    --config.mac.hardenedRuntime=false
    --config.mac.notarize=false
  )
elif [ "$(uname -s)" = "Darwin" ]; then
  echo "==> CSC_LINK is present: signing with Developer ID${APPLE_ID:+ and notarizing as $APPLE_ID}"
fi

# PUT THE WORKING TREE BACK AFTERWARDS. A `--mac` build packages BOTH slices,
# and electron-builder rebuilds the native modules for each one in turn against
# the shared `node_modules`. Whichever arch it built last is what it leaves
# there — so after packaging on Apple silicon, `node_modules/node-pty` holds an
# **x86_64** `pty.node` and `spawn-helper`, and every terminal in the dev app
# then dies with `posix_spawnp failed`. The packaged apps are fine (each slice
# got its own correct build); it is the developer's tree that is left broken,
# silently, by a command that appears to have succeeded.
#
# Measured 2026-09-01: this is what broke `pnpm smoke`'s terminal-panel and
# command-palette-modes steps, and it reproduces from plain node, not just
# under Electron. So rebuild for the host arch on the way out.
#
# Not `exec`, because there is work after the build. The rebuild is best-effort
# and never fails the packaging run: the artifacts are already built and valid,
# and a failure here costs a developer one `pnpm rebuild:native`, which the
# message names.
restore_host_native_modules() {
  [ "$(uname -s)" = "Darwin" ] || return 0
  echo "==> restoring native modules for the host arch ($(uname -m)) after packaging"
  ./node_modules/.bin/electron-rebuild -f -w node-pty >/dev/null 2>&1 || {
    echo "    WARNING: could not rebuild node-pty for $(uname -m)." >&2
    echo "    Terminals in the dev app will fail with 'posix_spawnp failed' until you run:" >&2
    echo "      pnpm rebuild:native" >&2
    return 0
  }
  echo "    done — dev terminals will work again"
}

# `${extra[@]+...}` rather than a bare `"${extra[@]}"`: macOS ships bash 3.2,
# where an empty array expanded under `set -u` is an unbound-variable error.
# `set +e` around the build: under `set -e` a failed electron-builder would
# exit here, before `status=$?` and before the restore — leaving the tree with
# the wrong-arch native modules precisely on the runs where a developer is
# about to retry and needs a working app.
set +e
./node_modules/.bin/electron-builder \
  --config electron-builder.yml \
  --publish never \
  ${extra[@]+"${extra[@]}"} \
  "$@"
status=$?
set -e

restore_host_native_modules
exit "$status"
