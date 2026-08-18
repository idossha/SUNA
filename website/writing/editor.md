# The editor

How the writing surface works: the two view modes, the formatting and insertion commands, vim motions, and what SUNA does when a file changes underneath you.

Your prose is a Markdown file on disk. The editor is one CodeMirror surface over it, with two ways of looking at the same text.

## Source and Reading

Press <kbd>⌘E</kbd> to switch between them. The toolbar button shows the mode you are currently in — `Source` or `Reading` — and toggles it too.

**Source** is the plain Markdown: every `**`, every `$$`, every `![[fig:id]]` exactly as it sits in the file.

**Reading** is a live preview that stays fully editable. It renders inline and display math through KaTeX, figures from `figures/<id>/figure.svg`, Markdown images, GFM tables, citation and cross-reference chips, bullet glyphs, heading sizes and blockquote bars, and it hides `#` prefixes, the `**` / `*` / `~~` / backtick delimiters, and a link's brackets and URL.

Reading mode is the shipped default for Markdown. The mode setting applies only to `.md` and `.markdown` files — every other file type is source-only and shows no mode button at all.

<figure class="shot">
  <img src="/shots/manuscript-reading.webp" alt="The manuscript open in Reading mode: a typeset title page with authors and abstract, body prose with superscript citation numbers, and a centred KaTeX display equation with its number in the right margin." />
  <figcaption>Reading mode over manuscript.md. The citation superscripts and the equation number are derived at render time — nothing in the source file carries a number.</figcaption>
</figure>

### Cursor reveal keeps it editable

Reading mode is not a preview pane you have to leave to make a change. Wherever the cursor or the selection touches, the raw source comes back: put the caret in a bold run and both `**` markers reappear; put it on a figure and you see `![[fig:overview]]` again. Move away and it renders once more.

Two things are deliberately left literal: ordered-list numbers (so you can renumber them yourself) and autolinks written as `<url>`.

A figure rendered in Reading mode repaints as soon as its SVG is saved, so editing it on [the canvas](/figures/canvas) updates the prose view without reopening anything.

### Chips only resolve in the Manuscript tab

Citation and cross-reference chips need the whole document to know what number they are. That resolution happens in the combined Manuscript tab, where a chip reads `Fig. 1` or `(Gunn & Gott 1972)` in the active journal's style. In a plain editor tab opened on the same `.md`, Reading mode shows the raw forms instead — `[key1; key2]`, `kind:id`, `(eq:stripping)`. See [the manuscript](/writing/manuscript) for what the combined tab adds.

## Formatting commands

These work on `.md` and `.markdown` files only.

| Key | Does |
| --- | --- |
| <kbd>⌘B</kbd> | Bold |
| <kbd>⌘I</kbd> | Italic |
| <kbd>⌘⇧C</kbd> | Inline code |
| <kbd>⌘⇧X</kbd> | Strikethrough |
| <kbd>⌘K</kbd> | Link |

The first four toggle. Applied to text already wrapped in that marker they remove it; with no selection they act on the word under the cursor; and a multi-line selection is split per line, so a marker never spans a newline.

<kbd>⌘K</kbd> with a selection wraps it as `[selection](url)` and leaves the `url` placeholder selected to type over. With **no** selection <kbd>⌘K</kbd> does nothing in the editor and the command palette opens instead — use the right-click **Link…** item, which inserts `[](url)` with no selection.

## Inserting citations and figures

Markdown files have no as-you-type autocompletion — the pickers are the insertion path. (Autocomplete exists only in `.bib` files, where typing `@` suggests entry types.)

<kbd>⌘⇧K</kbd> opens the **citation picker** next to the cursor with a `Search references…` field. It lists the entries from the bibliography named in `manuscript.json`, filters as you type, and inserts `[@key]` on Enter or click. <kbd>↑</kbd>/<kbd>↓</kbd> move, <kbd>Esc</kbd> closes. More on the library in [references](/writing/references).

<kbd>⌘⇧F</kbd> opens the **figure picker** with a `Search figures…` field and thumbnails, and offers two insertions:

| Key | Inserts |
| --- | --- |
| <kbd>↵</kbd> (or click) | `![[fig:id]]` as a placed figure on its own blank-line-separated line |
| <kbd>⇧↵</kbd> (or ⇧-click) | `@fig:id`, the in-prose reference |

Placing a figure adds only the blank lines the position actually needs and leaves the cursor on the blank line *below* the embed, so the next thing you type cannot turn the embed back into ordinary text. Inserting `@fig:id` mid-sentence prepends a space when the character to its left would otherwise swallow the token.

The picker also lists figures it finds on disk that `manuscript.json` does not know about, marked `not in manuscript.json — no caption or number`.

::: warning Not built yet
There is no insert-cross-reference command. <kbd>⇧↵</kbd> in the figure picker is the only cross-reference UI and it only emits `@fig:`. Write `@tbl:`, `@eq:` and `@sec:` references by hand — the syntax is in [SciMark](/writing/scimark).
:::

## The right-click menu

Right-clicking in a Markdown editor gives you:

**Comment** (⌘⇧M) · **Bold** (⌘B) · **Italic** (⌘I) · **Code** (⌘⇧C) · **Strikethrough** (⌘⇧X) · **Link…** (⌘K) · **Insert citation…** (⌘⇧K) · **Insert figure…** (⌘⇧F) · **Open reference PDF** · **Cut** · **Copy** · **Paste**

