# Changelog

All notable changes to SUNA. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and SUNA uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

`scripts/release.sh <version>` dates the section for the version it cuts and
opens a fresh `[Unreleased]` above it; `.github/workflows/release.yml` reads
that section back out and makes it the body of the GitHub Release. So the
section written here is what a user reads on the download page — write it for
them, not for the commit log, which GitHub appends underneath on its own.

## [Unreleased]

Nothing yet.

## [1.1.0] - 2026-09-01

### Added

- macOS builds are signed with a Developer ID and notarized by Apple, so a
  downloaded `.dmg` opens by double-clicking it. No `xattr` step, and no
  terminal installer required.
- `.zip` alongside the `.dmg` on macOS, and a `.tar.gz` alongside the
  `.AppImage` and `.deb` on Linux.
- A CI workflow: typecheck and tests on Linux, macOS and Windows for every
  pull request, plus a macOS leg that packages the app and launches the real
  bundle.
- `scripts/release.sh` — one command bumps every version in the repo, dates the
  changelog, commits and tags. It never pushes.
- `docs/RELEASING.md`, the operator's manual for cutting a release.

### Changed

- The release workflow creates the GitHub Release first as a **draft**, each
  platform attaches its own assets as soon as it has them, and a final `verify`
  job publishes only once every required asset is actually attached. An
  incomplete release is never public, and a complete one is never left
  forgotten as a draft.
- Packaging goes through `scripts/electron-builder.sh` on every path, which
  owns the one signing conditional. `apps/desktop/electron-builder.config.cjs`
  is gone.

## [1.0.5] - 2026-08-27

- Release uploads retry per file, so one flaky HTTP 400 from GitHub's upload
  endpoint no longer costs a release its assets.
- macOS builds are ad-hoc signed under the hardened runtime, which stops Apple
  silicon rejecting them as damaged. They are still not notarized.
