import { describe, expect, it } from 'vitest';
import { merge3, type Merge3Result } from './merge3';

/** Every result must satisfy this, whatever the inputs. */
function checkShape(result: Merge3Result): Merge3Result {
  for (const c of result.conflicts) {
    expect(c.from).toBeGreaterThanOrEqual(0);
    expect(c.to).toBeGreaterThanOrEqual(c.from);
    expect(c.to).toBeLessThanOrEqual(result.merged.length);
    // the reported range must actually hold the text the merge kept
    expect(result.merged.slice(c.from, c.to)).toBe(c.ours);
    expect(c.ours).not.toBe(c.theirs);
  }
  // conflicts are ordered and disjoint
  let cursor = -1;
  for (const c of result.conflicts) {
    expect(c.from).toBeGreaterThanOrEqual(cursor);
    cursor = c.to;
  }
  return result;
}

const PARAS = [
  'Galaxies falling into dense clusters lose their gas.',
  'The stripping condition compares ram pressure with the restoring force.',
  'We measure a centroid of 6563.3 A and a width of 6.2 A.',
  'The stripped disk shows a regular rotation pattern.',
  'Molecular gas survives in the stripped tails for some time.',
  'We conclude that quenching proceeds outside-in.',
];
const BASE = PARAS.join('\n\n');

describe('merge3 — clean merges', () => {
  it('merges edits in different paragraphs with no conflict', () => {
    const ours = BASE.replace(PARAS[1]!, 'The stripping condition compares ram pressure with gravity.');
    const theirs = BASE.replace(PARAS[4]!, 'Molecular gas survives in the stripped tails for a long time.');
    const result = checkShape(merge3(BASE, ours, theirs));
    expect(result.conflicts).toEqual([]);
    expect(result.merged).toContain('with gravity.');
    expect(result.merged).toContain('for a long time.');
  });

  it('merges word-precisely, disturbing nothing around the edit', () => {
    // Application grain is words: only the changed words move, even though
    // conflict DETECTION is per paragraph.
    const ours = BASE.replace('6563.3', '6562.8');
    const theirs = BASE.replace('outside-in', 'from the outside in');
    const result = checkShape(merge3(BASE, ours, theirs));
    expect(result.conflicts).toEqual([]);
    expect(result.merged).toBe(
      BASE.replace('6563.3', '6562.8').replace('outside-in', 'from the outside in'),
    );
  });

  it('is order-independent when the merge is clean', () => {
    const ours = BASE.replace(PARAS[0]!, 'Galaxies falling into rich clusters lose their gas.');
    const theirs = BASE.replace(PARAS[5]!, 'We conclude that quenching proceeds from the outside in.');
    const a = merge3(BASE, ours, theirs);
    const b = merge3(BASE, theirs, ours);
    expect(a.conflicts).toEqual([]);
    expect(b.conflicts).toEqual([]);
    expect(a.merged).toBe(b.merged);
  });

  it('applies an edit both sides made identically exactly once', () => {
    const same = BASE.replace('outside-in', 'outside–in');
    const result = checkShape(merge3(BASE, same, same));
    expect(result.conflicts).toEqual([]);
    expect(result.merged).toBe(same);
  });

  it('keeps our insertion and their deletion when they are far apart', () => {
    const ours = `${BASE}\n\nA new closing paragraph.`;
    const theirs = BASE.replace(`${PARAS[2]!}\n\n`, '');
    const result = checkShape(merge3(BASE, ours, theirs));
    expect(result.conflicts).toEqual([]);
    expect(result.merged).toContain('A new closing paragraph.');
    expect(result.merged).not.toContain('6563.3');
  });
});

