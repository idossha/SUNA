# Keyboard shortcuts

Every binding SUNA implements, grouped the way the in-app help overlay groups them: Global, Editor, Manuscript, Canvas, Explorer, Viewers.

Press <kbd>?</kbd> anywhere you are not typing to open the overlay. It ignores the key inside a text input, a textarea, a select or any editable surface (CodeMirror included), and while <kbd>⌘</kbd>, <kbd>⌃</kbd> or <kbd>⌥</kbd> is held, so typing a question mark into the References filter never opens a dialog. The overlay is also reachable from the **?** button at the right of the status bar, from the palette command **Keyboard Shortcuts…**, and from `:help` inside a vim buffer.

The overlay opens on the tab that matches the surface you were in — keyboard focus in the Explorer tree wins, otherwise the active tab decides (canvas, manuscript and editor tabs map to their own sections; PDF, image and CSV tabs map to Viewers; everything else opens on Global). <kbd>Esc</kbd> or a backdrop click closes it and returns focus to whatever opened it.

<figure class="shot">
  <img src="/shots/shortcuts.webp" alt="The keyboard-shortcuts overlay open over the app, showing a row of tabs — Global, Editor, Manuscript, Canvas, Explorer, Viewers — above grouped tables of key chords and their descriptions." />
  <figcaption>The overlay's six tabs. The footer legend spells out the glyphs: ⌘ = Cmd · ⌃ = Ctrl · ⌥ = Option · ⇧ = Shift.</figcaption>
</figure>

::: info Glyphs on every platform
SUNA prints macOS glyphs in tooltips and in the overlay whatever machine you are on. Matching treats <kbd>⌘</kbd> as Command *or* Control, so a row that reads <kbd>⌘⇧B</kbd> is <kbd>Ctrl+Shift+B</kbd> on Linux.
:::

## Global

| Keys | Action |
| --- | --- |
| <kbd>⌘K</kbd> | Palette — files |
| <kbd>⌘⇧P</kbd> | Palette — commands |
| `>` · `$` · `?` | Palette prefixes: `>` commands, `$` terminal, `?` ask agent |
| <kbd>⌘&#92;</kbd> | Split right |
| <kbd>⌘⇧&#92;</kbd> | Split down |
| <kbd>⌘⇧B</kbd> | Toggle sidebar |
| <kbd>⌘⌥B</kbd> | Toggle left nav bar |
| <kbd>⌃&#96;</kbd> | Toggle terminal |
| <kbd>?</kbd> | This help (`:help` inside a vim buffer, where vim owns `?`) |
| <kbd>Esc</kbd> | Close overlays |
| Title bar | Project switcher |

The two split commands are enabled only when the active tab is a file tab. Welcome, Settings, Export and the combined Manuscript tab have no file path behind them, so nothing happens there. Splitting reuses one secondary group rather than splitting again and again.

Global chords are dispatched by a window listener that is armed only while the command palette is closed, and it skips any keystroke a focused surface has already handled. A focused editor's own keymap therefore wins the key first — that is why <kbd>⌘K</kbd> makes a link when you have a selection in the editor and opens the palette when you do not.

## Editor

See [the editor](/writing/editor) for what each of these does to your prose. Formatting shortcuts apply to `.md` and `.markdown` files only.

### Editing

| Keys | Action |
| --- | --- |
| <kbd>⌘S</kbd> | Save |
| <kbd>⌘Z</kbd> / <kbd>⌘⇧Z</kbd> | Undo / redo |
| <kbd>⌘E</kbd> | Source ⇄ reading view |
| <kbd>⌘F</kbd> | Search |
| Right-click | Menu: format · link · citation · figure · comment |

### Formatting

| Keys | Action |
| --- | --- |
| <kbd>⌘B</kbd> / <kbd>⌘I</kbd> | Bold / italic |
| <kbd>⌘⇧C</kbd> | Code |
| <kbd>⌘⇧X</kbd> | Strikethrough |
| <kbd>⌘K</kbd> | Link (selection only; otherwise the palette) |

### Citations, figures and comments

| Keys | Action |
| --- | --- |
| <kbd>⌘⇧K</kbd> | Insert citation |
| <kbd>⌘⇧F</kbd> | Insert figure (<kbd>↵</kbd> places it, <kbd>⇧↵</kbd> references it) |
| <kbd>⌘⇧M</kbd> | Comment on selection |
| <kbd>⌘⌥M</kbd> | Toggle comments rail |
| ✦ AI | On a comment card: send the comment to the agent |

The comment gutter, the rail, <kbd>⌘⇧M</kbd> and the right-click **Comment** item appear only for Markdown files inside the project's `manuscript/` folder. See [comments](/writing/comments).

## Manuscript

The combined Manuscript tab carries every editor binding above, plus these.

