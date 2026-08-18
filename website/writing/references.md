# References and citations

The whole citation loop: a plain BibTeX file you can hand-edit, a picker that inserts `[@key]`, a References view that tells you what is cited and what is not, and numbering that is derived at format time from your journal profile.

## references.bib is the source of truth

A project's bibliography is an ordinary BibTeX file at `manuscript/references.bib`. The References view reads that file directly. If it is missing, the view says "No manuscript/references.bib in this project."; if it exists but is empty, the Library tab tells you to use the Search tab.

Nothing else owns that file. Adding a reference appends the serialized text for the new entry and never re-serializes what is already there, so hand-written entries, comments and anything the parser could not read survive untouched. If some entries fail to parse, the Library tab reports "N entries could not be parsed." and still lists the ones it could read.

The one exception is a `.docx` import, which creates `references.bib` from the imported document's reference list. That is the only place SUNA writes a whole bib file.

## Citing in prose

Citations are typed inline in SciMark. Press <kbd>⌘⇧K</kbd> — or right-click and choose **Insert citation…** — to open a picker next to the cursor. Type to filter, <kbd>↑</kbd>/<kbd>↓</kbd> to move, <kbd>Enter</kbd> or a click to insert, <kbd>Escape</kbd> to close. Filtering is a case-insensitive substring match over cite key, title, year and author names, and each row shows `@key` plus the entry's title. It works in the plain code editor and in the combined Manuscript tab.

The picker reads the bibliography named by `manuscript.json`'s `bibliography` field, defaulting to `references.bib`.

| You type | You get |
| --- | --- |
| `[@gunn1972infall]` | a parenthetical citation |
| `[@gunn1972infall; @wang2025]` | two keys in one cluster |
| `@gunn1972infall` | a narrative citation |

Trailing sentence punctuation is dropped from a narrative key, and things that merely contain an `@` — `word@key2020`, `author@example.edu` — are not treated as citations. `@fig:`, `@tbl:`, `@eq:` and `@sec:` are [cross-references](/writing/scimark), not citations; an unrecognised prefix such as `@data:release` *is* parsed as a citation with the key `data:release`.

In the combined Manuscript tab each `[@key]` cluster renders as a live chip showing the resolved citation — `1,3–5` or `(Gunn & Gott 1972)`. A freshly typed key keeps its raw label until the next recompute, because the numbering recomputes when the project saves, not on every keystroke.

## The References view

Activate **References** in the activity bar. The panel has two tabs, **Library** and **Search**.

<figure class="shot">
  <img src="/shots/references.webp" alt="The References sidebar showing the Library and Search tabs, a filter box, All / Cited / Uncited chips with counts, a list of bibliography entries with per-row actions, and below it a RENDERED AS row of journal chips with an in-text citation preview." />
  <figcaption>The Library tab lists everything in references.bib. Selecting an entry reveals the "Rendered as" journal chips and a live preview of how that citation and its reference-list line will look.</figcaption>
</figure>

The Library tab lists every entry in the file. Above the list is a filter box ("Filter N references…") matching case-insensitively on cite key, title, year, journal and author names, and three chips with live counts:

| Chip | Shows |
| --- | --- |
| **All** | every entry in `references.bib` |
| **Cited** | entries whose key appears in the manuscript prose |
| **Uncited** | entries cited nowhere |

"Cited" is computed against the prose file named by `manuscript.json`'s `manuscriptFile` (default `manuscript.md`), and it refreshes on save rather than on every keystroke. An uncited entry also carries a dot marker whose tooltip reads "Not cited in the manuscript".

The reverse problem gets a banner: keys cited in the prose with no matching bib entry are listed as "N citations have no bib entry: …". That is the one to fix before an export.

Each row has a `[@]` button that copies `[@key]` to the clipboard, so you can paste a citation without leaving the panel. With an entry selected, **Find similar** in the preview header seeds the Search tab — by DOI when the entry has one, falling back to a title search.

## Searching the literature

The Search tab offers five providers. OpenAlex is selected by default. A search runs when you press <kbd>Enter</kbd> in the query box or click **Search**.

| Provider | Badge | Notes |
| --- | --- | --- |
| **AI search** | uses your Claude/Codex subscription · ~30–60s | Runs an installed Claude Code or Codex CLI as a child process with the project directory as its cwd. Requires an open project. |
| **Crossref** | free, no key | "Keyless. Add an email in Settings for the polite pool." |
| **OpenAlex** | metered | "Metered — without budget or a key it answers HTTP 429." |
| **bioRxiv / medRxiv** | free, preprints | "Keyless. Preprints only, searched through Crossref." |
| **arXiv** | free, best-effort | "Keyless, best-effort: the Atom feed can come back empty." |

