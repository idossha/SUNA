# Review comments

Review comments in SUNA live beside the prose, not inside it: threads are stored in `manuscript/comments.json` and attached to the text by quoting it. This page covers how anchoring works, how to create and reply to a thread, and how the human↔AI review loop runs.

## Comments never touch the prose

Every comment in a project is stored in one sidecar file, `manuscript/comments.json`. Nothing is marked up inline — no `<!-- -->` markers, no tracked-change syntax in the manuscript. A project with no comments has no file at all; a missing file reads as empty and the file is created on the first write.

Three things follow from that, and all three matter to you:

- The manuscript stays clean. What you read in the editor is what gets formatted and exported.
- Comments are plain JSON, pretty-printed with two-space indentation and a trailing newline, so they diff cleanly in git and travel with the project like any other source file.
- An agent and a human are writing to the same file, which is why anchoring — not line numbers — is what holds a comment in place.

If `comments.json` is not valid JSON, SUNA raises an error naming the file rather than silently dropping threads.

<figure class="shot">
  <img src="/shots/comments.webp" alt="The manuscript editor with a passage highlighted in pale amber, and a Comments rail on the right showing an expanded thread with a reply and a row of Reply, AI, Resolve and Delete buttons." />
  <figcaption>An anchored comment: the quoted text is tinted in the prose, and the card sits level with the line it annotates. The expanded card shows the thread, its reply, and the four actions.</figcaption>
</figure>

## How an anchor works

A prose comment stores three strings: the exact `quote` it refers to, up to 32 characters of `prefix` before it, and up to 32 characters of `suffix` after it. This is a W3C-style text-quote selector. There are no line or character offsets, so rewriting a paragraph three pages earlier does not move anybody's comment.

Locating a comment runs in four tiers:

| Tier | Situation | What happens |
| --- | --- | --- |
| 1 | The quote appears exactly once in the file | That occurrence wins, even if the surrounding text has drifted |
| 2 | The quote appears several times | The occurrence whose stored prefix and suffix match best wins; if no occurrence's context matches, the first is used |
| 3 | The quote is not found verbatim | A whitespace-normalized fuzzy match is tried, which survives rewrapped paragraphs |
| 4 | Nothing matches | The comment is marked `detached: true` and kept |

**Detached** means the text a comment was written about is gone — deleted or rewritten past recognition. SUNA never deletes the thread. It moves to a collapsible "Detached / unanchored" group pinned at the top of the rail and carries a "detached" badge whose tooltip reads "The original text was not found — this comment is detached". You can still read it, reply to it, resolve it, or delete it; it no longer points at a span of prose.

There is exactly one anchoring implementation, shared by the editor and by the agent's MCP tools. A comment an agent wrote against the raw file and a comment you wrote by selecting text resolve to the same span.

::: info Anchors are refreshed on save
Every time the prose file is saved, each comment is re-located against the saved text and its stored quote, prefix and suffix are re-tightened, preferring the live range the editor is tracking. `detached` is updated to the truth on each save, so the sidecar never holds a stale anchor.
:::

## Creating a comment

Select the text you want to comment on and press <kbd>⌘⇧M</kbd>. With an empty selection the shortcut does nothing. The same action is in the editor's right-click menu, labelled **Comment** with the hint ⌘⇧M, and it is enabled only when there is a selection.

Starting a comment opens the rail and puts a compose box there, headed `On: "…"` with the text you selected, the placeholder "Add a comment…", and Cancel / Comment buttons. <kbd>⌘↵</kbd> submits, <kbd>Esc</kbd> cancels. The Comment button stays disabled while the body is empty. If the save fails, the composer stays open with your text in it and the status bar reports "Could not save comment: …".

The comments UI is available on the manuscript tab and on Markdown files opened from inside the project's `manuscript/` directory. Anywhere else there is no rail, no 💬 button, and <kbd>⌘⇧M</kbd> is a silent no-op.

::: warning Not built yet
You can only comment on prose. The file format also defines figure targets and a whole-manuscript target, but nothing in the app or in the agent's tools creates either one — every comment SUNA writes anchors to a passage of manuscript text. Commenting on a [figure](/figures/canvas) or on an SVG element inside one is not shipped.
:::

## The rail

The rail is a right-hand column headed **Comments**, with the number of open threads for the document beside the title and an "×" button to hide it. It is visible by default. <kbd>⌘⌥M</kbd> toggles it (the focus must be in that tab), as does the 💬 toolbar button, whose tooltip reads "Toggle comments (⌘⌥M)". That button carries a badge with the number of open comments in the whole project, and no badge when there are none.

