/**
 * Pure HTML → Block[] parser tuned for mammoth's output shape (feature-plan-6
 * §2). Deliberately NOT a general HTML parser: mammoth's own writer always
 * produces well-formed, entity-escaped markup from a fixed, known tag set
 * (headings, p, strong/em/sup/sub, lists, tables, blockquote, img, a, br,
 * hr), so a small tolerant tree-builder is enough and keeps this file free of
 * Electron/Node imports — every function here is pure string in, data out,
 * which is what makes the front-matter/section/reference heuristics in
 * docx-heuristics.ts and docx-references.ts unit-testable without mammoth.
 */

export interface HtmlElement {
  type: 'element';
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
}
export interface HtmlTextNode {
  type: 'text';
  value: string;
}
export type HtmlNode = HtmlElement | HtmlTextNode;

const VOID_TAGS = new Set(['img', 'br', 'hr', 'meta', 'link', 'input']);

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

const CLOSE_TAG_RE = /^<\/([a-zA-Z][a-zA-Z0-9]*)\s*>/;
const OPEN_TAG_RE =
  /^<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;

/** Parses a mammoth-shaped HTML fragment into a node tree. Unbalanced/unknown
 *  tags degrade gracefully (unmatched close tags pop to the nearest matching
 *  ancestor, or are ignored at the root) rather than throwing. */
export function parseHtmlFragment(html: string): HtmlNode[] {
  const root: HtmlElement = { type: 'element', tag: '#root', attrs: {}, children: [] };
  const stack: HtmlElement[] = [root];
  let i = 0;
  const n = html.length;

  while (i < n) {
    if (html.charAt(i) === '<') {
      if (html.startsWith('<!--', i)) {
        const end = html.indexOf('-->', i + 4);
        i = end === -1 ? n : end + 3;
        continue;
      }
      const rest = html.slice(i);
      const closeMatch = CLOSE_TAG_RE.exec(rest);
      if (closeMatch !== null) {
        const tag = (closeMatch[1] as string).toLowerCase();
        for (let k = stack.length - 1; k >= 1; k -= 1) {
          if (stack[k]?.tag === tag) {
            stack.length = k;
            break;
          }
        }
        i += closeMatch[0].length;
        continue;
      }
      const openMatch = OPEN_TAG_RE.exec(rest);
      if (openMatch !== null) {
        const tag = (openMatch[1] as string).toLowerCase();
        const attrsRaw = openMatch[2] ?? '';
        const selfClosed = openMatch[3] === '/';
        const attrs: Record<string, string> = {};
        ATTR_RE.lastIndex = 0;
        let am: RegExpExecArray | null;
        while ((am = ATTR_RE.exec(attrsRaw)) !== null) {
          const name = (am[1] as string).toLowerCase();
          attrs[name] = decodeEntities(am[2] ?? am[3] ?? '');
        }
        const el: HtmlElement = { type: 'element', tag, attrs, children: [] };
        const parent = stack[stack.length - 1];
        if (parent) parent.children.push(el);
        if (!selfClosed && !VOID_TAGS.has(tag)) stack.push(el);
        i += openMatch[0].length;
        continue;
      }
      // '<' that isn't a recognizable tag start: keep as literal text.
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push({ type: 'text', value: '<' });
      i += 1;
      continue;
    }
    const next = html.indexOf('<', i);
    const chunk = next === -1 ? html.slice(i) : html.slice(i, next);
    if (chunk.length > 0) {
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push({ type: 'text', value: decodeEntities(chunk) });
    }
    i = next === -1 ? n : next;
  }

  return root.children;
}

/* ------------------------------------------------------------------ */
/* Inline runs                                                          */
/* ------------------------------------------------------------------ */

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  sup?: boolean;
  sub?: boolean;
  link?: string;
}

interface InlineStyle {
  bold?: boolean;
  italic?: boolean;
  sup?: boolean;
  sub?: boolean;
  link?: string;
}

