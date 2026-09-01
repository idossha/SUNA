# Where the profiles came from

`resources/profiles/*.json` is the **shipped output**. The files in this
directory are the **research record behind it**: which guideline page every
profile value was read off, the URL it was read from, the wording that was
found there, and how much confidence that wording earns.

None of these files ships. `packages/formatter/src/profiles.ts` imports the ten
profile documents by name and nothing else, and
`scripts/packaging/stage-resources.mjs` stages only `examples/`, `mcp/` and
`python/` into the app bundle. They live here — beside the profiles they
justify — rather than under `docs/`, because they are data about this data, not
prose.

| File | What it holds |
| --- | --- |
| `author-guidelines-findings.json` | The first research pass: ApJ/AAS, MNRAS, Science and Nature Astronomy, each with its `sources[]`, and per-surface findings for citations, figures and manuscript limits. |
| `author-guidelines-findings-2.json` | The second pass — a re-verification sweep across the shipped venues, recording per-journal whether a correction was found and why. Its Science entry is the one that documents two *official self-contradictions* preserved deliberately in `science.json`: column widths 5.7/12.1/18.4 cm (instruction pages) versus 9/18.3 cm (2025 figure-guide PDF), and minimum line weight 0.5 pt versus 0.28 pt. `packages/formatter/src/profiles.test.ts` traces shipped values back to this file. |
| `document-kinds-findings.json` | Five areas — cover letters, revision responses, NIH SF424/PHS 398, NSF PAPPG 24-1, and rounds/returns — sourced for the `letters` and `revision` blocks and for the sponsor-package schema. The `notes[]` string in `science.json`, `pnas.json` and `nature.json` points here for the indexed cover-letter quote candidates. |
| `reference-analyses.json` | Structured analyses of four published papers (3× *Nature Astronomy* 2026, 1× *Nature Physics* 2017) — page geometry, section structure, figure inventory. This is the measurement record behind the figure-capability tallies summarised in `docs/ARCHITECTURE.md` §20.9; the page-geometry half of it was descoped and nothing in the profile schema consumes it. |

Two rules govern everything here, and they are stated in `docs/ARCHITECTURE.md`
§12:

* **If a journal's guidelines cannot be found, that journal is not shipped.** No
  inferred profile, no "close enough" sibling journal's rules.
* **`null` means "the journal does not state this"** and suppresses the check
  entirely. It never means "no limit" and never falls back to another journal's
  number.

Re-verifying a profile means re-reading the URLs recorded here and updating both
the finding and `lastVerified` on the profile.