Those are all of them. There is no Google Scholar, Semantic Scholar or PubMed provider.

The HTTP providers are asked for 20 results per search. AI search is asked for 8, because it works result by result under a hard 180-second budget; it streams its progress and shows a **Cancel** button while it runs. When both CLIs are installed, the **AI CLI preference** select in [Settings](/guide/settings) decides which one is used, and its hint reports which CLIs were found on your PATH. Detecting a CLI enables the option but does not make it the default.

When a provider fails, the panel shows the error together with a concrete next step ("Try Crossref instead — no key needed.") rather than an empty list.

Two settings are worth a minute. **Contact email** under "Literature providers" is sent to Crossref and OpenAlex as a polite-pool contact — their preferred practice, not a login — and falls back to your `user.email` setting. Of the four HTTP providers only OpenAlex has an API-key field; keys are encrypted with Electron's `safeStorage` and stored as ciphertext.

Each result card shows the title, an **OA** chip when an open-access URL exists, the authors, and a faint "year · venue · cited by" line, with three actions: **Add to references.bib**, **Copy DOI** and **Open**. Adding writes the entry to `manuscript/references.bib` (creating the file if needed), the button changes to **Added**, and the status bar confirms "Added &lt;key&gt; to references.bib".

Cite keys are generated as `<firstauthorfamily><year><firstsignificantword>` — `gunn1972infall` — ASCII-folded, with `anon` for a missing author and `nd` for a missing year. Collisions get `a`, `b`, `c` suffixes.

## Adding an entry by DOI

If you already have a DOI, the reliable path is the agent. The MCP verb `add_reference` takes a DOI (and an optional provider) and echoes back the cite key it generated, so the documented agent workflow is `search_literature` or `lookup_doi` → `add_reference` → insert `[@key]` with `edit_manuscript`. It calls exactly the same code as the app's **Add to references.bib** button, so both produce byte-identical entries. See [MCP verbs](/ai/mcp).

::: warning Not built yet
There is no dedicated "add by DOI" or "add by arXiv id" field in the desktop UI. The Search box sends your text to the selected provider's search endpoint with no DOI detection, so pasting a DOI there may or may not return the right work depending on the provider. Use the agent, or add the entry by hand.
:::

## PDFs

A row shows a **PDF** badge when a PDF resolves for that entry, and the tooltip names how it was found. Resolution is tried in this order, first hit wins:

| Order | Source | Tooltip |
| --- | --- | --- |
| 1 | the entry's BibTeX `file` field (Zotero/JabRef triples, `file://` URIs and `;`-separated lists included) | PDF via BibTeX file field |
| 2 | `references/<citekey>.pdf` in the project | PDF via references/&lt;citekey&gt;.pdf |
| 3 | a fuzzy `Author_Year*` filename match, preferring a hit inside `references/` | PDF via Author_Year* match |

**Attach PDF…** on a row without one opens a `.pdf`-only file picker and *copies* the chosen file to `<project>/references/<key>.pdf`. Your original is never moved. With **Auto-open reference PDF** on — a Settings checkbox under "References", on by default — selecting an entry opens its PDF in the side group, replacing whatever PDF was there instead of stacking tabs.

### Find PDF

**Find PDF** on a row without one runs an acquisition ladder and stops at the first rung that works:

1. **Already there.** A copy at `references/<citekey>.pdf` is used as-is.
2. **On this machine.** The folders named in **Reference library** — `~/Downloads`, `~/Documents`, `~/Zotero/storage` and `~/Papers` by default — are searched read-only, with Spotlight (`mdfind`) asked first on macOS. A confident match is *copied* into `references/<citekey>.pdf`; your original file is never moved or touched.
3. **Downloaded.** If nothing local matches and your download policy allows it, SUNA fetches the open-access PDF — arXiv, bioRxiv, an open-access URL, or Unpaywall's best location — and at the widest setting will also try the publisher's page.

The three download policies are **off**, **open access** and **open access + publisher**; the default reaches publisher pages. Set them, and the folders to search, under [Reference library in Settings](/guide/settings). That configuration lives in `~/SunaConfig/library.json` rather than the app's own settings, because your agent's MCP server has to search exactly the same folders.

