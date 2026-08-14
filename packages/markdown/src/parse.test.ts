import type { Paragraph, PhrasingContent, RootContent } from 'mdast';
import { describe, expect, it } from 'vitest';
import { parseSciMark } from './parse';

function narrow<T extends { type: string }, K extends T['type']>(
  node: T | undefined,
  type: K,
): Extract<T, { type: K }> {
  if (node === undefined || node.type !== type) {
    throw new Error(`expected ${type}, got ${node?.type ?? 'undefined'}`);
  }
  return node as Extract<T, { type: K }>;
}

function firstParagraph(source: string): Paragraph {
  const root = parseSciMark(source);
  return narrow<RootContent, 'paragraph'>(root.children[0], 'paragraph');
}

function inlineNodes(source: string): PhrasingContent[] {
  return firstParagraph(source).children;
}

describe('citations', () => {
  it('parses a bracketed multi-key citation', () => {
    const nodes = inlineNodes('As shown in [@wang2025; @smith2024], clusters form.');
    const citation = narrow(nodes[1], 'citation');
    expect(citation.keys).toEqual(['wang2025', 'smith2024']);
    expect(citation.narrative).toBe(false);
  });

  it('parses a single bracketed citation', () => {
    const citation = narrow(inlineNodes('Prior work [@wang2025] agrees.')[1], 'citation');
    expect(citation.keys).toEqual(['wang2025']);
    expect(citation.narrative).toBe(false);
  });

  it('parses a narrative citation preceded by whitespace', () => {
    const nodes = inlineNodes('As @wang2025 showed, gas cools.');
    const citation = narrow(nodes[1], 'citation');
    expect(citation.keys).toEqual(['wang2025']);
    expect(citation.narrative).toBe(true);
    expect(narrow(nodes[0], 'text').value).toBe('As ');
    expect(narrow(nodes[2], 'text').value).toBe(' showed, gas cools.');
  });

  it('parses a narrative citation at start of text', () => {
    const citation = narrow(inlineNodes('@wang2025 showed this.')[0], 'citation');
    expect(citation.narrative).toBe(true);
  });

  it('drops trailing sentence punctuation from narrative keys', () => {
    const citation = narrow(inlineNodes('See @wang2025.')[1], 'citation');
    expect(citation.keys).toEqual(['wang2025']);
  });

  it('does not match email-like text mid-word', () => {
    const root = parseSciMark('Contact ihaber@wisc.edu for data.');
    const types: string[] = [];
    const collect = (nodes: RootContent[]): void => {
      for (const node of nodes) {
        types.push(node.type);
        if ('children' in node) collect(node.children as RootContent[]);
      }
    };
    collect(root.children);
    expect(types).not.toContain('citation');
    expect(types).not.toContain('crossRef');
  });

  it('does not match @ glued to a preceding word', () => {
    const nodes = inlineNodes('word@key2020 is not a citation');
    expect(nodes).toHaveLength(1);
    expect(narrow(nodes[0], 'text').value).toBe('word@key2020 is not a citation');
  });
});

describe('cross-references', () => {
  it('parses @fig:cluster as a crossRef', () => {
    const xref = narrow(inlineNodes('See @fig:cluster for the map.')[1], 'crossRef');
    expect(xref.kind).toBe('fig');
    expect(xref.id).toBe('cluster');
    expect(xref.suffix).toBeUndefined();
  });

  it('parses panel suffix @fig:cluster{b}', () => {
    const xref = narrow(inlineNodes('Panel @fig:cluster{b} shows the residuals.')[1], 'crossRef');
    expect(xref.kind).toBe('fig');
    expect(xref.id).toBe('cluster');
    expect(xref.suffix).toBe('b');
  });

  it('parses tbl, eq, and sec kinds', () => {
    expect(narrow(inlineNodes('In @tbl:params we list values.')[1], 'crossRef').kind).toBe('tbl');
    expect(narrow(inlineNodes('From @eq:tf it follows.')[1], 'crossRef').kind).toBe('eq');
    expect(narrow(inlineNodes('As in @sec:methods we fit.')[1], 'crossRef').kind).toBe('sec');
  });

  it('drops trailing punctuation after a crossRef', () => {
    const nodes = inlineNodes('Shown in @fig:cluster.');
    const xref = narrow(nodes[1], 'crossRef');
    expect(xref.id).toBe('cluster');
    expect(narrow(nodes[2], 'text').value).toBe('.');
  });

  it('treats unknown prefixes as citations, not crossRefs', () => {
    const citation = narrow(inlineNodes('See @data:release for details.')[1], 'citation');
    expect(citation.keys).toEqual(['data:release']);
  });

  it('parses a panel-suffix crossRef immediately inside parentheses', () => {
    const nodes = inlineNodes('Panels show (@fig:x{a}) clearly.');
    const xref = narrow(nodes[1], 'crossRef');
    expect(xref.kind).toBe('fig');
    expect(xref.id).toBe('x');
    expect(xref.suffix).toBe('a');
    expect(narrow(nodes[0], 'text').value).toBe('Panels show (');
    expect(narrow(nodes[2], 'text').value).toBe(') clearly.');
  });

  it('parses a multi-item suffix after "see"', () => {
    const xref = narrow(inlineNodes('see @fig:x{b,c} for both panels.')[1], 'crossRef');
    expect(xref.kind).toBe('fig');
    expect(xref.id).toBe('x');
    expect(xref.suffix).toBe('b,c');
  });

  it('drops a trailing period from an eq crossRef with no suffix', () => {
    const nodes = inlineNodes('This follows from @eq:y.');
    const xref = narrow(nodes[1], 'crossRef');
    expect(xref.kind).toBe('eq');
    expect(xref.id).toBe('y');
    expect(xref.suffix).toBeUndefined();
    expect(narrow(nodes[2], 'text').value).toBe('.');
  });

  it('drops a trailing comma from a tbl crossRef with no suffix', () => {
    const nodes = inlineNodes('As in @tbl:z, we list values.');
    const xref = narrow(nodes[1], 'crossRef');
    expect(xref.kind).toBe('tbl');
    expect(xref.id).toBe('z');
    expect(narrow(nodes[2], 'text').value).toBe(', we list values.');
  });

  it('parses a sec crossRef with suffix at the start of a sentence', () => {
    const xref = narrow(inlineNodes('@sec:methods{2} covers the appendix case.')[0], 'crossRef');
    expect(xref.kind).toBe('sec');
    expect(xref.id).toBe('methods');
    expect(xref.suffix).toBe('2');
  });
});

