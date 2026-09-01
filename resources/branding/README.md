# SUNA's icon

The mark is a **lit limb**: a gold annulus whose weight is modulated by
offsetting the inner circle up and to the left, over a night-sky rounded
square, with a small dot at the centre. It descends from the flat ring the
docs site used before it — same palette (`--s-accent` gold `#e8b45c` on
`--s-bg-shell` `#16161c`), same reading as sun, aperture and orbit — but the
uneven weight makes it a body catching light rather than a drawn circle.

## Sources — the only files edited by hand

| File | For |
|---|---|
| `icon.svg` | The master. Used for every raster of 64px and up. |
| `icon-small.svg` | 16 and 32 only. A separate drawing, not a shrunk master. |
| `mark.svg` | The ring alone, no ground under it, for placing on a surface. |

`website/public/favicon.svg` is a fourth hand-drawn one, on a 32 grid, for
the docs site. It is not generated from these.

### Why the small sizes are drawn twice

The master's thinnest limb is 36 of 1024 units. At 16px that is half a pixel:
it greys out, and the ring reads as broken rather than lit. `icon-small.svg`
draws the same idea with one even ring, flat colour, and weights that land
near whole pixels (stroke 64/1024 → 1px at 16, 2px at 32). Every icon this
size is drawn twice by anyone who cares how it looks in the Finder sidebar.

### Geometry

Apple's grid: a 1024 canvas with the art inside an 824 rounded square (corner
radius 185.4) inset 100 a side. Drawing edge to edge would make SUNA larger
than every neighbour in the dock. No drop shadow is baked in — it survives
16px badly, and the two sizes that would carry it are not worth a second
master.

## Generated files

```bash
node scripts/branding/make-icons.mjs
```

Needs `rsvg-convert` (`brew install librsvg`); the `.icns` step also needs
`iconutil`, which ships with macOS, and is skipped elsewhere.

| File | For |
|---|---|
| `apps/desktop/resources/icon.png` | 512. Loaded at runtime: `src/main/index.ts` imports it with electron-vite's `?asset` suffix and sets the dock icon from it in development. |
| `apps/desktop/build/icon.icns` | macOS bundle icon |
| `apps/desktop/build/icon.png` | 1024, Linux |

They are committed, so a clone has an icon without librsvg installed. Re-run
the script after editing any source.

## Packaging

There is no packaging yet — a signed macOS build is a roadmap item. The
generated files already use the names and the `build/` location that
electron-builder looks in with no configuration at all, so that milestone
does not also have to be an icon milestone. Two things to check when it
lands:

- `resources/` must be shipped, or the `?asset` path
  (`out/main/../../resources/icon.png`) misses inside the bundle. Only the
  non-macOS window icon depends on it; the macOS dock icon comes from the
  `.icns`, and the code that sets it by hand is guarded by `!app.isPackaged`.
- macOS 26 prefers layered icons authored in Icon Composer. A `.icns` still
  works; a layered version would be a new source beside these, not a
  replacement for them.
