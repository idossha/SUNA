# SUNA — agent instructions

Electron academic-writing platform. pnpm monorepo, TypeScript strict.

## Ground rules

- Read `docs/design/architecture.md` before structural changes; it is the
  master plan (milestones M0–M5). `docs/design/reference-analysis.md` is the
  authoritative spec for formatter and canvas behavior; ADRs live beside it.
- Sources of truth are JSON / Markdown / BibTeX / SVG / LaTeX. Never introduce
  a binary or proprietary document format. PDF/DOCX are export-only.
- The canvas document model is the SVG DOM itself — never add a parallel scene
  graph, never let an import/export conversion own the file.
- Numbering (figures, tables, equations, references) is derived at format
  time, never stored.
- All canvas mutations go through the command bus (`@suna/canvas`); UI
  gestures and AI agent calls are equal clients of it.

## Commands

- `pnpm typecheck` / `pnpm test` — must pass workspace-wide before a commit.
- UI checks run against a HIDDEN app — never launch a visible window for
  testing. `node scripts/e2e/drive.mjs --boot --example` boots it once (no
  window, no dock icon, isolated userData); then `drive.mjs --shot out.png`,
  `--eval "expr"` or `run probe.mjs` iterate in seconds; `--stop` when done.
- `pnpm smoke` — hidden by default too; takes
  `--only`/`--from`/`--until`/`--list`/`--keep`.
- `pnpm dev` — run the app with a visible window; for the human only.
- Python: `cd python/suna_mpl && uv run pytest`.

## Gotchas

- dockview v8 ships no React binding — the adapter is
  `apps/desktop/src/renderer/src/shell/dock/DockHost.tsx`; extend it rather
  than importing a `DockviewReact` that doesn't exist.
- TypeScript 7: CSS side-effect imports need the `vite/client` types
  reference (`src/renderer/src/env.d.ts`).
- pnpm 10 blocks postinstall scripts: electron/esbuild are allow-listed in
  root `package.json` (`pnpm.onlyBuiltDependencies`).
- matplotlib SVG export: `svg.fonttype: none` keeps text editable — required
  for canvas text editing (suna_mpl sets it).
- Settings and themes live in ONE user-owned file, `~/.suna/config.yml`, plus
  `~/.suna/themes/*.yml` — there is no project settings level and no second
  store. Add a setting by adding one entry to `SETTING_KEYS`
  (`packages/core/src/settings-resolve.ts`); the seeded config file, defaults,
  validation and resolver all follow. Colours are NOT in any stylesheet: they
  come from the theme registry (`packages/core/src/theme.ts`) as a generated
  sheet. See `docs/design/configuration.md`.

## Packaging and releases

- Packaging goes through `scripts/electron-builder.sh` on EVERY path
  (`pnpm package`, CI, the release workflow). It owns `--publish never` and the
  one macOS signing conditional; never call `electron-builder` directly.
- `apps/desktop/electron-builder.yml` describes the SIGNED build. It has no
  `identity:` key on purpose — with one, electron-builder never reads
  `CSC_LINK`. `identity: null` must never be used: Apple silicon rejects such a
  bundle as "damaged" with no override.
- Cutting a release is `scripts/release.sh <version>`, which never pushes.
  Pushing the tag is what publishes, and is a human's act, not an agent's.
- `docs/RELEASING.md` is the operator's manual; `docs/packaging.md` covers what
  goes inside the bundle.
