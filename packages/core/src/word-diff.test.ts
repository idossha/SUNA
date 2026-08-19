import { describe, expect, it } from 'vitest';
import { applyDiffSpans, diffSpans, wordDiff, type DiffOp, type DiffSpan } from './word-diff';

/* ------------------------------------------------------------ invariants -- */

/**
 * The contract every result must satisfy, asserted on every case below and on
 * every randomized pair: the ops tile `a` and `b` in order with no gap and no
 * overlap, equal runs really are equal text, and the spans rebuild `b`.
 */
function checkContract(a: string, b: string): DiffOp[] {
  const ops = wordDiff(a, b);
  let ai = 0;
  let bi = 0;
  for (const op of ops) {
    if (op.kind === 'equal') {
      expect(op.aFrom).toBe(ai);
      expect(op.bFrom).toBe(bi);
      expect(op.aTo).toBeGreaterThan(op.aFrom);
      expect(a.slice(op.aFrom, op.aTo)).toBe(b.slice(op.bFrom, op.bTo));
      ai = op.aTo;
      bi = op.bTo;
    } else if (op.kind === 'delete') {
      expect(op.aFrom).toBe(ai);
      expect(op.bAt).toBe(bi);
      expect(op.aTo).toBeGreaterThan(op.aFrom);
      ai = op.aTo;
    } else {
      expect(op.aAt).toBe(ai);
      expect(op.bFrom).toBe(bi);
      expect(op.bTo).toBeGreaterThan(op.bFrom);
      bi = op.bTo;
    }
  }
  expect(ai).toBe(a.length);
  expect(bi).toBe(b.length);

  const spans = diffSpans(a, b);
  let cursor = -1;
  for (const span of spans) {
    expect(span.from).toBeGreaterThanOrEqual(cursor);
    expect(span.to).toBeGreaterThanOrEqual(span.from);
    expect(span.to).toBeLessThanOrEqual(a.length);
    expect(span.to > span.from || span.insert.length > 0).toBe(true);
    cursor = span.to;
  }
  expect(applyDiffSpans(a, spans)).toBe(b);
  return ops;
}

/** The text each span replaces, paired with what replaces it. */
function hunks(a: string, b: string): { removed: string; added: string }[] {
  return diffSpans(a, b).map((span: DiffSpan) => ({
    removed: a.slice(span.from, span.to),
    added: span.insert,
  }));
}

/* --------------------------------------------------------- word grain -- */

describe('wordDiff — word resolution', () => {
  it('marks only the changed word inside a sentence', () => {
    const a = 'The result was significant at the 3-sigma level.';
    const b = 'The result was marginal at the 3-sigma level.';
    checkContract(a, b);
    expect(hunks(a, b)).toEqual([{ removed: 'significant', added: 'marginal' }]);
  });

  it('marks only the changed identifier, not the call around it', () => {
    // The reference case from feature-plan-11: hashlib.md5() -> hashlib.sha256()
    const a = '        h = hashlib.md5()\n';
    const b = '        h = hashlib.sha256()\n';
    checkContract(a, b);
    expect(hunks(a, b)).toEqual([{ removed: 'md5', added: 'sha256' }]);
  });

  it('carries the space with an inserted word rather than stranding it', () => {
    const a = 'The result was significant.';
    const b = 'The result was highly significant.';
    checkContract(a, b);
    // ' highly', not 'highly ' — slideLeft moves the block onto the space.
    expect(hunks(a, b)).toEqual([{ removed: '', added: ' highly' }]);
  });

  it('carries the space with a deleted word too', () => {
    const a = 'The result was highly significant.';
    const b = 'The result was significant.';
    checkContract(a, b);
    expect(hunks(a, b)).toEqual([{ removed: ' highly', added: '' }]);
  });

  it('treats punctuation as its own token', () => {
    const a = 'we measured 6563.3 A';
    const b = 'we measured 6562.8 A';
    checkContract(a, b);
    expect(hunks(a, b)).toEqual([
      { removed: '6563', added: '6562' },
      { removed: '3', added: '8' },
    ]);
  });

  it('reports an insertion and a deletion in one sentence separately', () => {
    const a = 'alpha beta gamma delta epsilon';
    const b = 'alpha BETA gamma delta EPSILON';
    checkContract(a, b);
    expect(hunks(a, b)).toEqual([
      { removed: 'beta', added: 'BETA' },
      { removed: 'epsilon', added: 'EPSILON' },
    ]);
  });
});