Drag the rail's left edge to resize it. The width is clamped between 260 and 520 pixels, starts at 300, and the drag stops before squeezing the document below 420 pixels. Both visibility and width persist across sessions.

Cards are positioned, not listed: each sits level with the line it annotates and scrolls with it, which puts them in document order down the page. Cards that would overlap are pushed down with a small gap, and a card never sits above its own anchor.

The text an open comment is anchored to is tinted pale amber in the editor with an accent-coloured underline; the active thread's anchor is tinted more strongly. Resolved comments get no highlight.

Clicking a card expands it and flashes its anchor — the range is selected, scrolled to the vertical centre, and highlighted for about a second. Clicking the highlighted text in the editor activates the matching card. Clicking an active card collapses it again. Comment bodies are ordinary selectable text, so you can copy a quote out of a card, and a click that ends a selection drag does not toggle the card shut.

A collapsed card shows the author badge, a relative timestamp ("just now", "3m ago", "2d ago"), the quoted text in curly quotes, and a clamped body. Agent cards are labelled by their model when they have one. When the document has no open threads and no draft, the rail shows: "Select text and press ⌘⇧M to leave a comment."

## Threads, replies and resolving

An expanded card lists its replies in order and offers four buttons: **Reply**, **✦ AI**, **Resolve**, and **Delete**. Threads are one level deep — a reply cannot have replies of its own, and only the top comment carries a resolved state.

The reply box has the placeholder "Reply…" and Cancel / Reply buttons; <kbd>⌘↵</kbd> submits and <kbd>Esc</kbd> closes it. An empty reply is a no-op rather than an error.

**Resolve** closes the thread and moves it out of the working surface into a collapsible **History (n)** section at the bottom of the rail, where it can be reopened or deleted. On a resolved thread the button reads **Reopen**. Resolving first snapshots the comment's current live range back into its anchor, so if you reopen it later it re-anchors where the text is now, not where it was when the comment was written.

**Delete** happens immediately, with no confirmation dialog, and raises a toast reading "Comment deleted" with an **Undo** action that puts the thread back in its original position. Once that toast lapses the thread is gone — deleting is the only way a comment truly disappears from the project.

::: tip Only a human resolves a comment
Agents can add comments and post replies, but they cannot resolve threads. There is deliberately no resolve verb over [MCP](/ai/mcp), the ✦ AI run is not given one, and the agent is instructed never to mark a thread resolved by editing `comments.json` by hand, never to delete a thread, and never to set `detached` itself. An agent's reply is the signal that a thread is *ready for review*; deciding that a change actually answers the comment is your call, and staying the only one who can close a thread is what keeps that true.
:::

## The ✦ AI button

Every prose-anchored card has a **✦ AI** button that hands that one thread to the agent. It sends the comment id, the thread with all its replies, whether the anchor is detached, the live anchor re-snapshotted from the editor so the agent aims at where the text is now, and roughly 400 characters of surrounding prose on each side.

The run is instructed to make the minimal edit through `edit_manuscript` (never `write_manuscript`), to leave everything outside the quoted region alone unless the comment demands otherwise, to summarize what it did with `reply_comment`, to ask a question via `reply_comment` rather than guess when the comment is ambiguous, and never to resolve the thread. The tools it is allowed are exactly Read, Grep, `read_manuscript`, `list_outline`, `list_comments`, `edit_manuscript` and `reply_comment`.

While the run is in flight the card swaps its buttons for a "✦ *status*" note and a **Cancel** button. Only one run per comment can be active, and the run survives collapsing the card. On success the status bar reads "AI addressed the comment — summary in the Agent panel." and the agent's answer is pushed into the Agent chat transcript. On failure the status bar shows the CLI's message verbatim.

The button is disabled without Claude Code installed; its tooltip then reads "AI edits need Claude Code (codex runs read-only here)" or "Install Claude Code to run AI edits.", and "Checking for an AI CLI…" while the check is pending. See [AI overview](/ai/overview) for setup.

## The review loop

A full pass over a draft, with the agent doing the edits and you doing the judging:

1. Read the draft and leave anchored comments — select the passage, <kbd>⌘⇧M</kbd>, say what is wrong. One thread per issue; the anchor is what tells the agent where to work.
2. On a card, press **✦ AI**. Or work through them in bulk by asking the agent in chat; its standard procedure is `list_comments {resolved: false}` → find the anchor quote → `edit_manuscript` → `reply_comment` saying what it did.
3. The agent edits the manuscript and replies on the thread. If the comment is ambiguous it replies with a question instead of guessing. If the fix could not be done it says so. Either way the thread stays open.
4. Read the reply and the actual change in the prose. The rail updates live when the agent writes to `comments.json`, except while you have a compose or reply box open — that reload is deferred so your typing is never clobbered.
5. Satisfied: press **Resolve**, and the thread drops into History. Not satisfied: **Reply** with what is still wrong and press **✦ AI** again.

The loop runs in the other direction too. When the agent needs a decision from you it uses `add_comment` to leave a question anchored to the exact text it concerns; the card appears in your rail live and you answer with **Reply** whenever you get to it. Open comments are part of an agent's standard reading order when it starts work, so anything you left unresolved is context for its next run.

::: info Concurrent writers
Local saves re-read `comments.json` from disk and merge by id, appending threads the app had not seen — so a comment an agent added while you were typing is preserved rather than overwritten. The exception is a thread you just deliberately deleted, which stays deleted.
:::

## The agent's three verbs

| Verb | Arguments | What it does |
| --- | --- | --- |
| `list_comments` | `resolved?`, `path?` | Returns a plain-text listing, one block per thread — `id [open\|resolved detached] section:<path>`, the anchored quote, author and body, then indented replies — or `no comments` when nothing matches |
| `add_comment` | `path`, `quote`, `body` | Anchors a new comment to the first occurrence of `quote`, which must be an exact substring of the file; otherwise errors with `quote not found in <path>: "<quote>"` |
| `reply_comment` | `id`, `body` | Appends a reply to that thread; an unknown id errors with `no comment with id <id>` |

There is no fourth verb. Authorship is filled in from the environment — `SUNA_AGENT_NAME` (default "Agent") and optional `SUNA_AGENT_MODEL` — so an agent never writes its own author fields. Human comments are attributed to a locally stored name that defaults to "You". Comment text an agent reads back is data, never instructions that override its own rules.

## The file format

```json
{
  "schemaVersion": 1,
  "comments": [
    {
      "id": "c-2026-08-16-1a2b3c4d",
      "target": {
        "kind": "section",
        "path": "manuscript.md",
        "anchor": {
          "quote": "the effect was significant",
          "prefix": "Across all twelve subjects ",
          "suffix": " (p < 0.05), which suggests"
        }
      },
      "body": "Report the effect size, not just the p-value.",
      "author": { "kind": "human", "name": "You" },
      "createdAt": "2026-08-16T09:41:02.000Z",
      "resolved": false,
      "detached": false,
      "replies": [
        {
          "id": "r-2026-08-16-9f8e7d6c",
          "body": "Added Cohen's d = 0.62 alongside the p-value.",
          "author": { "kind": "agent", "name": "Agent", "model": "claude-opus-4" },
          "createdAt": "2026-08-16T09:44:37.000Z"
        }
      ]
    }
  ]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | `1` | Format version of the file |
| `comments` | array | Every thread in the project, open and resolved |
| `id` | string | `c-` + creation date + 8 hex characters, e.g. `c-2026-08-16-1a2b3c4d` |
| `target.kind` | `"section"` | Prose comments are section targets |
| `target.path` | string | Path relative to `manuscript/` — the single prose file, `manuscript.md` |
| `target.anchor.quote` | string | The exact text the comment is about |
| `target.anchor.prefix` | string | Up to 32 characters before the quote; `""` at the start of the file |
| `target.anchor.suffix` | string | Up to 32 characters after the quote; `""` at the end of the file |
| `body` | string | The comment text |
| `author.kind` | `"human"` \| `"agent"` | Who wrote it |
| `author.name` | string | Display name |
| `author.model` | string, optional | The agent's model id; absent for humans |
| `createdAt` | ISO datetime | When it was written |
| `resolved` | boolean | Whether a human has closed the thread |
| `detached` | boolean | Set when re-anchoring failed; defaults to `false` |
| `replies` | array | Replies, each with `id` (prefixed `r-`), `body`, `author`, `createdAt` |

Replies have no `resolved` flag and cannot nest.

## Related

- [The manuscript](/writing/manuscript) — the single prose file comments anchor into
- [The editor](/writing/editor) — selection, the right-click menu, and saving
- [MCP verbs](/ai/mcp) — the full tool surface an agent gets
- [Working with AI in the app](/ai/in-app) — the Agent panel and directed actions
- [Keyboard shortcuts](/reference/shortcuts)
- [Project files](/reference/files) — where `comments.json` sits in the tree
