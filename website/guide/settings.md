# Settings and themes

Everything you can change about how SUNA looks and behaves — and the one place it is all kept.

## One file, one level

SUNA is configured the way nvim and ghostty are: **one plain-text file you own**, seeded on first launch with every key present and commented.

```
~/.suna/config.yml      every setting
~/.suna/themes/*.yml    one colour theme per file
```

A key the file sets wins; a key it does not set takes the shipped default. **There is no project level and no second store.** The Settings tab edits this same file in place, keeping your comments and key order, and the file is watched — a save in any editor repaints every window without a restart. Hand-edit or click; both land in the same place.

A bad value never takes the app down: it falls back to the default and appears as a diagnostic in the Settings tab, naming the key and what was wrong with it.

::: tip Where the full key list lives
Every key, its bounds and its default are documented in the file itself, and the exhaustive reference is [the configuration reference](/developers/configuration).
:::

## Opening Settings

Click **Settings** in the status bar, or open the command palette with <kbd>⌘⇧P</kbd> and run **Open Settings**. It opens as a dock tab titled "Settings" and stays open when you switch projects.

<figure class="shot">
  <img src="/shots/settings.webp" alt="The Settings tab open beside the file explorer, showing the Global section with General rows for Default editor mode, Vim motions, Editor theme and Autosave, then Appearance rows for Interface scale, Font size 14, Line height 1.6, Content width 140 and Body font Serif." />
  <figcaption>The Global scope. Every row states its effect under the label, and the numeric rows name their default.</figcaption>
</figure>

