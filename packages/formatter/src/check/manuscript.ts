import type {
  BodyNode,
  Manuscript,
  PublisherProfile,
  RequiredSection,
} from '@suna/core';
import type { Diagnostic } from './types';
import { sourceSuffix } from './util';

/**
 * Manuscript compliance checker (ADR-002 §4). Flags violations of the
 * profile's stated manuscript rules for one article type; every null rule
 * ("the journal does not state this") is skipped.
 */

export interface ManuscriptCheckInput {
  manuscript: Manuscript;
  /** Rendered markdown of each body section, keyed by its content path. */
  sectionTexts: Record<string, string>;
  referenceCount: number;
}

/**
 * Reference entries are not available as text (only a count), so limits
 * whose scope includes references use this per-entry word estimate — a
 * typical journal-style entry ("Author, A., Author, B. 2020, ApJ, 900, 45").
 */
export const WORDS_PER_REFERENCE_ESTIMATE = 15;

/** Count words in markdown-ish text: whitespace tokens containing a letter or digit. */
export function countWords(text: string): number {
  let n = 0;
  for (const token of text.split(/\s+/)) {
    if (/[\p{L}\p{N}]/u.test(token)) n += 1;
  }
  return n;
}

/** Does the limit's scope sentence say the count includes `noun`? */
function scopeMentions(scope: string, noun: 'references' | 'captions'): boolean {
  return new RegExp(`includ\\w*[^.;]*\\b${noun.slice(0, -1)}s?\\b`, 'i').test(scope);
}

/**
 * Does the scope sentence explicitly exclude `noun`? Catches "excluding
 * abstract, Methods, references", "not including references", "without
 * captions". `nounPattern` is a regex fragment (e.g. 'references?').
 */
function scopeExcludes(scope: string, nounPattern: string): boolean {
  return new RegExp(
    `(?:\\bexclud\\w*|\\bnot\\s+includ\\w*|\\bwithout\\b)[^.;]*\\b${nounPattern}\\b`,
    'i',
  ).test(scope);
}

function captionWords(manuscript: Manuscript): number {
  let n = 0;
  for (const fig of manuscript.figures) {
    n += countWords(fig.caption.title) + countWords(fig.caption.body);
    if (fig.caption.credits !== undefined) n += countWords(fig.caption.credits);
  }
  for (const table of manuscript.tables) {
    n += countWords(table.caption.title);
    if (table.caption.body !== undefined) n += countWords(table.caption.body);
  }
  return n;
}

