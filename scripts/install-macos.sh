#!/usr/bin/env bash
# Install the latest SUNA release on macOS.
#
# Why this exists: SUNA is not notarized (no Apple Developer certificate yet),
# and macOS refuses to open ANY quarantined app it cannot check with Apple —
# reporting it as "damaged", with no "open anyway". A browser attaches that
# quarantine flag; curl does not. This script downloads with curl, installs to
# /Applications, and strips the flag if one is present anyway.
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
URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o "https://[^\"]*-mac-$ARCH\.dmg" | head -1)
[[ -n "$URL" ]] || { echo "No macOS $ARCH build found in the latest release."; exit 1; }

TMP=$(mktemp -d)
MNT="$TMP/mnt"
cleanup() {
  [[ -d "$MNT" ]] && hdiutil detach "$MNT" -quiet 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "Downloading $(basename "$URL")..."
curl -fL --progress-bar "$URL" -o "$TMP/suna.dmg"

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
