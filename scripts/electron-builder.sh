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

# `${extra[@]+...}` rather than a bare `"${extra[@]}"`: macOS ships bash 3.2,
# where an empty array expanded under `set -u` is an unbound-variable error.
exec ./node_modules/.bin/electron-builder \
  --config electron-builder.yml \
  --publish never \
  ${extra[@]+"${extra[@]}"} \
  "$@"
