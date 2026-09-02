# Tour of the interface

A region-by-region reference for SUNA's window: what each panel contains, what every control is called, and which key gets you there.

If you have used VS Code the shape will be familiar. Top to bottom the window is a title bar, then a workbench row holding the activity bar, the sidebar and the tab area (with the terminal strip beneath it), then the status bar. The command palette, the keyboard-shortcut overlay and toast messages float on top of all of it.

::: info Key glyphs
SUNA prints macOS glyphs — <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>⌥</kbd> <kbd>⌃</kbd> — in tooltips and in the shortcut overlay on every platform. Matching treats <kbd>⌘</kbd> as Command *or* Control, so a tooltip that reads <kbd>⌘⇧B</kbd> is <kbd>Ctrl+Shift+B</kbd> on Linux.
:::

## Title bar

Three things live in the title bar.

On the left, a panel button ("Toggle left nav bar (⌘⌥B)"). It is always rendered, so it is your way back when you have hidden everything on the left.

In the middle, the wordmark **SUNA**.

On the right, a button showing the open project's name — or **Open project** when none is open. Click it for the project switcher: up to eight entries under **Recent projects**, then a separator, then **Open project…**, **New project…** and **Open example**. Arrow keys move, <kbd>Enter</kbd> activates, <kbd>Esc</kbd> closes. A recent project whose folder has gone is dimmed, badged **Missing**, and carries a **Remove** button.

## Activity bar and sidebar

The activity rail has exactly six views, always in this order.

| View | What it holds |
| --- | --- |
| Explorer | The project's file tree |
| Writing | Every document in the project, plus the manuscript's outline |
| Figures | One card per figure, with thumbnails |
| References | `references.bib` as a browsable library, plus search |
| Source Control | Branch, changes, commit box, history |
| Agent | CLI collaborators, API keys and a chat transcript |

Each icon's tooltip is the view name plus the toggle hint — "Explorer (⌘⇧B to toggle)". Clicking the icon that is already active closes the sidebar; clicking it again reopens it.

The left nav has three states: rail plus panel, rail only, or neither. Both flags persist across launches. With no project open it starts fully collapsed, and your saved preference comes back when a project is adopted.

Drag the sidebar's right edge to resize it ("Drag to resize · double-click to reset"). Double-click resets it to 272 px; the rendered width is clamped between 180 px and 560 px, and dragging narrower than 120 px hides the panel altogether while remembering the width you started from.

With no project open, each view shows its own one-line placeholder — Explorer says "Open a project to browse its files.", References says "Your bibliography (references.bib) will be managed here.", and so on. The Agent view is the only one that still renders its controls.

### Explorer

The file tree, plus two icon buttons in the sidebar header: **New file at project root** and **New folder at project root**.

Keyboard: <kbd>↑</kbd>/<kbd>↓</kbd> move (hold <kbd>⇧</kbd> to extend the selection), <kbd>→</kbd>/<kbd>←</kbd> expand and collapse (<kbd>←</kbd> on a file jumps to its parent folder), <kbd>Home</kbd>/<kbd>End</kbd> go to first and last, <kbd>Enter</kbd> opens a file or expands a folder, <kbd>Esc</kbd> clears the selection, <kbd>F2</kbd> renames, <kbd>⌘A</kbd> selects all, and <kbd>Delete</kbd> opens a confirmation rather than deleting outright. <kbd>⌘⌥R</kbd> reveals the focused row in Finder; <kbd>⌘⌥O</kbd> opens it with the default app.

Mouse: click opens a file or toggles a folder, <kbd>⌥</kbd>-click opens a file in the side split, <kbd>⌘</kbd>-click adds a row to the selection, <kbd>⇧</kbd>-click selects a range, double-click opens the selection. Drag rows onto a folder — or onto the empty area below the tree, which means the project root — to move files.