Comment, the four formatting items, Cut and Copy need a selection. Link, the two Insert items and Paste do not.

**Open reference PDF** appears only when you right-click directly on a citation, and opens the linked PDF in a split. When nothing is linked the item reads `No PDF found for @<key>` and is disabled. Off a citation it is not shown.

<kbd>⌘⌥M</kbd> toggles the comments rail beside the prose. The comment UI — gutter, rail, <kbd>⌘⇧M</kbd>, the right-click item — appears only for Markdown files opened from inside the project's `manuscript/` folder. See [comments](/writing/comments).

## Vim motions

Vim is off by default. Turn it on with the **Vim motions** checkbox in the editor's gear popover (the same popover carries content width, font size, line height, font and theme — see [settings](/guide/settings)). If your project overrides the setting, the checkbox is disabled and says so. Toggling vim never loses document state, scroll position or comment anchors.

While vim is on, the current mode — normal, insert, visual line, visual block — shows in the status bar. Nothing shows when vim is off.

`j` and `k` (and `+`, `-`, `_`) move by **document** line even where a rendered widget covers the line, so every line stays reachable and its source can be revealed. `gj`, `Ctrl-f` and `Ctrl-b` keep their display-line behaviour.

SUNA implements these ex commands:

| Command | Does |
| --- | --- |
| `:w` | Write |
| `:q` / `:q!` | Close / close discarding changes |
| `:wq` / `:x` | Write, then close — refusing to close if the write did not land |
| `:help` / `:h` | Open the keyboard-shortcut overlay |
| `:caption` / `:cap`, `:title` | Focus the rendered caption title of the embed at or above the cursor, for in-place editing |
| `:note` | Focus a table's Note body, or a figure's caption body |

`:q` on a buffer with unsaved changes refuses: `No write since last change — :w to save, or :q! to discard`. On the combined Manuscript tab, which is not a single file, it reports `:q — this tab is not a file, so there is nothing to close`. These messages appear in SUNA's own status bar beside the vim mode chip, not in a vim command line.

For the caption commands, <kbd>↵</kbd> commits and returns to normal mode, <kbd>Esc</kbd> reverts. With no `![[fig:…]]` or `![[tbl:…]]` embed at or above the cursor, `:caption` says so in the status bar.

::: info
In a vim buffer, `?` is vim's search-backward and does not open the shortcut overlay. Use `:help`, or the `?` button in the status bar. The caption commands are not listed in that overlay yet.
:::

::: warning Known limitation
In the combined Manuscript tab, `Ctrl-d` / `Ctrl-u` / `Ctrl-f` / `Ctrl-b` and `zz` / `zt` / `zb` do nothing, because the outer page scrolls rather than the editor. Cursor motions like `G`, `gg` and `}` still scroll.
:::

## Saving

Autosave is on by default and fires one second after you stop editing — one save per pause, not one per keystroke. <kbd>⌘S</kbd> saves immediately and always works; turn autosave off in Settings if you would rather save by hand.

An unsaved buffer marks its tab title with a `•`. A successful autosave is silent (the dot clearing is the feedback); an explicit <kbd>⌘S</kbd> notes `Saved <file>` in the status bar, and a failure always speaks up.

Saving writes the text file itself. There is no separate project database, no lock file, and nothing to compile.

::: info Line endings
CodeMirror works in LF internally, so the first save of a CRLF file writes LF. That is a one-time, visible normalisation of the whole file.
:::

## One buffer per file

Every surface showing the same file — a plain editor tab, the combined Manuscript tab, a split — edits **one** buffer. Typing in either view appears in the other immediately, there is a single dirty state, and there is a single save path. You cannot get two divergent copies of your own manuscript open at once.

When something outside the editor changes the file — an agent tool call, a `git checkout`, an edit in another program — SUNA reconciles:

- **The buffer is clean.** The disk content is applied as a minimal single-span change, so your cursor, scroll position and comment anchors map through it instead of being thrown away. Nothing interrupts you.
- **The buffer has unsaved edits.** SUNA touches nothing and raises a banner across the top of the editor: `<file> changed on disk while you have unsaved edits.` with two buttons, **Reload from disk** and **Keep my version**.

Autosave refuses to run while that banner is up, so neither version can be destroyed before you answer. **Reload from disk** replaces the buffer with the disk content. **Keep my version** keeps your edits, accepts the new disk content as the baseline so the same change never re-flags, and re-arms autosave — your next save overwrites the file.

## Editing shortcuts

| Key | Action |
| --- | --- |
| <kbd>⌘E</kbd> | Source ⇄ Reading (Markdown files only) |
| <kbd>⌘S</kbd> | Save |
| <kbd>⌘Z</kbd> / <kbd>⌘⇧Z</kbd> | Undo / redo |
| <kbd>⌘F</kbd> | Search panel |
| <kbd>⌘B</kbd> | Bold |
| <kbd>⌘I</kbd> | Italic |
| <kbd>⌘⇧C</kbd> | Inline code |
| <kbd>⌘⇧X</kbd> | Strikethrough |
| <kbd>⌘K</kbd> | Link (needs a selection) |
| <kbd>⌘⇧K</kbd> | Insert citation |
| <kbd>⌘⇧F</kbd> | Insert figure |
| <kbd>⌘⇧M</kbd> | Comment on selection |
| <kbd>⌘⌥M</kbd> | Toggle the comments rail |

Everything else — the palette, splits, the explorer, the canvas — is in the [full shortcuts reference](/reference/shortcuts).
