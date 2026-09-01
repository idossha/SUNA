# Configuring SUNA

> **Historical design note.** The contract is [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and the
> decisions are in [`docs/DECISIONS.md`](../DECISIONS.md). This file is kept for the detail and the
> sourcing it carries, but where it disagrees with the contract the contract wins — and
> `ARCHITECTURE.md` §20 lists the places it is known to. Do not treat anything here as current.

SUNA is configured the way nvim, ghostty and aerospace are: **one plain-text
file you own**, in a dot-directory, seeded on first launch with every key
present and commented out.

```
~/.suna/config.yml      every setting
~/.suna/themes/*.yml    one colour theme per file
```

`SUNA_CONFIG_HOME` relocates the whole directory.

There is **one level**. A key the file sets wins; a key it does not set takes
the shipped default. There is no project-level override and no second global
store that could silently outrank the file — an rc file something else can
quietly beat is the failure this design exists to avoid.

The Settings GUI edits **this same file**, in place, preserving your comments
and key order. Power users hand-edit; everyone else clicks; both land in the
same place and see the same result immediately. The file is watched, so a save
in any editor applies live — no restart.

A bad value never takes the app down. It falls back to the shipped default and
appears as a diagnostic in the Settings tab, naming the key and what was wrong
with it.

---

## The settings

Every key below is a dot-path, and that path is where it lives in the YAML:
`editor.lineHeight` is

```yaml
editor:
  lineHeight: 1.75
```

The authoritative list — names, bounds, defaults and the one-line
documentation the seeded file carries — is the `SETTING_KEYS` registry in
`packages/core/src/settings-resolve.ts`. The generated `config.yml` is
produced from it, so the file on your disk cannot drift from the real surface.

| Block | What it covers |
| --- | --- |
| `editor:` | measure (`contentWidthCh`), `fontSizePx`, `lineHeight`, `fontFamily`, `theme`, `defaultMode`, `vimMotions`, `lineNumbers`, `autosave` |
| `ui:` | `scale`, `textScale`, `radiusPx`, `titleBarHeightPx`, `activityBarWidthPx`, `statusBarHeightPx`, `fontUi`, `fontSerif`, `fontMono` |
| `figures:` | `defaultWidthPreset` |
| `export:` | `doubleSpacing`, `lineNumbers`, `pageNumbers` |
| `preview:` | `profileId` — the journal profile preview and render surfaces use |
| `python:` | `envPath` |
| `literature:` | `provider`, `mailto`, `cli` |
| `terminal:` | `shell` |
| `references:` | `autoOpenPdf` |
| `ai:` | `mode`, `cliCommand`, `model`, `effort` |
| `review:` | `aiDiffs` |
| `response:` | `colorRoles`, `quickInsert` |
| `trash:` | `maxFileMb`, `retentionDays` |

A key set to `null` means the same as an absent key: the shipped default. That
is how the GUI's "Reset to default" leaves a clean file.

### Metrics are not part of a theme

`ui:` is deliberately separate from the colour themes. Bar heights, corner
radius, the type scale and font stacks are **layout**, shared by every theme:
switching from gruvbox to suna-light must not silently move your status bar.

---

## Themes

A theme is a YAML file naming colours. Put it in `~/.suna/themes/nord.yml` (the
filename becomes its id) or inline it under `themes:` in `config.yml`, then
point `editor.theme` at it.

```yaml
# ~/.suna/themes/nord.yml
name: Nord Night
base: dark          # dark | light — drives color-scheme and CodeMirror's dark flag
extends: suna-dark  # inherit everything you don't restate

palette:            # optional names you can reuse below
  base: "#2e3440"
  surface: "#3b4252"
  frost: "#88c0d0"

chrome:
  bg.chrome: base
  bg.shell: base
  bg.panel: surface
  bg.editor: base
  ink: "#eceff4"
  accent: frost

syntax:
  heading: frost
  keyword: "#81a1c1"
```

That is a complete, working theme. Everything it does not name is inherited.

### Inheritance, precisely

1. Start from `extends:`, or from `suna-dark` / `suna-light` per your `base:`.
2. Apply what this theme declares.
3. **Derive**: for any `editor`/`syntax` token this theme did not state, if the
   chrome colour it comes from *was* changed here, re-derive it from that.

Step 3 is what lets four chrome colours produce a coherent editor, while a
theme that only re-tints its chrome still keeps its parent's deliberate editor
tuning (gruvbox's selection wash is not its chrome selection wash).

A theme id must be lowercase letters, digits and dashes. You cannot shadow a
built-in id (`suna-dark`, `suna-light`, `gruvbox`, `jellybeans`,
`mono-blue-dark`, `mono-blue-light`) — use `extends:` to start from one. An
`extends:` that does not resolve degrades to the base theme rather than to
nothing: renaming a file should cost you an inheritance, not every colour in
your UI.

Built-in themes are **data in the same registry**, resolved by the same code
and emitted as the same stylesheet. There is no privileged path: your theme
and a shipped one are the same kind of object.

---

## The three layers, and what each one paints

This is the contract. A theme may name these keys and no others; an unknown
key is a validation error naming what it should have been.

### `chrome:` — the window around the work

Title bar, activity bar, explorer, panels, status bar, dialogs, commit graph.

| Key | CSS property | Paints |
| --- | --- | --- |
| `bg.chrome` | `--s-bg-chrome` | Window frame: title bar and activity bar |
| `bg.shell` | `--s-bg-shell` | The shell behind the panes; the app background |
| `bg.panel` | `--s-bg-panel` | Side panels: explorer, references, review |
| `bg.editor` | `--s-bg-editor` | Chrome-side editor surface (tab strip, gutters) |
| `bg.raised` | `--s-bg-raised` | Things that float: menus, popovers, dialogs |
| `bg.hover` | `--s-bg-hover` | Hover wash over a row or button — use a translucent value |
| `bg.active` | `--s-bg-active` | The active tab / current item; usually the accent, tinted |
| `bg.selected` | `--s-bg-selected` | Selected list rows; must read above `bg.hover` |
| `ink` | `--s-ink` | Primary text |
| `ink.muted` | `--s-ink-muted` | Secondary text: labels, inactive tabs |
| `ink.faint` | `--s-ink-faint` | Tertiary: hints, disabled, line numbers |
| `accent` | `--s-accent` | The one accent: focus rings, active indicators, carets |
| `accent.ink` | `--s-accent-ink` | Text **on** the accent (a filled button label) |
| `ok` / `warn` / `err` | `--s-ok` / `--s-warn` / `--s-err` | Passing checks / advisories / failures |
| `border` | `--s-border` | Ordinary dividers |
| `border.strong` | `--s-border-strong` | Focused inputs, the active pane |
| `diff.ins` | `--s-diff-ins` | Inserted words in an inline diff — sits *under* prose, so it needs to survive that |
| `role.comment` | `--s-role-comment` | A reviewer's comment in a response letter |
| `role.reply` | `--s-role-reply` | Your reply |
| `role.change` | `--s-role-change` | Quoted manuscript text that changed |
| `graph.0` … `graph.7` | `--s-graph-0` … `-7` | Commit-graph lanes. Lane 0 is the branch you are on — usually the accent |

The response-letter roles are worth a note: the exported `.docx` uses black /
`#0432FF` / `#EE0000`. The light themes resolve to exactly those, so the
workspace is a preview of the file. Black on a dark panel is unreadable, so the
dark themes carry the same three **roles** at a legible lightness instead.

### `editor:` — the writing surface

Separate from chrome because a manuscript is often wanted on paper-coloured
stock inside dark chrome (and the reverse), and because selection and
active-line want tuning against a page of prose rather than a list row. Every
key falls back to its chrome counterpart.

| Key | CSS property | Paints | Falls back to |
| --- | --- | --- | --- |
| `bg` | `--ed-bg` | The page you write on | `chrome.bg.editor` |
| `ink` | `--ed-ink` | Body text | `chrome.ink` |
| `ink.muted` | `--ed-ink-muted` | Block quotes, the active line number | `chrome.ink.muted` |
| `ink.faint` | `--ed-ink-faint` | Line numbers, Markdown punctuation | `chrome.ink.faint` |
| `accent` | `--ed-accent` | Caret and editor focus | `chrome.accent` |
| `border` | `--ed-border` | `hr`, table rules, callouts | `chrome.border.strong` |
| `selection` | `--ed-selection` | Selected text — translucent, so prose reads through it | `chrome.bg.selected` |
| `activeLine` | `--ed-active-line` | The caret's line; keep it barely-there | `chrome.bg.hover` |

### `syntax:` — tokens inside the editor

Split out because this is the layer people port from a vim colourscheme, and
the one most themes want to say the most about. Reading mode's fenced code
uses the same palette, so a fence and the source view always agree.

| Key | CSS property | Paints |
| --- | --- | --- |
| `heading` | `--ed-syn-heading` | Markdown headings |
| `em` / `strong` | `--ed-syn-em` / `--ed-syn-strong` | Italic / bold |
| `link` | `--ed-syn-link` | Links, URLs, property names |
| `code` | `--ed-syn-code` | Inline and fenced code, strings |
| `label` | `--ed-syn-label` | Citation keys, figure labels, cross-references |
| `number` | `--ed-syn-number` | Numbers, booleans, null |
| `keyword` | `--ed-syn-keyword` | Language keywords in fenced code |

---

## How it reaches the screen

```
~/.suna/config.yml ──┐
~/.suna/themes/*.yml ┤
                     ├─► main: parse + validate + resolve   (services/userconfig.ts)
built-in themes ─────┘         │
                               ├─► resolved settings ──► the store, per key + source
                               └─► one generated stylesheet
                                        │
                    .app[data-suna-theme=id]  → the --s-* chrome layer
                    .editor-tab--theme-<id>   → the --ed-* editor + syntax layers
```

`styles/tokens.css` contains **no colours at all**. It carries the metrics and
font stacks that themes deliberately do not own — which is exactly the set the
`ui:` block overrides, inline on `:root`.

Main watches the config directory and pushes the whole reloaded config to every
window, so an external edit repaints without a round trip.

## Where the code lives

| Concern | File |
| --- | --- |
| Token registry, theme schema, resolution, CSS emission, the six built-ins | `packages/core/src/theme.ts` |
| Setting keys, bounds, defaults, per-key docs, resolution | `packages/core/src/settings-resolve.ts` |
| YAML parse, comment-preserving write, the seeded default file | `packages/core/src/userconfig.ts` |
| Reading, watching, writing `~/.suna/` | `apps/desktop/src/main/services/userconfig.ts` |
| The renderer's store, stylesheet injection, `ui:` application | `apps/desktop/src/renderer/src/state/settings.ts` |

Adding a setting is a one-file change: add an entry to `SETTING_KEYS`. The
seeded `config.yml`, the defaults, the validation and the resolver all follow
from it. Adding a themeable colour is likewise one entry in the token registry.
