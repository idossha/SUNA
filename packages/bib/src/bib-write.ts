import type { LitResult } from '@suna/core';
import { generateCiteKey, litResultToBibEntry } from './lit-entry.js';
import { parseBibtex } from './parse.js';
import { serializeEntry } from './serialize.js';
import { detectArxivId, type BibEntry } from './model.js';

/**
 * Pure text transform for "add this literature hit to references.bib": no
 * IO here, so it's testable without a running app and — because both hosts
 * import the SAME function — the desktop UI's "Add to references.bib" button
 * (apps/desktop's Search tab) and the MCP `add_reference` tool produce byte-
 * identical output for the same input. Callers own IO: re-read the file
 * fresh immediately before calling this, then write the returned `text`
 * straight back (never a stale in-memory copy).
 *
 * The new entry's cite key is deduped against every key already in the file
 * (well-formed entries only). This only APPENDS serialized text for the new
 * entry — it never re-serializes entries it didn't add, so anything the
 * parser couldn't understand is surfaced via `parseErrors` but never
 * rewritten or dropped.
 */
export interface AppendLitResultOutcome {
  /** The full new file content to write. */
  text: string
  /** The cite key assigned to the new entry (post-dedupe). */
  key: string
  entry: BibEntry
  /** Non-fatal: entries already in the file that failed to parse (still present in `text` untouched). */
  parseErrors: readonly string[]
  /**
   * Exactly the `file` field written into the new entry, or null when none
   * was — the 2-argument call, or an `opts.filePath` that was blank. Always
   * present and explicitly null rather than omitted, so the caller reporting
   * the acquisition outcome (ARCHITECTURE §15.2, `cite_study`) can say
   * whether the entry points at a PDF without re-parsing its own output.
   */
  fileField: string | null
}

export interface AppendLitResultOptions {
  /**
   * Where the PDF backing this reference lives, project-relative with POSIX
   * separators — `references/gunn1972.pdf`, the destination
   * `importPdfIntoProject`/`savePdfBytes` write to (ARCHITECTURE §15.5).
   * It is written verbatim as the entry's `file` field so `resolvePdfPath`'s
   * `file-field` rule answers immediately, with no directory listing and no
   * rescan. Must end in `.pdf`: that rule accepts nothing else, so a path
   * without the extension would be written faithfully and then never found.
   */
  filePath?: string
}

function appendEntryText(original: string, entryText: string): string {
  const trimmed = original.trimEnd();
  return trimmed === '' ? `${entryText}\n` : `${trimmed}\n\n${entryText}\n`;
}

/**
 * The `file` field value to write, or null when there is nothing to say.
 *
 * `resolvePdfPath`'s `file-field` rule reads a `;`-separated attachment list
 * and treats a backslash-escaped `\;` as a literal semicolon (Zotero's
 * convention — see `splitUnescaped` in pdf.ts), so a path containing one is
 * escaped on the way out or it would come back as two truncated paths. A
 * blank path writes NO field at all: `file = {}` is not a fact about where
 * the PDF is, it is noise the resolver has to step over.
 */
function fileFieldValue(filePath: string | undefined): string | null {
  if (filePath === undefined) return null;
  const trimmed = filePath.trim();
  return trimmed === '' ? null : trimmed.replace(/;/g, '\\;');
}

/**
 * Append `result` as a new entry. With `opts.filePath` the entry also carries
 * a `file` field pointing at its PDF; without it — the original 2-argument
 * call — the output is byte-for-byte what it has always been, which the tests
 * pin against a golden string.
 */
export function appendLitResultToBib(
  bibText: string,
  result: LitResult,
  opts?: AppendLitResultOptions,
): AppendLitResultOutcome {
  const parsed = parseBibtex(bibText);
  const existingKeys = parsed.entries.map((e) => e.key);
  const entry = litResultToBibEntry(result);
  entry.key = generateCiteKey(result, existingKeys);
  const fileField = fileFieldValue(opts?.filePath);
  if (fileField !== null) entry.raw['file'] = fileField;
  return {
    text: appendEntryText(bibText, serializeEntry(entry)),
    key: entry.key,
    entry,
    parseErrors: parsed.errors.map((e) => e.message),
    fileField,
  };
}

/**
 * A DOI is case-insensitive by definition (ISO 26324) and reaches us in three
 * shapes — bare, `doi:`-prefixed, and as a doi.org URL — so all three fold to
 * the same string before comparison. parse.ts already strips the URL prefix
 * off entries it read; results come straight from a provider and have not
 * been through that.
 */
function normalizeDoi(doi: string): string {
  return doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .toLowerCase();
}

/** `arXiv:2401.00001v2`, `2401.00001v2` and `2401.00001` are one paper. */
function normalizeArxivId(id: string): string {
  return id
    .trim()
    .replace(/^arxiv:/i, '')
    .replace(/v\d+$/i, '')
    .toLowerCase();
}

function stripArxivPrefix(id: string): string {
  return id.startsWith('arXiv:') ? id.slice('arXiv:'.length) : id;
}

/**
 * The result's arXiv id, derived exactly as `litResultToBibEntry` derives the
 * one it would WRITE — same `detectArxivId` call, same inputs — so a work can
 * never fail to match the entry a previous append made from it.
 */