The tab ends with an **About** page: the SUNA version you are running, the Electron and Chrome versions, the platform, the path of the open project, and the [Updates](/guide/install#updating) controls.

## The settings

The key column is the dot-path the value has in `config.yml` — `editor.lineHeight` is `editor:` then `lineHeight:`.

| Setting | Key | Default | Effect |
| --- | --- | --- | --- |
| Default editor mode | `editor.defaultMode` | Reading (live preview) | How markdown files open — Reading is the editable live preview, Source is plain markdown |
| Vim motions | `editor.vimMotions` | off | Vim keybindings in the source editor |
| Editor theme | `editor.theme` | SUNA Dark | Theme for the whole app: editor surface and chrome |
| Autosave | `editor.autosave` | on | Saves editors and the figure canvas a second after you stop editing |
| Interface scale | `ui.scale` | 100% | Zoom applied to the whole window; 90%, 100%, 110% or 125% |
| Font size | `editor.fontSizePx` | 14 | Base editor font size in px, 12–22 |
| Line height | `editor.lineHeight` | 1.6 | Line spacing in both modes, 1.4–2 |
| Content width | `editor.contentWidthCh` | 140 | Reading-mode column width in characters, 50–150 |
| Body font | `editor.fontFamily` | Serif | Reading-mode body font — Serif, Sans or Mono; source view stays monospace |
| Shell | `terminal.shell` | empty | Absolute shell path for new terminals; empty uses the system default |
| Auto-open reference PDF | `references.autoOpenPdf` | on | Selecting a reference that has a PDF opens it beside the list |
| Contact email | `literature.mailto` | empty | Sent to Crossref and OpenAlex as a polite-pool contact, not a login |
| AI CLI preference | `literature.cli` | Automatic | Which agent CLI the "AI search" literature provider spawns |
| Model | `ai.model` | Sonnet | Model tier every AI call runs at — Opus, Sonnet or Haiku |
| Effort | `ai.effort` | Low | How hard it thinks before answering — Low, Medium, High, Extra high or Max |
| Check on launch | `updates.checkOnLaunch` | on | Ask GitHub for a newer SUNA a few seconds after start — see [updating](/guide/install#updating) |

The Shell setting applies to newly opened terminals only, and its basename becomes the default terminal tab title.

## The themes

SUNA ships six themes, and the choice covers the whole window — the editor surface and the app chrome change together, so the title bar, sidebar and status bar never disagree with the text you are reading.

| Theme | Character |
| --- | --- |
| SUNA Dark | The default: near-black with warm accents |
| SUNA Light | Paper-cream background, dark text |
| Gruvbox | Warm dark browns with orange headings |
| Jellybeans | Cool near-black with muted highlights |
| Mono Blue Dark | Near-monochrome, one blue accent |
| Mono Blue Light | The same restraint on paper |

Pick one under **Appearance → Editor theme**, or from the gear popover on the editor toolbar. Your own themes go in `~/.suna/themes/` and appear in the same list.

<figure class="shot">
  <img src="/shots/manuscript-reading-dark.webp" alt="The combined Manuscript tab in the SUNA Dark theme: near-black background, a serif title page with authors and affiliations, an abstract, and the outline sidebar on the left." />
  <figcaption>SUNA Dark. The theme reaches the sidebar and status bar, not just the text column — every other screenshot on this site is SUNA Light.</figcaption>
</figure>

<figure class="shot">
  <img src="/shots/canvas-dark.webp" alt="The figure canvas in the SUNA Dark theme: dark chrome around the tool rail, layers tree and properties panel, with the figure's own white artboard unchanged in the middle." />
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

Vim motions are off by default and apply to the source editor. Turn them on under **Editor → Vim motions**, or from the gear popover on an editor tab.

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

**In your config** — **Python → Environment path** (`python.envPath`), an absolute interpreter or venv path. It is the path figure scripts run in. Leave it empty and the per-machine pick applies instead.

The split is deliberate: an absolute interpreter path differs on every laptop, so the status-bar pick is remembered per directory on this machine and never travels. See [installation](/guide/install) for what SUNA detects.

## Literature providers and API keys

**Contact email** (`literature.mailto`) is sent to Crossref and OpenAlex as a polite-pool contact — their preferred practice, not a login. Left empty it falls back to your `user.email` setting, and if that is empty too, nothing is sent. This field reaches only the app's own lookups; the standalone MCP server reads `SUNA_CONTACT_EMAIL` from its own environment and SUNA never passes this value to it.

Four HTTP providers are listed, each with its own status line:

| Provider | Key | Note |
| --- | --- | --- |
| Crossref | not needed | Keyless. Add an email above for the polite pool |
| OpenAlex | accepted | Metered — without budget or a key it answers HTTP 429 |
| bioRxiv / medRxiv | not needed | Keyless. Preprints only, searched through Crossref |
| arXiv | not needed | Keyless, best-effort: the Atom feed can come back empty |

OpenAlex is the only provider with a key field, with **Save** and **Clear** buttons; the row reads "Key saved." once one is stored.

**References → Literature provider** picks which provider the References panel defaults to; "Auto (prefers a detected agent CLI)" is the default. More in [references](/writing/references).

## AI CLI preference

**AI CLI preference** chooses which agent CLI the "AI search" literature provider spawns — billed to your existing subscription, not to an API key:

| Choice | Meaning |
| --- | --- |
| Automatic (Claude Code, then Codex) | Default; tries Claude Code first |
| Claude Code | Always `claude` |
| Codex | Always `codex` |

The row reports what it found: "Detected: …", or "Neither was found on PATH — literature search falls back to Crossref." Losing the CLI costs you the AI-search provider, not literature search itself.

Separately, **AI → Mode** (`ai.mode`) sets how SUNA talks to an AI at all: **Agent CLI (uses your subscription)**, **API key**, or **Off**.

## Model and effort

**Model** and **Effort** decide how the AI runs, whichever entry point calls it — the palette's `?` ask, a directed edit, the Agent chat. The default is **Sonnet** at **Low** effort: the tier that answers a writing question quickly and cheaply. Reaching for Opus, or for more thinking, is a deliberate choice.

| Setting | Choices | Default |
| --- | --- | --- |
| Model | Opus (most capable), Sonnet (balanced), Haiku (fastest) | Sonnet |
| Effort | Low, Medium, High, Extra high, Max | Low |

Both live under **AI** in Settings, and in the editor's quick-settings popover (the gear on an editor tab) right under Vim motions.

The model is stored as a **tier**, not a dated model id, so your config does not go stale when a new generation ships. Where it lands:

- **Agent CLI mode** — `claude --model <tier> --effort <level>`.
- **API mode** — the tier maps to the current model id (Sonnet → `claude-sonnet-5`) and the effort is sent as `output_config.effort`.
- **Codex** — takes the effort only, as `model_reasoning_effort`, with Extra high and Max collapsing onto its top level (`high`). The tier names Anthropic models, so it is not passed to codex at all.

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

## There are no project-level settings

`suna.json` once carried a `settings` block that overrode your global values. **It is no longer read.** Two levels meant a value could be silently outranked by a file you were not looking at, which is the failure the single-file design exists to avoid — see [the configuration reference](/developers/configuration). An old project's block is left alone on disk and simply ignored; delete it whenever you like.

What still travels with a project in `suna.json` is the project's own facts: its name, its active journal profile and its directory-name map. See [project layout](/guide/project).

::: warning Not built yet
There is no shortcut editor. The chords shown in the keyboard overlay (<kbd>?</kbd>) are fixed, and Settings offers no way to rebind them.
:::

## Related

- [The workbench tour](/guide/tour) — where the status bar, activity rail and dock tabs are
- [The editor](/writing/editor) — reading versus source mode, and what the toolbar gear reaches
- [Files and formats](/reference/files) — what else lives at the project root
