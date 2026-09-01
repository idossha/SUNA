import { readFile, readdir } from 'node:fs/promises';
import { z } from 'zod';
import {
  REFERENCE_NOTES_DIR,
  ReferenceNotesFileSchema,
  isDetached,
  noteQuote,
  notePage,
  sortNotes,
  type PdfNote,
} from '@suna/core';
import { parseBibtex } from '@suna/bib';
import { resolveInside, type ProjectContext } from './project';

/**
 * MCP-side reading notes: what the user highlighted in each paper, and which
 * paper it was (ARCHITECTURE §14.4).
 *
 * Reads `references/notes/<citekey>.json` straight off disk, the same
 * discipline `mcp/comments.ts` uses for comments.json — the MCP server runs
 * standalone, without Electron, so it cannot borrow the app's main-process
 * service and re-resolves the path itself.
 *
 * The verb exists because a PDF is a fixed artifact whose entire value is
 * extraction. An agent drafting prose can already read the manuscript and the
 * bibliography; what it could not see is the part the researcher actually
 * judged worth keeping, or which paper each judgement belongs to. Every note
 * comes back joined to its bibliography entry for exactly that reason.
 */

export const listReferenceNotesInput = z.object({
  /** Only this paper's notes. Omit for every paper in the project. */
  citekey: z.string().min(1).optional(),
  /** Only notes carrying at least one of these colours. */
  colors: z.array(z.string().min(1)).optional(),
  /** Only notes carrying at least one of these tags. */
  tags: z.array(z.string().min(1)).optional(),
  /** Only notes the reader wrote something on, not bare highlights. */
  withBodyOnly: z.boolean().optional(),
});

/** One paper's bibliography facts, so a note is never floating. */
interface PaperFacts {
  title: string | null;
  authors: string | null;
  year: string | null;
  doi: string | null;
}

async function bibFacts(ctx: ProjectContext): Promise<Map<string, PaperFacts>> {
  const out = new Map<string, PaperFacts>();
  try {
    const path = resolveInside(ctx.root, ctx.dirs.manuscript, 'references.bib');
    const { entries } = parseBibtex(await readFile(path, 'utf8'));
    for (const entry of entries) {
      const names = entry.authors
        .map((a) => (a.kind === 'person' ? a.family : a.literal).trim())
        .filter((n) => n !== '');
      out.set(entry.key, {
        title: entry.title.trim() || null,
        authors:
          names.length === 0
            ? null
            : names.length <= 2
              ? names.join(' & ')
              : `${names[0]} et al.`,
        year: entry.year?.trim() || null,
        doi: entry.doi?.trim() || null,
      });
    }
  } catch {
    // No bibliography yet — notes still answer, just without paper facts.
  }
  return out;
}

/** Every citekey that has a notes file, in a stable order. */
async function citekeysWithNotes(ctx: ProjectContext): Promise<string[]> {
  try {
    const dir = resolveInside(ctx.root, REFERENCE_NOTES_DIR);
    const names = await readdir(dir);
    return names
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -5))
      .sort();
  } catch {
    return [];
  }
}

async function readNotesFor(
  ctx: ProjectContext,
  citekey: string,
): Promise<{ notes: PdfNote[]; pageLabelOffset: number }> {
  try {
    const path = resolveInside(ctx.root, REFERENCE_NOTES_DIR, `${citekey}.json`);
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    const file = ReferenceNotesFileSchema.parse(parsed);
    return {
      notes: sortNotes(file.notes),
      // The paper's printed-page correction. Printing the raw sheet number
      // here gave an agent a different page from the one the app copies, and
      // the agent's is the one that ends up in prose.
      pageLabelOffset: file.source?.pageLabelOffset ?? 0,
    };
  } catch {
    return { notes: [], pageLabelOffset: 0 };
  }
}

function matches(note: PdfNote, input: z.infer<typeof listReferenceNotesInput>): boolean {
  if (input.withBodyOnly === true && note.body.trim() === '') return false;
  if (input.colors !== undefined && !input.colors.includes(note.color)) return false;
  if (input.tags !== undefined && !input.tags.some((tag) => note.tags.includes(tag))) return false;
  return true;
}

/**
 * List reading notes, grouped by paper.
 *
 * Rendered as text rather than JSON, matching the other verbs: an agent reads
 * this to write prose, and a quote it can cite directly is more use than a
 * structure it has to reassemble. The citekey is on every group so a claim can
 * be attributed without a second lookup.
 */
export async function listReferenceNotes(
  ctx: ProjectContext,
  input: z.infer<typeof listReferenceNotesInput>,
): Promise<string> {
  const keys =
    input.citekey === undefined ? await citekeysWithNotes(ctx) : [input.citekey];
  if (keys.length === 0) {
    return 'No reading notes yet. Notes are made by highlighting a reference PDF in the app.';
  }

  const facts = await bibFacts(ctx);
  const lines: string[] = [];
  let total = 0;
  let papers = 0;

  for (const citekey of keys) {
    const { notes: all, pageLabelOffset } = await readNotesFor(ctx, citekey);
    const notes = all.filter((note) => matches(note, input));
    if (notes.length === 0) continue;
    papers += 1;
    total += notes.length;

    const paper = facts.get(citekey);
    const heading =
      paper === undefined
        ? `## [@${citekey}] (not in references.bib)`
        : `## [@${citekey}] ${paper.authors ?? 'unknown author'}${
            paper.year === null ? '' : ` (${paper.year})`
          }`;
    lines.push(heading);
    if (paper?.title != null) lines.push(`   ${paper.title}`);
    if (paper?.doi != null) lines.push(`   doi:${paper.doi}`);
    lines.push('');

    for (const note of notes) {
      const flags: string[] = [note.color];
      if (note.tags.length > 0) flags.push(...note.tags.map((tag) => `#${tag}`));
      if (isDetached(note)) flags.push('detached');
      if (note.ambiguous) flags.push('ambiguous');
      lines.push(`- p. ${notePage(note) + pageLabelOffset} [${flags.join(' ')}]`);
      lines.push(`  > ${noteQuote(note)}`);
      if (note.body.trim() !== '') {
        for (const line of note.body.trim().split('\n')) lines.push(`  ${line}`);
      }
    }
    lines.push('');
  }

  if (total === 0) return 'No reading notes match that filter.';

  const header = `${total} note${total === 1 ? '' : 's'} across ${papers} paper${
    papers === 1 ? '' : 's'
  }. A quote is the passage the reader highlighted; an indented line under it is what they wrote about it. Cite with the [@citekey, p. N] shown.`;
  return [header, '', ...lines].join('\n').trimEnd();
}
