import type { Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

/**
 * The manuscript outline, DERIVED from manuscript.md rather than stored
 * (ARCHITECTURE §4.3). `manuscript.json` no longer carries a `body` array of
 * section-file pointers: the prose file is the source of truth and its
 * Markdown headings ARE the sections.
 *
 * Built on the same remark pipeline the SciMark parser uses, so a `#` inside a
 * fenced code block, an indented code block or inline code is code — never a
 * heading. Setext headings (`Title` underlined with `===` / `---`) are
 * supported too and report level 1 / 2.
 */

/** Only root-level headings define sections; a `#` inside a blockquote or list item does not. */
const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

export interface OutlineSection {
  /**
   * Markdown heading depth, 1–6. `0` marks the untitled leading section: the
   * prose before the first heading, which every manuscript with an unheaded
   * introduction has and which must never vanish from the outline.
   */
  level: number;
  /**
   * Heading text with Markdown emphasis/link syntax removed (inline math keeps
   * its `$…$` delimiters). `''` for the untitled leading section.
   */
  title: string;
  /**
   * Offset of the first character of the heading line. Equals `from` for the
   * untitled leading section. This is the offset to scroll-spy against.
   */
  headingFrom: number;
  /** Offset of the first character of the section's BODY (just past the heading line). */
  from: number;
  /**
   * Offset just past the section's body — the `headingFrom` of the next
   * section, or the end of the document. Sections tile the file in order, so
   * `md.slice(section.headingFrom, section.to)` is the whole section including
   * its heading and `md.slice(from, to)` is the body alone.
   */
  to: number;
  /**
   * Words in the BODY (the heading text is not counted), with Markdown syntax
   * excluded: emphasis/link markers do not split a word, fenced code blocks,
   * display math, raw HTML and image alt text contribute nothing, and an
   * inline `$…$` span counts as a single word.
   */
  words: number;
}

interface AnyNode {
  type: string;
  depth?: number | undefined;
  value?: string | undefined;
  children?: AnyNode[] | undefined;
  position?: { start: { offset?: number | undefined }; end: { offset?: number | undefined } };
}

/** Nodes whose children are phrasing: concatenated with no separator so `**bold**ly` is one word. */
const PHRASING_CONTAINERS = new Set([
  'paragraph',
  'heading',
  'tableCell',
  'strong',
  'emphasis',
  'delete',
  'link',
  'linkReference',
  'footnote',
]);

/** Not prose: contributes no words and no title text. */
const NON_PROSE = new Set([
  'code',
  'math',
  'rawLatex',
  'html',
  'image',
  'imageReference',
  'figureEmbed',
  'definition',
  'footnoteDefinition',
  'thematicBreak',
  'yaml',
  'toml',
]);

function startOffset(node: AnyNode): number | undefined {
  return node.position?.start.offset;
}

/**
 * Plain-text projection used for counting: Markdown syntax is gone, word
 * boundaries are preserved. Inline math collapses to one token so `$z = 1.7$`
 * counts as one word rather than three.
 */
function projectText(node: AnyNode): string {
  if (NON_PROSE.has(node.type)) return '';
  if (node.type === 'inlineMath') return (node.value ?? '').replace(/\s+/g, '');
  if (node.type === 'break') return ' ';
  if (typeof node.value === 'string') return node.value;
  const children = node.children;
  if (children === undefined) return '';
  const separator = PHRASING_CONTAINERS.has(node.type) ? '' : '\n';
  return children.map(projectText).join(separator);
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Heading label. Deliberately not `mdast-util-to-string`: that would strip the
 * `$` around inline math, and a heading like `Results at $z = 1.7$` should read
 * as the author wrote it.
 */
function headingTitle(node: AnyNode): string {
  if (NON_PROSE.has(node.type)) return '';
  if (node.type === 'inlineMath') return `$${node.value ?? ''}$`;
  if (node.type === 'inlineCode') return node.value ?? '';
  if (node.type === 'break') return ' ';
  if (typeof node.value === 'string') return node.value;
  return (node.children ?? []).map(headingTitle).join('');
}

/** Offset of the body: just past the heading's line ending (LF or CRLF). */
function bodyStart(md: string, headingEnd: number): number {
  let index = headingEnd;
  if (md.charAt(index) === '\r') index += 1;
  if (md.charAt(index) === '\n') index += 1;
  return index;
}

/**
 * Derive the section outline of a manuscript Markdown file. Pure: no I/O, no
 * dependence on manuscript.json. Sections appear in document order and tile the
 * file; nesting is read off `level` (there is no tree — the flat list plus the
 * level is everything the sidebar, export, and word counts need).
 *
 * A file with no headings at all yields a single untitled section covering it;
 * a file that is empty or only whitespace yields no sections.
 */
export function outlineFromMarkdown(md: string): OutlineSection[] {
  const root = processor.parse(md) as Root as unknown as AnyNode;
  const children = root.children ?? [];

  const headings: { node: AnyNode; headingFrom: number; from: number }[] = [];
  for (const child of children) {
    if (child.type !== 'heading') continue;
    const start = startOffset(child);
    const end = child.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    headings.push({ node: child, headingFrom: start, from: bodyStart(md, end) });
  }

  const sections: OutlineSection[] = [];
  const firstHeadingAt = headings[0]?.headingFrom ?? md.length;
  if (md.slice(0, firstHeadingAt).trim() !== '') {
    sections.push({
      level: 0,
      title: '',
      headingFrom: 0,
      from: 0,
      to: firstHeadingAt,
      words: 0,
    });
  }
  headings.forEach((heading, index) => {
    const depth = heading.node.depth;
    sections.push({
      level: typeof depth === 'number' ? depth : 1,
      title: headingTitle(heading.node).trim(),
      headingFrom: heading.headingFrom,
      from: heading.from,
      to: headings[index + 1]?.headingFrom ?? md.length,
      words: 0,
    });
  });
  if (sections.length === 0) return sections;

  // Bucket every non-heading top-level block into the section that contains it.
  for (const child of children) {
    if (child.type === 'heading') continue;
    const start = startOffset(child);
    if (start === undefined) continue;
    let index = -1;
    for (let i = 0; i < sections.length; i += 1) {
      const section = sections[i];
      if (section !== undefined && section.headingFrom <= start) index = i;
    }
    const section = index >= 0 ? sections[index] : undefined;
    if (section === undefined) continue;
    section.words += countWords(projectText(child));
  }

  return sections;
}
