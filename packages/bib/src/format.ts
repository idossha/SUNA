import type { Author, BibEntry, Run, RunLink } from './model.js';

export interface BibFormatConfig {
  maxAuthors: number;
  journalAbbreviations?: Readonly<Record<string, string>>;
}

type Variant = 'article' | 'chapter' | 'preprint' | 'software';

function variantOf(entry: BibEntry): Variant {
  const type = entry.entryType.toLowerCase();
  if (type === 'software' || type === 'dataset') return 'software';
  if (type === 'incollection' || type === 'inbook') return 'chapter';
  if (entry.arxivId !== undefined && entry.journal === undefined && entry.booktitle === undefined) {
    return 'preprint';
  }
  if (type === 'misc' && entry.raw['version'] !== undefined) return 'software';
  return 'article';
}

class RunBuilder {
  private readonly runs: Run[] = [];

  text(text: string): void {
    if (text === '') return;
    const last = this.runs[this.runs.length - 1];
    if (last !== undefined && last.style === undefined && last.link === undefined) {
      last.text += text;
    } else {
      this.runs.push({ text });
    }
  }

  run(run: Run): void {
    if (run.text === '') return;
    this.runs.push(run);
  }

  build(): Run[] {
    return this.runs;
  }
}

function initials(given: string): string {
  return given
    .trim()
    .split(/\s+/)
    .map((token) =>
      token
        .split('-')
        .map((part) => (part === '' ? '' : `${part.charAt(0)}.`))
        .join('-'),
    )
    .join(' ');
}

function personName(author: Author): string {
  if (author.kind === 'literal') return author.literal;
  if (author.given === undefined || author.given === '') return author.family;
  return `${author.family}, ${initials(author.given)}`;
}

function joinNames(names: readonly string[], maxNames: number): string {
  if (names.length > maxNames) {
    return `${names.slice(0, maxNames).join(', ')} et al.`;
  }
  if (names.length >= 2) {
    return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
  }
  return names[0] ?? '';
}

function formatAuthorBlock(authors: readonly Author[], maxAuthors: number): string {
  const passthrough = authors.filter(
    (a): a is Author & { kind: 'literal' } => a.kind === 'literal' && a.literal.startsWith('('),
  );
  const named = authors.filter((a) => !(a.kind === 'literal' && a.literal.startsWith('(')));
  const parts: string[] = [];
  const joined = joinNames(named.map(personName), maxAuthors);
  if (joined !== '') parts.push(joined);
  for (const literal of passthrough) parts.push(literal.literal);
  let block = parts.join(' ');
  if (block === '') return '';
  if (!block.endsWith('.') && !block.endsWith(')')) block += '.';
  return `${block} `;
}

function titleSeparator(title: string): string {
  return /[.!?]$/.test(title) ? ' ' : '. ';
}

function linkTarget(entry: BibEntry): RunLink | undefined {
  if (entry.doi !== undefined) return { url: `https://doi.org/${entry.doi}` };
  if (entry.url !== undefined) return { url: entry.url };
  return undefined;
}

function yearSuffix(entry: BibEntry): string {
  return entry.year !== undefined ? ` (${entry.year}).` : '.';
}

function formatArticle(entry: BibEntry, cfg: BibFormatConfig, out: RunBuilder): void {
  const link = linkTarget(entry);
  if (link !== undefined) {
    out.run({ text: entry.title, link });
  } else {
    out.text(entry.title);
  }
  out.text(titleSeparator(entry.title));
  if (entry.journal !== undefined) {
    const abbrev = cfg.journalAbbreviations?.[entry.journal] ?? entry.journal;
    out.run({ text: abbrev, style: 'italic' });
    if (entry.volume !== undefined) {
      out.text(' ');
      out.run({ text: entry.volume, style: 'bold' });
      if (entry.pages !== undefined) out.text(`, ${entry.pages}`);
      out.text(yearSuffix(entry));
    } else {
      out.text(yearSuffix(entry));
    }
  } else if (entry.publisher !== undefined) {
    out.text(entry.year !== undefined ? `(${entry.publisher}, ${entry.year}).` : `(${entry.publisher}).`);
  } else {
    out.text(yearSuffix(entry).trimStart());
  }
}

function formatChapter(entry: BibEntry, cfg: BibFormatConfig, out: RunBuilder): void {
  out.text('in ');
  const bookRun: Run = { text: entry.booktitle ?? entry.title, style: 'italic' };
  const link = linkTarget(entry);
  if (link !== undefined) bookRun.link = link;
  out.run(bookRun);
  const editors = entry.editors ?? [];
  if (editors.length > 0) {
    const token = editors.length === 1 ? 'ed.' : 'eds';
    out.text(` (${token} ${joinNames(editors.map(personName), cfg.maxAuthors)})`);
  }
  if (entry.pages !== undefined) out.text(` ${entry.pages}`);
  if (entry.publisher !== undefined) {
    out.text(entry.year !== undefined ? ` (${entry.publisher}, ${entry.year}).` : ` (${entry.publisher}).`);
  } else {
    out.text(yearSuffix(entry));
  }
}

function formatPreprint(entry: BibEntry, out: RunBuilder): void {
  out.text(entry.title);
  out.text(titleSeparator(entry.title));
  const url =
    entry.arxivId !== undefined ? `https://arxiv.org/abs/${entry.arxivId}` : entry.url;
  if (url !== undefined) {
    out.text('Preprint at ');
    out.run({ text: url, link: { url } });
    out.text(yearSuffix(entry));
  } else {
    out.text(`Preprint${yearSuffix(entry)}`);
  }
}

function formatSoftware(entry: BibEntry, out: RunBuilder): void {
  out.text(entry.title);
  const version = entry.raw['version'];
  if (version !== undefined) out.text(` v${version}`);
  out.text(titleSeparator(version !== undefined ? version : entry.title));
  const url =
    entry.doi !== undefined
      ? `https://doi.org/${entry.doi}`
      : entry.url;
  if (url !== undefined) {
    out.run({ text: url, link: { url } });
    out.text(yearSuffix(entry));
  } else {
    out.text(yearSuffix(entry).trimStart());
  }
}

export function formatReference(entry: BibEntry, cfg: BibFormatConfig): Run[] {
  const out = new RunBuilder();
  out.text(formatAuthorBlock(entry.authors, cfg.maxAuthors));
  switch (variantOf(entry)) {
    case 'article':
      formatArticle(entry, cfg, out);
      break;
    case 'chapter':
      formatChapter(entry, cfg, out);
      break;
    case 'preprint':
      formatPreprint(entry, out);
      break;
    case 'software':
      formatSoftware(entry, out);
      break;
  }
  return out.build();
}
