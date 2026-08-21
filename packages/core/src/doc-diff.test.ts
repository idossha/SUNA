import { describe, expect, it } from 'vitest';
import {
  countWords,
  diffBibliography,
  diffFields,
  diffHunks,
  diffSections,
  diffStats,
  splitSections,
} from './doc-diff';
import { buildQuoteBlock, insertBlock } from './reply-markup';

const V1 = `# Introduction

Galaxies fall into clusters over cosmic time.

# Methods

We used a t-test to compare the two groups.

# Results

The effect was significant.
`;

const V2 = `# Introduction

Galaxies fall into clusters over cosmic time.

# Methods

We applied a linear mixed model to compare the two groups.

# Results

The effect was significant.

# Limitations

The sample is small.
`;

describe('splitSections', () => {
  it('cuts on ATX headings and keeps the heading with its prose', () => {
    const sections = splitSections(V1);
    expect(sections.map((s) => s.title)).toEqual(['Introduction', 'Methods', 'Results']);
    expect(V1.slice(sections[1]!.from, sections[1]!.to)).toContain('t-test');
  });

  it('reports text before the first heading as an untitled preamble', () => {
    const sections = splitSections('Loose opening words.\n\n# One\n\nBody.\n');
    expect(sections[0]!.level).toBe(0);
    expect(sections[0]!.title).toBe('');
    expect(sections[0]!.to).toBe('Loose opening words.\n\n'.length);
  });

  it('does not cut inside fenced code', () => {
    const text = '# Real\n\n```python\n# not a heading\nx = 1\n```\n\nAfter.\n';
    expect(splitSections(text).map((s) => s.title)).toEqual(['Real']);
  });

  it('records the heading path above a subsection', () => {
    const sections = splitSections('# Methods\n\n## Statistics\n\nWe fit.\n');
    expect(sections[1]!.ancestors).toEqual(['Methods']);
  });
});

describe('diffSections', () => {
  it('marks only the section that changed', () => {
    const diff = diffSections(V1, V2);
    const byTitle = new Map(diff.map((s) => [s.title, s]));
    expect(byTitle.get('Introduction')!.change).toBe('unchanged');
    expect(byTitle.get('Methods')!.change).toBe('modified');
    expect(byTitle.get('Results')!.change).toBe('unchanged');
  });

  it('reports a wholly new section as added, not as a rewrite of its neighbour', () => {
    const diff = diffSections(V1, V2);
    const added = diff.find((s) => s.title === 'Limitations');
    expect(added?.change).toBe('added');
    expect(added?.baseText).toBe('');
    // The section it follows must stay quiet — the bug an index-based
    // alignment would introduce.
    expect(diff.find((s) => s.title === 'Results')?.change).toBe('unchanged');
  });

  it('reports a deleted section as removed', () => {
    const diff = diffSections(V2, V1);
    expect(diff.find((s) => s.title === 'Limitations')?.change).toBe('removed');
  });

  it('counts the words each side gained and lost', () => {
    const methods = diffSections(V1, V2).find((s) => s.title === 'Methods')!;
    expect(methods.wordsRemoved).toBeGreaterThan(0);
    expect(methods.wordsAdded).toBeGreaterThan(0);
    // The unchanged tail of the sentence is not counted on either side.
    expect(methods.wordsRemoved).toBeLessThan(countWords(methods.baseText));
  });

  it('gives repeated headings distinct ids', () => {
    const text = '# Methods\n\n## Statistics\n\nA.\n\n# Results\n\n## Statistics\n\nB.\n';
    const ids = diffSections(text, text).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a section moved elsewhere is one removal and one addition', () => {
    const before = '# A\n\nx\n\n# Limits\n\nsmall\n\n# B\n\ny\n';
    const after = '# A\n\nx\n\n# B\n\ny\n\n# Limits\n\nsmall\n';
    const diff = diffSections(before, after);
    expect(diff.filter((s) => s.change === 'removed').map((s) => s.title)).toEqual(['Limits']);
    expect(diff.filter((s) => s.change === 'added').map((s) => s.title)).toEqual(['Limits']);
  });

  it('is empty of changes when nothing changed', () => {
    const stats = diffStats(diffSections(V1, V1));
    expect(stats.sectionsChanged).toBe(0);
    expect(stats.hunks).toBe(0);
    expect(stats.wordsAdded + stats.wordsRemoved).toBe(0);
  });
});

describe('diffHunks', () => {
  it('folds a replacement into one hunk carrying both coordinate spaces', () => {
    const base = 'we used a t-test here';
    const head = 'we used a linear model here';
    const hunks = diffHunks(base, head);
    expect(hunks).toHaveLength(1);
    const h = hunks[0]!;
    expect(base.slice(h.baseFrom, h.baseTo)).toBe('t-test');
    expect(head.slice(h.headFrom, h.headTo)).toBe('linear model');
  });

  it('gives a pure insertion an empty base range at the insertion point', () => {
    const hunks = diffHunks('alpha gamma', 'alpha beta gamma');
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.baseFrom).toBe(hunks[0]!.baseTo);
    expect('alpha beta gamma'.slice(hunks[0]!.headFrom, hunks[0]!.headTo)).toContain('beta');
  });

  it('gives a pure deletion an empty head range', () => {
    const hunks = diffHunks('alpha beta gamma', 'alpha gamma');
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.headFrom).toBe(hunks[0]!.headTo);
    expect('alpha beta gamma'.slice(hunks[0]!.baseFrom, hunks[0]!.baseTo)).toContain('beta');
  });

  it('finds nothing between identical texts', () => {
    expect(diffHunks('same', 'same')).toEqual([]);
  });
});

