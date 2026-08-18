# The figure canvas

A vector editor that works directly on `figure.svg` — the tools, the layers tree, the properties rail, and the export presets that put a file on disk at a journal's stated width and dpi.

The document model is the SVG DOM itself. When you open a figure, SUNA parses `figure.svg` into a live DOM and edits that DOM in place; when you save, it writes the SVG back. There is no import step, no conversion, no proprietary project file sitting beside the drawing. The file on disk before you opened it and the file after you save are both plain SVG that any other program can read.

That has one consequence worth knowing up front: the ids in the file are the handles you edit by. A plot exported by [`suna_mpl`](/figures/from-code) carries semantic ids like `ax0`, `ax0.title` and `ax0.line.halpha`, and those ids survive every edit you make on the canvas.

<figure class="shot">
  <img src="/shots/canvas.webp" alt="The SUNA window with a two-panel spectrum figure on a 180 x 58 mm artboard. A narrow tool rail runs down the left with select, rectangle, ellipse, line, arrow and text icons; a LAYERS tree lists metadata, defs, figure_1, ax0, xtick_1 and their children; the PROPERTIES rail on the right shows Align, Figure, Palette, Agent and Export sections." />
  <figcaption>A figure open on the canvas. The Layers tree is the SVG's own element tree — nothing is translated into a separate scene graph.</figcaption>
</figure>

## The figure folder

Each figure is a directory under `figures/`:

```text
figures/fig-spectrum/
  figure.json            metadata: caption, namespace, width preset, panels
  figure.svg             the drawing — this is what the canvas edits
  figure.svg.suna.json   coordinate manifest, written by suna_mpl
  source/plot.py         the generating script, if there is one
```

`figure.json` holds the caption (`title` and `body`, optionally `credits` and `abbreviations`), a `namespace` of `main`, `extended-data` or `box`, a `widthPreset` of `single` or `double`, and the `panels` list. (`onehalf` is a render and export width, and a project-settings value — it is not one a figure can store.) It also has a `provenance` field, which is `null` for a figure you drew from scratch. Figure ids match `[A-Za-z][A-Za-z0-9_.-]*`. The `figures/` directory name comes from your project's `suna.json`, so it is not hardcoded — see [project layout](/guide/project).

`figure.svg.suna.json` is a sidecar written by `suna_mpl` at export time. It records the SVG's SHA-256, its size in millimetres, and per-axes anchor pairs mapping data values to SVG coordinates. Nothing in the app reads it yet.

Captions live in `figure.json`, not in your prose. The manuscript's live preview reads them from there and can patch the title or body back without touching any other field. See [the manuscript](/writing/manuscript).

## Opening and creating figures

The Figures view lists one card per figure — thumbnail, id, a `single`/`double` chip and the caption title. Click a card to open it on the canvas; <kbd>⌘</kbd>-click opens it beside the current tab. The card’s tooltip offers <kbd>⌘↵</kbd> for that, but no handler listens for it — see [shortcuts](/reference/shortcuts).

To create one, click **+** in the Figures view header or on the canvas tab toolbar. It is an inline field, not a dialog: type a name and press <kbd>↵</kbd>. SUNA slugifies the name to lowercase ASCII with hyphens (a collision becomes `<base>-2`, `<base>-3`, …), writes `figure.svg` and `figure.json`, registers the figure in `manuscript.json`, and opens it. <kbd>Esc</kbd> cancels.

The new artboard is blank, at your journal profile's double-column width (180 mm if the profile states none), with height = width × 0.618. Its `widthPreset` is `double`, its `namespace` is `main`, its caption title is the name you typed, and its `provenance` is `null`.

The command palette also has **New Figure** under the Figures category. That one auto-names the figure instead of prompting.

An empty artboard shows the hint `Drop or import a plot · ⌘⇧I import SVG/PNG · or draw with the tools` until it has real content.

## The tool rail

Six tools, each bound to a bare letter key — no modifier.

| Tool | Key | Notes |
| --- | --- | --- |
| Select | <kbd>V</kbd> | Click, marquee, move, resize, rotate |
| Rectangle | <kbd>R</kbd> | <kbd>⇧</kbd> constrains to a square |
| Ellipse | <kbd>O</kbd> | <kbd>⇧</kbd> constrains to a circle |
| Line | <kbd>L</kbd> | <kbd>⇧</kbd> constrains to 45° angles |
| Arrow | <kbd>A</kbd> | <kbd>⇧</kbd> constrains to 45° angles |
| Text | <kbd>T</kbd> | Click to place; opens for editing at once |

