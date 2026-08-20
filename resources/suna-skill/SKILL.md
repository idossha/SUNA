---
name: suna
description: >-
  Work on a SUNA project — an academic manuscript with managed figures,
  references, review comments, and journal-compliance checks (a folder
  containing suna.json). Use whenever the user asks to write or edit a
  manuscript in SUNA, address review comments, manage citations or
  references, check journal compliance, or points at a SUNA project.
---

<!-- suna:managed-skill — replace this file with your own to opt out of updates -->

# SUNA — the knowledge lives with SUNA, not in this skill

This machine runs **SUNA**, and all agent instructions for it ship *with
SUNA* in the machine context layer (so they can never go stale against the
installed app). This skill is only the trigger.

1. Locate the context layer: `~/SunaConfig/Context/` by default; when
   `$SUNA_CONFIG_DIR` is set, `$SUNA_CONFIG_DIR/Context/`.
2. Read **everything** under `UserContext/` — who the user is and their
   standing rules for all SUNA work.
3. Orient in `SunaContext/`: start with `README.md` (the scheme + reading
   map), then `WORKFLOW.md` (the session playbook). The complete references
   (`PROJECT-GUIDE.md`, `MANUSCRIPT.md`, `COMMENTS.md`, `FIGURES.md`,
   `LETTERS.md`, `ROUNDS.md`, `MCP.md`) are siblings. Read `ROUNDS.md`
   BEFORE helping anyone hand SUNA a reviewer report — the single most
   common way an import goes wrong is a human tidying the letter first.
4. In a project, read `context/PROJECT.md`, `context/MEMORY.md`, and
   `context/RULES.md` before working, and check open review comments
   (`list_comments` over MCP, or `manuscript/comments.json`).

That's the whole skill — the canonical, always-current instructions are the
files above.
