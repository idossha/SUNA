# Settings and themes

Everything you can change about how SUNA looks and behaves, and how the two levels fit together: a global value applies everywhere, and a project can override it in `suna.json`.

## Two levels, one resolution rule

SUNA resolves every adjustable value the same way:

> **project value → global value → built-in default**

The Settings tab says so in its own subtitle: "Two levels: Global applies everywhere; This project overrides it in suna.json". Each row in the **This project** section carries a badge naming the level the current value came from — `from project`, `from global` or `default` — and a **Reset to global** button that is enabled only when a project override is actually in force.

Global values live in the app's own `settings.json`, outside any project. Project values live in the `settings` block of `suna.json` at the project root, which is a committed file — so a project's editor mode, theme, figure width and Python environment travel with the repository to your co-author's machine. See [project layout](/guide/project) and [files and formats](/reference/files).

A value that fails validation — a font size of 400, a theme name that does not exist — is skipped rather than throwing, and resolution falls through to the next level. Hand-editing `suna.json` cannot take the settings surface down.

::: tip
Setting a project key to `null` means "not set", exactly like the key being absent. That is how a hand-edit spells "reset to global".
:::

## Opening Settings

Click **Settings** in the status bar, or open the command palette with <kbd>⌘⇧P</kbd> and run **Open Settings**. It opens as a dock tab titled "Settings" and stays open when you switch projects.

<figure class="shot">
  <img src="/shots/settings.webp" alt="The Settings tab open beside the file explorer, showing the Global section with General rows for Default editor mode, Vim motions, Editor theme and Autosave, then Appearance rows for Interface scale, Font size 14, Line height 1.6, Content width 140 and Body font Serif." />
  <figcaption>The Global scope. Every row states its effect under the label, and the numeric rows name their default.</figcaption>
</figure>

The tab ends with an **About** block: SUNA 0.1.0, the Electron and Chrome versions, the platform, and the path of the open project.

## Global settings

These apply to every project. The key column is the name the value has in the global settings file.

| Setting | Key | Default | Effect |
| --- | --- | --- | --- |
| Default editor mode | `editor.defaultMode` | Reading (live preview) | How markdown files open — Reading is the editable live preview, Source is plain markdown |
| Vim motions | `editor.vimMotions` | off | Vim keybindings in the source editor |
| Editor theme | `editor.theme` | SUNA Dark | Theme for the whole app: editor surface and chrome |
| Autosave | `editor.autosave` | on | Saves editors and the figure canvas a second after you stop editing |
| Interface scale | `appearance.uiScale` | 100% | Zoom applied to the whole window; 90%, 100%, 110% or 125% |
| Font size | `editor.fontSizePx` | 14 | Base editor font size in px, 12–22 |
| Line height | `editor.lineHeight` | 1.6 | Line spacing in both modes, 1.4–2 |
| Content width | `editor.contentWidthCh` | 140 | Reading-mode column width in characters, 50–150 |
| Body font | `editor.fontFamily` | Serif | Reading-mode body font — Serif, Sans or Mono; source view stays monospace |
| Shell | `terminal.shell` | empty | Absolute shell path for new terminals; empty uses the system default |
| Auto-open reference PDF | `references.autoOpenPdf` | on | Selecting a reference that has a PDF opens it beside the list |
| Contact email | `lit.mailto` | empty | Sent to Crossref and OpenAlex as a polite-pool contact, not a login |
| AI CLI preference | `lit.cli` | Automatic | Which agent CLI the "AI search" literature provider spawns |

The Shell setting applies to newly opened terminals only, and its basename becomes the default terminal tab title.

## The four themes

SUNA ships four themes, and the choice covers the whole window — the editor surface and the app chrome change together, so the title bar, sidebar and status bar never disagree with the text you are reading.

| Theme | Character |
| --- | --- |
| SUNA Dark | The default: near-black with warm accents |
| SUNA Light | Paper-cream background, dark text |
| Gruvbox | Warm dark browns with orange headings |
| Jellybeans | Cool near-black with muted highlights |

Pick one under **Global · General → Editor theme**, from the gear popover on the editor toolbar, or per project under **This project → Editor theme**.

<figure class="shot">
  <img src="/shots/manuscript-reading-light.webp" alt="The combined Manuscript tab in the SUNA Light theme: cream background, a serif title page with authors and affiliations, an abstract, and the outline sidebar on the left." />
  <figcaption>SUNA Light. The theme reaches the sidebar and status bar, not just the text column.</figcaption>
</figure>

<figure class="shot">
  <img src="/shots/canvas-light.webp" alt="The figure canvas in the SUNA Light theme: cream chrome around the tool rail, layers tree and properties panel, with the figure's own white artboard unchanged in the middle." />
  <figcaption>The same theme on the canvas. The chrome follows the theme; the figure does not — its artboard renders exactly as it will export.</figcaption>