function makeRun(text: string, style: InlineStyle): Run {
  const run: Run = { text };
  if (style.bold === true) run.bold = true;
  if (style.italic === true) run.italic = true;
  if (style.sup === true) run.sup = true;
  if (style.sub === true) run.sub = true;
  if (style.link !== undefined) run.link = style.link;
  return run;
}

function sameStyle(a: Run, b: InlineStyle): boolean {
  return (
    (a.bold ?? false) === (b.bold ?? false) &&
    (a.italic ?? false) === (b.italic ?? false) &&
    (a.sup ?? false) === (b.sup ?? false) &&
    (a.sub ?? false) === (b.sub ?? false) &&
    (a.link ?? null) === (b.link ?? null)
  );
}

function pushRun(runs: Run[], text: string, style: InlineStyle): void {
  if (text === '') return;
  const last = runs[runs.length - 1];
  if (last !== undefined && sameStyle(last, style)) {
    last.text += text;
    return;
  }
  runs.push(makeRun(text, style));
}

function walkInline(nodes: readonly HtmlNode[], style: InlineStyle, out: Run[]): void {
  for (const node of nodes) {
    if (node.type === 'text') {
      pushRun(out, node.value, style);
      continue;
    }
    switch (node.tag) {
      case 'strong':
      case 'b':
        walkInline(node.children, { ...style, bold: true }, out);
        break;
      case 'em':
      case 'i':
        walkInline(node.children, { ...style, italic: true }, out);
        break;
      case 'sup':
        walkInline(node.children, { ...style, sup: true }, out);
        break;
      case 'sub':
        walkInline(node.children, { ...style, sub: true }, out);
        break;
      case 'a':
        walkInline(node.children, { ...style, link: node.attrs['href'] ?? '' }, out);
        break;
      case 'br':
        pushRun(out, '\n', style);
        break;
      case 'img':
        // Inline images inside otherwise-textual paragraphs are rare in
        // mammoth's output (it normally emits <p><img/></p>); fall back to
        // alt text so nothing silently vanishes.
        pushRun(out, node.attrs['alt'] ?? '', style);
        break;
      default:
        walkInline(node.children, style, out);
    }
  }
}

/** Elements/text → a run list with adjacent same-style runs merged. */
export function elementsToRuns(nodes: readonly HtmlNode[]): Run[] {
  const out: Run[] = [];
  walkInline(nodes, {}, out);
  return out;
}

export function runsToPlainText(runs: readonly Run[]): string {
  return runs.map((r) => r.text).join('');
}

export function isBlankRuns(runs: readonly Run[]): boolean {
  return runsToPlainText(runs).trim() === '';
}

/* ------------------------------------------------------------------ */
/* Blocks                                                               */
/* ------------------------------------------------------------------ */

export interface HeadingBlock {
  kind: 'heading';
  level: number;
  runs: Run[];
}
export interface ParagraphBlock {
  kind: 'paragraph';
  runs: Run[];
}
export interface ListBlock {
  kind: 'list';
  ordered: boolean;
  items: Run[][];
}
export interface TableBlock {
  kind: 'table';
  rows: Run[][][];
}
export interface BlockquoteBlock {
  kind: 'blockquote';
  blocks: Block[];
}
export interface ImageBlock {
  kind: 'image';
  src: string;
  alt: string;
}
export interface ThematicBreakBlock {
  kind: 'thematicBreak';
}
export type Block =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | TableBlock
  | BlockquoteBlock
  | ImageBlock
  | ThematicBreakBlock;

/** True paragraph "allBold": every run carries bold and there's real text. */
export function isFullyBold(runs: readonly Run[]): boolean {
  if (isBlankRuns(runs)) return false;
  return runs.every((r) => r.text.trim() === '' || r.bold === true);
}

function nonWhitespaceChildren(nodes: readonly HtmlNode[]): HtmlNode[] {
  return nodes.filter((n) => !(n.type === 'text' && n.value.trim() === ''));
}

/** A `<p>` mammoth wrapped around a single image and nothing else. */
function soleImage(el: HtmlElement): HtmlElement | null {
  const kids = nonWhitespaceChildren(el.children);
  if (kids.length !== 1) return null;
  const only = kids[0];
  return only !== undefined && only.type === 'element' && only.tag === 'img' ? only : null;
}

