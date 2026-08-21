import { z } from 'zod';
import { VERSION_ID_RE } from './versions';
import type { Manuscript } from './manuscript';

/**
 * What a comparison compares (feature-plan-14 §2).
 *
 * A comparison has two sides, and each side is named by a REFERENCE rather
 * than by a path. The reason is that the three things an author wants to
 * compare are not three files in the same sense:
 *
 *  - `working`  — the manuscript as it is right now, on disk, still being
 *                 typed into. It has no version number yet.
 *  - `version`  — a logged version under `manuscript/archive/vX.Y`,
 *                 read-only by construction.
 *  - `round`    — "what the reviewers of this round read", which resolves to
 *                 a version but is not one: which version that is belongs to
 *                 the round, and asking for it by round id means a reader
 *                 never has to remember that Round 2 read v1.3.
 *
 * The third is the one that makes the peer-review workflow work. A response
 * letter is written against a round, so the comparison it needs is addressed
 * by round, and it keeps pointing at the right text if the author later
 * corrects which version went out.
 */

export const CompareRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('working') }),
  z.object({ kind: z.literal('version'), versionId: z.string().regex(VERSION_ID_RE) }),
  z.object({ kind: z.literal('round'), roundId: z.string().min(1) }),
]);
export type CompareRef = z.infer<typeof CompareRefSchema>;

/** A side offered in the pickers, with everything needed to label it. */
export const CompareSideSchema = z.object({
  ref: CompareRefSchema,
  /** Stable string form of the ref, for React keys and `<select>` values. */
  id: z.string().min(1),
  /** "v1.3", "Working copy", "Round 2 — Nature Astronomy". */
  label: z.string().min(1),
  /** "First submission", "logged 3 Mar 2026", "reviewers read v1.3". */
  sublabel: z.string(),
  /** When this text was frozen; null for the working copy, which is now. */
  at: z.string().nullable(),
  /** True when the side cannot be resolved to any text — a round with no
   *  baseline, a version whose folder was deleted. Offered anyway, greyed,
   *  because hiding it turns a fixable state into a missing feature. */
  unavailable: z.boolean().default(false),
});
export type CompareSide = z.infer<typeof CompareSideSchema>;

/**
 * One titled piece of metadata prose, pulled out of manuscript.json so it can
 * be compared beside the sections of manuscript.md.
 */
export const CompareFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  text: z.string(),
});
export type CompareField = z.infer<typeof CompareFieldSchema>;

/** Everything one side of a comparison contributes. */
export const CompareDocumentSchema = z.object({
  ref: CompareRefSchema,
  label: z.string().min(1),
  sublabel: z.string(),
  at: z.string().nullable(),
  /** manuscript.md, verbatim. Empty when the side could not be read. */
  markdown: z.string(),
  /** Title-page and back-matter prose, in the order a reader meets it. */
  fields: z.array(CompareFieldSchema),
  /** references.bib, verbatim. */
  bibliography: z.string(),
  /** Why this side is empty, when it is. Null on a side that read fine. */
  problem: z.string().nullable(),
});
export type CompareDocument = z.infer<typeof CompareDocumentSchema>;

/** The ref, as one string — `<select>` values and panel ids need one. */
export function compareRefId(ref: CompareRef): string {
  if (ref.kind === 'working') return 'working';
  if (ref.kind === 'version') return `version:${ref.versionId}`;
  return `round:${ref.roundId}`;
}

/** The inverse, for a `<select>` handing back what it was given. */
export function parseCompareRefId(id: string): CompareRef | null {
  if (id === 'working') return { kind: 'working' };
  const [kind, rest] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  if (kind === 'version' && VERSION_ID_RE.test(rest)) return { kind: 'version', versionId: rest };
  if (kind === 'round' && rest !== '') return { kind: 'round', roundId: rest };
  return null;
}