function arxivIdOfResult(result: LitResult): string | null {
  const id = detectArxivId({
    eprint: result.source === 'arxiv' ? stripArxivPrefix(result.id) : undefined,
    url: result.openAccessUrl ?? undefined,
    doi: result.doi ?? undefined,
  });
  return id === undefined ? null : normalizeArxivId(id);
}

/**
 * Letters and digits only, diacritics folded: `Self-Similar Collapse!` and
 * `{Self similar collapse}` are the same title. Deliberately lossy — this is
 * the last-resort rule, used only once the identifiers have both come up
 * empty.
 */
function foldTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

/**
 * The cite key `references.bib` ALREADY uses for this work, or null when the
 * file has no entry for it. ARCHITECTURE §9: `cite_study` asks this
 * before appending, so a reference the bibliography already carries is reused
 * rather than duplicated under a second key.
 *
 * Three rules, strongest identifier first, each swept across the whole file
 * before the next is tried:
 *
 *   1. normalized DOI — the one identifier both sides can be trusted on;
 *   2. arXiv id, version suffix dropped — catches the preprint of a work
 *      whose published DOI the file does not have (and vice versa);
 *   3. folded title — the hand-typed entry with no identifiers at all, where
 *      only casing, punctuation or brace noise differs.
 *
 * There is deliberately no author+year fallback: two papers by the same group
 * in the same year are ordinary, and a false "already there" would silently
 * swallow the citation the user asked for. When in doubt this returns null
 * and the caller appends — a duplicate is visible and fixable, a dropped
 * citation is neither.
 *
 * Entries the parser could not read are invisible here; running the same text
 * through `appendLitResultToBib` reports them in `parseErrors`, so a
 * malformed file is never silently treated as an empty one.
 */
export function findExistingKey(bibText: string, result: LitResult): string | null {
  const entries = parseBibtex(bibText).entries;

  const doi = result.doi === null ? null : normalizeDoi(result.doi);
  if (doi !== null && doi !== '') {
    const hit = entries.find((e) => e.doi !== undefined && normalizeDoi(e.doi) === doi);
    if (hit !== undefined) return hit.key;
  }

  const arxivId = arxivIdOfResult(result);
  if (arxivId !== null && arxivId !== '') {
    const hit = entries.find((e) => {
      if (e.arxivId === undefined) return false;
      return normalizeArxivId(e.arxivId) === arxivId;
    });
    if (hit !== undefined) return hit.key;
  }

  const title = foldTitle(result.title);
  if (title !== '') {
    const hit = entries.find((e) => foldTitle(e.title) === title);
    if (hit !== undefined) return hit.key;
  }

  return null;
}

export interface RemoveEntryOutcome {
  /** The full new file content to write. */
  text: string;
  /** False when the file had no entry under that key — `text` is then the input, unchanged. */
  removed: boolean;
  /**
   * The removed entry's raw `file` field, or null when it had none. The caller
   * deleting the PDF needs it: an entry whose PDF lives outside the
   * conventional `references/<key>.pdf` says so only here.
   */
  fileField: string | null;
}

/**
 * The offsets of the `@type{key, ... }` block for `key`, or null. Text-level
 * on purpose: like `appendLitResultToBib` this must not re-serialize the
 * entries it isn't touching, so it finds the one block's bounds and cuts
 * exactly that, leaving every other byte — including entries the parser could
 * not read — as it was.
 */
function entrySpan(bibText: string, key: string): { start: number; end: number } | null {
  const header = /@[A-Za-z]+[ \t\r\n]*([{(])/g;
  let match: RegExpExecArray | null;
  while ((match = header.exec(bibText)) !== null) {
    const open = match[1] === '{' ? '{' : '(';
    const close = open === '{' ? '}' : ')';
    const bodyStart = match.index + match[0].length;
    // The cite key runs to the first comma (or, for a key-only entry, to the
    // closing delimiter).
    const comma = bibText.indexOf(',', bodyStart);
    const keyEnd = comma === -1 ? bibText.length : comma;
    if (bibText.slice(bodyStart, keyEnd).trim() !== key) continue;

    let depth = 0;
    for (let i = bodyStart - 1; i < bibText.length; i += 1) {
      const ch = bibText[i];
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) return { start: match.index, end: i + 1 };
      }
    }
    // Unterminated entry: cut to end of file rather than leaving a fragment.
    return { start: match.index, end: bibText.length };
  }
  return null;
}

/**
 * Remove the entry under `key`. Pure text transform — the caller owns IO and
 * should re-read the file immediately before calling, then write `text` back.
 *
 * Only the matched block is cut; the surrounding text is rejoined with one
 * blank line so the file keeps the shape `appendLitResultToBib` writes.
 */
export function removeEntryFromBib(bibText: string, key: string): RemoveEntryOutcome {
  const span = entrySpan(bibText, key);
  if (span === null) return { text: bibText, removed: false, fileField: null };

  const entry = parseBibtex(bibText).entries.find((e) => e.key === key);
  const rawFile = entry?.raw['file'];
  const before = bibText.slice(0, span.start).replace(/[ \t]*\n?\s*$/, '');
  const after = bibText.slice(span.end).replace(/^\s*/, '');
  const joined = before === '' ? after : after === '' ? before : `${before}\n\n${after}`;
  return {
    text: joined === '' ? '' : `${joined.trimEnd()}\n`,
    removed: true,
    fileField: rawFile === undefined || rawFile.trim() === '' ? null : rawFile,
  };
}
