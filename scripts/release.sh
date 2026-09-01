#!/usr/bin/env bash
# Cut a release: bump the version everywhere, date the changelog, commit, tag.
#
#   scripts/release.sh 1.1.0
#   scripts/release.sh 1.1.0 --dry-run     # print what would change, touch nothing
#   scripts/release.sh 1.1.0 --no-tag      # commit only
#
# IT DOES NOT PUSH. Pushing the tag is what starts release.yml and therefore
# what creates a GitHub Release, so it stays a deliberate act by a human on
# `main`. docs/RELEASING.md §3.
#
# THE VERSION LIVES IN TWO PLACES and this script is the only thing that knows
# both. `apps/desktop/package.json` is the one electron-builder reads for
# `${version}` in every artifact name, so a tree bumped only at the root ships
# `SUNA-1.0.5-mac-arm64.dmg` out of a 1.1.0 release — and release.yml's
# `verify` job then fails on assets that are all present under the wrong name.
# The workspace libraries under packages/ are unpublished internals on their
# own 0.x line and are deliberately NOT bumped.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-}"
shift || true
DRY=0
TAG=1
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --no-tag) TAG=0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

if [ -z "$VERSION" ]; then
  echo "usage: scripts/release.sh <version> [--dry-run] [--no-tag]" >&2
  exit 2
fi
# Semver, no leading `v` — the tag gets the `v`, the files do not; npm rejects
# `v1.1.0` as a version.
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "not a semver version: '$VERSION' (expected e.g. 1.1.0, and no leading 'v')" >&2
  exit 2
fi

TAG_NAME="v$VERSION"
PACKAGE_JSONS=(package.json apps/desktop/package.json)

# ---------------------------------------------------------------- preconditions
if [ "$DRY" = "0" ]; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "the working tree is dirty; commit or stash first" >&2
    git status --short >&2
    exit 1
  fi
  if git rev-parse -q --verify "refs/tags/$TAG_NAME" >/dev/null; then
    echo "tag $TAG_NAME already exists" >&2
    exit 1
  fi
  branch="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$branch" != "main" ]; then
    echo "on '$branch', not main — releases are cut from main" >&2
    exit 1
  fi
fi

CURRENT="$(node -p "require('./package.json').version")"
echo "==> $CURRENT → $VERSION"

if [ "$DRY" = "1" ]; then
  echo "    (dry run) would rewrite:"
  printf '      %s\n' "${PACKAGE_JSONS[@]}" CHANGELOG.md
  echo "    (dry run) would commit 'chore(release): $VERSION' and tag $TAG_NAME"
  node scripts/changelog-section.mjs "$VERSION" >/dev/null 2>&1 \
    && echo "    (dry run) CHANGELOG.md has a section for $VERSION" \
    || echo "    (dry run) NOTE: CHANGELOG.md has no section for $VERSION yet"
  exit 0
fi

# ---------------------------------------------------------------------- edits
for f in "${PACKAGE_JSONS[@]}"; do
  node - "$f" "$VERSION" <<'NODE'
const { readFileSync, writeFileSync } = require('node:fs');
const [file, version] = process.argv.slice(2);
const text = readFileSync(file, 'utf8');
// A targeted replacement of the FIRST top-level "version", not JSON.parse +
// stringify: rewriting the whole document would reformat it, and a
// dependency's own "version" key must never be touched.
const next = text.replace(/^(\s*"version":\s*)"[^"]*"/m, `$1"${version}"`);
if (next === text) { console.error(`no top-level "version" in ${file}`); process.exit(1); }
writeFileSync(file, next);
NODE
  echo "    $f"
done

# CHANGELOG: date this version's section and open a fresh [Unreleased] above it.
node - CHANGELOG.md "$VERSION" <<'NODE'
const { readFileSync, writeFileSync } = require('node:fs');
const [file, version] = process.argv.slice(2);
const today = new Date().toISOString().slice(0, 10);
const esc = version.replace(/\./g, '\\.');
let text = readFileSync(file, 'utf8');
if (new RegExp(`^## \\[${esc}\\]`, 'm').test(text)) {
  // Written by hand ahead of the bump — the normal case for a release whose
  // notes are the point. Only date it if it is undated.
  text = text.replace(new RegExp(`^## \\[${esc}\\](?! - )`, 'm'), `## [${version}] - ${today}`);
} else if (text.includes('## [Unreleased]')) {
  // Promote whatever accumulated under [Unreleased] into this version.
  text = text.replace('## [Unreleased]', `## [Unreleased]\n\nNothing yet.\n\n## [${version}] - ${today}`);
} else {
  console.error('CHANGELOG.md has neither an [Unreleased] section nor one for this version');
  process.exit(1);
}
writeFileSync(file, text);
NODE
echo "    CHANGELOG.md"

echo "==> sanity: every version reads $VERSION, and the notes resolve"
for f in "${PACKAGE_JSONS[@]}"; do
  got="$(node -p "require('./$f').version")"
  [ "$got" = "$VERSION" ] || { echo "$f is $got, not $VERSION" >&2; exit 1; }
done
node scripts/changelog-section.mjs "$VERSION" >/dev/null

git add "${PACKAGE_JSONS[@]}" CHANGELOG.md
git commit -m "chore(release): $VERSION"

if [ "$TAG" = "1" ]; then
  # Annotated: `git describe` and the GitHub release UI both read a tag's
  # author and date, and a lightweight tag has neither.
  git tag -a "$TAG_NAME" -m "SUNA $VERSION"
  echo "==> tagged $TAG_NAME"
fi

cat <<EOF

Done, locally. Nothing has been pushed.

  git show --stat HEAD
  git push origin main
  git push origin $TAG_NAME     # <- this is what builds and publishes the Release

docs/RELEASING.md §3 has the rest.
EOF