describe('diffFields', () => {
  it('keeps only the fields that changed', () => {
    const out = diffFields([
      { id: 'title', label: 'Title', base: 'A study', head: 'A study' },
      { id: 'abstract', label: 'Abstract', base: 'We find X.', head: 'We find Y.' },
    ]);
    expect(out.map((f) => f.id)).toEqual(['abstract']);
    expect(out[0]!.hunks).toHaveLength(1);
  });
});

describe('diffBibliography', () => {
  const A = `@article{smith2020,
  title = {A first paper},
  year = {2020}
}

@article{jones2019,
  title = {Another},
  year = {2019}
}
`;
  const B = `@article{smith2020,
  title = {A first paper},
  year  =  {2020}
}

@article{lee2023,
  title = {A new one},
  year = {2023}
}
`;

  it('reports added and removed keys', () => {
    const diff = diffBibliography(A, B);
    expect(diff.find((d) => d.citekey === 'lee2023')?.change).toBe('added');
    expect(diff.find((d) => d.citekey === 'jones2019')?.change).toBe('removed');
  });

  it('does not call a reflowed entry a change', () => {
    expect(diffBibliography(A, B).find((d) => d.citekey === 'smith2020')).toBeUndefined();
  });

  it('reports a real field edit as modified', () => {
    const edited = A.replace('{2019}', '{2018}');
    expect(diffBibliography(A, edited).map((d) => [d.citekey, d.change])).toEqual([
      ['jones2019', 'modified'],
    ]);
  });

  it('survives braces inside a title', () => {
    const braced = '@article{hubble1929,\n  title = {The {Hubble} Constant},\n  year = {1929}\n}\n';
    expect(diffBibliography('', braced).map((d) => d.citekey)).toEqual(['hubble1929']);
  });
});

describe('buildQuoteBlock', () => {
  it('fences the excerpt and marks the new words', () => {
    const excerpt = 'We applied a linear mixed model.';
    const block = buildQuoteBlock(excerpt, [{ from: 13, to: 31 }]);
    expect(block).toBe('::quote\nWe applied a +++linear mixed model+++.\n::\n');
  });

  it('takes an unmarked excerpt too', () => {
    expect(buildQuoteBlock('Unchanged prose.')).toBe('::quote\nUnchanged prose.\n::\n');
  });

  it('merges overlapping ranges rather than nesting marks', () => {
    const block = buildQuoteBlock('alpha beta gamma', [
      { from: 0, to: 9 },
      { from: 6, to: 10 },
    ]);
    expect(block.match(/\+\+\+/g)).toHaveLength(2);
  });

  it('drops a whitespace-only change', () => {
    expect(buildQuoteBlock('alpha beta', [{ from: 5, to: 6 }])).toBe('::quote\nalpha beta\n::\n');
  });

  it('leaves the author’s own marks alone outside the ranges', () => {
    expect(buildQuoteBlock('plain', [])).not.toContain('+++');
  });
});

describe('insertBlock', () => {
  it('opens a blank line when the reply does not already end in one', () => {
    const edit = insertBlock('RE: We agree.', 13, '::quote\nX\n::\n');
    expect(edit.text).toBe('RE: We agree.\n\n::quote\nX\n::\n');
    expect(edit.selectionStart).toBe(edit.text.length);
  });

  it('adds nothing to an empty reply', () => {
    expect(insertBlock('', 0, '::quote\nX\n::\n').text).toBe('::quote\nX\n::\n');
  });

  it('keeps the text after the caret', () => {
    const edit = insertBlock('A\n\nB', 3, '::quote\nX\n::\n');
    expect(edit.text).toBe('A\n\n::quote\nX\n::\n\nB');
  });
});

describe('section bodies', () => {
  it('compares the prose under a heading, not the heading line', () => {
    const before = '# Methods\n\nWe fit a line.\n'
    const after = '# Methods\n\nWe fit a curve.\n'
    const [section] = diffSections(before, after)
    expect(section!.headText).toBe('We fit a curve.')
    expect(section!.headText).not.toContain('#')
    expect(section!.title).toBe('Methods')
  })

  it('reports a reworded heading as one section out and one in', () => {
    const before = '# Methods\n\nSame prose.\n'
    const after = '# Materials and Methods\n\nSame prose.\n'
    const diff = diffSections(before, after)
    expect(diff.map((s) => `${s.title}:${s.change}`)).toEqual([
      'Methods:removed',
      'Materials and Methods:added'
    ])
  })

  it('does not report the blank line between sections as a change', () => {
    const before = '# A\n\nx\n\n# B\n\ny\n'
    const after = '# A\n\nx\n\n\n\n# B\n\ny\n'
    expect(diffStats(diffSections(before, after)).hunks).toBe(0)
  })
})