After you draw a shape the tool returns to Select and the new element lands selected. <kbd>Esc</kbd> cancels a gesture in progress; with no gesture running it returns you to the Select tool; with the Select tool already active it clears the selection.

## Selection

Selection is semantic, which matters when you are editing a matplotlib export. Clicking resolves upward to the nearest ancestor with a meaningful id — anything containing a dot, or matching `ax0`, `suptitle`, `legend` — so you select `ax0.legend` or `ax0` rather than an internal `patch_2`. If no ancestor qualifies, the deepest element with an id is used. Nothing outside the figure SVG is ever selectable.

Click to select, <kbd>⇧</kbd>-click to add or remove, drag on empty canvas for a marquee. Clicking one element of a multi-selection narrows to that element — but the multi-selection is kept if you drag instead, so you can still move the whole group.

A single selection frame appears with eight resize handles and a rotate handle above the top-centre. While resizing, <kbd>⇧</kbd> keeps the scale uniform and <kbd>⌥</kbd> resizes about the centre. Rotation snaps to 15° steps with <kbd>⇧</kbd> held.

Dragging snaps to the artboard's edges and centres and to other visible elements' bounding boxes, within 6 screen pixels, drawing guide lines as it does. When you resize, only the axes the dragged handle actually drives will snap. A <kbd>⇧</kbd> constraint always wins over a snap.

Resizing a lone `<text>` element changes its `font-size` rather than applying a transform matrix, so the glyphs stay real text at a real point size.

## Layers

The Layers panel is a depth-indented tree of the document — tag name plus id, with `—` for anonymous elements. It renders up to 500 rows and then says `…N more elements`.

| Action | Effect |
| --- | --- |
| Click | Select |
| <kbd>⇧</kbd>-click | Add to or remove from the selection |
| Double-click | Rename the element's id (<kbd>↵</kbd> commits, <kbd>Esc</kbd> cancels) |
| ● / ◌ button | Hide or show (`display: none`) |
| Drag a row | Reorder within a parent, or drop onto a `<g>` to reparent |

You cannot drop an element into its own subtree. Renaming rejects a duplicate with `Id "<x>" is already in use` and whitespace with `Ids cannot contain whitespace`.

The Layers and Properties panels start expanded only on windows at least 1200 px wide. Either can be collapsed to a labelled vertical strip with its chevron.

## The properties rail

Five sections are always present, top to bottom, whether or not anything is selected. Below them, a selection adds Geometry, Fill, Stroke, Text (for `<text>` only) and Opacity. With nothing selected the lower half reads `No selection`.

### Align

Six align buttons — left, centre, right, top, middle, bottom — plus **Distribute horizontally** and **Distribute vertically**. Align needs at least two objects (`Select at least 2 objects to align`); distribute needs at least three (`Select at least 3 objects to distribute`). The buttons stay visible but disabled until then.

### Figure

**W mm** and **H mm** set the artboard in real millimetres. **Bg** sets or clears a background colour with the ∅ button.

**Duplicate figure** copies the whole `figures/<id>/` directory — including `source/` — to a new id, rewrites the id inside `figure.json`, registers the copy in `manuscript.json` and reports `Duplicated figure → <newId>`.

**Auto-letter panels (a, b, c)** finds every element whose id matches `ax0`, `ax1`, … (the ids `suna_mpl` gives axes), orders them in reading order — top to bottom, then left to right — and inserts a text letter flush to each panel's left edge just above its top, clamped to stay inside the artboard. It is one undoable batch. The letters carry a `data-suna-panel-letter` marker, so running it again replaces its own previous letters instead of stacking new ones. Case, weight and optional parentheses come from your journal profile, defaulting to lowercase bold with no parentheses, at 9 pt clamped into the profile's font range. With no axes groups it reports `No axes groups found (ids like ax0, ax1, …)`; otherwise `Lettered N panels`.

### Palette

A **Fill** / **Stroke** toggle decides what a swatch applies to, and a **No fill** / **No stroke** chip clears it. The first ramp is your journal profile's suggested palette, labelled Journal; then fixed Gray, Red, Orange, Yellow, Cyan and Olive ramps; then anything you have imported.

**Import palette…** accepts a JSON array of hex strings and stores it per project.

```json
["#0072b2", "#d55e00", "#009e73", "#cc79a7"]
```

A good file reports `Imported palette "<name>" (<n> colors)`. A bad one reports `Import palette: not valid JSON` or `Import palette: expected a JSON array of hex colors`. Clicking a swatch with nothing selected says `Select an object to apply a color`.

### Agent