describe('figure embeds', () => {
  it('converts a paragraph containing exactly ![[fig:x]] into a figureEmbed', () => {
    const root = parseSciMark('Intro text.\n\n![[fig:x]]\n\nMore text.');
    const embed = narrow(root.children[1], 'figureEmbed');
    expect(embed.figureId).toBe('x');
  });

  it('leaves paragraphs with extra text around the embed untouched', () => {
    const root = parseSciMark('before ![[fig:x]] after');
    expect(narrow(root.children[0], 'paragraph').type).toBe('paragraph');
  });
});

describe('raw latex fences', () => {
  it('converts a {=latex} fence into a rawLatex node', () => {
    const root = parseSciMark('```{=latex}\n\\begin{tabular}{cc}\na & b\n\\end{tabular}\n```');
    const raw = narrow(root.children[0], 'rawLatex');
    expect(raw.value).toBe('\\begin{tabular}{cc}\na & b\n\\end{tabular}');
  });

  it('leaves ordinary fenced code untouched', () => {
    const root = parseSciMark('```python\nprint(1)\n```');
    const code = narrow(root.children[0], 'code');
    expect(code.lang).toBe('python');
  });
});

describe('math', () => {
  it('parses inline math', () => {
    const math = narrow(inlineNodes('Energy is $E = mc^2$ here.')[1], 'inlineMath');
    expect(math.value).toBe('E = mc^2');
  });

  it('parses display math as a block', () => {
    const root = parseSciMark('$$\n\\int_0^1 x\\,dx\n$$');
    const math = narrow(root.children[0], 'math');
    expect(math.value).toContain('\\int_0^1');
  });
});

describe('positions', () => {
  it('preserves position info on generated inline nodes', () => {
    const nodes = inlineNodes('See [@wang2025] and @fig:cluster now.');
    const citation = narrow(nodes[1], 'citation');
    const xref = narrow(nodes[3], 'crossRef');
    expect(citation.position?.start.line).toBe(1);
    expect(xref.position?.start.line).toBe(1);
  });

  it('preserves position info on block-level generated nodes', () => {
    const root = parseSciMark('![[fig:x]]\n\n```{=latex}\n\\alpha\n```');
    expect(narrow(root.children[0], 'figureEmbed').position?.start.line).toBe(1);
    expect(narrow(root.children[1], 'rawLatex').position?.start.line).toBe(3);
  });
});

describe('plain CommonMark passthrough', () => {
  it('keeps emphasis, links, and lists untouched', () => {
    const root = parseSciMark('Some *emphasis* and a [link](https://example.org).\n\n- one\n- two');
    const paragraph = narrow(root.children[0], 'paragraph');
    expect(paragraph.children.some((n) => n.type === 'emphasis')).toBe(true);
    expect(paragraph.children.some((n) => n.type === 'link')).toBe(true);
    const list = narrow(root.children[1], 'list');
    expect(list.children).toHaveLength(2);
  });

  it('parses GFM tables', () => {
    const root = parseSciMark('| a | b |\n| --- | --- |\n| 1 | 2 |');
    const table = narrow(root.children[0], 'table');
    expect(table.children).toHaveLength(2);
  });
});
