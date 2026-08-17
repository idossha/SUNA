# MCP.md — the SUNA MCP server

## What it is

A stdio MCP server over the project's plain-text files (Markdown / JSON / BibTeX / SVG).
It runs without the SUNA app open. On boot it heals, best-effort, the machine context
layer (`~/SunaConfig/Context/`) and the project's agent files (the `AGENTS.md` /
`CLAUDE.md` stubs and `.mcp.json`). Prefer these verbs over raw file edits — they give
you anchored edits, comment threading, and compliance checks. When the server is
unavailable, fall back to direct file edits (see the last section).

## Wiring

`.mcp.json` in the project root wires the server; both Claude Code and Codex
auto-discover that file:

```json
{
  "mcpServers": {
    "suna": {
      "command": "node",
      "args": ["{{SUNA_MCP_PATH}}", "--project", "<ABSOLUTE PROJECT PATH>"]
    }
  }
}
```

- SUNA writes and heals this file automatically — on project open in the app, and on
  server boot. It is machine-local and gitignored. If it is missing, open the project
  in SUNA once.
- Manual start: `{{SUNA_MCP}} --project /path/to/project`.
- Root resolution: `--project <dir>` argv if given, else the current working directory.

## Identity

Two environment variables set your comment authorship (see WORKFLOW.md for when to
comment):

| var | effect |
|---|---|
| `SUNA_AGENT_NAME` | `author.name` on comments you add (default "Agent") |
| `SUNA_AGENT_MODEL` | optional model string recorded alongside |

Set them in the environment the server is launched with. Agent comments always carry
`author.kind: "agent"`.

## The 20 verbs

Every reply is plain text.

| verb | input | purpose |
|---|---|---|
| list_project | {} | header (project/profile/root) + recursive file list |
| read_manuscript | {} | the whole prose file |
| write_manuscript | {content} | overwrite the whole prose file — wholesale restructures only; prefer edit_manuscript |
| edit_manuscript | {find, replace} | anchored exact-match edit; errors if find matches 0 or >1 times (with per-match context so you can extend find); reports the section it edited |
| read_section | {path} | DEPRECATED alias of read_manuscript (path ignored) |
| write_section | {path, content} | DEPRECATED alias of write_manuscript (path ignored) |
| list_outline | {} | derived section outline: indent = depth, title, word count |
| read_manuscript_meta | {} | manuscript.json + authors.json |
| check_manuscript | {} | manuscript compliance vs the active journal profile (word/abstract/section limits, required sections, availability statements, figure-reference integrity); "severity id: message" lines or "compliant with <journal>" |
| list_figures | {} | figure ids with caption titles |
| read_figure_svg | {figureId} | the figure's SVG source |
| check_figure_compliance | {figureId} | figure compliance vs the active profile (fonts, line weights, dimensions, palette) |
| read_bib | {} | references.bib verbatim |
| list_comments | {resolved?, path?} | review-comment threads |
| add_comment | {path, quote, body} | open a thread anchored to exact prose text |
| reply_comment | {id, body} | reply in a thread |
| resolve_comment | {id, resolved} | mark a thread resolved/open |
| search_literature | {query, provider?, limit?} | search a literature provider (default Crossref, keyless) |
| lookup_doi | {doi, provider?} | one work by DOI |
| add_reference | {doi, provider?} | fetch a DOI's metadata and append it to references.bib (generated cite key is echoed back) |

Citation workflow: search_literature / lookup_doi -> add_reference (echoes the new
key) -> insert `[@key]` in the prose with edit_manuscript. Check the echoed metadata —
registries serve junk on automated deposits. Citation and cross-reference syntax is in
MANUSCRIPT.md; the comment schema and review procedure are in COMMENTS.md.

## Conventions

- All replies are plain text; errors come back as text with `isError`.
- There are no locks. When the SUNA app is open it live-reloads external file changes;
  prefer the verbs — and anchored `edit_manuscript` over `write_manuscript` — so you
  never clobber the user's in-progress editing.
- Compliance verbs are advisory-only: they flag violations with measured value vs the
  journal's stated rule, and never rewrite anything. Fix what they flag, or report to
  the user if fixing would change scientific content.
- Never write literal "Figure 3" — numbering is derived at format time. Write
  cross-references (`@fig:x`) instead.

## File-verb fallback

The file is the API: every source of truth is plain text (JSON / Markdown / BibTeX /
SVG), so when MCP is unavailable you may read and edit the files directly with the
same discipline — anchored edits, comments only in the `manuscript/comments.json`
sidecar, never touch `figures/*/figure.svg` or `output/`. Edit `context/` files
(NOTEBOOK.md, RULES.md, MISSION.md) with your own file tools regardless — there is no
MCP verb for them.
