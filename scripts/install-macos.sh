#!/usr/bin/env bash
# Install the latest SUNA release on macOS.
#
# THIS IS NOW A CONVENIENCE, NOT A REQUIREMENT. SUNA's macOS builds are signed
# with a Developer ID and notarized by Apple, so the normal path works: open
# the .dmg, drag SUNA to Applications, double-click it. Use this if you would
# rather install from a terminal, or want the right slice picked for you.
#
# It downloads with curl (which attaches no quarantine flag), installs to
# /Applications, and clears the attribute if one is present anyway — harmless
# on a notarized build, and it keeps the script working on an older release.
#
#   curl -fsSL https://raw.githubusercontent.com/idossha/SUNA/main/scripts/install-macos.sh | bash
#
# Read it before you run it. It writes only to /Applications/SUNA.app and a
# temporary directory, and it asks for no privileges you would not grant to
# dragging an app into place yourself.
set -euo pipefail

REPO="idossha/SUNA"
APP="/Applications/SUNA.app"

[[ "$(uname -s)" == "Darwin" ]] || { echo "This installer is macOS-only."; exit 1; }

case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *) echo "Unsupported architecture: $(uname -m)"; exit 1 ;;
esac

echo "Finding the latest SUNA release..."
URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
  | grep -o "https://[^\"]*-mac-$ARCH\.dmg" | head -1) || true

TMP=$(mktemp -d)
MNT="$TMP/mnt"
cleanup() {
  [[ -d "$MNT" ]] && hdiutil detach "$MNT" -quiet 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

if [[ -n "$URL" ]]; then
  echo "Downloading $(basename "$URL")..."
  curl -fL --progress-bar "$URL" -o "$TMP/suna.dmg"
elif command -v gh >/dev/null 2>&1; then
  # The releases API answers 404 for a private repo without credentials; the
  # GitHub CLI already holds the user's, so use it rather than failing.
  echo "Public download unavailable; fetching with the GitHub CLI..."
  gh release download --repo "$REPO" -p "*-mac-$ARCH.dmg" -D "$TMP" --clobber
  mv "$TMP"/*-mac-"$ARCH".dmg "$TMP/suna.dmg"
else
  echo "Could not find a macOS $ARCH build. If $REPO is private, install the"
  echo "GitHub CLI (brew install gh), run 'gh auth login', and try again."
  exit 1
fi

echo "Installing to $APP..."
mkdir -p "$MNT"
hdiutil attach "$TMP/suna.dmg" -nobrowse -quiet -mountpoint "$MNT"
rm -rf "$APP"
cp -R "$MNT/SUNA.app" "$APP"
hdiutil detach "$MNT" -quiet
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

if ! codesign --verify --deep --strict "$APP" 2>/dev/null; then
  echo "Warning: the installed app's signature does not verify."
fi

echo "Done. Open it with: open -a SUNA"
