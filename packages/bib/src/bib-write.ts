import type { LitResult } from '@suna/core';
import { generateCiteKey, litResultToBibEntry } from './lit-entry.js';
import { parseBibtex } from './parse.js';
import { serializeEntry } from './serialize.js';
import type { BibEntry } from './model.js';

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
}

function appendEntryText(original: string, entryText: string): string {
  const trimmed = original.trimEnd();
  return trimmed === '' ? `${entryText}\n` : `${trimmed}\n\n${entryText}\n`;
}

export function appendLitResultToBib(bibText: string, result: LitResult): AppendLitResultOutcome {
  const parsed = parseBibtex(bibText);
  const existingKeys = parsed.entries.map((e) => e.key);
  const entry = litResultToBibEntry(result);
  entry.key = generateCiteKey(result, existingKeys);
  return {
    text: appendEntryText(bibText, serializeEntry(entry)),
    key: entry.key,
    entry,
    parseErrors: parsed.errors.map((e) => e.message),
  };
}