</figure>

<figure class="shot">
  <img src="/shots/theme-gruvbox.webp" alt="manuscript.md open in the Gruvbox theme: warm dark brown background, an orange Results heading, olive-toned citation keys and a rendered display equation." />
  <figcaption>Gruvbox. Citation keys, cross-references and code spans each keep a distinct colour.</figcaption>
</figure>

<figure class="shot">
  <img src="/shots/theme-jellybeans.webp" alt="The same manuscript in the Jellybeans theme with the left nav collapsed: a cool near-black background, tan headings and blue cross-reference links." />
  <figcaption>Jellybeans, with the left nav collapsed — the theme is independent of the workbench layout.</figcaption>
</figure>

## Editor typography

The four typography values — content width, font size, line height and body font — are reachable in two places. The Settings tab writes the global level. The gear button on the editor toolbar opens an **Editor appearance** popover with the same controls as sliders and selects, plus a theme select and a **Reset to defaults** button that resets the appearance controls only.

Content width and Font are hidden in the popover for code and data files, where neither has any effect.

| Value | Range | Default |
| --- | --- | --- |
| Content width | 50–150 ch | 140 |
| Font size | 12–22 px | 14 |
| Line height | 1.4–2 | 1.6 |

Content width applies to reading mode, and the `ch` unit resolves against the editor's own font — so the number really is characters per line. More on the two modes in [the editor](/writing/editor).

## Vim motions

Vim motions are off by default and apply to the source editor. Turn them on globally under **General → Vim motions**, or for one project under **This project → Vim motions**. When a project overrides the value, the popover's checkbox is shown but disabled, with the tooltip pointing you at Settings → This project — because the popover writes the global level, and the project's value would win right back.

While vim is active, the status bar shows the current mode. These ex commands are registered:

| Command | Effect |
| --- | --- |
| `:w` | Write the buffer |
| `:q` / `:q!` | Close the tab / close discarding changes |
| `:wq`, `:x` | Write, then close — refusing to close if the write failed |
| `:help`, `:h` | Open the keyboard-shortcut overlay |
| `:caption`, `:cap` | Edit the caption title of the nearest figure or table embed |
| `:note` | Focus a table's **Note.** body, or a figure's caption body |
| `:title` | Same target as `:caption` |

In NORMAL mode a bare <kbd>?</kbd> is vim's search-backward, so `:help` is the only route to the shortcut overlay from a vim buffer. Full chord list: [keyboard shortcuts](/reference/shortcuts).

## Autosave

Autosave is on by default. Its description states that it saves editors and the figure canvas a second after you stop editing; <kbd>⌘S</kbd> still works, and turning autosave off makes saving manual everywhere.

## Python environment

The Python environment is set in two independent places, and they mean different things.

**Per machine** — the status-bar chip, titled "Python environment for new terminals". Clicking it re-scans and opens a popover listing what was detected by kind (`uv`, `venv`, `conda`) and name, plus a "none" row. With nothing selected the chip reads `no env`; with nothing found the popover says "No environments found (uv, .venv, conda)." The choice applies to newly opened terminals and is remembered per project directory on that machine.

**Per project** — **This project → Python environment**, an absolute interpreter or venv path stored in `suna.json` as `python.envPath`. It is the path this project's figure scripts run in. Leave it empty and the per-machine pick applies instead.

The split is deliberate: the committed path is the one your co-author should reproduce, while the machine pick is the one whose absolute location differs on every laptop. See [installation](/guide/install) for what SUNA detects.

## Literature providers and API keys

**Contact email** (`lit.mailto`) is sent to Crossref and OpenAlex as a polite-pool contact — their preferred practice, not a login. Left empty it falls back to your `user.email` setting, and if that is empty too, nothing is sent. This field reaches only the app's own lookups; the standalone MCP server reads `SUNA_CONTACT_EMAIL` from its own environment and SUNA never passes this value to it.

Four HTTP providers are listed, each with its own status line:

| Provider | Key | Note |
| --- | --- | --- |
| Crossref | not needed | Keyless. Add an email above for the polite pool |
| OpenAlex | accepted | Metered — without budget or a key it answers HTTP 429 |
| bioRxiv / medRxiv | not needed | Keyless. Preprints only, searched through Crossref |
| arXiv | not needed | Keyless, best-effort: the Atom feed can come back empty |

OpenAlex is the only provider with a key field, with **Save** and **Clear** buttons; the row reads "Key saved." once one is stored.

Per project, **This project → Literature provider** picks which provider the References panel defaults to. Its "Auto (prefers a detected agent CLI)" option is the default. More in [references](/writing/references).

## AI CLI preference

**AI CLI preference** chooses which agent CLI the "AI search" literature provider spawns — billed to your existing subscription, not to an API key:

| Choice | Meaning |
| --- | --- |
| Automatic (Claude Code, then Codex) | Default; tries Claude Code first |
| Claude Code | Always `claude` |
| Codex | Always `codex` |

The row reports what it found: "Detected: …", or "Neither was found on PATH — literature search falls back to Crossref." Losing the CLI costs you the AI-search provider, not literature search itself.

Separately, **This project → AI mode** (`ai.mode`) sets how this project talks to an AI at all: **Agent CLI (uses your subscription)**, **API key**, or **Off**.

::: info Where API keys are entered
Provider API keys for the in-app chat (Anthropic, OpenAI, Ollama) are entered in the Agent sidebar, not on the Settings page. The Settings page's only key field is OpenAlex's. See [AI overview](/ai/overview) and [AI in the app](/ai/in-app).
:::

## Reference library

The **Reference library** section is the one part of Settings that does not live in the app's settings file. It is stored in `~/SunaConfig/library.json`, and the section shows that path — because the standalone MCP server has no access to the app's settings and must search exactly the folders this pane names. See [MCP](/ai/mcp).

| Control | Default | Effect |
| --- | --- | --- |
| Folders to search | — | Folders searched read-only for a reference's PDF; a file found there is copied into the project, never moved. Each row shows `searchable` or `not on this machine — skipped` |
| Use Spotlight | on | Asks `mdfind` for PDFs whose text contains the DOI or title before walking the folders. macOS only — the toggle is hidden elsewhere, though the stored value stays portable |
| Download policy | Open access + publisher | How far "Find PDF" may reach when no copy is on this machine |

Download policy has three settings:

| Policy | Reach |
| --- | --- |
| Off — never download | Never fetches bytes |
| Open access only | arXiv, bioRxiv and Unpaywall |
| Open access + publisher | The above, and additionally follows the DOI to the article page and reads its PDF link |

No policy ever tries to get past a paywall. A 403 is reported as a 403.

## Project settings in suna.json

The **This project** section is empty until a project is open ("Open a project to see and override its settings here."). With one open, it offers these overrides, each written into `suna.json`:

| Row | Path in `suna.json` `settings` | Default |
| --- | --- | --- |
| Preview / render profile | `previewProfileId` | follows the manifest's `activeProfileId` |
| Default editor mode | `editor.defaultMode` | reading |
| Content width | `editor.contentWidthCh` | 140 |
| Font size | `editor.fontSizePx` | 14 |
| Line height | `editor.lineHeight` | 1.6 |
| Body font | `editor.fontFamily` | serif |
| Editor theme | `editor.editorTheme` | suna-dark |
| Vim motions | `editor.vimMotions` | false |
| Default figure width | `figures.defaultWidthPreset` | double |
| Python environment | `python.envPath` | null |
| Literature provider | `literature.provider` | null (auto) |
| AI mode | `ai.mode` | cli |
| — (no row; hand-edit only) | `ai.cliCommand` | null (auto-detect the installed CLI) |

Figure width presets are `single`, `onehalf` and `double`, shown as **Single column**, **1.5 column** and **Double column**; the profile you export under decides what those measure. See [profiles](/publishing/profiles).

::: warning Stored, not yet honoured
**Default figure width** is written and read back correctly, but nothing consumes it: figure creation always uses the profile's double-column width. Set the width per figure on [the canvas](/figures/canvas) instead.
:::

::: warning One key spelled two ways
The theme's global key is `editor.theme`, but its path inside `suna.json` is `editor.editorTheme`. Both name the same setting. Use the right one for the file you are editing.
:::

A project block looks like this:

```json
{
  "schemaVersion": 1,
  "name": "Ram-pressure stripping in a z=1.7 cluster (demo)",
  "activeProfileId": "nature-astronomy",
  "directories": { "manuscript": "manuscript", "figures": "figures" },
  "createdAt": "2026-08-14T00:00:00.000Z",
  "settings": {
    "editor": { "fontSizePx": 16, "editorTheme": "gruvbox", "vimMotions": true },
    "figures": { "defaultWidthPreset": "single" },
    "python": { "envPath": "/Users/you/paper/.venv/bin/python" }
  }
}
```

The section's footer says it plainly — "Project settings live in `suna.json` — you can edit it directly" — with an **Open suna.json** button beside it. Settings re-resolve when the file is saved, so a hand-edit takes effect without a restart. The `settings` block is optional; projects created before it existed have none.

::: warning Not built yet
There is no shortcut editor. The chords shown in the keyboard overlay (<kbd>?</kbd>) are fixed, and Settings offers no way to rebind them.
:::

## Related

- [The workbench tour](/guide/tour) — where the status bar, activity rail and dock tabs are
- [The editor](/writing/editor) — reading versus source mode, and what the toolbar gear reaches
- [Files and formats](/reference/files) — what else lives at the project root