Right-click gives **New File…**, **New Folder…**, **Rename…**, **Reveal in Finder** (<kbd>⌘⌥R</kbd>; "Show in File Manager" elsewhere), **Open with Default App** (<kbd>⌘⌥O</kbd>) and **Delete**, which arms to "Confirm delete?" before it acts. With several rows selected, Rename and the two OS actions are disabled and Delete reads "Delete 3 items".

::: warning Not built yet
There is no filter box in the Explorer and no project-wide search view. To find a file by name, use the command palette (<kbd>⌘K</kbd>), which matches against the project-relative path.
:::

### Writing

<figure class="shot">
  <img src="/shots/outline.webp" alt="The Writing sidebar listing Manuscript, Supplementary Information, Letters and Peer review, then the manuscript's version chip and a Log version button, author and abstract counts, and an Outline of sections each with a word count, beside the manuscript open in reading mode." />
  <figcaption>The Writing view. Clicking an outline row opens the combined Manuscript tab and scrolls to that section.</figcaption>
</figure>

The paper is not the only document a submission needs, so this view lists them all — **Manuscript**, **Supplementary Information**, **Letters** and **Peer review**, with a count beside the last two — and the **+** at the top adds one. See [cover letters](/documents/letters) and [peer review](/documents/review).

Below the list, the manuscript's own summary: its current logged version with a **Log version** button, the title (with `$…$` math rendered), an author count and an abstract word count, then an **Outline** where each row carries a section chip and a word count, and figure and table counts at the bottom. If `manuscript/manuscript.json` is missing, the view says so instead.

Activating this view — when it was not already the active one, and only with a project open — also opens or focuses the combined **Manuscript** tab in the dock. See [the manuscript](/writing/manuscript).

### Figures

A **Figures** header with a **New figure** button, then one card per figure: an SVG thumbnail (or "no preview"), the figure id, a width-preset chip and the caption title. Click a card to open its canvas; <kbd>⌘</kbd>-click to open it in the side split.

With no figures, the view reads: "No figures found. Each figure lives in figures/&lt;id&gt;/ with a figure.svg canvas."

::: tip
The card tooltip says "⌘↵ to open beside". That is wrong — the handler listens for <kbd>⌘</kbd>-click.
:::

### References

<figure class="shot">
  <img src="/shots/references.webp" alt="The References sidebar with Library and Search tabs, a filter box, All/Cited/Uncited chips, reference rows offering Find PDF and Attach PDF, and a Rendered as preview showing journal profile chips with in-text and reference-list samples." />
  <figcaption>The References view. Selecting an entry opens the "Rendered as" preview, so you can see a citation in a journal's style before you commit to that profile.</figcaption>
</figure>

Two tabs: **Library** and **Search**. Library has a filter box ("Filter N references…", N being how many are in the file), **All** / **Cited** / **Uncited** buttons with counts, a warning row naming any citation key with no bib entry, and a `[@]` copy button on each row.

A row shows a **PDF** badge once a PDF is resolved. Only when none is resolved does it offer **Find PDF** and **Attach PDF…** instead — you see one state or the other, never both.

Select a reference and you get a **Rendered as** preview: a **Find similar** button (which switches to the Search tab seeded from that entry), a row of publisher-profile buttons, an **In text** sample and a **Reference list** sample. The pickers offer `suna`, `science`, `nature`, `neuron`, `pnas`, `brain-stimulation`, `sleep`, `sleep-advances`, `jne` and `jneurosci`.

An empty bibliography reads: "references.bib has no entries yet. Use the Search tab to find and add one." More in [references](/writing/references).

### Source Control

<figure class="shot">
  <img src="/shots/source-control.webp" alt="The Source Control sidebar showing the current branch, a Changes list with modified files, a commit message box with a Commit all button, and a History list of recent commits." />
  <figcaption>Source Control. Click a changed file to expand its colour-coded diff in place.</figcaption>
</figure>

