export interface PersonAuthor {
  kind: 'person';
  family: string;
  given?: string;
}

export interface LiteralAuthor {
  kind: 'literal';
  literal: string;
}

export type Author = PersonAuthor | LiteralAuthor;

export interface BibEntry {
  key: string;
  entryType: string;
  title: string;
  authors: Author[];
  year?: string;
  journal?: string;
  volume?: string;
  pages?: string;
  doi?: string;
  url?: string;
  arxivId?: string;
  publisher?: string;
  booktitle?: string;
  editors?: Author[];
  note?: string;
  raw: Record<string, string>;
}

export type RunLink = { refKey: string } | { url: string };

export interface Run {
  text: string;
  style?: 'italic' | 'bold';
  link?: RunLink;
}

const NEW_STYLE = /^\d{4}\.\d{4,5}(v\d+)?$/;
const OLD_STYLE = /^[a-z-]+(\.[A-Z]{2})?\/\d{7}(v\d+)?$/i;
const ARXIV_URL = /arxiv\.org\/(?:abs|pdf)\/([a-z0-9.\-\/]+?)(?:\.pdf)?(?:[?#]|$)/i;
const ARXIV_DOI = /^10\.48550\/arxiv\.(.+)$/i;

export interface ArxivSourceFields {
  eprint?: string;
  archivePrefix?: string;
  url?: string;
  doi?: string;
}

export function detectArxivId(fields: ArxivSourceFields): string | undefined {
  const { eprint, archivePrefix, url, doi } = fields;
  if (eprint !== undefined) {
    const prefixOk = archivePrefix === undefined || archivePrefix.toLowerCase() === 'arxiv';
    if (prefixOk && (NEW_STYLE.test(eprint) || OLD_STYLE.test(eprint))) return eprint;
  }
  if (url !== undefined) {
    const m = url.match(ARXIV_URL);
    const id = m?.[1];
    if (id !== undefined && (NEW_STYLE.test(id) || OLD_STYLE.test(id))) return id;
  }
  if (doi !== undefined) {
    const m = doi.match(ARXIV_DOI);
    if (m?.[1] !== undefined) return m[1];
  }
  return undefined;
}
