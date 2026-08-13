import { describe, expect, it } from 'vitest';
import { parseSciMark } from './parse';
import { renderHtml } from './html';
import type { RenderOptions } from './html';

function render(source: string, options?: RenderOptions): string {
  return renderHtml(parseSciMark(source), options);
}

describe('math rendering', () => {
  it('renders inline math through katex', () => {
    const html = render('Energy is $E = mc^2$ here.');
    expect(html).toContain('katex');
    expect(html).not.toContain('$E = mc^2$');
  });

  it('renders display math in display mode inside a math block', () => {
    const html = render('$$\n\\int_0^1 x\\,dx\n$$');
    expect(html).toContain('class="math math--display"');
    expect(html).toContain('katex-display');
    expect(html).toMatch(/<div class="math math--display" data-pos="\d+-\d+">/);
  });

  it('turns an opening-fence {#eq:label} into the block id', () => {
    const html = render('$$ {#eq:stripping}\nP = \\rho v^2\n$$');
    expect(html).toContain('id="eq:stripping"');
    expect(html).toContain('katex-display');
    expect(html).not.toContain('{#eq:stripping}');
  });

  it('ignores malformed opening-fence meta', () => {
    const html = render('$$ not-a-label\nP = \\rho v^2\n$$');
    expect(html).not.toContain('id=');
    expect(html).toContain('katex-display');
  });
});

describe('citation rendering', () => {
  it('renders the default unresolved chip', () => {
    const html = render('Shown in [@wang2025; @smith2024].');
    expect(html).toContain(
      '<sup class="cite cite--unresolved" data-keys="wang2025,smith2024">[wang2025; smith2024]</sup>',
    );
  });

  it('uses the resolveCitation callback when provided', () => {
    const html = render('Shown in [@wang2025; @smith2024] and by @jones2023 too.', {
      resolveCitation: (keys, narrative) =>
        `<span class="cite">${narrative ? 'N' : 'P'}:${keys.join('+')}</span>`,
    });
    expect(html).toContain('<span class="cite">P:wang2025+smith2024</span>');
    expect(html).toContain('<span class="cite">N:jones2023</span>');
    expect(html).not.toContain('cite--unresolved');
  });
});

describe('cross-reference rendering', () => {
  it('renders the default unresolved xref', () => {
    const html = render('See @fig:cluster now.');
    expect(html).toContain(
      '<a class="xref xref--unresolved" data-kind="fig" data-id="cluster">fig:cluster</a>',
    );
  });

  it('carries the panel suffix', () => {
    const html = render('See @fig:cluster{b} now.');
    expect(html).toContain('data-suffix="b"');
  });

  it('uses the resolveCrossRef callback when provided', () => {
    const html = render('See @fig:cluster{b} now.', {
      resolveCrossRef: (kind, id, suffix) => `<a class="xref">Fig. 2${suffix ?? ''} (${kind}:${id})</a>`,
    });
    expect(html).toContain('<a class="xref">Fig. 2b (fig:cluster)</a>');
  });
});

describe('figure embeds', () => {
  it('renders the default unresolved figure', () => {
    const html = render('![[fig:x]]');
    expect(html).toMatch(
      /<figure class="figure figure--unresolved" data-figure-id="x" data-pos="1-1"><\/figure>/,
    );
  });

  it('uses the resolveFigure callback when provided', () => {
    const html = render('![[fig:x]]', {
      resolveFigure: (figureId) => ({
        svgHtml: `<svg data-id="${figureId}"></svg>`,
        number: 'Figure 3.',
        captionHtml: 'A <em>cluster</em> map.',
      }),
    });
    expect(html).toContain('<svg data-id="x"></svg>');
    expect(html).toContain('<figcaption><span class="figure-number">Figure 3.</span> A <em>cluster</em> map.</figcaption>');
    expect(html).not.toContain('figure--unresolved');
  });
});

describe('raw latex', () => {
  it('emits a placeholder comment, never the raw latex text', () => {
    const html = render('```{=latex}\n\\begin{tabular}{cc}\na & b\n\\end{tabular}\n```');
    expect(html).toContain('<!-- scimark:raw-latex omitted in HTML preview -->');
    expect(html).not.toContain('begin{tabular}');
    expect(html).not.toContain('\\begin');
  });
});

describe('GFM support', () => {
  it('renders tables with header and alignment', () => {
    const html = render('| a | b |\n| :-- | --: |\n| 1 | 2 |');
    expect(html).toContain('<table');
    expect(html).toContain('<th style="text-align:left">a</th>');
    expect(html).toContain('<td style="text-align:right">2</td>');
  });

  it('renders strikethrough', () => {
    expect(render('This is ~~wrong~~ right.')).toContain('<del>wrong</del>');
  });
});

describe('data-pos attributes', () => {
  it('stamps paragraphs with start-end lines', () => {
    const html = render('First paragraph.\n\nSecond one\nspanning two lines.');
    expect(html).toContain('<p data-pos="1-1">First paragraph.</p>');
    expect(html).toContain('<p data-pos="3-4">Second one\nspanning two lines.</p>');
  });

  it('stamps headings and code blocks', () => {
    const html = render('# Title\n\n```python\nprint(1)\n```');
    expect(html).toContain('<h1 data-pos="1-1">Title</h1>');
    expect(html).toMatch(/<pre data-pos="3-5">/);
  });
});

describe('plain CommonMark', () => {
  it('renders emphasis, strong, links, and lists', () => {
    const html = render('Some *em* and **strong** and a [link](https://example.org "T").\n\n- one\n- two\n\n1. first');
    expect(html).toContain('<em>em</em>');
    expect(html).toContain('<strong>strong</strong>');
    expect(html).toContain('<a href="https://example.org" title="T">link</a>');
    expect(html).toContain('<ul');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<ol');
    expect(html).toContain('<li>first</li>');
  });

  it('renders heading levels without inventing numbering', () => {
    const html = render('# One\n\n## Two\n\n### Three');
    expect(html).toContain('<h1 data-pos="1-1">One</h1>');
    expect(html).toContain('<h2 data-pos="3-3">Two</h2>');
    expect(html).toContain('<h3 data-pos="5-5">Three</h3>');
    expect(html).not.toMatch(/1\.\s*One/);
  });

  it('renders blockquotes and inline code', () => {
    const html = render('> quoted `code` here');
    expect(html).toMatch(/<blockquote data-pos="1-1"><p data-pos="1-1">quoted <code>code<\/code> here<\/p><\/blockquote>/);
  });
});

describe('escaping', () => {
  it('escapes HTML-significant characters in text', () => {
    const html = render('Compare 5 < 6 & 6 > 5 with "quotes".');
    expect(html).toContain('Compare 5 &lt; 6 &amp; 6 &gt; 5 with &quot;quotes&quot;.');
  });

  it('escapes code content', () => {
    const html = render('```\n<script>alert(1)</script>\n```');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });
});
