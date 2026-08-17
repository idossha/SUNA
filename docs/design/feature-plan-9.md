# Feature plan 9 — help in vim mode, explorer drag-and-drop, Finder actions

Requested 2026-08-17. Gates: `pnpm typecheck`, `pnpm test`,
`pnpm --filter @suna/desktop build`, the hidden-driver probes, and two new
smoke steps. Nothing in this plan may open a window, a Finder window, or
any OS surface during a test run — see §5.

## Measured first (hidden app, 2026-08-17)

Every decision in §1 rests on these, not on assumption:

1. **In vim NORMAL mode a bare `?` never reaches the window listener.** A
   probe listening at window level recorded *zero* events for
   Shift-Slash while the editor had focus, and vim's backward-search panel
   opened (`?(JavaScript regexp: set pcre)`). The vim keymap consumes it
   entirely — the help overlay's listener could not see it even without
   the isTyping guard, and hijacking it would break `?` search.
2. **`⌘/` is already taken by CodeMirror's `toggleComment`.** Pressing it
   in the markdown buffer inserted `<!--  -->` — exactly 9 characters —
   and arrived at window level with `defaultPrevented: true`, which the
   app's command dispatcher bails on. It is not available, and taking it
   would cost line-commenting in code files.
3. **`⌘⇧/` (⌘?) arrives unprevented and changes nothing.** Same probe, vim
   normal mode: one window-level event, `prevented: false`, buffer length
   unchanged.
4. **Electron 43's default menu has no Help submenu** — a windowless
   `Menu.getApplicationMenu()` check returned `Electron, File, Edit, View,
   Window`. macOS therefore never installs the Help-menu search field that
   normally owns ⌘⇧/, so the chord is genuinely free here.
   (A static reading of the code predicted the opposite — that Electron's
   default menu carries a Help role and macOS would swallow the chord. The
   runtime check above is what settled it; trust the measurement, and
   re-run that check before ever moving this binding.)
   `Vim.defineEx('help', 'h', …)` also collides with nothing: vim's
   `defaultExCommandMap` has no command whose name or short name starts
   with `h`.
5. **Renaming a file leaves its open tab pointing at the dead path**
   (`fs:rename` on an open file: the panel keeps the old path, nothing
   retargets). Moving must not inherit that bug — §2 fixes both.
6. **`fs:rename` cannot cross directories**: its contract is
   `{ path, newName }` and `renameEntry` rejects a `newName` containing a
   separator. A move needs a new channel.

## 1. Reaching the shortcut help from a vim buffer

`?` on non-typing surfaces is unchanged. Three additions:

- **`⌘⇧/` — global, works while typing.** Register the existing
  `help.shortcuts` command with `shortcut: 'Mod-Shift-Slash'` so the
  palette's window dispatcher fires it; measurement 3 says it reaches that
  listener from inside a vim buffer. It must NOT go behind the overlay's
  isTyping guard — that guard exists for the bare `?` only.
- **`formatShortcut` renders it as `⌘?`**, not `⌘⇧/`: Shift+Slash *is* the
  `?` key, and a reader looking for "?" should see "?". Add a
  shifted-punctuation table (`Slash → ?`) in `palette/shortcuts.ts` with
  unit tests; matching is unchanged (still `event.code` + exact
  modifiers).
- **`:help` / `:h` — the vim-native path.** Register through the existing
  `exRegistry` (`editor/vimEx.ts`) exactly like `:w`/`:q`: a `showHelp`
  callback injected by the app, so the module keeps its no-CodeMirror,
  no-store discipline and stays node-testable. `:h` is vim's own
  abbreviation; both map to the same handler.

The overlay's **Editor** section gains a `Vim (when vim motions are on)`
group listing `:w`, `:q` / `:q!`, `:wq`, `:help`, and the honest line that
`?` is vim's search-backward here — with `⌘?` named as the way to reach
this dialog without leaving the buffer. The StatusBar `?` chip's title
gains `⌘?` too.

## 2. Explorer drag-and-drop

### The selection gotcha (must be fixed first)

`TreeRow.onMouseDown` calls `selectRow(path, …)` immediately, so pressing
on a row that is part of a multi-selection collapses the selection to that
one row before a drag can start. Adopt Finder/VS Code semantics:

- plain mousedown on a row **already in a selection of >1**: do not
  collapse; record a pending collapse.
- `dragstart` clears the pending collapse (the drag takes the whole
  selection).
- `mouseup`/`click` without a drag applies it (the click still collapses,
  as it does today).
- Modifier clicks (⌘/⇧) keep today's immediate behaviour.

### Dragging

Rows get `draggable`. `dragstart` payload: the current selection when the
dragged row is in it, else that row alone (and the row becomes the
selection). `dataTransfer` carries `application/x-suna-paths` (JSON array
of absolute paths) plus a `text/plain` fallback of the same paths, with
`effectAllowed = 'move'`.

### Dropping

- a **folder row** → into that folder;
- a **file row** → into that file's parent (Finder/VS Code behaviour);
- the tree's empty area below the rows → the project root. The container
  must actually own that space; if it does not, give it the remaining
  height so a drop below the last row is a real root drop.

Highlight the resolved target with `tree__row--droptarget` (and
`tree--droptarget` for the root case). When the drop is not allowed, set
`dropEffect = 'none'` and paint nothing.

### Guards — pure, unit-tested (`shell/explorer-dnd.ts`)

`resolveDrop(dragged: string[], overPath, isDir, rootDir, tree)` returns
`{ targetDir, allowed, reason }`:

