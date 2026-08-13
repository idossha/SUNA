import {
  parse as parseUpstream,
  type Bibliography,
  type Creator,
  type Entry,
  type FieldValue,
} from '@retorquere/bibtex-parser';
import { detectArxivId, type Author, type BibEntry } from './model.js';

export interface ParseIssue {
  message: string;
  input?: string;
}

export interface ParseResult {
  entries: BibEntry[];
  errors: ParseIssue[];
}

function asString(value: FieldValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value.normalize('NFC');
  if (value.every((item): item is string => typeof item === 'string')) {
    return value.join(' and ').normalize('NFC');
  }
  return undefined;
}

function asCreators(value: FieldValue | undefined): Creator[] | undefined {
  if (value === undefined || typeof value === 'string') return undefined;
  if (value.every((item): item is Creator => typeof item === 'object')) return value;
  return undefined;
}

function stripOuterBraces(text: string): string {
  if (text.startsWith('{') && text.endsWith('}')) return text.slice(1, -1);
  return text;
}

function toAuthor(creator: Creator): Author {
  if (creator.name !== undefined) {
    return { kind: 'literal', literal: stripOuterBraces(creator.name).normalize('NFC') };
  }
  const familyParts = [creator.prefix, creator.lastName, creator.suffix].filter(
    (part): part is string => part !== undefined && part !== '',
  );
  const family = familyParts.join(' ').normalize('NFC');
  if (creator.firstName !== undefined && creator.firstName !== '') {
    return { kind: 'person', family, given: creator.firstName.normalize('NFC') };
  }
  return { kind: 'person', family };
}

function creatorToRaw(creator: Creator): string {
  if (creator.name !== undefined) {
    const name = creator.name;
    return name.startsWith('{') && name.endsWith('}') ? name : `{${name}}`;
  }
  const last = [creator.prefix, creator.lastName, creator.suffix]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' ');
  if (creator.firstName !== undefined && creator.firstName !== '') {
    return `${last}, ${creator.firstName}`;
  }
  return last;
}

function rawFieldToString(field: string, value: FieldValue): string {
  if (typeof value === 'string') return value;
  if (value.every((item): item is string => typeof item === 'string')) {
    return field === 'keywords' ? value.join(', ') : value.join(' and ');
  }
  return (value as Creator[]).map(creatorToRaw).join(' and ');
}

function buildRawMap(entry: Entry | undefined): Record<string, string> {
  const raw: Record<string, string> = {};
  if (entry === undefined) return raw;
  for (const [field, value] of Object.entries(entry.fields)) {
    raw[field] = rawFieldToString(field, value);
  }
  return raw;
}

function normalizeDoi(doi: string): string {
  return doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
}

function toBibEntry(entry: Entry, rawEntry: Entry | undefined): BibEntry {
  const fields = entry.fields;
  const authors = (asCreators(fields['author']) ?? []).map(toAuthor);
  const editorCreators = asCreators(fields['editor']);
  const doiField = asString(fields['doi']);
  const url = asString(fields['url']);
  const eprint = asString(fields['eprint']);
  const archivePrefix = asString(fields['archiveprefix']);
  const doi = doiField === undefined ? undefined : normalizeDoi(doiField);
  const yearField = asString(fields['year']);
  const year = yearField ?? asString(fields['date'])?.match(/\d{4}/)?.[0];

  const result: BibEntry = {
    key: entry.key,
    entryType: entry.type,
    title: asString(fields['title']) ?? '',
    authors,
    raw: buildRawMap(rawEntry),
  };
  if (year !== undefined) result.year = year;
  const journal = asString(fields['journal']) ?? asString(fields['journaltitle']);
  if (journal !== undefined) result.journal = journal;
  const volume = asString(fields['volume']);
  if (volume !== undefined) result.volume = volume;
  const pages = asString(fields['pages']);
  if (pages !== undefined) result.pages = pages;
  if (doi !== undefined) result.doi = doi;
  if (url !== undefined) result.url = url;
  const arxivId = detectArxivId({
    ...(eprint !== undefined ? { eprint } : {}),
    ...(archivePrefix !== undefined ? { archivePrefix } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(doi !== undefined ? { doi } : {}),
  });
  if (arxivId !== undefined) result.arxivId = arxivId;
  const publisher = asString(fields['publisher']);
  if (publisher !== undefined) result.publisher = publisher;
  const booktitle = asString(fields['booktitle']);
  if (booktitle !== undefined) result.booktitle = booktitle;
  if (editorCreators !== undefined) result.editors = editorCreators.map(toAuthor);
  const note = asString(fields['note']);
  if (note !== undefined) result.note = note;
  return result;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function parseBibtex(source: string): ParseResult {
  let cooked: Bibliography;
  try {
    cooked = parseUpstream(source, { sentenceCase: false });
  } catch (err) {
    return { entries: [], errors: [{ message: errorMessage(err) }] };
  }

  let rawPass: Bibliography | undefined;
  try {
    rawPass = parseUpstream(source, { raw: true });
  } catch {
    rawPass = undefined;
  }

  const errors: ParseIssue[] = cooked.errors.map((e) => ({
    message: e.error,
    ...(e.input !== undefined ? { input: e.input } : {}),
  }));

  const entries: BibEntry[] = [];
  cooked.entries.forEach((entry, index) => {
    if (entry.input === '') return; // partial recovery of an entry already reported in errors
    if (entry.key === '') {
      errors.push({ message: `entry of type @${entry.type} has no citation key`, input: entry.input });
      return;
    }
    let rawEntry = rawPass?.entries[index];
    if (rawEntry !== undefined && rawEntry.key !== entry.key) {
      rawEntry = rawPass?.entries.find((e) => e.key === entry.key);
    }
    try {
      entries.push(toBibEntry(entry, rawEntry));
    } catch (err) {
      errors.push({ message: errorMessage(err), input: entry.input });
    }
  });

  return { entries, errors };
}
