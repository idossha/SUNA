# AI inside the app

The four AI surfaces built into SUNA's window: the Agent view, the ✦ AI button on a comment card, the Agent section in the canvas properties rail, and the palette's `?` ask mode. This page says exactly what each one does, what it needs installed, and where it stops.

Two different engines sit behind these surfaces. The Agent view's chat talks to Anthropic, OpenAI or a local Ollama over your own API key — text in, text out, no access to your files. The other three spawn an agent CLI (Claude Code or Codex) as a one-shot process in your project folder, where it can read and edit through SUNA's [MCP verbs](/ai/mcp). Knowing which is which tells you what to expect from each button. See [AI in SUNA](/ai/overview) for how the two halves fit together.

## The Agent view

The Agent view is the sixth icon in the activity rail. It is the only sidebar view that renders with no project open — the other five show an empty-state line instead.

<figure class="shot">
  <img src="/shots/agent.webp" alt="The Agent sidebar view, showing a CLI collaborators section with Open Claude Code here and Open Codex CLI here buttons, an API providers section with a provider select and key field, and a chat transcript with a composer below." />
  <figcaption>The Agent view holds three things: CLI launchers, API-provider setup, and the chat transcript that every AI answer in the app lands in.</figcaption>
</figure>

### CLI collaborators

Two buttons, **Open Claude Code here** and **Open Codex CLI here**. Each one writes (or repairs) the project's `.mcp.json` and agent-context files, then opens the CLI in a terminal tab at the project folder. A failure to write the config aborts the launch. With no project open the section reads "Open a project first — the CLI runs in the project folder."

These launches use your existing CLI login — your Claude or OpenAI subscription — and no API key is stored by SUNA. The launched command is prefixed with `SUNA_AGENT_NAME='Claude Code'` or `SUNA_AGENT_NAME='Codex CLI'`, so review comments that session writes are attributed under that name.

### API providers

Under **API providers**, a dropdown picks Anthropic, OpenAI or Ollama. Anthropic and OpenAI take an API key in a password field — press <kbd>⏎</kbd> or **Save**, and the status dot reads "key saved" or "no key". Ollama says "Ollama runs locally — no key required." and shows the status "local".

| Provider | Model used | Endpoint |
| --- | --- | --- |
| Anthropic | the model tier from **Settings → AI**, max 4096 output tokens | Messages API, `/v1/messages` |
| OpenAI | `gpt-4o` | `/v1/chat/completions` |
| Ollama | `llama3.2` | `http://127.0.0.1:11434/api/chat` |