function normalizeHeading(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function collectHeadings(body: readonly BodyNode[]): Set<string> {
  const headings = new Set<string>();
  const visit = (nodes: readonly BodyNode[]): void => {
    for (const node of nodes) {
      if (node.kind !== 'section') continue;
      if (node.heading !== null) headings.add(normalizeHeading(node.heading));
      visit(node.children);
    }
  };
  visit(body);
  return headings;
}

/**
 * A required section is satisfied by a matching body heading or by the
 * standard back-matter field it names: abstract is always a dedicated
 * manuscript field, acknowledgments maps to backMatter.acknowledgements,
 * references to the bibliography.
 */
function sectionPresent(
  rs: RequiredSection,
  manuscript: Manuscript,
  headings: ReadonlySet<string>,
): boolean {
  switch (rs.id) {
    case 'abstract':
      return manuscript.abstract.content.trim() !== '';
    case 'acknowledgments':
    case 'acknowledgements': {
      const ack = manuscript.backMatter.acknowledgements;
      return ack !== null && ack.trim() !== '';
    }
    case 'references':
    case 'bibliography':
      return manuscript.bibliography.trim() !== '';
    default:
      return (
        headings.has(normalizeHeading(rs.id)) || headings.has(normalizeHeading(rs.label))
      );
  }
}

export function checkManuscript(
  input: ManuscriptCheckInput,
  profile: PublisherProfile,
  articleTypeId: string,
): Diagnostic[] {
  const rules = profile.manuscript;
  const articleType = rules.articleTypes.find((t) => t.id === articleTypeId);
  if (articleType === undefined) {
    throw new Error(
      `unknown article type "${articleTypeId}" in profile "${profile.id}"`,
    );
  }
  const { manuscript, sectionTexts, referenceCount } = input;
  const src = sourceSuffix(rules.sources);
  const out: Diagnostic[] = [];

  // Abstract word count.
  if (articleType.abstractWordLimit !== null) {
    const words = countWords(manuscript.abstract.content);
    if (words > articleType.abstractWordLimit) {
      out.push({
        id: 'ms.abstract-words',
        severity: 'error',
        surface: 'manuscript',
        message: `Abstract is ${words} words, over the ${articleType.abstractWordLimit}-word limit${src}`,
        target: { sectionPath: 'abstract' },
      });
    }
  }

  // Total word count. The abstract counts unless the scope explicitly
  // excludes it (e.g. Nature Astronomy: "... excluding abstract, Methods,
  // references and figure captions").
  if (articleType.wordLimit !== null) {
    const limit = articleType.wordLimit;
    let total = scopeExcludes(limit.scope, 'abstract')
      ? 0
      : countWords(manuscript.abstract.content);
    for (const text of Object.values(sectionTexts)) total += countWords(text);
    if (scopeMentions(limit.scope, 'captions') && !scopeExcludes(limit.scope, 'captions?')) {
      total += captionWords(manuscript);
    }
    let estimated = false;
    if (
      scopeMentions(limit.scope, 'references') &&
      !scopeExcludes(limit.scope, 'references?')
    ) {
      total += referenceCount * WORDS_PER_REFERENCE_ESTIMATE;
      estimated = referenceCount > 0;
    }
    if (total > limit.max) {
      const approx = estimated
        ? ` (references estimated at ${WORDS_PER_REFERENCE_ESTIMATE} words each)`
        : '';
      out.push({
        id: 'ms.word-limit',
        severity: limit.hard ? 'error' : 'warning',
        surface: 'manuscript',
        message: `Manuscript is ${estimated ? '~' : ''}${total} words${approx}, over the ${limit.max}-word limit (${limit.scope})${src}`,
      });
    }
  }

  // Title length.
  if (
    articleType.titleLimitChars !== null &&
    manuscript.title.length > articleType.titleLimitChars
  ) {
    out.push({
      id: 'ms.title-chars',
      severity: 'error',
      surface: 'manuscript',
      message: `Title is ${manuscript.title.length} characters, over the ${articleType.titleLimitChars}-character limit${src}`,
      target: { sectionPath: 'title' },
    });
  }

  // Running head (short title) length.
  if (
    rules.runningHeadLimitChars !== null &&
    manuscript.shortTitle.length > rules.runningHeadLimitChars
  ) {
    out.push({
      id: 'ms.running-head',
      severity: 'error',
      surface: 'manuscript',
      message: `Running head is ${manuscript.shortTitle.length} characters, over the ${rules.runningHeadLimitChars}-character limit${src}`,
      target: { sectionPath: 'shortTitle' },
    });
  }

  // Required sections.
  const headings = collectHeadings(manuscript.body);
  for (const rs of rules.requiredSections) {
    if (!rs.required) continue;
    if (sectionPresent(rs, manuscript, headings)) continue;
    out.push({
      id: 'ms.section-missing',
      severity: 'error',
      surface: 'manuscript',
      message: `Required section "${rs.label}" is missing${src}`,
      target: { sectionPath: rs.id },
    });
  }

  // Availability statements.
  if (
    rules.availabilityStatements.data === true &&
    manuscript.availability.data.trim() === ''
  ) {
    out.push({
      id: 'ms.availability-data',
      severity: 'error',
      surface: 'manuscript',
      message: `The journal requires a data availability statement; none is present${src}`,
      target: { sectionPath: 'availability.data' },
    });
  }
  if (
    rules.availabilityStatements.code === true &&
    manuscript.availability.code.trim() === ''
  ) {
    out.push({
      id: 'ms.availability-code',
      severity: 'error',
      surface: 'manuscript',
      message: `The journal requires a code availability statement; none is present${src}`,
      target: { sectionPath: 'availability.code' },
    });
  }

  // Display items (figures + tables).
  if (articleType.maxDisplayItems !== null) {
    const count = manuscript.figures.length + manuscript.tables.length;
    if (count > articleType.maxDisplayItems) {
      out.push({
        id: 'ms.display-items',
        severity: 'error',
        surface: 'manuscript',
        message: `Manuscript has ${count} display items (${manuscript.figures.length} figures + ${manuscript.tables.length} tables), over the limit of ${articleType.maxDisplayItems}${src}`,
      });
    }
  }

  // Reference count: article-type limit, falling back to the citations rule.
  const maxReferences = articleType.maxReferences ?? profile.citations.maxReferences;
  if (maxReferences !== null && referenceCount > maxReferences) {
    out.push({
      id: 'ms.max-references',
      severity: 'error',
      surface: 'manuscript',
      message: `Manuscript cites ${referenceCount} references, over the limit of ${maxReferences}${src}`,
    });
  }

  return out;
}
