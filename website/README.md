# SUNA documentation site

The user-facing documentation for SUNA, built with [VitePress](https://vitepress.dev).
Content is Markdown; the design is SUNA's own palette, ported from
`apps/desktop/src/renderer/src/styles/tokens.css` into `.vitepress/theme/suna.css`.

## Run it locally

From the repository root:

```bash
pnpm install            # once — the site is a workspace package
pnpm docs:dev           # http://localhost:5173
```

Other commands:

```bash
pnpm docs:build         # static build → website/.vitepress/dist
pnpm docs:preview       # serve that build, as GitHub Pages will
```

`docs:build` fails on a dead internal link, so it doubles as the site's
link-checker. Run it before pushing.

## Screenshots

Every image under `public/shots/` is a real capture of the running application,
produced by `scripts/e2e/probes/docs-shots.mjs` driving a hidden SUNA against a
fresh copy of `examples/hello-suna`. To regenerate the whole set after a UI
change:

```bash
pnpm docs:shots         # boot hidden → capture → convert to WebP → stop
```

That needs `cwebp` (`brew install webp`). The probe captures PNGs at
3200×2200; the converter resizes to 2000 px wide and writes WebP, which is
about a fifth of the size at the width the site displays them. Only the WebP
files are committed — `public/shots/*.png` is gitignored.

To iterate on a single image without recapturing all 21:

```bash
node scripts/e2e/drive.mjs --boot --example
SUNA_SHOTS_ONLY=canvas,export node scripts/e2e/drive.mjs scripts/e2e/probes/docs-shots.mjs
node website/scripts/shots.mjs --convert-only
node scripts/e2e/drive.mjs --stop
```

Adding a new screenshot means adding a `shot(...)` block to the probe, not
taking one by hand — a hand-taken screenshot cannot be regenerated when the UI
moves.

## Publishing

`.github/workflows/docs.yml` builds the site on every push to `main` that
touches `website/`, and on every pull request. That build is worth having on
its own: it runs `normalize.mjs --check` and then a full VitePress build at the
deploy base path, so a dead internal link or an unnormalised shortcut fails CI
rather than reaching the published site.

Publishing is switched off until you turn it on, in three steps:

1. make the repository public — Pages cannot be enabled on a private repo on
   most plans;
2. **Settings → Pages → Source**: **GitHub Actions**;
3. **Settings → Secrets and variables → Actions → Variables**: add
   `DOCS_PAGES_ENABLED` = `true`.

The artifact upload and the deploy job are both gated on that variable. Without
it the workflow is a link checker and stays green; the alternative — attempting
to publish on every push and failing until an unrelated setting changes — just
trains everyone to ignore a red X.

The published URL will be `https://<owner>.github.io/SUNA/`. The workflow
passes that path through `SUNA_DOCS_BASE`, which `config.ts` reads and
interpolates into the favicon link by hand, so local builds stay at `/`.

## Structure

```
website/
  index.md                  home page
  guide/  writing/  figures/  publishing/  ai/  reference/
  public/shots/*.webp        generated app screenshots
  scripts/shots.mjs          regeneration entry point
  .vitepress/
    config.ts                nav, sidebar, base, search
    theme/suna.css           SUNA's palette and typography
    theme/index.ts
```

The sidebar is declared in `config.ts`; a new page has to be added there or it
will not be reachable.
