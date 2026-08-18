import type { PhrasingContent, Text } from 'mdast';
import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { Point, Position } from 'unist';
import { visit } from 'unist-util-visit';
import type {
  CitationNode,
  CrossRefKind,
  CrossRefNode,
  FigureEmbedNode,
  RawLatexNode,
  SciMarkRoot,
  TableEmbedNode,
} from './ast';

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

const FIGURE_EMBED = /^!\[\[fig:([A-Za-z][\w.-]*)\]\]$/;
const TABLE_EMBED = /^!\[\[tbl:([A-Za-z][\w.-]*)\]\]$/;
const SCAN = /\[@[^\]]*\]|@[A-Za-z][\w:.-]+(\{[^}]*\})?/g;
const BRACKET_ITEM = /^@([A-Za-z][\w:.-]*)$/;
const BARE = /^@([A-Za-z][\w:.-]+)(\{([^}]*)\})?/;
/**
 * Characters that may immediately precede a bare `@key`/`@kind:id{suffix}`
 * token for it to count as a citation/cross-reference start, beyond
 * start-of-string. Whitespace covers the common case; the opening brackets
 * let a parenthetical crossref like "(@fig:x{a})" or "[@eq:y]"-as-prose
 * still be recognised even though nothing whitespace-like precedes the `@`.
 */