/**
 * The manuscript.json prose a reviewer actually reads, in reading order.
 *
 * Kept here rather than in the comparison view because it is a statement
 * about the document model — "these are the fields that are prose" — and
 * because the same list should drive any other surface that wants to show
 * metadata as text. Numbering, ids and file paths are deliberately absent:
 * they are derived or internal, and a diff of them is noise.
 *
 * Figure and table captions are included. They live in manuscript.json rather
 * than in the prose file, and "the caption of Figure 2 still does not say
 * what the shaded band is" is one of the most common review points there is —
 * a comparison that dropped them would be silent about a change the author
 * made specifically because a reviewer asked for it.
 */
export function manuscriptCompareFields(manuscript: Manuscript): CompareField[] {
  const fields: CompareField[] = [
    { id: 'title', label: 'Title', text: manuscript.title },
    { id: 'abstract', label: 'Abstract', text: manuscript.abstract.content },
  ];
  const keywords = manuscript.keywords ?? [];
  if (keywords.length > 0) {
    fields.push({ id: 'keywords', label: 'Keywords', text: keywords.join(', ') });
  }
  if (manuscript.significance != null) {
    fields.push({ id: 'significance', label: 'Significance', text: manuscript.significance });
  }
  const highlights = manuscript.highlights ?? [];
  if (highlights.length > 0) {
    fields.push({ id: 'highlights', label: 'Highlights', text: highlights.join('\n') });
  }
  for (const figure of manuscript.figures) {
    fields.push({
      id: `figure:${figure.id}`,
      label: `Figure caption — ${figure.id}`,
      text: captionText(figure.caption),
    });
  }
  for (const table of manuscript.tables) {
    fields.push({
      id: `table:${table.id}`,
      label: `Table caption — ${table.id}`,
      text: [table.caption.title, table.caption.body ?? ''].filter((s) => s !== '').join('\n'),
    });
  }
  fields.push(
    { id: 'data', label: 'Data availability', text: manuscript.availability.data },
    { id: 'code', label: 'Code availability', text: manuscript.availability.code },
  );
  const back = manuscript.backMatter;
  if (back.acknowledgements != null) {
    fields.push({ id: 'acknowledgements', label: 'Acknowledgements', text: back.acknowledgements });
  }
  if (back.authorContributions != null) {
    fields.push({
      id: 'contributions',
      label: 'Author contributions',
      text: back.authorContributions,
    });
  }
  if (back.competingInterests != null) {
    fields.push({
      id: 'competing',
      label: 'Competing interests',
      text: back.competingInterests,
    });
  }
  if (back.funding.length > 0) {
    fields.push({
      id: 'funding',
      label: 'Funding',
      text: back.funding.map((f) => (f.grant === null ? f.funder : `${f.funder} — ${f.grant}`)).join('\n'),
    });
  }
  return fields;
}

/** A caption as one string: its title, then its body if it has one. */
function captionText(caption: { title: string; body?: string | null }): string {
  const body = caption.body ?? '';
  return body === '' ? caption.title : `${caption.title}\n${body}`;
}

/**
 * Pair two sides' field lists by id, so a field present on only one side is
 * still compared — against the empty string, which is what "added in this
 * revision" means.
 */
export function pairCompareFields(
  base: readonly CompareField[],
  head: readonly CompareField[],
): { id: string; label: string; base: string; head: string }[] {
  const byId = new Map<string, { id: string; label: string; base: string; head: string }>();
  for (const f of base) byId.set(f.id, { id: f.id, label: f.label, base: f.text, head: '' });
  for (const f of head) {
    const existing = byId.get(f.id);
    if (existing === undefined) byId.set(f.id, { id: f.id, label: f.label, base: '', head: f.text });
    else {
      existing.head = f.text;
      // The head's label wins: a renamed figure keeps the name it has now.
      existing.label = f.label;
    }
  }
  // Head order first (the document as it stands), then anything only the base
  // had, so a removed caption is reported at the end rather than lost.
  const order = [...head.map((f) => f.id), ...base.map((f) => f.id)];
  const seen = new Set<string>();
  const out: { id: string; label: string; base: string; head: string }[] = [];
  for (const id of order) {
    if (seen.has(id)) continue;
    seen.add(id);
    const entry = byId.get(id);
    if (entry !== undefined) out.push(entry);
  }
  return out;
}
