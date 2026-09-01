import type { Author, BibEntry } from './model.js';

/**
 * How a reference PDF was found, in the resolution order of DECISIONS 2026-08-14:
 * the BibTeX `file` field first, then the `references/<citekey>.pdf`
 * convention, then an `Author_Year*` fuzzy match. First hit wins.
 */
export type PdfResolutionHow = 'file-field' | 'citekey' | 'fuzzy';

export interface PdfResolution {
  /**
   * Project-relative by default (e.g. `references/gunn1972.pdf`), absolute
   * when `opts.projectRoot` is given or when the `file` field itself held an
   * absolute path (a Zotero storage path, say — those live outside the
   * project and are returned untouched).
   */
  path: string;
  how: PdfResolutionHow;
}

export interface ResolvePdfOptions {
  /**
   * Absolute project root. When given, relative hits are returned joined to it
   * so the result can go straight to `fs:read-binary`; absolute `file` field
   * paths are never rewritten.
   */
  projectRoot?: string;
}

const REFERENCES_DIR = 'references/';

/** ASCII-fold for case/diacritic-insensitive comparison: Jáchym → jachym. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[øØ]/g, 'o')
    .replace(/[đĐ]/g, 'd')
    .replace(/[łŁ]/g, 'l')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[œŒ]/g, 'oe')
    .replace(/ß/g, 'ss')
    .replace(/[\s'’]/g, '')
    .toLowerCase();
}

function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}

/** POSIX `/x`, Windows `C:\x`, or a UNC `\\server\share` path. */
function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

function basenameOf(path: string): string {
  const posix = toPosix(path);
  return posix.slice(posix.lastIndexOf('/') + 1);
}

/** Drop a leading `./` and any accidental leading slash-dot noise. */
function normalizeRelative(path: string): string {
  let out = toPosix(path);
  while (out.startsWith('./')) out = out.slice(2);
  return out;
}

function joinRoot(root: string, relative: string): string {
  const trimmed = root.replace(/[/\\]+$/, '');
  return `${trimmed}/${relative}`;
}

function resolveAgainstRoot(path: string, opts: ResolvePdfOptions | undefined): string {
  if (isAbsolutePath(path)) return path;
  const relative = normalizeRelative(path);
  const root = opts?.projectRoot;
  return root === undefined || root === '' ? relative : joinRoot(root, relative);
}

/** Case-insensitive lookup in the raw field map (`File`, `FILE`, `file`). */
function rawField(entry: BibEntry, name: string): string | undefined {
  const direct = entry.raw[name];
  if (direct !== undefined) return direct;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(entry.raw)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

function stripWrapper(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '{' && last === '}') || (first === '"' && last === '"')) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

/** Split on a delimiter that is not backslash-escaped (Zotero escapes `\;`). */
function splitUnescaped(value: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === '\\' && value[i + 1] === delimiter) {
      current += delimiter;
      i += 1;
      continue;
    }
    if (char === delimiter) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char ?? '';
  }
  parts.push(current);
  return parts;
}

/**
 * The colon-separated fields of one Zotero/JabRef `file` entry, with the two
 * colons that belong to a path stitched back on: Windows drive letters
 * (`C` + `\Users\…`) and URI schemes (`file` + `//…`).
 */
function fileEntryFields(entry: string): string[] {
  const parts = splitUnescaped(entry, ':');
  const merged: string[] = [];
  for (const part of parts) {
    const previous = merged[merged.length - 1];
    const isDriveLetter =
      previous !== undefined &&
      /^[A-Za-z]$/.test(previous) &&
      (part.startsWith('\\') || part.startsWith('/'));
    const isUriScheme =
      previous !== undefined &&
      /^[A-Za-z][A-Za-z0-9+.-]*$/.test(previous) &&
      part.startsWith('//');
    if (isDriveLetter || isUriScheme) {
      merged[merged.length - 1] = `${previous}:${part}`;
      continue;
    }
    merged.push(part);
  }
  return merged;
}

function stripFileUri(path: string): string {
  if (!/^file:\/\//i.test(path)) return path;
  const withoutScheme = path.replace(/^file:\/\/(localhost)?/i, '');
  try {
    return decodeURI(withoutScheme);
  } catch {
    return withoutScheme;
  }
}

/**
 * The first `.pdf` path in a BibTeX `file` field. Handles the plain form
 * (`papers/gunn1972.pdf`), the Zotero/JabRef triple (`:papers/x.pdf:PDF`,
 * `Full Text PDF:/abs/x.pdf:application/pdf`) and `;`-separated multi-entry
 * lists, where a non-PDF attachment may come first.
 */
export function pdfPathFromFileField(value: string): string | null {
  for (const chunk of splitUnescaped(stripWrapper(value), ';')) {
    if (chunk.trim() === '') continue;
    for (const field of fileEntryFields(chunk)) {
      const candidate = stripFileUri(field.trim());
      if (candidate !== '' && /\.pdf$/i.test(candidate)) return candidate;
    }
  }
  return null;
}

function familyName(author: Author | undefined): string | null {
  if (author === undefined) return null;
  const name = author.kind === 'literal' ? author.literal : author.family;
  const cleaned = name.replace(/[{}]/g, '').trim();
  return cleaned === '' ? null : cleaned;
}

function citekeyHit(entry: BibEntry, listing: readonly string[]): string | null {
  const wanted = `${REFERENCES_DIR}${entry.key}.pdf`.toLowerCase();
  for (const item of listing) {
    if (normalizeRelative(item).toLowerCase() === wanted) return item;
  }
  return null;
}

function fuzzyHit(entry: BibEntry, listing: readonly string[]): string | null {
  const family = familyName(entry.authors[0]);
  if (family === null || entry.year === undefined || entry.year === '') return null;
  const prefix = `${fold(family)}_${fold(entry.year)}`;

  const pdfs = listing.filter((item) => /\.pdf$/i.test(item));
  const matches = (item: string): boolean => fold(basenameOf(item)).startsWith(prefix);

  // references/ is the convention (§3), so it wins; anywhere else is a fallback.
  const inReferences = pdfs.find(
    (item) => normalizeRelative(item).toLowerCase().startsWith(REFERENCES_DIR) && matches(item),
  );
  if (inReferences !== undefined) return inReferences;
  return pdfs.find(matches) ?? null;
}

/**
 * Where a reference's PDF lives, in the order of DECISIONS 2026-08-14 — file
 * field, then `references/<citekey>.pdf`, then an `Author_Year*` fuzzy match.
 * Pure: `listing` is the caller's set of project-relative file paths (POSIX
 * separators, e.g. `references/Gunn_1972_Infall.pdf`), and nothing here
 * touches the disk. A `file` field is trusted as written — it is the author's
 * explicit answer — so callers that need certainty should stat the result.
 * Returns null when no rule matches.
 */
export function resolvePdfPath(
  entry: BibEntry,
  listing: readonly string[],
  opts?: ResolvePdfOptions,
): PdfResolution | null {
  const fileField = rawField(entry, 'file');
  if (fileField !== undefined) {
    const fromField = pdfPathFromFileField(fileField);
    if (fromField !== null) {
      return { path: resolveAgainstRoot(fromField, opts), how: 'file-field' };
    }
  }

  const byKey = citekeyHit(entry, listing);
  if (byKey !== null) return { path: resolveAgainstRoot(byKey, opts), how: 'citekey' };

  const byFuzzy = fuzzyHit(entry, listing);
  if (byFuzzy !== null) return { path: resolveAgainstRoot(byFuzzy, opts), how: 'fuzzy' };

  return null;
}
