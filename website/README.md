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
fresh copy of `examples/demo-paper`. To regenerate the whole set after a UI
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
touches `website/`, and deploys it to GitHub Pages. Two things must be true
before anything appears:

1. the repository is public (or on a plan that serves Pages from a private repo);
2. **Settings → Pages → Source** is set to **GitHub Actions**.

Until then the build job still runs and acts as a link-checker, and the deploy
job is skipped. The published URL will be `https://<owner>.github.io/SUNA/`;
the workflow passes that path through `SUNA_DOCS_BASE`, which `config.ts`
reads, so local builds stay at `/`.

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