function rowCells(tr: HtmlElement): Run[][] {
  return tr.children
    .filter((c): c is HtmlElement => c.type === 'element' && (c.tag === 'td' || c.tag === 'th'))
    .map((c) => elementsToRuns(c.children));
}

function tableRows(table: HtmlElement): Run[][][] {
  const rows: Run[][][] = [];
  const visit = (nodes: readonly HtmlNode[]): void => {
    for (const node of nodes) {
      if (node.type !== 'element') continue;
      if (node.tag === 'tr') rows.push(rowCells(node));
      else visit(node.children);
    }
  };
  visit(table.children);
  return rows;
}

const HEADING_RE = /^h([1-6])$/;

/** Top-level HTML nodes → Block[]. Unknown wrapper elements (mammoth rarely
 *  emits any at the root, but be tolerant) are flattened: their children are
 *  parsed as if they were siblings of the wrapper. */
export function parseBlocks(nodes: readonly HtmlNode[]): Block[] {
  const blocks: Block[] = [];
  let strayRuns: Run[] = [];

  const flushStray = (): void => {
    if (strayRuns.length > 0 && !isBlankRuns(strayRuns)) {
      blocks.push({ kind: 'paragraph', runs: strayRuns });
    }
    strayRuns = [];
  };

  for (const node of nodes) {
    if (node.type === 'text') {
      if (node.value.trim() === '') continue;
      strayRuns = strayRuns.concat(elementsToRuns([node]));
      continue;
    }
    const headingMatch = HEADING_RE.exec(node.tag);
    if (headingMatch !== null) {
      flushStray();
      const runs = elementsToRuns(node.children);
      if (!isBlankRuns(runs)) blocks.push({ kind: 'heading', level: Number(headingMatch[1]), runs });
      continue;
    }
    switch (node.tag) {
      case 'p': {
        flushStray();
        const img = soleImage(node);
        if (img !== null) {
          blocks.push({ kind: 'image', src: img.attrs['src'] ?? '', alt: img.attrs['alt'] ?? '' });
          break;
        }
        const runs = elementsToRuns(node.children);
        if (!isBlankRuns(runs)) blocks.push({ kind: 'paragraph', runs });
        break;
      }
      case 'img':
        flushStray();
        blocks.push({ kind: 'image', src: node.attrs['src'] ?? '', alt: node.attrs['alt'] ?? '' });
        break;
      case 'ul':
      case 'ol': {
        flushStray();
        const items = node.children
          .filter((c): c is HtmlElement => c.type === 'element' && c.tag === 'li')
          .map((li) => elementsToRuns(li.children))
          .filter((runs) => !isBlankRuns(runs));
        if (items.length > 0) blocks.push({ kind: 'list', ordered: node.tag === 'ol', items });
        break;
      }
      case 'table': {
        flushStray();
        const rows = tableRows(node).filter((row) => row.length > 0);
        if (rows.length > 0) blocks.push({ kind: 'table', rows });
        break;
      }
      case 'blockquote': {
        flushStray();
        const inner = parseBlocks(node.children);
        if (inner.length > 0) blocks.push({ kind: 'blockquote', blocks: inner });
        break;
      }
      case 'hr':
        flushStray();
        blocks.push({ kind: 'thematicBreak' });
        break;
      case 'br':
        break;
      default:
        // Unknown wrapper (div/span/section/…): splice its children in place.
        for (const b of parseBlocks(node.children)) {
          flushStray();
          blocks.push(b);
        }
    }
  }
  flushStray();
  return blocks;
}

/** Convenience: parse an HTML string straight to Block[]. */
export function parseHtmlBlocks(html: string): Block[] {
  return parseBlocks(parseHtmlFragment(html));
}

/** Block-level plain text (headings/paragraphs only give text; other kinds
 *  give ''), used by heuristics that scan for a marker without caring about
 *  the block's inline styling. */
export function blockText(block: Block): string {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
      return runsToPlainText(block.runs);
    default:
      return '';
  }
}
