# LETTERS.md — cover letters and letters to the editor

A SUNA project holds more than a manuscript. A cover letter lives at
`manuscript/letters/<id>.md` with a sidecar `manuscript/letters/<id>.json`, and it is
listed in `suna.json`'s `documents` registry. Because it sits under `manuscript/` it
gets the same comment threads, the same three-way merge and the same reviewable-diff
treatment as the prose.

## The one rule that matters

**You draft the argument. The author signs the affidavit.**

A cover letter makes factual claims to an editor over a named person's signature: that
the work is not under consideration elsewhere, that there are no competing interests,
that a clinician colleague read the draft, that the data are in a particular repository.
Getting one of those wrong is not a typo — it is a false statement in a submission.

So the claims are not prose. They live in the sidecar as structured **assertions**, they
are answered by a person in the app's Assertions panel, and **there is no MCP verb that
writes one.** In the prose they appear as a marker and a directive:

```
⟦ unanswered — competingInterests ⟧ ::assert{competingInterests}
```

Leave every one of those exactly where it is. Do not fill them in, do not reword them,
do not delete them, do not move them, and do not "helpfully" write the sentence they
stand for. An unanswered marker blocks export, which is the point: it is a visible hole
that only the author can close.

If you can see that an assertion is unanswered and you think you know the answer, say so
in your reply to the user. Do not write it into the letter.

## What a cover letter is

It is not a summary of the paper — the editor has the abstract. It is an argument that
the paper is worth sending to referees. Three moves, in order:

1. **The gap and the claim.** What the field could not do or did not know, then what
   this paper establishes. Name the actual result, with the paper's own numbers.
2. **The evidence and its limits.** How the claim is supported and where it is bounded.
   Naming the limit honestly reads as competence; omitting it reads as marketing.
3. **Why this venue.** What this journal's readership specifically can do with it. A
   sentence that would fit any journal is worse than no sentence.

250–400 words. Plain declarative prose. No "paradigm shift", no "unprecedented", no
"we are excited to", no "paves the way".

Every number and comparison must come from the manuscript. If it is not in the paper it
does not go in the letter — an invented statistic in a cover letter is the worst failure
mode this document exists to prevent.

## Read the paper first

Before drafting: `read_manuscript_meta` (title, abstract, significance), `list_outline`
(where the weight sits), `read_manuscript` (the Results and Discussion properly), and
`context/PROJECT.md` if it exists. Then `read_letter` to see what the venue requires and
what is still unanswered.

## The verbs

| verb | what it does |
| --- | --- |
| `list_documents` | every document in the project, with kind, file and profile |
| `read_document` | any document's prose by registry id |
| `write_document` | overwrite a document's prose by registry id |
| `read_letter` | the sidecar: venue, what it covers, which assertions are UNANSWERED |
| `check_letter` | the letter against the venue's stated requirements |

`check_letter` findings split in two. Fix what is yours — naming the wrong journal in
the prose, a claim the manuscript does not support. Report what is the author's — a
missing assertion, an unnamed data repository — and leave it.

## Venues differ, and silence is not permission

Each journal's stated requirements come from its own author guidelines and are carried
in the profile. Some require a statement of significance; some ask that the letter not
repeat the abstract; some do not request a cover letter at all. Where SUNA has
researched nothing for a venue it says so, and that is **not** the same as the venue
requiring nothing — do not infer a rule that no source states.

Where a requirement's wording was captured from a search index rather than read from the
journal's own page, SUNA marks it. Treat those as real but unverified, and do not quote
them back to the user as though they were read from the source.
