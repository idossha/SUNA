import katex from 'katex';
import type {
  AlignType,
  Definition,
  List,
  ListItem,
  Node,
  RootContent,
  Table,
} from 'mdast';
import { visit } from 'unist-util-visit';
import type { CrossRefKind, FigureEmbedNode, SciMarkRoot } from './ast';

export interface FigureResolution {
  svgHtml?: string;
  number?: string;
  captionHtml?: string;
}

export interface RenderOptions {
  resolveCitation?: (keys: string[], narrative: boolean) => string;
  resolveCrossRef?: (kind: CrossRefKind, id: string, suffix?: string) => string;
  resolveFigure?: (figureId: string) => FigureResolution;
  /**
   * The `src` to give a markdown image, so a caller that can reach the file
   * system (the export path) can inline the bytes this package must not read.
   * `null` means the image could not be resolved at all, and the alt text
   * stands in for it — the same degradation an `imageReference` with no
   * definition already gets.
   */
  resolveImage?: (url: string, alt: string) => string | null;
}

interface RenderContext {
  options: RenderOptions;
  definitions: Map<string, Definition>;
}

export function renderHtml(root: SciMarkRoot, options: RenderOptions = {}): string {
  const definitions = new Map<string, Definition>();
  visit(root, 'definition', (node) => {
    definitions.set(node.identifier, node);
  });
  const ctx: RenderContext = { options, definitions };
  return root.children
    .map((child) => renderNode(child, ctx))
    .filter((html) => html.length > 0)
    .join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function posAttr(node: Node): string {
  const position = node.position;
  return position ? ` data-pos="${position.start.line}-${position.end.line}"` : '';
}

function renderChildren(children: readonly RootContent[], ctx: RenderContext): string {
  return children.map((child) => renderNode(child, ctx)).join('');
}

function renderBlockChildren(children: readonly RootContent[], ctx: RenderContext): string {
  return children
    .map((child) => renderNode(child, ctx))
    .filter((html) => html.length > 0)
    .join('\n');
}

function renderMath(value: string, displayMode: boolean): string {
  return katex.renderToString(value, { displayMode, throwOnError: false });
}

function renderCitation(keys: string[], narrative: boolean, ctx: RenderContext): string {
  const resolver = ctx.options.resolveCitation;
  if (resolver) return resolver(keys, narrative);
  const dataKeys = escapeHtml(keys.join(','));
  const label = escapeHtml(`[${keys.join('; ')}]`);
  return `<sup class="cite cite--unresolved" data-keys="${dataKeys}">${label}</sup>`;
}

function renderCrossRef(kind: CrossRefKind, id: string, suffix: string | undefined, ctx: RenderContext): string {
  const resolver = ctx.options.resolveCrossRef;
  if (resolver) return resolver(kind, id, suffix);
  const suffixAttr = suffix === undefined ? '' : ` data-suffix="${escapeHtml(suffix)}"`;
  return `<a class="xref xref--unresolved" data-kind="${kind}" data-id="${escapeHtml(id)}"${suffixAttr}>${escapeHtml(`${kind}:${id}`)}</a>`;
}

function renderFigureEmbed(node: FigureEmbedNode, ctx: RenderContext): string {
  const idAttr = escapeHtml(node.figureId);
  const resolver = ctx.options.resolveFigure;
  if (!resolver) {
    return `<figure class="figure figure--unresolved" data-figure-id="${idAttr}"${posAttr(node)}></figure>`;
  }
  const { svgHtml, number, captionHtml } = resolver(node.figureId);
  const parts: string[] = [];
  if (svgHtml !== undefined) parts.push(svgHtml);
  if (number !== undefined || captionHtml !== undefined) {
    const numberHtml = number === undefined ? '' : `<span class="figure-number">${escapeHtml(number)}</span> `;
    parts.push(`<figcaption>${numberHtml}${captionHtml ?? ''}</figcaption>`);
  }
  return `<figure class="figure" data-figure-id="${idAttr}"${posAttr(node)}>${parts.join('')}</figure>`;
}

function renderImage(
  url: string,
  alt: string,
  title: string | null | undefined,
  width: string | undefined,
  ctx: RenderContext,
): string {
  const resolver = ctx.options.resolveImage;
  const src = resolver === undefined ? url : resolver(url, alt);
  if (src === null) return escapeHtml(alt);
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  // A `max-width`, never a definite `width`. Both axes have to stay `auto`:
  // measured in Chromium against the export stylesheet (660px column, a
  // 400px max-height cap, a 500x1400 source), `width:100%` renders 660x400 —
  // aspect 1.65 against a natural 0.357 — because `object-fit` defaults to
  // `fill`, while `max-width:50%` renders 142.85x400, the natural ratio.
  //
  // `min(…,100%)` so an over-wide value cannot escape the measure either, and
  // the semantic then matches reading mode exactly (ImageWidget narrows the
  // holder and leaves the art at its natural size): `{width=…}` can only ever
  // make an image smaller, in all three renderers.
  const styleAttr =
    width === undefined ? '' : ` style="max-width:min(${escapeHtml(width)},100%)"`;
  return `<img class="md-image" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${titleAttr}${styleAttr}/>`;
}

function alignStyle(align: AlignType | undefined): string {
  return align === 'left' || align === 'center' || align === 'right'
    ? ` style="text-align:${align}"`
    : '';
}

function renderTable(node: Table, ctx: RenderContext): string {
  const align = node.align ?? [];
  const renderRow = (row: RootContent, tag: 'th' | 'td'): string => {
    if (row.type !== 'tableRow') return '';
    const cells = row.children
      .map((cell, column) => `<${tag}${alignStyle(align[column])}>${renderChildren(cell.children, ctx)}</${tag}>`)
      .join('');
    return `<tr>${cells}</tr>`;
  };
  const [head, ...body] = node.children;
  const headHtml = head === undefined ? '' : `<thead>${renderRow(head, 'th')}</thead>`;
  const bodyHtml =
    body.length === 0 ? '' : `<tbody>${body.map((row) => renderRow(row, 'td')).join('')}</tbody>`;
  return `<table${posAttr(node)}>${headHtml}${bodyHtml}</table>`;
}

function renderList(node: List, ctx: RenderContext): string {
  const loose = node.spread === true || node.children.some((item) => item.spread === true);
  const items = node.children.map((item) => renderListItem(item, ctx, !loose)).join('\n');
  if (node.ordered === true) {
    const startAttr =
      node.start !== null && node.start !== undefined && node.start !== 1
        ? ` start="${node.start}"`
        : '';
    return `<ol${startAttr}${posAttr(node)}>\n${items}\n</ol>`;
  }
  return `<ul${posAttr(node)}>\n${items}\n</ul>`;
}

function renderListItem(node: ListItem, ctx: RenderContext, tight: boolean): string {
  const checkbox =
    node.checked === true || node.checked === false
      ? `<input type="checkbox" disabled${node.checked ? ' checked' : ''}/> `
      : '';
  const content = tight
    ? node.children
        .map((child) => (child.type === 'paragraph' ? renderChildren(child.children, ctx) : renderNode(child, ctx)))
        .filter((html) => html.length > 0)
        .join('\n')
    : renderBlockChildren(node.children, ctx);
  return `<li>${checkbox}${content}</li>`;
}

function renderNode(node: RootContent, ctx: RenderContext): string {
  switch (node.type) {
    case 'paragraph':
      return `<p${posAttr(node)}>${renderChildren(node.children, ctx)}</p>`;
    case 'heading': {
      const level = Math.min(node.depth, 6);
      return `<h${level}${posAttr(node)}>${renderChildren(node.children, ctx)}</h${level}>`;
    }
    case 'text':
      return escapeHtml(node.value);
    case 'emphasis':
      return `<em>${renderChildren(node.children, ctx)}</em>`;
    case 'strong':
      return `<strong>${renderChildren(node.children, ctx)}</strong>`;
    case 'delete':
      return `<del>${renderChildren(node.children, ctx)}</del>`;
    case 'inlineCode':
      return `<code>${escapeHtml(node.value)}</code>`;
    case 'code': {
      const langAttr = node.lang ? ` class="language-${escapeHtml(node.lang)}"` : '';
      return `<pre${posAttr(node)}><code${langAttr}>${escapeHtml(node.value)}</code></pre>`;
    }
    case 'blockquote':
      return `<blockquote${posAttr(node)}>${renderBlockChildren(node.children, ctx)}</blockquote>`;
    case 'list':
      return renderList(node, ctx);
    case 'listItem':
      return renderListItem(node, ctx, false);
    case 'thematicBreak':
      return `<hr${posAttr(node)}/>`;
    case 'break':
      return '<br/>';
    case 'link': {
      const titleAttr = node.title ? ` title="${escapeHtml(node.title)}"` : '';
      return `<a href="${escapeHtml(node.url)}"${titleAttr}>${renderChildren(node.children, ctx)}</a>`;
    }
    case 'image':
      return renderImage(node.url, node.alt ?? '', node.title, node.data?.width, ctx);
    case 'linkReference': {
      const definition = ctx.definitions.get(node.identifier);
      const inner = renderChildren(node.children, ctx);
      if (definition === undefined) return inner;
      const titleAttr = definition.title ? ` title="${escapeHtml(definition.title)}"` : '';
      return `<a href="${escapeHtml(definition.url)}"${titleAttr}>${inner}</a>`;
    }
    case 'imageReference': {
      const definition = ctx.definitions.get(node.identifier);
      const alt = node.alt ?? '';
      if (definition === undefined) return escapeHtml(alt);
      // No width: the attribute block is only read after an inline image.
      return renderImage(definition.url, alt, definition.title, undefined, ctx);
    }
    case 'definition':
      return '';
    case 'footnoteReference':
      return `<sup class="footnote-ref" data-id="${escapeHtml(node.identifier)}">[${escapeHtml(node.identifier)}]</sup>`;
    case 'footnoteDefinition':
      return '';
    case 'html':
      return node.value;
    case 'yaml':
      return '';
    case 'table':
      return renderTable(node, ctx);
    case 'tableRow':
      return '';
    case 'tableCell':
      return renderChildren(node.children, ctx);
    case 'math': {
      // Equation label convention: `$$ {#eq:label}` on the opening fence.
      const labelMatch = /^\{#(eq:[A-Za-z][\w:.-]*)\}$/.exec(node.meta?.trim() ?? '');
      const idAttr = labelMatch ? ` id="${escapeHtml(labelMatch[1] as string)}"` : '';
      return `<div class="math math--display"${idAttr}${posAttr(node)}>${renderMath(node.value, true)}</div>`;
    }
    case 'inlineMath':
      return renderMath(node.value, false);
    case 'citation':
      return renderCitation(node.keys, node.narrative, ctx);
    case 'crossRef':
      return renderCrossRef(node.kind, node.id, node.suffix, ctx);
    case 'figureEmbed':
      return renderFigureEmbed(node, ctx);
    case 'rawLatex':
      return `<!-- scimark:raw-latex omitted in HTML preview -->`;
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}