- dropping into a path's own current parent is a no-op → not allowed;
- a directory may not be dropped into itself or any descendant (compare
  resolved paths with a `sep` boundary — a prefix test alone matches
  `/a/data2` for `/a/data`);
- a row inside the dragged set is never a target;
- a name collision in the target is reported by name, not silently
  overwritten.

### Moving

New `fs:move` channel, batched so one drop is one refresh:
request `{ paths: string[], targetDir: string }` → response
`{ moved: { from, to }[], failed: { path, reason }[] }`.

`moveEntries` in `main/services/fs.ts`:

- `assertInsideAllowedRoot` on **every** source and on the target dir;
- refuse an existing destination — `stat` first and fail with
  `copyFileInto`'s wording (`refusing to overwrite an existing …`).
  `fs.rename` silently clobbers on POSIX, and drag-and-drop is precisely
  the gesture that produces collisions;
- re-reject dir-into-descendant in main, not only in the renderer;
- per-path failures are collected, never thrown: the batch moves what it
  can and names what it could not, mirroring the existing multi-delete
  convention. Status note: `Moved 3 items to data/` or
  `Moved 2 items to data/; 1 could not move: fig.svg already exists`.
- **Non-goal**: no `EXDEV` copy+unlink fallback. A project lives in one
  tree; if a cross-device rename ever fails, the raw error is reported
  verbatim rather than silently doing something else.

### Open tabs must follow

New `retargetPanels(from: string, to: string)` in `state/dock.ts`: rewrites
the panel id/params/title of a panel whose path is `from`, **or is inside
`from`** when `from` is a directory (prefix + `sep`). The explorer calls it
after each successful move — and also **after a rename**, which fixes
measurement 5's pre-existing dead-tab bug in the same place. Selection
follows the moved paths so the rows stay selected at their new home.

## 3. Finder / "open with the OS" actions

Context menu gains a group between *Rename…* and *Delete*:

- **Reveal in Finder** (⌥⌘R) — `shell.showItemInFolder`
- **Open with Default App** (⌥⌘O) — `shell.openPath`

Both act on a single target, and are disabled with >1 selected, matching
*Rename…*'s existing precedent. The tree's `onKeyDown` binds the same two
chords for the focused row. Labels are platform-aware:
`darwin → Reveal in Finder`, `win32 → Show in Explorer`, otherwise
`Show in File Manager`.

New channels `shell:reveal` `{ path }` and `shell:open-path` `{ path }`
→ `{ error: string | null }` (Electron's `openPath` returns `''` on
success; map it to `null`).

**Safety.** Both are root-confined by `assertInsideAllowedRoot`.
`shell:open-path` additionally refuses to launch anything executable:
the extensions `.app .command .pkg .dmg .scpt .workflow .term` and any
file whose mode carries a user-execute bit. The reason is concrete rather
than theoretical — since feature-plan-8 an agent can write files into the
project, and "open with the OS" must never become "run whatever the agent
just wrote". Directories are allowed (that opens a Finder window, which is
what the user asked for). The refusal is reported as a status note naming
the file.

## 4. Not in this plan

Dragging files *from Finder into* the tree (needs `webUtils.getPathForFile`
plus a copy-vs-move decision) and dragging *out to Finder* (needs
`webContents.startDrag`). Both are OS-boundary features with their own
failure modes; the request was moving things around inside the tree, which
§2 covers completely. Say the word and either is a small follow-up.

## 5. Verification (and one hard constraint)

**A test run must never call `shell:reveal` or `shell:open-path` for
real** — that would open Finder windows and launch apps on the developer's
screen, which is exactly what the hidden-driver work exists to prevent.
The probes and smoke steps assert the *wiring and the guards* (menu items
present, enablement rules, the executable refusal, root confinement) and
stop at the IPC boundary. The OS effect itself is a one-line manual check,
recorded in TESTING.md.

- **Unit**: `explorer-dnd.test.ts` (every guard, including the
  `/a/data2` vs `/a/data` prefix trap); `fs.test.ts` additions for
  `moveEntries` against real temp dirs (overwrite refusal, dir-into-self,
  confinement, partial success); `shell-open.test.ts` for the executable
  refusal table; `dock.test.ts` for `retargetPanels` (file, directory
  prefix, no-match); `shortcuts.test.ts` for `⌘?` formatting;
  `vimEx.test.ts` for `:help`.
- **Probe** `scripts/e2e/probes/explorer-dnd.mjs`: real synthetic
  `DragEvent`s carrying a real `DataTransfer` (the same technique the
  canvas SVG-import smoke step uses), dragging a file row onto a folder
  row in the hidden app — assert the file moved on disk, its open tab
  retargeted, and the row now renders under the folder; then drag it back
  out to the root; then a refused case (folder onto its own child) that
  must move nothing.
- **Probe** extension to `help-overlay.mjs`: with vim on and the buffer in
  normal mode, `⌘⇧/` opens the overlay; `:help` opens it; a bare `?` does
  not (it drives vim's search panel instead).
- **Smoke**: `explorer-drag-move` and `help-in-vim-mode`, in the existing
  step style, appended after the current last step.

## 6. Selector contract (API for the drivers)

`draggable` on `.tree__row`; `.tree__row--droptarget`;
`.tree--droptarget`; menu items carry `data-action` values
`reveal-in-os` and `open-with-os`; the overlay keeps
`data-help-section`, and the Vim group's rows live in the `editor`
section.