| Keys | Action |
| --- | --- |
| Click outline | Scroll to the section |
| Click title / abstract / authors | Edit in place — <kbd>Esc</kbd> cancels, <kbd>⌘⏎</kbd> commits |
| Gear | Appearance for the whole document |

::: warning Vim scrolling in the Manuscript tab
<kbd>⌃d</kbd>, <kbd>⌃u</kbd>, <kbd>⌃f</kbd>, <kbd>⌃b</kbd> and `zz` / `zt` / `zb` do nothing in the combined Manuscript tab, because the outer page scrolls rather than the editor. Cursor motions such as `G`, `gg` and `}` still move and still scroll.
:::

## Canvas

The bindings below are the ones the overlay lists for [the figure canvas](/figures/canvas). The tool keys are also in each tool's rail tooltip, written as "Label (Key)".

### Tools

| Keys | Action |
| --- | --- |
| <kbd>V</kbd> / <kbd>R</kbd> / <kbd>O</kbd> / <kbd>L</kbd> / <kbd>A</kbd> / <kbd>T</kbd> | Select / rectangle / ellipse / line / arrow / text |
| <kbd>Esc</kbd> | Cancel / deselect |

### Editing

| Keys | Action |
| --- | --- |
| <kbd>⌘S</kbd> | Save |
| <kbd>⌘Z</kbd> / <kbd>⌘⇧Z</kbd> | Undo / redo |
| <kbd>⌘D</kbd> | Duplicate |
| <kbd>⌘⇧I</kbd> | Import SVG/PNG |
| Arrows | Nudge (<kbd>⇧</kbd> = ×10) |
| <kbd>Delete</kbd> | Remove selection |
| <kbd>⌘[</kbd> / <kbd>⌘]</kbd> | Back / forward (<kbd>⌥</kbd> = to end) |
| <kbd>⌘G</kbd> / <kbd>⌘⇧G</kbd> | Group / ungroup |
| <kbd>⇧-click</kbd> | Add to selection |

### Navigation

| Keys | Action |
| --- | --- |
| Scroll | Pan |
| <kbd>⌘</kbd>-scroll | Zoom |

### Agent

| Keys | Action |
| --- | --- |
| Agent section | Right rail: send the selection and a prompt to the agent |

## Explorer

### Navigate

| Keys | Action |
| --- | --- |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Move (<kbd>⇧</kbd> extends) |
| <kbd>→</kbd> / <kbd>←</kbd> | Expand / collapse |
| <kbd>Home</kbd> / <kbd>End</kbd> | First / last row |
| <kbd>Enter</kbd> | Open |
| <kbd>Esc</kbd> | Clear selection |

<kbd>←</kbd> on a file jumps to its parent folder; <kbd>Enter</kbd> on a folder expands it.

### Manage

| Keys | Action |
| --- | --- |
| <kbd>F2</kbd> | Rename |
| <kbd>⌘A</kbd> | Select all |
| <kbd>Delete</kbd> | Delete (two-step confirm) |
| <kbd>⌘⌥R</kbd> | Reveal in Finder / file manager (focused row) |
| <kbd>⌘⌥O</kbd> | Open with the default app (focused row) |
| Right-click | Context menu |

<kbd>⌘⌥R</kbd> and <kbd>⌘⌥O</kbd> act on the focused row only, never on a multi-selection. In the context menu the reveal item follows the platform: **Reveal in Finder** on macOS, **Show in File Manager** elsewhere.

### Mouse

| Keys | Action |
| --- | --- |
| <kbd>⌘</kbd>-click | Toggle row |
| <kbd>⇧</kbd>-click | Select range |
| <kbd>⌥</kbd>-click | Open beside |

A plain click opens a file or toggles a folder, a double-click opens the selection, and rows can be dragged onto a folder — or onto the empty area below the tree, which means the project root — to move files.

## Viewers

### PDF and images

| Keys | Action |
| --- | --- |
| <kbd>⌘+</kbd> / <kbd>⌘−</kbd> / <kbd>⌘0</kbd> | Zoom in / out / reset |
| Fit width | Fit the page width |
| Page box | PDF: jump to a page |

The <kbd>⌘</kbd> zoom keys work only while the viewer pane itself has focus. Click into the page first.

### Data and figures

| Keys | Action |
| --- | --- |
| Text / Grid | CSV: toggle raw text and grid |
| <kbd>⌘</kbd>-click | Figures view: open beside |

::: warning A tooltip that lies
A figure card's tooltip in the Figures sidebar says "⌘↵ to open beside". There is no <kbd>⌘↵</kbd> handler there. <kbd>⌘</kbd>-click is the gesture that works.
:::

### References

| Keys | Action |
| --- | --- |
| Click row | Open its PDF beside |
| Attach PDF… | Link a PDF to a reference |

Opening a reference PDF in the side group replaces any PDF or image already parked there rather than stacking viewer tabs. An editor in that group is left alone. See [references](/writing/references).

## The command palette