A local match whose evidence is too weak to take unasked is reported as a candidate rather than copied, so a wrongly-named file in your Downloads never silently becomes a citation's PDF. Reads leave the project; writes never do — the only thing SUNA ever writes is `references/<citekey>.pdf` inside a project you have opened.

The same ladder is available to an agent as the [`fetch_pdf` and `cite_study` verbs](/ai/mcp).

::: warning Newly built
PDF acquisition is the most recent work in SUNA. Its local scan and download ladder pass their unit tests but have not been exercised end to end in the running app under automation. Check what lands in `references/` before you rely on it.
:::

## Numbering and journal style

Reference numbers are never stored. They are assigned at format time, in the first-appearance order of citation clusters in the prose, and the in-text style comes from the [journal profile](/publishing/profiles). Select an entry and a **Rendered as** row of profile chips appears, with a live preview in two blocks: "In text — &lt;mode&gt;" showing the sample sentence "…as shown in earlier work" with the citation attached, and "Reference list" showing the formatted entry, plus a hint naming the journal and its et al. threshold.

That choice is shared with the combined Manuscript tab, so switching it here also switches the manuscript body. It is a machine-local view preference, remembered per project folder and never written back to `suna.json` — which is why it does not travel with the repository. The setting that does travel is **Preview / render profile** in [Settings](/guide/settings).

What actually varies by journal:

| Aspect | Behaviour |
| --- | --- |
| In-text mode | `numeric-superscript` (Nature, Neuron), `parenthetical-numeric` (Science, PNAS, SLEEP, SLEEP Advances, Brain Stimulation, J. Neural Eng.), `author-year` (J. Neurosci., and the `suna` house style) |
| Range collapsing | three or more consecutive numbers collapse to `3–5` where the profile sets it; the two author-year profiles do not |
| Author truncation | Nature 1 author past 5, SLEEP 3 past 6, J. Neurosci. and Brain Stimulation 6 past 6, Neuron 10 past 10, J. Neural Eng. 1 past 10, the house style 19 past 20, Science never (every author listed) |
| List order | appearance order under the numeric profiles, alphabetical by first author under the author-year ones; rows are numbered only when the mode is not author-year |

Entries render in four shapes — article, chapter, preprint ("Preprint at …") and software/dataset — with the journal in italics, the volume in bold, and the title linked to `https://doi.org/<doi>` when a DOI exists. The same formatter code runs in the app and in the DOCX and HTML/PDF [exports](/publishing/export), so what you preview is what you get.

::: info Two lists, two numberings
The References sidebar numbers every entry in `references.bib` in file order. The combined Manuscript tab and the exporters number only the *cited* keys, in first-appearance order. Under a numeric profile the sidebar's "3." and the manuscript's "3." routinely refer to different papers — the manuscript's is the one that ships.
:::

::: warning Journal styling is partial
The in-text mode, range collapsing, author truncation and list order follow the profile. The punctuation and field order of each reference-list line do not — every profile currently renders through the same four entry shapes. Journal names are never abbreviated. If your target journal demands its exact entry punctuation, plan on a pass in the exported file.
:::

::: warning Export uses its own profile
The Export dialog picks its own journal profile, defaulting to the project's active profile from `suna.json` — not the "Rendered as" chip you set in the References view. If you have been previewing in one style, select the same one in the dialog.
:::

One compliance check covers references today: `ms.max-references` fires when the manuscript cites more works than the article type's limit, reporting "Manuscript cites N references, over the limit of M". The other citation checks described in the design documents are not implemented. See [compliance](/publishing/compliance).

## Editing an entry

`references.bib` is a text file and the Explorer opens it in the code editor. That is how you edit an entry.

<figure class="shot">
  <img src="/shots/bib-source.webp" alt="references.bib open in the SUNA code editor, showing BibTeX entries with syntax highlighting — entry type, cite key, and author, title, journal, year and doi fields." />
  <figcaption>The bibliography is plain BibTeX, hand-editable and diffable in git like everything else in the project.</figcaption>
</figure>

::: warning Not built yet
There is no in-app form for editing a BibTeX entry: no field editor, and no rename, delete or merge action in the References view. Fix a wrong author list or a mangled title by opening `references.bib` and editing the text.
:::

If you keep your library in Zotero, export the entries you need to `manuscript/references.bib` and let SUNA read them there — including the `file` field, which SUNA follows straight to your PDF.
