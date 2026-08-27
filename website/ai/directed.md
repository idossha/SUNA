# Directed AI actions

A chat box is the wrong instrument for most of what an agent should do in a writing app. If you can see the thing that is wrong — this comment, this figure element, this reviewer's point, this panel of the interface — then pointing at it *is* the prompt. SUNA calls these **directed actions**: an agent run scoped to one element, with a tool allowlist chosen for that job and a result you accept or discard.

They all share three properties, and it is worth stating them once:

1. **A specific target, not a conversation.** The element you pointed at is in the prompt, with its file path, its identifiers, and often a screenshot.
2. **A tool allowlist per action.** Each run is handed exactly the verbs its job needs. The reply drafter has no write verb at all; the comment fixer cannot resolve a thread, because no such verb exists.
3. **One place to review.** Every answer lands in the Agent transcript, so there is a single surface where AI output is read.

These spawn an agent CLI (Claude Code, or Codex where it is read-only) as a one-shot process in your project folder. Directed *edit* actions are Claude-only for now — a Codex ask runs sandboxed read-only. See [AI inside the app](/ai/in-app) for the CLI-versus-API split.

## Element-level analysis: "Repair this UI"

The most literal of them. Enter pick mode and the whole window becomes a crosshair layer: whatever is under the pointer is outlined in gold and labelled with its own identity — `div.cm-line`, `button.cmt__btn--ai`. Click to freeze it, and describe what is wrong.

<figure class="shot">
  <img src="/shots/repair-picker.webp" alt="The SUNA window in pick mode: a paragraph of the manuscript is outlined in gold and labelled div dot cm dash line, with a hint bar at the bottom reading Click the broken element, Esc to cancel." />
  <figcaption>Pick mode outlines the element under the pointer and labels it with its <code>tag.class</code> identity. Esc cancels.</figcaption>
</figure>

What the agent receives is a bundle written to disk first — a screenshot, and a `context.json` holding the element's **DOM path**: the target and up to six ancestors, each as `tag.class.class`, root-most first. When the path is deeper than the cap it is the far ancestors that are dropped, never the element you pointed at. Those class names map onto components under `apps/desktop/src/renderer/src`, which is what lets an agent go from "this box is misaligned" to the file that renders it.

The bundle is written **before** the agent is called, so it is the fallback when no CLI is installed: the report survives as a directory you can hand to an agent yourself.

The run is allowed `Read`, `Grep`, `Glob`, `Edit`, `Write`, `Bash(pnpm:*)` and `Bash(node:*)` — enough to make a minimal fix and verify it with a typecheck and the nearest unit tests. It is told not to commit, and to list the files it changed.

::: warning Development builds only
"Repair this UI" edits SUNA's own source, so the command is gated on a development build and is not present in a downloaded release. It is the mechanism by which the app's own bugs get reported with enough context to fix them — pointing at a broken panel in a packaged app has nothing to edit.
:::

## Fix a comment

The ✦ on a review comment card. The agent gets the comment thread, the manuscript path, and a live text-quote anchor — prefix, quote, suffix — so it can find the passage even if the surrounding prose has moved.

It may read the manuscript and outline, edit the manuscript, and reply to the thread. It may **not** resolve one: no resolve verb exists, because closing a review thread is a judgement about whether the concern was met, and that stays human.

## Edit a figure

The Agent section in the canvas properties rail. The prompt carries the figure id, the SVG's absolute path, the artboard size in millimetres, **the ids of the elements you have selected**, the active journal profile, and the current compliance issues — plus a screenshot in which a gold overlay marks the selection.

The rules it works under are the canvas's own doctrine: edit the SVG in place, never regenerate it from `source/plot.py`, preserve every element id, leave untouched markup exactly as it is, and check the result with `check_figure_compliance`.

## Draft a letter

The ✦ on a cover letter. It gets the letter's path, the venue, the letter kind, and the venue's stated requirements in their own wording, and it drafts the *argument* — why this result matters and why it belongs in this journal.

Its allowlist deliberately contains nothing that could make a claim on your behalf. See [Cover letters](/documents/letters#ai-and-the-affidavit): the AI drafts the argument, the human signs the affidavit.

## Draft a reply to a referee

The ✦ beside a reply box in a review round. **Read-only by construction** — no `Edit`, no `Write`, no write verb — because the draft is a proposal you accept in the app, not an edit to your file. What it must do well is read the paper before answering for it, so it gets the manuscript, the outline, the round, the review points, the figures and the bibliography.

This is the one action behind an explicit approval gate; [Peer review](/documents/review#the-ai-gate) explains why, and what is recorded.

## Learn from a past letter

Point SUNA at a response letter you have already written and it derives your house style from it — how manuscript text is quoted, how replies are marked, which sections the letter uses — into `context/PEER-REVIEW.md`, the file the reply drafter follows.

Its allowlist is `Read` and nothing else. The letter's whole text travels in the prompt, so there is nothing to fetch; the list exists to take `Write`, `Edit` and `Bash` away.

## While a run is going

The agent reads the manuscript before it answers, which takes tens of seconds — long enough that a button which merely dimmed would read as broken. A busy strip says what the agent is doing right now, from the CLI's own progress lines, and offers to cancel. On failure the status bar shows the CLI's message verbatim rather than a summary of it.