The branch name at the top ("detached HEAD" when there is none), a **Changes · N** list, a **Commit message** box with a **Commit all** button, and a **History** list of the last 20 commits. Clicking a changed file expands its colour-coded diff. **Commit all** stays disabled until there is both a message and a change. With no repository, the view offers an **Initialize repository** button.

### Agent

<figure class="shot">
  <img src="/shots/agent.webp" alt="The Agent sidebar with a CLI collaborators section offering Open Claude Code here and Open Codex CLI here, an API providers section with a provider select and key field, and a chat transcript with a composer below." />
  <figcaption>The Agent view. The CLI buttons write the project's MCP config, then launch the CLI in a terminal at the project folder.</figcaption>
</figure>

A **CLI collaborators** section with **Open Claude Code here** and **Open Codex CLI here** (they refuse with a note when no project is open), an **API providers** section with a provider select, a key-status dot, a password field and **Save**, then a chat transcript and a composer where <kbd>⌘⏎</kbd> sends. See [AI overview](/ai/overview) and [MCP](/ai/mcp).

## Tabs, splits and the dock

The centre is a tab area. A tab's identity is the file path and its title is the file's base name, so the same file never opens twice. What kind of tab you get depends on the extension.

| Extension | Opens as |
| --- | --- |
| `.svg` | The figure canvas |
| `.csv`, `.tsv` | The data grid |
| `.ipynb` | The notebook, with a Jupyter kernel |
| `.pdf` | The PDF viewer |
| `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` | The image viewer |
| anything else | The text editor |

<figure class="shot">
  <img src="/shots/manuscript-reading.webp" alt="A manuscript section in Reading mode: a typeset title page, body prose with superscript citation numbers, and a centred KaTeX display equation." />
  <figcaption>A markdown file in Reading mode. <kbd>⌘E</kbd> flips between Reading and Source.</figcaption>
</figure>

Non-file tabs are **Welcome**, **Settings**, **Manuscript**, **Export**, the onboarding wizard (**New project** or **Set up project**) and **Import &lt;file&gt;.docx**. Settings, Export, Import and onboarding tabs survive a project switch; editor, canvas, data, PDF, image and Manuscript tabs close with the project they belonged to.

Rename or move a file on disk and its open tabs follow it to the new path, keeping their group and position. Unsaved edits do not come along.

**Splitting.** <kbd>⌘&#92;</kbd> is Split Right and <kbd>⌘⇧&#92;</kbd> is Split Down. Both are available only when the active tab is a file tab — Welcome, Settings, Export and the combined Manuscript tab do not qualify. The split reuses one secondary group rather than splitting endlessly, so the layout stays two-up.

Opening a reference PDF or an image in that side group replaces whatever PDF or image is already there instead of stacking viewers. An editor parked in the side group is left alone.

<figure class="shot">
  <img src="/shots/data-grid.webp" alt="A CSV file open in the data grid: a toolbar with a row and column count and a Text/Grid toggle, a numbered row gutter, and right-aligned numeric columns." />
  <figcaption>The data grid. It is read-only; the Text/Grid button switches to the raw file when you need to edit.</figcaption>
</figure>

The data-grid toolbar shows a count ("1,234 rows · 8 columns") and a single toggle reading **Text** or **Grid**. It renders at most 5,000 rows and tells you when it has truncated: "Showing first 5,000 of N rows."

A `.ipynb` opens as a notebook against a real Jupyter kernel, and any script runs into the terminal with <kbd>⌃⏎</kbd> — see [notebooks and code](/writing/notebooks).

The PDF viewer toolbar has the filename, a page-jump box with "of N", zoom out (<kbd>⌘-</kbd>), a percentage button that resets to actual size (<kbd>⌘0</kbd>), zoom in (<kbd>⌘+</kbd>) and a **Fit width** toggle. The image viewer has the filename, the pixel dimensions, the same zoom trio and a **Fit** toggle, and you can drag the image to pan. The <kbd>⌘</kbd> zoom keys work only while the viewer pane has focus.