A free-text box (`Describe the edit…`) that sends your current selection plus a PNG screenshot of it to the AI CLI. Press <kbd>⌘↵</kbd> or click **✦ Send to agent**. The gold selection overlay is deliberately included in the screenshot so the agent can see what "the selection" refers to.

The prompt tells the agent to edit only that `figure.svg`, to preserve every element id, never to regenerate the figure from `source/plot.py`, and to check its work with the compliance verb. It also passes the figure id, the SVG's absolute path, the artboard size in mm, the selected ids, the screenshot path, your journal profile name and the current compliance issues.

When the edit finishes, the canvas reloads `figure.svg` from disk and re-runs compliance. If your tab has unsaved changes it refuses, with `Agent edited figure.svg on disk — save or undo your local edits, then reopen`.

The section is disabled, with the reason as a tooltip, until an AI CLI is detected. See [AI in the app](/ai/in-app).

### Export

Two vector buttons, **SVG** and **PDF**, then a **Journal-spec raster** block:

| Control | Options |
| --- | --- |
| Width | Single column (89 mm) · 1.5 column (120 mm) · Double column (180 mm) |
| Resolution | 300 · 600 · 1200 dpi |
| Transparent background | On or off |

The millimetre figures come from your active journal profile; those are the fallbacks when the profile states none. Resolution defaults to the profile's stated minimum, else 300. A live readout underneath reads `88 × 28.4 mm @ 300 dpi · 1039×335 px`, then **PNG** and **TIFF**.

::: info Width and transparency also govern the PDF
Despite sitting under the "Journal-spec raster" heading, the Width dropdown and the Transparent background checkbox apply to PDF export too: the PDF page is sized to the chosen width in mm, with the height from the SVG's aspect ratio, and prints a white background unless Transparent is checked. Only SVG ignores both — it is a byte-for-byte copy of the source file.
:::

Exports land in the project's `output/figures/` directory as `<figureId>.<format>`. PDF is true vector. PNG and TIFF are rasterised at exactly the pixel size shown. TIFF is baseline uncompressed RGBA, 8 bits per sample, with the chosen dpi written into the file's resolution tags.

Every export saves the figure first, so the file you get always matches what is on the canvas. A failure reports `<FORMAT> export failed: <message>`.

The command palette carries **Export Figure as PNG** and **Export Figure as PDF** as a fast path: they use the profile's first width preset — single column — at the default dpi, always on opaque white. Use the rail for anything else. More in [export](/publishing/export).

## Compliance

A compliance check runs against your active journal profile every time the figure loads and every time it saves. Findings appear as an `N issues` button in the canvas toolbar, red if any is an error, expanding to a list of rule id and message.

| Rule | Severity |
| --- | --- |
| `fig.min-font`, `fig.max-font` | error |
| `fig.line-weight` | error |
| `fig.raster-dpi` | error |
| `fig.artboard-width` | warning |
| `fig.palette` | warning |
| `fig.color-sole-delimiter` | warning |