The model picker is not in this panel — it is **Settings → AI → Model / Effort** (`ai.model` / `ai.effort`), which also drives the palette ask and directed actions. The tier maps to a model id on the way out (Opus → `claude-opus-5`, Sonnet → `claude-sonnet-5`, Haiku → `claude-haiku-4-5`) and the effort is sent as `output_config.effort`. OpenAI and Ollama keep the fixed models above: the tier names Anthropic models, so it is not sent to them. See [settings](/guide/settings#model-and-effort).

### The chat

Type in the composer and send with <kbd>⌘⏎</kbd> (the hint under the box says so). The placeholder reads "Message your collaborator…", or "Save an API key to start chatting" when no provider is configured. While a reply is in flight the transcript shows a "Thinking…" bubble and the composer is disabled.

The conversation is multi-turn: each send posts the whole accumulated transcript, so the model sees your earlier turns. That transcript also collects answers pushed in from the `?` palette ask and from the directed actions below — which means those summaries become context for your next chat turn.

::: warning What the chat cannot do
The request is a short system prompt plus your messages, and nothing else. The provider adapters expose no tools, and the main-process handler passes only the system prompt and the message list. The chat cannot read your manuscript, cannot list your figures, and cannot edit a single file. It knows the manuscript title when one is available; everything else you must paste in.

Replies are non-streaming — you wait, then the whole answer appears at once.
:::

For an assistant that can actually open and change your project, use the CLI launchers above, or the three directed surfaces below.

## ✦ AI on a comment card

Each section-anchored comment card in the comments rail carries a **✦ AI** button, tooltip "Send this comment to the AI agent", beside Reply, Resolve and Delete.

<figure class="shot">
  <img src="/shots/comments.webp" alt="Manuscript prose with highlighted anchored passages, and a comments rail on the right showing a thread with a reply and the Reply, AI, Resolve and Delete buttons." />
  <figcaption>The ✦ AI button sits on the card next to Reply. Resolve stays yours — no agent can close a thread.</figcaption>
</figure>

Pressing it sends the CLI the whole thread, the anchor quote with its prefix and suffix, whether the anchor is still attached or has detached, and roughly 400 characters of surrounding prose. The prompt tells the agent to make the minimal edit with `edit_manuscript` (never `write_manuscript`), to summarise on the thread with `reply_comment`, never to resolve it, and — when the comment is ambiguous — to ask a question on the thread rather than guess.

The run's tool allowlist is `Read`, `Grep`, `mcp__suna__read_manuscript`, `list_outline`, `list_comments`, `edit_manuscript`, `reply_comment`. On success the status bar reads "AI addressed the comment — summary in the Agent panel."

Comments written this way are authored as "Agent", not as the CLI's name — SUNA does not set `SUNA_AGENT_NAME` for app-spawned runs, only for the terminal launches in the Agent view. More on threads and anchors in [Review comments](/writing/comments).

## The Agent section on the canvas

Open a figure's `figure.svg` and the properties rail on the right carries an **Agent** section below Align, Figure and Palette.

<figure class="shot">
  <img src="/shots/canvas.webp" alt="The figure canvas: a tool rail on the left, a LAYERS tree, a millimetre artboard in the centre, and a PROPERTIES rail on the right with Align, Figure, Palette, Agent and Export sections." />
  <figcaption>The Agent section is part of the properties rail, so the selection you made with the mouse is the selection the agent is told about.</figcaption>
</figure>

Type into the **Describe the edit…** textarea and press **✦ Send to agent** (or <kbd>⌘⏎</kbd>). SUNA sends the figure id, the absolute path of the SVG, the artboard size in millimetres, the ids of the selected elements, a screenshot of the canvas with the gold selection overlay drawn on it, the active journal profile name, and the figure's current compliance issues.

The prompt constrains the agent to edit only `figures/<id>/figure.svg`, to preserve every element id, never to regenerate the figure from `source/plot.py`, and to verify its work with `check_figure_compliance`. Its allowlist is `Read`, `Grep`, `Glob`, `Edit`, `Write`, `mcp__suna__read_figure_svg`, `list_figures`, `check_figure_compliance`.

When the run finishes SUNA reloads the figure from disk and the status bar reads "AI edited the figure — summary in the Agent panel." Because the SVG is the document, the change lands as ordinary editable objects on [the canvas](/figures/canvas) — undo, nudge and re-edit as usual.

## The palette's ask mode

Open the command palette with <kbd>⌘K</kbd> and type `?` as the first character. The mode label switches to **Ask** and the palette offers "Press Enter to ask the agent CLI: `<query>`".

The ask needs an open project — without one, Enter does nothing at all. While the run is going the palette shows a status line with a **Cancel** button; when it finishes, the answer appears with a **Dismiss** button and is also pushed into the Agent view's transcript, so every AI answer in the app ends up in one place.

Ask is read-only by nature of what it runs. With Codex the command is `codex --ask-for-approval never --sandbox read-only --skip-git-repo-check`. With neither CLI installed the error is "Install Claude Code or Codex to use the `?` command."

An empty palette input lists your recent files, commands, terminal lines and AI prompts for that project. Clicking a recent AI prompt refills the input with `?<prompt>`; Enter re-submits it. See [Keyboard shortcuts](/reference/shortcuts) for the rest of the palette.

## What every CLI-backed run shares

The comment fix, the figure edit and the `?` ask all go through the same machinery.

| Property | Behaviour |
| --- | --- |
| Process | One `claude -p --output-format json` run per action, prompt on stdin |
| Session state | None. Consecutive asks share no conversation; the CLI never sees the in-app chat transcript |
| MCP | `--mcp-config <project>/.mcp.json` is passed only when that file exists |
| Tools | A single `--allowed-tools` list, per action, as listed above |
| Timeout | 180 seconds, then "Claude Code timed out after 180s." / "Codex timed out after 180s." |
| Cancellation | Every run can be cancelled; it reports "Cancelled." |
| Scope | The working directory is checked against SUNA's allowed roots before the process spawns |
| Git | Every prompt carries "Never run destructive git commands, never commit." |

Each prompt ends by asking for a concise summary of exactly what changed, and that summary becomes a bubble in the Agent panel labelled `✦ Fix comment: …` or `✦ Edit figure: …`, clipped to 60 characters.

::: warning No streaming, and no progress
`--output-format json` emits nothing incremental, so SUNA cannot show you what the agent is doing. The progress line is synthetic: "Asking Claude Code…", then "Thinking…" again every 12 seconds until the run returns or the 180-second timeout fires.
:::

## What you need installed

| Surface | Requirement |
| --- | --- |
| Agent view chat | An Anthropic or OpenAI API key, or Ollama running locally |
| Open Claude Code / Codex CLI here | That CLI on your `PATH`, logged in with your own subscription |
| ✦ AI on a comment | Claude Code |
| ✦ Send to agent on the canvas | Claude Code |
| `?` palette ask | Claude Code or Codex |

::: warning Edits are Claude Code only
The two directed edit buttons are disabled when only Codex is installed, with the reason "AI edits need Claude Code (codex runs read-only here)". With neither CLI found the reason is "Install Claude Code to run AI edits." While SUNA is still probing your `PATH`, the button's tooltip reads "Checking for an AI CLI…".
:::

Which CLI SUNA reaches for is the **AI CLI preference** row in [Settings](/guide/settings) — "Automatic (Claude Code, then Codex)", "Claude Code" or "Codex". An explicit choice never falls back to the other one. The row also reports what it detected on your `PATH`. Per project, the **AI mode** setting offers "Agent CLI (uses your subscription)", "API key" and "Off".

## Where AI does not act

Two boundaries are deliberate, and they hold across every surface on this page.

**An agent never resolves a review comment.** There is no resolve verb in the MCP server at all. Agents reply on the thread; you close it in the app.

**Compliance checks are advisory.** `check_manuscript` and `check_figure_compliance` report issues and rewrite nothing, so an AI run that consults them still has to make the edit through the allowlist it was given.

For what a CLI session reads before it starts work — your `WHO-AM-I.md`, the project's `PROJECT.md`, the standing rules — see [Context files](/ai/context).