### The figure canvas

<figure class="shot">
  <img src="/shots/canvas.webp" alt="The figure canvas: a vertical tool rail on the left, a Layers tree, a millimetre artboard with rulers in the centre, and a Properties rail on the right holding Align, Figure, Palette, Agent and Export sections." />
  <figcaption>A figure canvas tab. The artboard is measured in millimetres, so a figure is sized to the journal column from the start.</figcaption>
</figure>

The tool rail on the left holds Select (<kbd>V</kbd>), Rectangle (<kbd>R</kbd>), Ellipse (<kbd>O</kbd>), Line (<kbd>L</kbd>), Arrow (<kbd>A</kbd>) and Text (<kbd>T</kbd>), each tooltipped "Label (Key)". Beside it the **Layers** tree shows the element hierarchy; on the right the **Properties** rail carries **Align**, **Figure**, **Palette**, **Agent** and **Export** sections, plus Geometry, Fill, Stroke, Text and Opacity fields for whatever is selected ("No selection" when nothing is). Both side panels collapse with their chevrons. Full detail in [the canvas](/figures/canvas).

## The comments rail

<figure class="shot">
  <img src="/shots/comments.webp" alt="Manuscript prose with highlighted anchored passages beside a comments rail; one thread shows the quoted text, a comment, a reply, and a row of Reply, AI, Resolve and Delete buttons." />
  <figcaption>The comments rail. Each thread quotes the exact text it is anchored to, so you can tell when a comment has come loose from its sentence.</figcaption>
</figure>

Select text in a manuscript section and press <kbd>⌘⇧M</kbd> to start a comment; the draft card shows "On: “…”" and an "Add a comment…" box. <kbd>⌘⌥M</kbd> toggles the rail, and the editor toolbar has a matching button showing the open-comment count.

The rail is headed **Comments** with that count and a × ("Hide comments"), and can be resized by dragging its left grip. A thread shows the author, a relative time, the quoted target and any replies, then its actions: **Reply** (the reply box takes <kbd>⌘⏎</kbd> to submit), **✦ AI** — only on manuscript-section comments, and only when the AI gate allows it — **Resolve**, and **Delete**.

Resolving moves a thread out of the working surface into a separate history group at the bottom, where **Reopen** puts it back in play. Threads whose anchor text can no longer be found collect under **Detached / unanchored (N)**. See [comments](/writing/comments).

## The status bar

The left group carries, in order: **SUNA** and the version you are running, the active journal profile name, a Python environment chip (only with a project open), the current vim mode (only when an editor has vim motions on), and a transient status note.

The Python chip is titled "Python environment for new terminals". Click it to re-scan and open a **Python environment** popover listing what was detected by kind and name — `uv`, `venv` and `conda` — plus a **none** row, footed with "Applies to newly opened terminals." With nothing selected the chip reads **no env**; with nothing found the popover says "No environments found (uv, .venv, conda)." The choice is remembered per project folder.

The right group has four items: **?** ("Keyboard shortcuts (?)"), **Terminal** ("Toggle terminal (⌃`)"), **Settings**, and the Electron and Chrome version numbers.

## The terminal

<kbd>⌃&#96;</kbd> toggles the terminal strip from anywhere, including from inside a terminal — xterm is told to pass that key through. The bar reads **Terminal** and holds one tab per shell (each with a × to close), a **+** button ("New terminal") and a **–** button ("Hide terminal (⌃`)"). Drag the strip's top edge to resize it.

Terminals start in the project folder, or in your home directory when no project is open, and are handed the Python environment selected in the status bar. Scrollback is 5,000 lines and survives panel toggles and tab switches.

A tab shows "· exited" or "· failed" beside its name when the shell ends or cannot start; an exited shell also prints `[process exited · code N] — close the tab or open a new one` into the buffer. Opening an empty panel spawns the first shell, and closing the last tab closes the strip.

