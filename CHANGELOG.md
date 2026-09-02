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

## [1.1.1] - 2026-09-02

### Fixed

- **The project wizard's Review page now shows what Create will actually
  write.** Its `suna.json` preview was omitting the whole document registry,
  so the cover letter that ships beside the paper in the Starter scaffold was
  invisible until after you clicked Create. The preview and the writer now
  call one function, so they cannot drift apart again.
- **Notebooks work after the wizard provisions a Python environment.** The
  "Create with uv" branch made the environment but never selected it, so the
  first notebook ran under the system Python and failed inside the environment
  onboarding had just built for it.
- **The integrated terminal no longer breaks after packaging the app.**
  Building the macOS installers rebuilt native modules for both CPU slices in
  turn and left the wrong one behind, so `pnpm package:mac` silently killed
  every terminal in a development build. Only developers were affected;
  installed apps were always correct.

### Added

- **The wizard can install the notebook runtime for you.** Step 4 offers to
  add `ipykernel` to the environment it is about to create — checked by
  default when SUNA creates the environment, offered but unchecked for an
  environment you already had, since that one may be shared with other work.
  Nothing is installed until you press Create. Notebooks also offer to repair
  the interpreter you have selected at any later point.

### Removed

- Windows support. SUNA is a macOS and Linux application: there is no longer a
  Windows installer in a release, no Windows leg in CI, and no Windows
  branching in the code. Nothing changes for macOS or Linux users. This is a
  scope decision rather than a reaction to a bug — Windows was built and
  shipped as a best-effort extra that no machine ever exercised, and carrying
  a platform nobody runs cost more in code paths and CI minutes than it
  returned.

### Internal

- The end-to-end smoke suite passes all 78 steps again (it stopped at step 6),
  PDF export is verified by parsing the bytes of a real exported file, and
  `suna_mpl` ships with the app so the bundled example's figure script runs
  from an installed copy.

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
