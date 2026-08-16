import { describe, expect, it } from 'vitest';
import { outlineFromMarkdown } from './outline';

describe('outlineFromMarkdown', () => {
  it('returns nothing for an empty or whitespace-only file', () => {
    expect(outlineFromMarkdown('')).toEqual([]);
    expect(outlineFromMarkdown('   \n\n\t\n')).toEqual([]);
  });

  it('treats a file with no headings at all as one untitled leading section', () => {
    const md = 'Galaxies falling into dense clusters lose their gas.\n';
    const outline = outlineFromMarkdown(md);
    expect(outline).toHaveLength(1);
    expect(outline[0]?.level).toBe(0);
    expect(outline[0]?.title).toBe('');
    expect(outline[0]?.from).toBe(0);
    expect(outline[0]?.to).toBe(md.length);
    expect(outline[0]?.words).toBe(8);
  });

  it('keeps the unheaded introduction that precedes the first heading', () => {
    const md = ['Intro prose with two lines.', '', 'Still intro.', '', '# Results', '', 'Found it.', ''].join('\n');
    const outline = outlineFromMarkdown(md);
    expect(outline.map((s) => [s.level, s.title])).toEqual([
      [0, ''],
      [1, 'Results'],
    ]);
    const intro = outline[0];
    const results = outline[1];
    if (intro === undefined || results === undefined) throw new Error('expected two sections');
    expect(intro.from).toBe(0);
    expect(md.slice(intro.from, intro.to)).toBe('Intro prose with two lines.\n\nStill intro.\n\n');
    expect(intro.words).toBe(7);
    expect(md.slice(results.headingFrom, results.from)).toBe('# Results\n');
    expect(md.slice(results.from, results.to)).toBe('\nFound it.\n');
    expect(results.words).toBe(2);
  });

  it('handles a heading-only file (no body, zero words)', () => {
    const md = '# Results\n## Methods\n';
    const outline = outlineFromMarkdown(md);
    expect(outline.map((s) => [s.level, s.title, s.words])).toEqual([
      [1, 'Results', 0],
      [2, 'Methods', 0],
    ]);
    expect(outline[0]?.from).toBe(10);
    expect(outline[0]?.to).toBe(10);
    expect(outline[1]?.to).toBe(md.length);
  });

  it('ignores a # inside a fenced code block', () => {
    const md = [
      '# Methods',
      '',
      '```python',
      '# not a heading',
      'x = 1  # also not a heading',
      '```',
      '',
      'Prose after the fence.',
      '',
    ].join('\n');
    const outline = outlineFromMarkdown(md);
    expect(outline).toHaveLength(1);
    expect(outline[0]?.title).toBe('Methods');
    // Code contributes no words; only the trailing sentence does.
    expect(outline[0]?.words).toBe(4);
  });

  it('ignores a # inside inline code and inside an indented code block', () => {
    const md = ['Use `# heading` to make one.', '', '    # indented code, not a heading', ''].join('\n');
    const outline = outlineFromMarkdown(md);
    expect(outline).toHaveLength(1);
    expect(outline[0]?.level).toBe(0);
  });

  it('reports nested levels flat, in document order', () => {
    const md = [
      '# Results',
      '',
      'One.',
      '',
      '## Cluster identification',
      '',
      'Two.',
      '',
      '### Particle initialization',
      '',
      'Three.',
      '',
      '# Methods',
      '',
      'Four.',
      '',
    ].join('\n');
    const outline = outlineFromMarkdown(md);
    expect(outline.map((s) => [s.level, s.title, s.words])).toEqual([
      [1, 'Results', 1],
      [2, 'Cluster identification', 1],
      [3, 'Particle initialization', 1],
      [1, 'Methods', 1],
    ]);
  });

  it('tiles the document: every section is contiguous with the next', () => {
    const md = '# A\n\nalpha\n\n## B\n\nbeta\n\n# C\n\ngamma\n';
    const outline = outlineFromMarkdown(md);
    expect(outline[0]?.headingFrom).toBe(0);
    for (let i = 1; i < outline.length; i += 1) {
      expect(outline[i - 1]?.to).toBe(outline[i]?.headingFrom);
    }
    expect(outline.at(-1)?.to).toBe(md.length);
  });

  it('absorbs trailing whitespace into the last section without inventing words', () => {
    const md = '# Results\n\nOne two three.\n\n   \n\n';
    const outline = outlineFromMarkdown(md);
    expect(outline).toHaveLength(1);
    expect(outline[0]?.to).toBe(md.length);
    expect(outline[0]?.words).toBe(3);
    expect(outlineFromMarkdown('# Trailing spaces   \n')[0]?.title).toBe('Trailing spaces');
  });

  it('supports setext headings', () => {
    const md = ['Results', '=======', '', 'One.', '', 'Methods', '-------', '', 'Two.', ''].join('\n');
    const outline = outlineFromMarkdown(md);
    expect(outline.map((s) => [s.level, s.title])).toEqual([
      [1, 'Results'],
      [2, 'Methods'],
    ]);
    expect(md.slice(outline[0]?.from ?? 0, outline[0]?.to ?? 0)).toBe('\nOne.\n\n');
  });

  it('strips markdown syntax from heading titles but keeps inline math', () => {
    const outline = outlineFromMarkdown(
      '# The **rapid** quenching of $z = 1.7$ galaxies [see](http://x)\n',
    );
    expect(outline[0]?.title).toBe('The rapid quenching of $z = 1.7$ galaxies see');
  });

  it('counts words without letting markdown syntax split or inflate them', () => {
    // "very boldly stated" = 3 words even though bold splits the middle one,
    // the citation is one, the inline math is one, the image alt none.
    const md = '# H\n\nvery **bold**ly stated [@gunn1972] $\\rho v^2$ ![alt text here](fig.png)\n';
    expect(outlineFromMarkdown(md)[0]?.words).toBe(5);
  });

  it('excludes display math and raw HTML from the word count', () => {
    const md = '# H\n\n$$\nE = mc^2\n$$\n\n<div>markup only</div>\n\nTwo words\n';
    expect(outlineFromMarkdown(md)[0]?.words).toBe(2);
  });

  it('counts list items and table cells as prose', () => {
    const md = '# H\n\n- first item\n- second item\n\n| a | b |\n| - | - |\n| c | d |\n';
    expect(outlineFromMarkdown(md)[0]?.words).toBe(8);
  });

  it('does not treat a heading inside a blockquote or list item as a section', () => {
    const md = '# Real\n\n> # quoted\n\n- # listed\n';
    const outline = outlineFromMarkdown(md);
    expect(outline).toHaveLength(1);
    expect(outline[0]?.title).toBe('Real');
  });

  it('handles CRLF line endings', () => {
    const md = '# Results\r\n\r\nOne two.\r\n';
    const outline = outlineFromMarkdown(md);
    expect(outline).toHaveLength(1);
    expect(outline[0]?.title).toBe('Results');
    expect(md.slice(outline[0]?.from ?? 0)).toBe('\r\nOne two.\r\n');
    expect(outline[0]?.words).toBe(2);
  });
});