/* ------------------------------------------------- the 11b gate: multi-span -- */

describe('diffSpans — one span per changed run', () => {
  it('does not swallow the untouched paragraphs between two edits', () => {
    // This is exactly what state/minimalDiff got wrong: its single span ran
    // from the first difference to the last, deleting everything between.
    const lines = Array.from({ length: 9 }, (_, i) => `Paragraph ${i} says something.`);
    const a = lines.join('\n\n');
    const edited = [...lines];
    edited[1] = 'Paragraph 1 says something else.';
    edited[7] = 'Paragraph 7 says nothing.';
    const b = edited.join('\n\n');

    checkContract(a, b);
    const spans = diffSpans(a, b);
    expect(spans).toHaveLength(2);
    // Neither span may reach across the untouched paragraphs 2..6.
    const untouched = a.indexOf('Paragraph 4');
    for (const span of spans) {
      expect(span.from <= untouched && span.to > untouched).toBe(false);
    }
    // And the whole edit is tiny, not "most of the document".
    const churn = spans.reduce((n, s) => n + (s.to - s.from) + s.insert.length, 0);
    expect(churn).toBeLessThan(60);
  });

  it('keeps an inserted paragraph to a single span', () => {
    const a = 'First para.\n\nThird para.\n';
    const b = 'First para.\n\nSecond para.\n\nThird para.\n';
    checkContract(a, b);
    expect(diffSpans(a, b)).toHaveLength(1);
  });

  it('reports a pure deletion as an empty insert over the removed range', () => {
    const a = 'keep this\ndrop this\nkeep that\n';
    const b = 'keep this\nkeep that\n';
    checkContract(a, b);
    expect(hunks(a, b)).toEqual([{ removed: 'drop this\n', added: '' }]);
  });
});

/* ------------------------------------------------------------ edge cases -- */

describe('wordDiff — edges', () => {
  it('returns nothing for two empty strings', () => {
    expect(wordDiff('', '')).toEqual([]);
    expect(diffSpans('', '')).toEqual([]);
  });

  it('returns one equal op for identical text', () => {
    const ops = wordDiff('same', 'same');
    expect(ops).toEqual([{ kind: 'equal', aFrom: 0, aTo: 4, bFrom: 0, bTo: 4 }]);
    expect(diffSpans('same', 'same')).toEqual([]);
  });

  it('handles insertion into an empty document', () => {
    checkContract('', 'hello world');
    expect(hunks('', 'hello world')).toEqual([{ removed: '', added: 'hello world' }]);
  });

  it('handles clearing a document', () => {
    checkContract('hello world', '');
    expect(hunks('hello world', '')).toEqual([{ removed: 'hello world', added: '' }]);
  });

  it('sees a whitespace-only rewrap', () => {
    const a = 'one two\nthree four\n';
    const b = 'one two three four\n';
    checkContract(a, b);
    expect(applyDiffSpans(a, diffSpans(a, b))).toBe(b);
  });

  it('never splits an astral character', () => {
    const a = 'orbit 🛰 telemetry';
    const b = 'orbit 🛰🛰 telemetry';
    checkContract(a, b);
    for (const span of diffSpans(a, b)) {
      // A split surrogate pair would leave a lone half at a boundary.
      expect(a.charCodeAt(span.from) >= 0xdc00 && a.charCodeAt(span.from) <= 0xdfff).toBe(false);
      expect(a.charCodeAt(span.to) >= 0xdc00 && a.charCodeAt(span.to) <= 0xdfff).toBe(false);
    }
  });

  it('handles combining marks and non-Latin words', () => {
    checkContract('la résolution spectrale', 'la résolution spatiale');
    checkContract('измерение потока', 'измерение спектра');
  });

  it('handles a missing trailing newline on one side', () => {
    checkContract('alpha\nbeta\n', 'alpha\nbeta');
    checkContract('alpha\nbeta', 'alpha\nbeta\n');
  });

  it('is deterministic across repeated calls', () => {
    const a = 'the quick brown fox jumps over the lazy dog';
    const b = 'the quick red fox leaps over the lazy cat';
    expect(wordDiff(a, b)).toEqual(wordDiff(a, b));
  });
});

/* ------------------------------------------------------- property tests -- */