Messages name the measured value against the journal's rule, for example `Text "…" is 5pt, below the journal's 7pt minimum`. Compliance is advisory: it flags, it never rewrites. If there are error-severity findings, the Export section shows `<n> issues — export anyway?` above the raster buttons, but it does not block the export. See [compliance](/publishing/compliance) and [profiles](/publishing/profiles).

## Rulers, units and the artboard

The artboard is measured in physical millimetres, read from the root SVG's `width` and `height` with unit conversion, so a figure that says 180 mm is 180 mm on paper. The toolbar shows the artboard size — `180.0 × 58.0 mm` — and beside it the selected element's id, or `N selected`.

Rulers run along the top and left, ticked at 1 mm with a labelled major tick every 10 mm, origin at the artboard's top-left, with a live cursor marker. The **Rulers** button in the toolbar toggles them; they start on.

Geometry fields are X, Y, W, H and ∠, with a live `W × H mm` readout beneath. Stroke width and font size are entered in points (1 pt = 0.3528 mm). Font size shows a warning when it falls outside your profile's range: `Profile wants <min>–<max> pt`.

<figure class="shot">
  <img src="/shots/canvas-velocity.webp" alt="A single-column velocity map zoomed to 283 percent on an 88 by 70 mm artboard, with millimetre rulers along the top and left edges and the Figure section of the properties rail reading W mm 88.006 and H mm 70.004." />
  <figcaption>Zoomed to 283%, but the rulers still read millimetres and the Figure section still reports the artboard's real print size.</figcaption>
</figure>

Scroll to pan in both axes; <kbd>⌘</kbd>-scroll (or <kbd>⌃</kbd>-scroll) to zoom, anchored at the pointer, clamped between 0.05× and 12×. The toolbar shows the current zoom as a percentage. On open, the figure is fitted to 86% of the viewport, capped at 4×, and centred.

## Editing text

Double-click a `<text>` element with the Select tool. It becomes editable in place, in an overlay matching its font, size, weight and colour. <kbd>↵</kbd> or <kbd>⌘↵</kbd> commits, <kbd>Esc</kbd> cancels, clicking away commits. It is single-line — <kbd>⇧↵</kbd> is ignored.

Clicking with the Text tool inserts an element reading `Text` and opens it immediately with the placeholder selected. Leave it empty and the insert is undone entirely.

The Text section of the properties rail gives you a Font family field, backed by a list of your profile's preferred families, a Size in points, and a normal/bold Weight.

## Importing SVG and PNG

Drop an `.svg` or `.png` file onto the canvas, or press <kbd>⌘⇧I</kbd> for a file picker. Anything else reports `Unsupported import: <name> (only .svg and .png)`.

An imported SVG is wrapped in a single `<g id="imported-N">` and every id inside it is prefixed `impN-`, with internal `url(#…)` and `href="#…"` references rewritten to match. So an import can never collide with ids already in the figure, and one <kbd>⌘Z</kbd> removes the whole thing. Repeated imports are offset progressively so they do not stack exactly on top of each other. An SVG with no content reports `the SVG has no content to import`.

A PNG is embedded as a data URI, sized from its pixel dimensions read at 300 dpi and converted to the artboard's units. It gets the same `imported-N` id.

## Undo, saving and the command bus

Every canvas mutation goes through one serialisable command bus — `set-attrs`, `set-style`, `set-text`, `translate`, `transform`, `reorder`, `reparent`, `group`, `ungroup`, `insert`, `remove`, `align`, `distribute`, `set-artboard`, `batch`. A mouse drag and an agent edit take the same path, which is why undo works identically for both.

<kbd>⌘Z</kbd> undoes, <kbd>⌘⇧Z</kbd> redoes. <kbd>⌘S</kbd> saves. With `editor.autosave` on (the default) the figure saves after a pause in editing, and the tab title carries a ` •` while unsaved. Autosave is keyed to committed commands, so it never fires in the middle of a drag.

## Canvas shortcuts

| Key | Action |
| --- | --- |
| <kbd>V</kbd> <kbd>R</kbd> <kbd>O</kbd> <kbd>L</kbd> <kbd>A</kbd> <kbd>T</kbd> | Select · Rectangle · Ellipse · Line · Arrow · Text |
| <kbd>Esc</kbd> | Cancel gesture · return to Select · deselect |
| <kbd>⌘S</kbd> | Save |
| <kbd>⌘Z</kbd> / <kbd>⌘⇧Z</kbd> | Undo / redo |
| <kbd>⌘D</kbd> | Duplicate the selection, offset by 8 units |
| <kbd>⌘⇧I</kbd> | Import SVG or PNG |
| <kbd>←↑→↓</kbd> | Nudge 1 unit (<kbd>⇧</kbd> = 10) |
| <kbd>Delete</kbd> / <kbd>Backspace</kbd> | Remove the selection |
| <kbd>⌘]</kbd> / <kbd>⌘[</kbd> | Bring forward / send backward |
| <kbd>⌥⌘]</kbd> / <kbd>⌥⌘[</kbd> | Bring to front / send to back |
| <kbd>⌘G</kbd> / <kbd>⌘⇧G</kbd> | Group / ungroup |
| <kbd>⇧</kbd>-click | Add to the selection |
| Scroll | Pan |
| <kbd>⌘</kbd>-scroll | Zoom |

The full list for the rest of the app is in [shortcuts](/reference/shortcuts).

## What the canvas does not do

::: warning Not built yet
Editing a figure on the canvas does not change its generating Python. The edit is saved into `figure.svg` and nothing else — the `provenance.overlay` array in `figure.json` stays empty, and no code records, replays or absorbs canvas edits back into `source/plot.py`. The design documents describe such a loop; it is not implemented.

There is also no in-app "regenerate" button. Re-running a plot script is something you do in the terminal, and it overwrites `figure.svg` wholesale — any canvas edits you made since the last export are lost, with no warning. If a figure comes from code and you expect to re-run the script, make the change in the script. Keep the canvas for the finishing pass: panel letters, annotations, arrows, alignment.
:::

Nothing in the app reads `figure.svg.suna.json` yet either. `suna_mpl` writes the sidecar and its data-to-SVG coordinate anchors are real, but no consumer exists.

For the code side of the workflow — semantic ids, journal rcParams, byte-reproducible SVG — see [figures from code](/figures/from-code).