<kbd>⌘K</kbd> opens the palette in file search; <kbd>⌘⇧P</kbd> opens it straight in command mode. The first character of the line chooses the mode.

| Prefix | Mode | What Enter does |
| --- | --- | --- |
| *(none)* | Files | Opens the matched file. Matching runs over the project-relative path; results cap at 50 |
| `>` | Commands | Runs the app command |
| `$` | Terminal | Opens a **new** terminal tab running that line — it never reuses an existing shell |
| `?` | Ask | Asks the agent CLI. Does nothing with no project open; a successful answer also lands in the Agent view's transcript |

One space after the marker is stripped, so `> split` and `>split` are the same. Inside the palette, <kbd>↑</kbd> / <kbd>↓</kbd> move, <kbd>Enter</kbd> activates, <kbd>⌘⏎</kbd> (or <kbd>⌘</kbd>-click) opens a file row in the side split, and <kbd>Esc</kbd> or a backdrop click closes.

An empty input shows **Recent** — the last 20 files, commands, terminal lines and AI prompts for that project. Recents are stored per project root, so with no project open the list is empty. Clicking a recent AI prompt refills the input with `?<prompt>` rather than re-running it; press <kbd>Enter</kbd> to submit.

<figure class="shot">
  <img src="/shots/command-palette.webp" alt="The command palette open over the SUNA window, its input showing a > prefix and a list of app commands below it, each row carrying a category and, for some, a key chord on the right." />
  <figcaption>Command mode. The placeholder — "Search files… (&gt; commands, $ terminal, ? ask)" — is the reminder of all four modes.</figcaption>
</figure>

### Commands

These are the commands `>` mode offers, with the four that carry a chord of their own.

| Command | Category | Keys |
| --- | --- | --- |
| Split Right | View | <kbd>⌘&#92;</kbd> |
| Split Down | View | <kbd>⌘⇧&#92;</kbd> |
| Toggle Sidebar | View | <kbd>⌘⇧B</kbd> |
| Toggle Left Nav Bar | View | <kbd>⌘⌥B</kbd> |
| Toggle Terminal | View | <kbd>⌃&#96;</kbd> |
| Focus Terminal | View | |
| New Figure | Figures | |
| Export Figure as PNG | Figures | |
| Export Figure as PDF | Figures | |
| Open Settings | App | |
| Keyboard Shortcuts… | View | |
| Switch "Rendered As" Profile | App | |
| Open Full Manuscript | Manuscript | |
| Run Compliance Check | Figures | |
| Export Manuscript (Word/PDF)… | Manuscript | |

<kbd>⌃&#96;</kbd> belongs to the terminal strip's own listener rather than to the command, which is why it works from anywhere including inside a terminal. **Keyboard Shortcuts…** has no chord — use <kbd>?</kbd>.

## Vim ex commands

Vim motions are off by default. Turn them on with the **Vim motions** checkbox in the editor's gear popover, or in [Settings](/guide/settings). When vim is on, the current mode shows in the status bar.

| Command | Action |
| --- | --- |
| `:w` | Write — save the file |
| `:q` | Close the tab |
| `:q!` | Close it, discarding unsaved changes |
| `:wq` | Write, then close — refuses to close if the write did not land |
| `:x` | Same as `:wq` |
| `:help` / `:h` | Open the shortcut overlay |
| `:caption` / `:cap` | Focus the caption title of the embed at or above the cursor |
| `:title` | Same target as `:caption` |
| `:note` | Focus a table's **Note.** body, or a figure's caption body |

`:q` on a buffer with unsaved changes refuses, reporting `No write since last change — :w to save, or :q! to discard`. In the combined Manuscript tab it reports `:q — this tab is not a file, so there is nothing to close`. These messages appear in SUNA's own status bar beside the vim mode chip, not in a vim command line.

The caption commands need a `![[fig:…]]` or `![[tbl:…]]` embed at or above the cursor. With none, `:caption` reports `:caption — no ![[fig:…]] or ![[tbl:…]] embed at or above the cursor`. Once a caption is focused, <kbd>Enter</kbd> commits and returns you to normal mode; <kbd>Esc</kbd> reverts.

::: info `?` does not open help in a vim buffer
In normal mode vim consumes <kbd>?</kbd> entirely as search-backward, so the overlay never sees it. Use `:help`, or the **?** button in the status bar.
:::

`j` and `k` (and `+`, `-`, `_`) move by document line even where a rendered widget — an image, a figure, a display equation — covers the line, so every line stays reachable and its source can be revealed for editing. `gj`, <kbd>⌃f</kbd> and <kbd>⌃b</kbd> keep their display-line behaviour.

## Related

- [Tour of the interface](/guide/tour) — what each region of the window is called
- [The editor](/writing/editor) — what the formatting and insertion shortcuts produce
- [The figure canvas](/figures/canvas) — drawing and editing figures