const PRECEDING_OK = /[\s([{]/;
/**
 * Pandoc-style width attribute block written immediately after an image:
 * `![alt](fig.png){width=50%}`. One key, one value, no spaces and no quotes is
 * the whole grammar, deliberately — anything wider turns the source into a
 * styling dialect. A bare number means px, as pandoc reads it.
 */
const IMAGE_WIDTH = /^\{width=(\d+(?:\.\d+)?)(%|px)?\}/;

export function parseSciMark(source: string): SciMarkRoot {
  const root = processor.parse(source);
  transformRawLatex(root);
  transformFigureEmbeds(root);
  transformImageAttributes(root);
  transformInline(root);
  return root;
}

function clonePosition(position: Position): Position {
  return { start: { ...position.start }, end: { ...position.end } };
}

function copyPosition(
  target: { position?: Position | undefined },
  source: { position?: Position | undefined },
): void {
  if (source.position) target.position = clonePosition(source.position);
}

function transformRawLatex(root: SciMarkRoot): void {
  visit(root, 'code', (node, index, parent) => {
    if (parent === undefined || index === undefined) return;
    if (node.lang !== '{=latex}') return;
    const raw: RawLatexNode = { type: 'rawLatex', value: node.value };
    copyPosition(raw, node);
    parent.children[index] = raw;
  });
}

function transformFigureEmbeds(root: SciMarkRoot): void {
  visit(root, 'paragraph', (node, index, parent) => {
    if (parent === undefined || index === undefined) return;
    if (!node.children.every((child) => child.type === 'text')) return;
    const text = toString(node).trim();
    const match = FIGURE_EMBED.exec(text);
    const figureId = match?.[1];
    if (figureId !== undefined) {
      const embed: FigureEmbedNode = { type: 'figureEmbed', figureId };
      copyPosition(embed, node);
      parent.children[index] = embed;
      return;
    }
    const tableMatch = TABLE_EMBED.exec(text);
    const tableId = tableMatch?.[1];
    if (tableId === undefined) return;
    const embed: TableEmbedNode = { type: 'tableEmbed', tableId };
    copyPosition(embed, node);
    parent.children[index] = embed;
  });
}

function shiftPoint(point: Point | undefined, by: number): void {
  if (point === undefined) return;
  point.column += by;
  if (typeof point.offset === 'number') point.offset += by;
}

function imageWidth(text: string): { css: string; length: number } | undefined {
  const match = IMAGE_WIDTH.exec(text);
  const digits = match?.[1];
  if (match === null || digits === undefined) return undefined;
  if (Number(digits) <= 0) return undefined;
  return { css: `${digits}${match[2] ?? 'px'}`, length: match[0].length };
}

/**
 * Consumes `{width=…}` into the image node it follows. Anything the grammar
 * does not accept is left exactly where it is, so the braces survive as
 * literal text in every renderer — a visible `{width=huge}` is the honest
 * failure for a file that has to stay portable markdown.
 *
 * The block is consumed from both ends: the image's end point grows over it,
 * which is what makes the editor's syntax hiding cover the braces without a
 * decoration of its own, and the text node it came from loses it, which keeps
 * it out of the rendered prose.
 */
function transformImageAttributes(root: SciMarkRoot): void {
  visit(root, 'image', (node, index, parent) => {
    if (parent === undefined || index === undefined) return;
    const next = parent.children[index + 1];
    if (next === undefined || next.type !== 'text') return;
    const width = imageWidth(next.value);
    if (width === undefined) return;
    node.data = { ...node.data, width: width.css };
    shiftPoint(node.position?.end, width.length);
    const rest = next.value.slice(width.length);
    if (rest.length === 0) {
      parent.children.splice(index + 1, 1);
      return;
    }
    next.value = rest;
    shiftPoint(next.position?.start, width.length);
  });
}

function transformInline(root: SciMarkRoot): void {
  visit(root, 'text', (node, index, parent) => {
    if (parent === undefined || index === undefined) return;
    const segments = scanText(node);
    if (segments === undefined) return;
    parent.children.splice(index, 1, ...segments);
    return index + segments.length;
  });
}

function crossRefKind(value: string): CrossRefKind | undefined {
  switch (value) {
    case 'fig':
    case 'tbl':
    case 'eq':
    case 'sec':
      return value;
    default:
      return undefined;
  }
}

function splitCrossRef(key: string): { kind: CrossRefKind; id: string } | undefined {
  const colon = key.indexOf(':');
  if (colon <= 0) return undefined;
  const kind = crossRefKind(key.slice(0, colon));
  const id = key.slice(colon + 1);
  if (kind === undefined || id.length === 0) return undefined;
  return { kind, id };
}

function trimTrailingPunctuation(key: string): string {
  let end = key.length;
  while (end > 0 && /[.:-]/.test(key.charAt(end - 1))) end -= 1;
  return key.slice(0, end);
}

function parseBracketedKeys(token: string): string[] | undefined {
  const items = token.slice(1, -1).split(';');
  const keys: string[] = [];
  for (const item of items) {
    const match = BRACKET_ITEM.exec(item.trim());
    const key = match?.[1];
    if (key === undefined) return undefined;
    keys.push(key);
  }
  return keys.length > 0 ? keys : undefined;
}

interface InlineMatch {
  node: CitationNode | CrossRefNode;
  consumed: number;
}

function matchBare(token: string): InlineMatch | undefined {
  const match = BARE.exec(token);
  if (match === null) return undefined;
  const keyRaw = match[1];
  const suffixGroup = match[2];
  const suffixInner = match[3];
  if (keyRaw === undefined) return undefined;

  if (suffixGroup !== undefined && suffixInner !== undefined && suffixInner.length > 0) {
    const crossRef = splitCrossRef(keyRaw);
    if (crossRef !== undefined) {
      return {
        node: {
          type: 'crossRef',
          kind: crossRef.kind,
          id: crossRef.id,
          suffix: suffixInner,
        },
        consumed: 1 + keyRaw.length + suffixGroup.length,
      };
    }
  }

  const key = trimTrailingPunctuation(keyRaw);
  if (key.length < 2) return undefined;
  const consumed = 1 + key.length;
  const crossRef = splitCrossRef(key);
  if (crossRef !== undefined) {
    return { node: { type: 'crossRef', kind: crossRef.kind, id: crossRef.id }, consumed };
  }
  return { node: { type: 'citation', keys: [key], narrative: true }, consumed };
}

function scanText(node: Text): PhrasingContent[] | undefined {
  const value = node.value;
  const segments: PhrasingContent[] = [];
  let cursor = 0;
  SCAN.lastIndex = 0;
  let match = SCAN.exec(value);

  while (match !== null) {
    const token = match[0];
    const start = match.index;
    let produced: InlineMatch | undefined;

    if (token.startsWith('[@')) {
      const keys = parseBracketedKeys(token);
      if (keys !== undefined) {
        produced = {
          node: { type: 'citation', keys, narrative: false },
          consumed: token.length,
        };
      }
    } else if (start === 0 || PRECEDING_OK.test(value.charAt(start - 1))) {
      produced = matchBare(token);
    }

    if (produced !== undefined) {
      if (start > cursor) {
        const leading: Text = { type: 'text', value: value.slice(cursor, start) };
        copyPosition(leading, node);
        segments.push(leading);
      }
      copyPosition(produced.node, node);
      segments.push(produced.node);
      cursor = start + produced.consumed;
      SCAN.lastIndex = cursor;
    }
    match = SCAN.exec(value);
  }

  if (segments.length === 0) return undefined;
  if (cursor < value.length) {
    const trailing: Text = { type: 'text', value: value.slice(cursor) };
    copyPosition(trailing, node);
    segments.push(trailing);
  }
  return segments;
}
