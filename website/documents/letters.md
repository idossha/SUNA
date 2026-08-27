# Cover letters

A paper is not the only document a submission needs. SUNA treats a cover letter as a document in its own right — listed beside the manuscript, written with the same editor, checked against the same journal profile, and exported through the same page.

## Where a letter lives

`manuscript/letters/<id>.md` is the letter. It sits **under `manuscript/`** deliberately: everything the manuscript surface already does — the comment gutter, <kbd>⌘⇧M</kbd>, three-way merge, the AI review bar, version history — applies to a letter on the day you create it, because it is in the folder those features watch.

A sidecar at `manuscript/letters/<id>.json` records what the letter is *about*: its kind, the venue it addresses, and structured facts like where the data lives or whether the work was submitted elsewhere first.

| Kind | When |
| --- | --- |
| `submission` | the first letter, with a new manuscript |
| `revision` | accompanying a revised version |
| `appeal` | contesting a decision |
| `presubmission-enquiry` | asking an editor whether they want to see it at all |

## Writing one

New letters come from the **+** button at the top of the Writing sidebar. Pick a kind and a venue, and SUNA seeds a letter addressed to that journal, with its stated requirements shown beside the form.

<figure class="shot">
  <img src="/shots/letter.webp" alt="A cover letter open in SUNA: the Writing sidebar lists Manuscript, Supplementary information, Letters and Peer review, with Cover letter selected; the letter renders in reading mode with Source, Reading and Pages toggles and an Export button above it." />
  <figcaption>A letter gets the manuscript's instrument minus the title page: Source, Reading and Pages views, the comment rail, and Export.</figcaption>
</figure>

The tab carries the same three views as the manuscript — **Source**, **Reading**, **Pages** — so you can check where the page breaks before you send it.

::: info Assertions were retired
Earlier versions asked you to answer each venue-required claim (`::assert{competingInterests}`) in a structured sidecar, and blocked export until you had. That gate is gone: a letter is plain prose. Letters written under the old scheme still open — legacy `::assert{}` directives and `⟦ unanswered ⟧` markers are stripped at export, with any answer you gave substituted where its directive stood, so nothing you authored is lost.
:::

## What the checker can and cannot say

Journal profiles record what a venue asks a cover letter to contain — Science enumerates nine required items, Cell four required plus three optional, Nature calls the letter optional but names it the confidential channel to the editor. SUNA reports those, and they are **advisory**: a letter always exports.

The distinction the checker holds to is worth stating plainly:

- **Structured facts it has, it checks.** The corresponding contact against `authors.json`, prior-submission history and data locations from the sidecar, and the journal names in your prose against the venue you are actually targeting — the wrong-journal check that catches a letter still addressed to the last one.
- **Prose claims it surfaces, never verifies.** Every venue-required claim appears as `letter.requirement-unverified` — a warning you clear by reading. Deciding from free text whether "we declare no competing interests" is really there would mean SUNA deciding whether you have a competing interest, and it will not do that.

Requirements a venue marks optional, discouraged, or handled in the submission form instead are shown in the export page's panel rather than raised as findings.

## Export

**Export** opens the unified [export page](/publishing/export), with the letter preselected. Letters land in `output/letters/`, beside — not among — the manuscript's exports, in DOCX, PDF or HTML.

## AI and the affidavit

The ✦ button drafts the *argument*: why this result matters, why it belongs in this journal rather than a more specialist one. That is the part of a letter that is writing.

It will not write the claims. A cover letter makes factual assertions on your behalf — that the work is not under consideration elsewhere, that a named colleague has read the draft, that there are no competing interests — and an agent asserting those on your signature is not a feature. **The AI drafts the argument; the human signs the affidavit.**

See [Directed AI actions](/ai/directed) for how the drafting run works and what it is allowed to touch.