describe('merge3 — conflicts', () => {
  it('keeps ours and reports both WHOLE-PARAGRAPH versions', () => {
    // The conflict carries each side's full block, not just the words that
    // differ — a caller showing "yours / theirs" needs readable prose, and a
    // bare word pair is not enough to judge which reads correctly.
    const base = 'The result was significant.';
    const ours = 'The result was marginal.';
    const theirs = 'The result was decisive.';
    const result = checkShape(merge3(base, ours, theirs));
    expect(result.merged).toBe(ours);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.ours).toBe(ours);
    expect(result.conflicts[0]!.theirs).toBe(theirs);
  });

  it('never interleaves two rewrites of the same phrase into prose nobody wrote', () => {
    // The case that forced paragraph-grain detection. These two rewrites share
    // no word token, so a word-grain merge accepts both and yields
    // "from the inside out" — invented text, and the kind a reader cannot
    // catch by reviewing what they themselves wrote.
    const base = 'We conclude that quenching proceeds outside-in.';
    const ours = base.replace('outside-in', 'inside-out');
    const theirs = base.replace('outside-in', 'from the outside in');
    const result = checkShape(merge3(base, ours, theirs));
    expect(result.conflicts).toHaveLength(1);
    expect(result.merged).toBe(ours);
    expect(result.merged).not.toContain('from the inside out');
    expect(result.conflicts[0]!.theirs).toContain('from the outside in');
  });

  it('conflicts locally: a clash in one paragraph does not block another', () => {
    const ours = BASE.replace('outside-in', 'inside-out').replace('6563.3', '6562.8');
    const theirs = BASE.replace('outside-in', 'from the outside in').replace(
      PARAS[3]!,
      'The stripped disk shows a warped rotation pattern.',
    );
    const result = checkShape(merge3(BASE, ours, theirs));
    expect(result.conflicts).toHaveLength(1);
    // ours won the clash...
    expect(result.merged).toContain('inside-out');
    // ...and everything neither of us fought over still landed
    expect(result.merged).toContain('6562.8');
    expect(result.merged).toContain('warped rotation pattern');
  });

  it('flags two edits in one paragraph even when they touch different words', () => {
    // Deliberately conservative: same block, both sides, so the human decides.
    const base = 'We measure a centroid of 6563.3 A and a width of 6.2 A.';
    const result = checkShape(
      merge3(base, base.replace('6563.3', '6562.8'), base.replace('6.2', '6.4')),
    );
    expect(result.conflicts).toHaveLength(1);
    expect(result.merged).toBe(base.replace('6563.3', '6562.8'));
    expect(result.conflicts[0]!.theirs).toContain('6.4');
  });

  it('treats two different insertions at the same point as a conflict', () => {
    const base = 'alpha omega';
    const result = checkShape(merge3(base, 'alpha beta omega', 'alpha gamma omega'));
    expect(result.conflicts).toHaveLength(1);
    expect(result.merged).toBe('alpha beta omega');
  });

  it('resolves an ours-theirs-ours overlap chain as ONE conflict', () => {
    // theirs spans the whole paragraph, so it collides with both of our edits;
    // the three must resolve as a single region, not two half-applied ones.
    const base = 'one two three four five';
    const ours = 'one TWO three FOUR five';
    const theirs = 'a completely different sentence';
    const result = checkShape(merge3(base, ours, theirs));
    expect(result.conflicts).toHaveLength(1);
    expect(result.merged).toBe(ours);
    expect(result.conflicts[0]!.theirs).toBe(theirs);
  });

  it('reports the same number of conflicts whichever side is called ours', () => {
    const ours = BASE.replace('outside-in', 'inside-out');
    const theirs = BASE.replace('outside-in', 'from the outside in');
    const a = checkShape(merge3(BASE, ours, theirs));
    const b = checkShape(merge3(BASE, theirs, ours));
    expect(a.conflicts).toHaveLength(b.conflicts.length);
    expect(a.conflicts[0]!.ours).toBe(b.conflicts[0]!.theirs);
    expect(a.conflicts[0]!.theirs).toBe(b.conflicts[0]!.ours);
  });
});

describe('merge3 — degenerate inputs', () => {
  it('returns theirs when we changed nothing', () => {
    const theirs = `${BASE}\n\nAppended by the agent.`;
    expect(merge3(BASE, BASE, theirs)).toEqual({ merged: theirs, conflicts: [] });
  });

  it('returns ours when the file did not really change', () => {
    const ours = `${BASE}\n\nTyped by the human.`;
    expect(merge3(BASE, ours, BASE)).toEqual({ merged: ours, conflicts: [] });
  });

  it('returns ours when both sides ended up identical', () => {
    const same = `${BASE} tail`;
    expect(merge3(BASE, same, same)).toEqual({ merged: same, conflicts: [] });
  });

  it('handles an empty base', () => {
    const result = checkShape(merge3('', 'ours', 'theirs'));
    expect(result.conflicts).toHaveLength(1);
    expect(result.merged).toBe('ours');
  });

  it('handles both sides clearing the document', () => {
    expect(merge3(BASE, '', '')).toEqual({ merged: '', conflicts: [] });
  });
});

/* ------------------------------------------------------- property tests -- */

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Edit a random word of a random paragraph. */
function edit(rand: () => number, text: string, tag: string): string {
  const words = text.split(' ');
  const at = Math.floor(rand() * words.length);
  words[at] = tag;
  return words.join(' ');
}

describe('merge3 — properties', () => {
  it('is well-formed over 3000 randomized three-way cases', () => {
    for (let seed = 0; seed < 3000; seed += 1) {
      const rand = mulberry32(seed);
      let ours = BASE;
      let theirs = BASE;
      for (let i = 0; i <= Math.floor(rand() * 3); i += 1) ours = edit(rand, ours, `OURS${i}`);
      for (let i = 0; i <= Math.floor(rand() * 3); i += 1) theirs = edit(rand, theirs, `THEIRS${i}`);
      const result = merge3(BASE, ours, theirs);
      for (const c of result.conflicts) {
        if (result.merged.slice(c.from, c.to) !== c.ours) {
          throw new Error(`seed ${seed}: conflict range does not hold ours`);
        }
      }
    }
  });

  it('never loses one of our words to a clean merge', () => {
    for (let seed = 0; seed < 2000; seed += 1) {
      const rand = mulberry32(seed + 500_000);
      const ours = edit(rand, BASE, 'OURWORD');
      const theirs = edit(rand, BASE, 'THEIRWORD');
      const result = merge3(BASE, ours, theirs);
      // ours is kept whether the merge was clean or conflicted — that is the
      // policy, and the human's live text depends on it holding always.
      if (!result.merged.includes('OURWORD')) {
        throw new Error(`seed ${seed}: our edit was lost\nmerged: ${result.merged}`);
      }
      if (result.conflicts.length === 0 && !result.merged.includes('THEIRWORD')) {
        throw new Error(`seed ${seed}: clean merge dropped their edit\nmerged: ${result.merged}`);
      }
    }
  });
});
