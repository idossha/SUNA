# ADR-006 — Caption standard and `![[tbl:id]]` table embeds

Date: 2026-08-17 · Status: accepted

## Context

Figures already rendered with a derived bold "Figure N." label in the reading
view and exports, but the caption text was not consistently italic or
centered, and the editor's live preview showed only `fig:<id>` instead of the
number and caption. Tables were worse: managed table captions
(`manuscript.json`'s `tables` list) rendered in a detached trailing "Tables"
section, while the GFM tables in the prose rendered bare — nothing linked a
prose table to its caption entry, so no renderer could put "Table N." above
the table or its notes below it. Numbering followed manifest array order, not
the order things appear in the prose.

The user set the standard from APA-style examples (their SLEEP-adjacent
manuscripts, matching ADR-005's ground truth: "Figure N." bold + italic
caption below figures, table captions above with an italic "Note." line).

## Decision

1. **The SUNA caption standard, applied in every renderer** (live preview,
   reading view, HTML/PDF export, DOCX export):
   - Figure: bold derived "Figure N." label, italic caption, centered below
     the figure.
   - Table: bold derived "Table N." label plus the italic short title ABOVE
     the table; an italic "Note. …" line (caption body + footnotes) directly
     BELOW it.
2. **`![[tbl:id]]` is a new SciMark block construct**, symmetric with
   `![[fig:id]]`: written alone in its own paragraph directly above a
   markdown table, it binds that table to its `manuscript.json` `tables`
   entry (which keeps owning the caption — captions stay out of the prose).
   Every renderer pairs the embed with the table that immediately follows it
   into one captioned block. An embed with no following table renders its
   caption block alone; managed tables the prose never embeds keep rendering
   in the trailing "Tables" section.
3. **Numbering derives from prose order of first embed appearance** — for
   figures and tables alike — with manifest order as the tiebreaker for
   anything never embedded. (RULE unchanged: numbering is derived at format
   time, never stored.)

## Consequences

- `@suna/markdown` gains `tableEmbed` in the AST, a `resolveTable` render
  option, and sibling-pairing in `renderHtml`.
- `export-content.ts` orders `labels`/`figures`/`tables` by embed appearance;
  `withoutTables` drops `tableEmbed` nodes under `tablePlacement: 'end'` so
  captions do not duplicate.
- The live preview derives numbers per document, loads figure caption titles
  from `figure.json` and table captions from `manuscript.json` (short-TTL
  cache, `captionMeta.ts`), and merges embed+table spans into one widget.
- Journal profiles still override the label word (`Fig.`) and placement
  conventions (`figurePlacement`, `tablePlacement`); the standard is the
  always-on base per ADR-005.