/** Deterministic PRNG, so a failure is reproducible from its seed. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'the', 'flux', 'spectral', 'index', 'we', 'measure', 'a', 'centroid', 'of',
  'redshift', 'sample', 'null', 'hypothesis', 'significant', 'sigma', 'model',
  'residual', 'fit', 'and', 'therefore', 'observed', 'source', 'emission',
];

function randomText(rand: () => number, paragraphs: number): string {
  const out: string[] = [];
  for (let p = 0; p < paragraphs; p += 1) {
    const words: string[] = [];
    const n = 4 + Math.floor(rand() * 12);
    for (let i = 0; i < n; i += 1) words.push(WORDS[Math.floor(rand() * WORDS.length)]!);
    out.push(`${words.join(' ')}.`);
  }
  return out.join('\n\n');
}

/** Apply one random text mutation, biased toward the edits a writer makes. */
function mutate(rand: () => number, text: string): string {
  if (text.length === 0) return 'inserted';
  const at = Math.floor(rand() * text.length);
  const roll = rand();
  if (roll < 0.25) {
    const len = 1 + Math.floor(rand() * 12);
    return text.slice(0, at) + text.slice(at + len);
  }
  if (roll < 0.5) {
    return `${text.slice(0, at)} ${WORDS[Math.floor(rand() * WORDS.length)]!} ${text.slice(at)}`;
  }
  if (roll < 0.7) {
    const len = 1 + Math.floor(rand() * 8);
    return text.slice(0, at) + WORDS[Math.floor(rand() * WORDS.length)]! + text.slice(at + len);
  }
  if (roll < 0.85) return `${text.slice(0, at)}\n\n${text.slice(at)}`;
  return text.slice(0, at) + text.slice(at).replace(/\n\n/, ' ');
}

describe('wordDiff — properties over randomized edits', () => {
  it('round-trips 10000 randomized edit pairs', () => {
    for (let seed = 0; seed < 10_000; seed += 1) {
      const rand = mulberry32(seed);
      const a = randomText(rand, 1 + Math.floor(rand() * 4));
      let b = a;
      const edits = 1 + Math.floor(rand() * 4);
      for (let i = 0; i < edits; i += 1) b = mutate(rand, b);
      const spans = diffSpans(a, b);
      if (applyDiffSpans(a, spans) !== b) {
        throw new Error(`seed ${seed} failed to round-trip\n--- a ---\n${a}\n--- b ---\n${b}`);
      }
    }
  });

  it('satisfies the full op contract on 500 randomized pairs', () => {
    for (let seed = 0; seed < 500; seed += 1) {
      const rand = mulberry32(seed + 1_000_000);
      const a = randomText(rand, 1 + Math.floor(rand() * 6));
      let b = a;
      const edits = 1 + Math.floor(rand() * 6);
      for (let i = 0; i < edits; i += 1) b = mutate(rand, b);
      checkContract(a, b);
    }
  });

  it('round-trips pairs of unrelated random character soup', () => {
    const alphabet = 'ab \n.,()xyzé\u{1f6f0}';
    for (let seed = 0; seed < 300; seed += 1) {
      const rand = mulberry32(seed + 2_000_000);
      const make = (): string => {
        const n = Math.floor(rand() * 120);
        let s = '';
        for (let i = 0; i < n; i += 1) {
          s += alphabet[Math.floor(rand() * alphabet.length)]!;
        }
        return s;
      };
      const a = make();
      const b = make();
      expect(applyDiffSpans(a, diffSpans(a, b))).toBe(b);
    }
  });
});

/* ------------------------------------------------------------- bounded -- */

describe('wordDiff — bounded work', () => {
  it('still answers correctly when two large texts share nothing', () => {
    const a = Array.from({ length: 900 }, (_, i) => `alpha line ${i} of the first document`).join('\n');
    const b = Array.from({ length: 900 }, (_, i) => `omega row ${i} in a wholly other file`).join('\n');
    const started = Date.now();
    const spans = diffSpans(a, b);
    expect(applyDiffSpans(a, spans)).toBe(b);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('finds a one-word edit in a long document cheaply and precisely', () => {
    const lines = Array.from({ length: 1200 }, (_, i) => `Line ${i} of a long manuscript section.`);
    const a = lines.join('\n');
    lines[600] = 'Line 600 of a lengthy manuscript section.';
    const b = lines.join('\n');
    const started = Date.now();
    expect(hunks(a, b)).toEqual([{ removed: 'long', added: 'lengthy' }]);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