## The command palette

<figure class="shot">
  <img src="/shots/command-palette.webp" alt="The command palette open over the app in command mode, listing commands such as Split Right and Toggle Sidebar with their keyboard shortcuts and category labels." />
  <figcaption>The palette in command mode. Rows show the shortcut where a command has one — most do not.</figcaption>
</figure>

<kbd>⌘K</kbd> opens the palette in file search; <kbd>⌘⇧P</kbd> opens it straight into commands. The placeholder spells out the whole thing: "Search files… (> commands, $ terminal, ? ask)". The first character you type picks the mode.

| Prefix | Mode | What Enter does |
| --- | --- | --- |
| *(none)* | Files | Opens the file. Matches the project-relative path, capped at 50 results |
| `>` | Commands | Runs the command |
| `$` | Terminal | Opens a **new** terminal tab running that line — never an existing shell |
| `?` | Ask | Asks the agent CLI, in place |

<kbd>↑</kbd>/<kbd>↓</kbd> move the selection, <kbd>Enter</kbd> activates, <kbd>⌘Enter</kbd> (or <kbd>⌘</kbd>-click) opens a file row in the side split, <kbd>Esc</kbd> or a click on the backdrop closes.

In Ask mode the palette shows "Press Enter to ask the agent CLI: …", then a status line with **Cancel** while it runs and the answer with **Dismiss** when it finishes. A successful answer is also pushed into the Agent view's transcript. Ask does nothing with no project open.

An empty input shows **Recent** — the last 20 files, commands, terminal lines and AI prompts for this project ("No recent activity yet." when there are none). Recents are stored per project root, so the list is empty until you open one. Clicking a recent AI prompt only refills the input with `?<prompt>`; press <kbd>Enter</kbd> to re-run it.

The registered commands, by category, are: Split Right (<kbd>⌘&#92;</kbd>), Split Down (<kbd>⌘⇧&#92;</kbd>), Toggle Sidebar (<kbd>⌘⇧B</kbd>), Toggle Left Nav Bar (<kbd>⌘⌥B</kbd>), New Figure, Toggle Terminal, Focus Terminal, Open Settings, Run Compliance Check, Export Figure as PNG, Export Figure as PDF, Open Full Manuscript, Export Manuscript (Word/PDF)…, Keyboard Shortcuts…, and Switch 'Rendered As' Profile. Only the first four carry a chord of their own.

Command chords are dispatched only while the palette is closed, and any key an editor has already handled is skipped — so a focused editor's own keymap always wins the key first.

## The keyboard shortcut overlay

Press <kbd>?</kbd> anywhere you are not typing. The overlay ignores the key inside a text field or an editor, and while <kbd>⌘</kbd>, <kbd>⌃</kbd> or <kbd>⌥</kbd> is held. You can also reach it from the **?** button in the status bar, from **Keyboard Shortcuts…** in the palette, or with `:help` (or `:h`) inside a vim buffer — which is the only route from a vim NORMAL-mode buffer, where a bare `?` is vim's own search-backward.

It has six tabs — **Global**, **Editor**, **Manuscript**, **Canvas**, **Explorer**, **Viewers** — and opens on the tab matching the surface you were in. Explorer focus wins; canvas, manuscript and editor map to their own tabs; PDF, image and data views map to Viewers; anything else opens on Global. <kbd>Esc</kbd> or a backdrop click closes it and returns focus to whatever opened it. The footer legend reads "⌘ = Cmd · ⌃ = Ctrl · ⌥ = Option · ⇧ = Shift".

The full list is also on [shortcuts](/reference/shortcuts).

## Toasts

Transient messages appear bottom-centre and dismiss themselves after eight seconds. One may carry a single action button — **Undo** after a delete, for instance — alongside a × to dismiss it now.

---

Next: [the daily workflow](/guide/workflow), or [settings](/guide/settings) for the two-level Global and per-project preferences.
