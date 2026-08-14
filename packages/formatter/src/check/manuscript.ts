import type {
  BodyNode,
  Manuscript,
  PublisherProfile,
  RequiredSection,
  SubmissionStage,
} from '@suna/core';
import type { Diagnostic, DiagnosticSeverity } from './types';
import { sourceSuffix } from './util';

/**
 * Manuscript compliance checker (ADR-002 §4). Flags violations of the
 * profile's stated manuscript rules for one article type; every null rule
 * ("the journal does not state this") is skipped.
 *
 * Limit diagnostics (word/character/item/reference counts) honor the
 * profile's optional `manuscript.stageSeverity` mapping: when the current
 * submission stage has an entry, it overrides each limit's intrinsic
 * severity (journals that ignore formatting at initial submission downgrade
 * to warnings there and upgrade back to errors once accepted). Structural
 * checks — missing sections, availability statements, dangling figure
 * references — always keep their intrinsic severity.
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

/* ------------------------------------------------------------------ */
/* Figure references in prose                                          */
/* ------------------------------------------------------------------ */

/** "Figure 12", "Fig. 3b", "Figs 2 and 4", "figures 1–3" — number(s) attached to a figure word. */
const FIG_REF_RE = /\b[Ff]ig(?:ure)?s?\.?\s*(\d+)([A-Za-z])?/g;

/** Continuation after a matched number: ", 3", " and 4", "–5", " to 6". */
const FIG_CONT_RE = /^(\s*(?:,\s*(?:and|&)\s*|,\s*|\s+(?:and|&|to)\s+|\s*[–—-]\s*))(\d+)([A-Za-z])?/;

/** Separators that denote an inclusive numeric range ("Figs. 2–4"). */
const RANGE_SEP_RE = /^\s*(?:[–—-]|to)\s*$/;

/** Longest range a "Figs. 2–4" style reference is allowed to expand to. */
const MAX_RANGE_SPAN = 30;

/**
 * Common capitalized words that legitimately precede a figure reference
 * mid-sentence and must not be mistaken for author surnames.
 */
const NOT_AUTHOR_BEFORE = new Set([
  'A', 'An', 'And', 'As', 'Also', 'Both', 'Cf', 'Compare', 'Consider', 'Data',
  'E', 'Eq', 'Equation', 'For', 'From', 'In', 'Left', 'Lower', 'Namely',
  'Note', 'Or', 'Our', 'Panel', 'Panels', 'Recall', 'Right', 'Section', 'See',
  'Table', 'Tables', 'The', 'To', 'Top', 'Upper', 'With',
]);

/**
 * Capitalized words after "Figure N of/in/from …" that name a location in
 * THIS document rather than another paper's author.
 */
const NOT_AUTHOR_AFTER = new Set([
  'Appendix', 'Box', 'Chapter', 'Eq', 'Equation', 'Extended', 'Fig', 'Figs',
  'Figure', 'Figures', 'Our', 'Panel', 'Panels', 'Section', 'Sections',
  'Supplementary', 'Table', 'Tables', 'The', 'Their', 'This',
]);

/** "Extended Data Figure 5" / "Supplementary Figure 2": different namespaces, never main-figure refs. */
const OTHER_NAMESPACE_RE = /(?:extended\s+data|supplementary)\s*$/i;

/** "… et al. Figure 3", "(Author et al., 2020, Figure 3)". */
const ET_AL_BEFORE_RE = /\bet\s+al\.?[,;]?\s*(?:\(\d{4}[a-z]?\)|\d{4}[a-z]?)?[,;:]?\s*$/;

/**
 * Trailing proper-noun word directly before the figure word ("… Gao Figure
 * 2D"). Any intervening punctuation (comma, period) breaks the adjacency.
 */
const CAP_WORD_BEFORE_RE = /(\p{Lu}[\p{L}'’-]*)\s+$/u;

/**
 * Sentence boundary right before that word: a capitalized word opening a
 * sentence is ordinary prose, not a surname. Semicolons and colons do NOT
 * count — English does not capitalize after them, so "(maps in X; Gao
 * Figure 2)" keeps Gao author-adjacent.
 */
const SENTENCE_START_RE = /(?:^|[.!?]\s*|\n\s*)$/;

/** "Figure 2 of Gao et al.", "Figure 3 in Smith (2020)", "Figure 1 from Zhang". */
const AUTHOR_AFTER_RE = /^\s*(?:of|in|from)\s+(?:(\p{Lu}[\p{L}'’-]*)|et\s+al\b)/u;

export interface FigureReferenceScan {
  /** Numbers referenced as THIS manuscript's figures (document-global foreign numbers excluded). */
  cited: ReadonlySet<number>;
  /** Numbers seen author-adjacent — other papers' figures for the whole document. */
  foreign: ReadonlySet<number>;
}

function isForeignBefore(prefix: string): boolean {
  if (ET_AL_BEFORE_RE.test(prefix)) return true;
  const cap = CAP_WORD_BEFORE_RE.exec(prefix);
  if (cap === null) return false;
  const word = cap[1] ?? '';
  const possessive = /['’]s$/.test(word);
  if (NOT_AUTHOR_BEFORE.has(possessive ? word.slice(0, -2) : word)) return false;
  // A possessive ("Gao's Figure 3") is name-like even when it opens a sentence.
  if (possessive) return true;
  // Otherwise a capitalized word opening a sentence is ordinary prose
  // ("Only Figure 1…", "Consider Figure 2…"), not a surname — the rare
  // sentence-start "Gao Figure 3 shows…" construction is a known miss.
  return !SENTENCE_START_RE.test(prefix.slice(0, cap.index));
}

function isForeignAfter(suffix: string): boolean {
  const m = AUTHOR_AFTER_RE.exec(suffix);
  if (m === null) return false;
  const word = m[1];
  return word === undefined || !NOT_AUTHOR_AFTER.has(word);
}

/**
 * Scan prose for figure references, separating this manuscript's figures
 * from OTHER papers' figures cited author-adjacent ("Gao Figure 2D",
 * "(Author et al. Figure 3)", "as shown in Figure 2 of Gao et al.").
 * Foreignness is document-global and sticky: once a figure number appears
 * author-adjacent anywhere, every mention of that number — earlier or later
 * — is treated as foreign.
 */
export function scanFigureReferences(texts: readonly string[]): FigureReferenceScan {
  const own = new Set<number>();
  const foreign = new Set<number>();
  for (const text of texts) {
    FIG_REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FIG_REF_RE.exec(text)) !== null) {
      const prefix = text.slice(0, m.index);
      // Collect "Figs. 2, 3 and 5" / "Figures 2–4" continuations.
      const numbers: number[] = [Number(m[1])];
      let end = FIG_REF_RE.lastIndex;
      let cont: RegExpExecArray | null;
      while ((cont = FIG_CONT_RE.exec(text.slice(end))) !== null) {
        const sep = cont[1] ?? '';
        const next = Number(cont[2]);
        const prev = numbers[numbers.length - 1];
        if (
          prev !== undefined &&
          RANGE_SEP_RE.test(sep) &&
          next > prev &&
          next - prev <= MAX_RANGE_SPAN
        ) {
          for (let n = prev + 1; n <= next; n++) numbers.push(n);
        } else {
          numbers.push(next);
        }
        end += cont[0].length;
      }
      FIG_REF_RE.lastIndex = end;

      if (OTHER_NAMESPACE_RE.test(prefix)) continue; // Extended Data / Supplementary
      const target = isForeignBefore(prefix) || isForeignAfter(text.slice(end)) ? foreign : own;
      for (const n of numbers) target.add(n);
    }
  }
  for (const n of foreign) own.delete(n); // sticky: foreign for the whole document
  return { cited: own, foreign };
}

/**
 * Referential-integrity checks between prose figure references and the
 * manuscript's main-namespace figures (numbered 1..N in array order —
 * numbering is derived, never stored). Author-adjacent references to other
 * papers' figures are ignored entirely. The uncited-figure check only runs
 * once the prose engages in figure citation at all, so a half-drafted
 * manuscript with no references yet is not drowned in warnings.
 */
function checkFigureReferences(
  manuscript: Manuscript,
  sectionTexts: Record<string, string>,
  out: Diagnostic[],
): void {
  const scan = scanFigureReferences(Object.values(sectionTexts));
  const mainFigures = manuscript.figures.filter((f) => f.namespace === 'main');
  for (const n of [...scan.cited].sort((a, b) => a - b)) {
    if (n >= 1 && n <= mainFigures.length) continue;
    out.push({
      id: 'ms.figure-ref-unknown',
      severity: 'error',
      surface: 'manuscript',
      message: `Prose references Figure ${n}, but the manuscript has ${
        mainFigures.length === 1 ? 'only 1 main figure' : `${mainFigures.length} main figures`
      }`,
    });
  }
  if (scan.cited.size === 0) return;
  for (let i = 0; i < mainFigures.length; i++) {
    const fig = mainFigures[i];
    const n = i + 1;
    if (fig === undefined || scan.cited.has(n)) continue;
    const foreignNote = scan.foreign.has(n)
      ? ` (mentions of Figure ${n} adjacent to author names cite other papers' figures and do not count)`
      : '';
    out.push({
      id: 'ms.figure-uncited',
      severity: 'warning',
      surface: 'manuscript',
      message: `Figure ${n} ("${fig.id}") is never referenced in the text${foreignNote}`,
      target: { figureId: fig.id },
    });
  }
}

export function checkManuscript(
  input: ManuscriptCheckInput,
  profile: PublisherProfile,
  articleTypeId: string,
  stage: SubmissionStage = 'initial-submission',
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

  // Stage-mapped severity for LIMIT checks only (see module doc).
  const stageOverride = rules.stageSeverity?.[stage];
  const limitSeverity = (intrinsic: DiagnosticSeverity): DiagnosticSeverity =>
    stageOverride ?? intrinsic;

  // Abstract word count.
  if (articleType.abstractWordLimit !== null) {
    const words = countWords(manuscript.abstract.content);
    if (words > articleType.abstractWordLimit) {
      out.push({
        id: 'ms.abstract-words',
        severity: limitSeverity('error'),
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
        severity: limitSeverity(limit.hard ? 'error' : 'warning'),
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
      severity: limitSeverity('error'),
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
      severity: limitSeverity('error'),
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
        severity: limitSeverity('error'),
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
      severity: limitSeverity('error'),
      surface: 'manuscript',
      message: `Manuscript cites ${referenceCount} references, over the limit of ${maxReferences}${src}`,
    });
  }

  // Figure cross-references (structural; foreign figures ignored).
  checkFigureReferences(manuscript, sectionTexts, out);

  return out;
}
