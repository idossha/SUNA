import type { CanvasCommand } from '@suna/core';
import { describe, expect, it } from 'vitest';
import { resolveTarget } from './address';
import { dispatch } from './commands';
import { mustOk, open } from './testkit';

/**
 * Compact (whitespace-free) base document: structural commands move element
 * nodes only, so inter-element whitespace is the one thing apply→invert
 * cannot restore in pretty-printed files. Byte-level inverse tests therefore
 * run on compact markup; the pretty-printed real fixture is covered in
 * fixture-ops.test.ts for non-structural commands.
 */
const BASE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">' +
  '<rect id="r1" x="10" y="10" width="20" height="10"/>' +
  '<rect id="r2" x="40" y="30" width="20" height="10" style="fill: #ff0000; stroke: none"/>' +
  '<rect id="r3" x="80" y="70" width="10" height="10" transform="matrix(1, 0, 0, 1, 5, 5)"/>' +
  '<g id="grp"><circle id="c1" cx="50" cy="50" r="5"/><circle id="c2" cx="60" cy="60" r="5"/></g>' +
  '<text id="t1" x="5" y="5">hello</text>' +
  '</svg>';

function roundTrip(command: CanvasCommand, assertApplied?: (doc: ReturnType<typeof open>) => void) {
  const doc = open(BASE);
  const result = mustOk(dispatch(doc, command));
  assertApplied?.(doc);
  mustOk(dispatch(doc, result.inverse));
  expect(doc.serialize()).toBe(BASE);
  return result;
}

describe('set-attrs', () => {
  it('sets, overwrites, and adds attributes; inverse restores bytes', () => {
    roundTrip(
      { kind: 'set-attrs', target: 'r1', attrs: { x: '99', fill: '#00ff00', 'data-new': 'yes' } },
      (doc) => {
        const r1 = doc.getById('r1');
        expect(r1?.getAttribute('x')).toBe('99');
        expect(r1?.getAttribute('fill')).toBe('#00ff00');
        expect(r1?.getAttribute('data-new')).toBe('yes');
      },
    );
  });

  it('deletes attributes with null; inverse restores value AND position byte-exactly', () => {
    // The DOM can only append re-added attributes, so the inverse is a
    // two-step batch: clear every attribute from the first deleted position
    // onward, then re-add them in the original order.
    const result = roundTrip({ kind: 'set-attrs', target: 'r1', attrs: { x: null } }, (doc) => {
      expect(doc.getById('r1')?.hasAttribute('x')).toBe(false);
    });
    expect(result.inverse).toEqual({
      kind: 'batch',
      commands: [
        { kind: 'set-attrs', target: 'r1', attrs: { x: null, y: null, width: null, height: null } },
        { kind: 'set-attrs', target: 'r1', attrs: { x: '10', y: '10', width: '20', height: '10' } },
      ],
    });
  });

  it('refuses to delete the id attribute (it anchors addressing and undo)', () => {
    const doc = open(BASE);
    const result = dispatch(doc, { kind: 'set-attrs', target: 'r1', attrs: { id: null } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-command');
    expect(doc.serialize()).toBe(BASE);
  });

  it('inverse of an id rename targets the new id', () => {
    const doc = open(BASE);
    const result = mustOk(dispatch(doc, { kind: 'set-attrs', target: 'r1', attrs: { id: 'renamed' } }));
    expect(doc.getById('renamed')).not.toBeNull();
    expect(doc.getById('r1')).toBeNull();
    expect(result.inverse).toEqual({ kind: 'set-attrs', target: 'renamed', attrs: { id: 'r1' } });
    mustOk(dispatch(doc, result.inverse));
    expect(doc.serialize()).toBe(BASE);
  });

  it('fails with target-not-found and leaves the document untouched', () => {
    const doc = open(BASE);
    const result = dispatch(doc, { kind: 'set-attrs', target: 'ghost', attrs: { fill: 'red' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('target-not-found');
    expect(doc.serialize()).toBe(BASE);
  });
});

describe('set-style', () => {
  it('writes presentation attributes when the element has no style attribute', () => {
    roundTrip(
      { kind: 'set-style', target: 'r1', props: { fill: 'crimson', opacity: '0.5' } },
      (doc) => {
        const r1 = doc.getById('r1');
        expect(r1?.getAttribute('fill')).toBe('crimson');
        expect(r1?.getAttribute('opacity')).toBe('0.5');
        expect(r1?.hasAttribute('style')).toBe(false);
      },
    );
  });

  it('edits within an existing style attribute (update, add, delete)', () => {
    roundTrip(
      {
        kind: 'set-style',
        target: 'r2',
        props: { fill: '#0000ff', 'stroke-width': '2', stroke: null },
      },
      (doc) => {
        expect(doc.getById('r2')?.getAttribute('style')).toBe('fill: #0000ff; stroke-width: 2');
      },
    );
  });
});

describe('set-text', () => {
  it('replaces text content; inverse restores bytes', () => {
    roundTrip({ kind: 'set-text', target: 't1', text: 'goodbye' }, (doc) => {
      expect(doc.getById('t1')?.textContent).toBe('goodbye');
    });
  });

  it('rejects non-text elements with text-on-non-text', () => {
    const doc = open(BASE);
    const result = dispatch(doc, { kind: 'set-text', target: 'r1', text: 'nope' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('text-on-non-text');
    expect(doc.serialize()).toBe(BASE);
  });
});

describe('translate', () => {
  it('writes a composed matrix transform on multiple targets; inverse restores bytes', () => {
    roundTrip({ kind: 'translate', targets: ['r1', 'c1'], dx: 4, dy: -2 }, (doc) => {
      expect(doc.getById('r1')?.getAttribute('transform')).toBe('matrix(1, 0, 0, 1, 4, -2)');
      expect(doc.getById('c1')?.getAttribute('transform')).toBe('matrix(1, 0, 0, 1, 4, -2)');
    });
  });

  it('composes with an existing transform', () => {
    roundTrip({ kind: 'translate', targets: ['r3'], dx: 4, dy: -2 }, (doc) => {
      expect(doc.getById('r3')?.getAttribute('transform')).toBe('matrix(1, 0, 0, 1, 9, 3)');
    });
  });
});

describe('transform', () => {
  it('replace mode swaps the transform attribute; inverse restores the prior attr', () => {
    const result = roundTrip(
      { kind: 'transform', target: 'r3', matrix: [2, 0, 0, 2, 1, 1], mode: 'replace' },
      (doc) => {
        expect(doc.getById('r3')?.getAttribute('transform')).toBe('matrix(2, 0, 0, 2, 1, 1)');
      },
    );
    expect(result.inverse).toEqual({
      kind: 'set-attrs',
      target: 'r3',
      attrs: { transform: 'matrix(1, 0, 0, 1, 5, 5)' },
    });
  });

  it('replace on an element without a transform: inverse deletes the attribute', () => {
    roundTrip({ kind: 'transform', target: 'r1', matrix: [1, 0, 0, 1, 3, 3], mode: 'replace' });
  });

  it('compose mode multiplies onto the existing transform; inverse restores the prior attr verbatim', () => {
    // The inverse captures the pre-state attribute string (here: absent),
    // not a numerically inverted matrix — numeric round-trips are neither
    // byte-exact nor float-exact in general.
    const result = roundTrip(
      { kind: 'transform', target: 'r1', matrix: [2, 0, 0, 2, 10, 20], mode: 'compose' },
      (doc) => {
        expect(doc.getById('r1')?.getAttribute('transform')).toBe('matrix(2, 0, 0, 2, 10, 20)');
      },
    );
    expect(result.inverse).toEqual({
      kind: 'set-attrs',
      target: 'r1',
      attrs: { transform: null },
    });
  });
});

describe('reorder', () => {
  it('front moves the element last; inverse restores bytes', () => {
    roundTrip({ kind: 'reorder', target: 'r1', mode: 'front' }, (doc) => {
      expect(doc.root.lastElementChild?.getAttribute('id')).toBe('r1');
    });
  });

  it('back moves the element first; inverse restores bytes', () => {
    roundTrip({ kind: 'reorder', target: 't1', mode: 'back' }, (doc) => {
      expect(doc.root.firstElementChild?.getAttribute('id')).toBe('t1');
    });
  });

  it('forward and backward swap with adjacent siblings; inverses restore bytes', () => {
    roundTrip({ kind: 'reorder', target: 'r1', mode: 'forward' }, (doc) => {
      expect(doc.root.children[1]?.getAttribute('id')).toBe('r1');
    });
    roundTrip({ kind: 'reorder', target: 'r2', mode: 'backward' }, (doc) => {
      expect(doc.root.children[0]?.getAttribute('id')).toBe('r2');
    });
  });
});

describe('reparent', () => {
  it('moves an element into a new parent at an index; inverse restores bytes', () => {
    roundTrip({ kind: 'reparent', target: 'r1', parent: 'grp', index: 1 }, (doc) => {
      const grp = doc.getById('grp');
      expect(grp?.children[1]?.getAttribute('id')).toBe('r1');
      expect(grp?.children).toHaveLength(3);
    });
  });

  it('appends when index is omitted; inverse restores bytes', () => {
    roundTrip({ kind: 'reparent', target: 't1', parent: 'grp' }, (doc) => {
      expect(doc.getById('grp')?.lastElementChild?.getAttribute('id')).toBe('t1');
    });
  });

  it('refuses to reparent an element into its own subtree', () => {
    const doc = open(BASE);
    const result = dispatch(doc, { kind: 'reparent', target: 'grp', parent: 'c1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-command');
    expect(doc.serialize()).toBe(BASE);
  });
});

describe('group / ungroup', () => {
  it('group wraps contiguous targets in a new <g> at the first target; inverse restores bytes', () => {
    const result = roundTrip({ kind: 'group', targets: ['r1', 'r2'], id: 'gnew' }, (doc) => {
      const g = doc.getById('gnew');
      expect(g?.parentElement).toBe(doc.root);
      expect([...(g?.children ?? [])].map((c) => c.getAttribute('id'))).toEqual(['r1', 'r2']);
      expect(doc.root.firstElementChild).toBe(g);
    });
    expect(result.inverse).toEqual({ kind: 'ungroup', target: 'gnew' });
    expect(result.affected).toEqual(['gnew', 'r1', 'r2']);
  });

  it('group without an explicit id mints one', () => {
    const doc = open(BASE);
    const result = mustOk(dispatch(doc, { kind: 'group', targets: ['c1', 'c2'] }));
    expect(result.affected[0]).toMatch(/^suna-e\d+$/);
    expect(doc.getById(result.affected[0] as string)?.localName).toBe('g');
  });

  it('ungroup splices children up and removes the <g>; inverse restores bytes', () => {
    const result = roundTrip({ kind: 'ungroup', target: 'grp' }, (doc) => {
      expect(doc.getById('grp')).toBeNull();
      expect(doc.getById('c1')?.parentElement).toBe(doc.root);
      expect(doc.getById('c2')?.parentElement).toBe(doc.root);
    });
    // The inverse removes the freed children and reinserts the captured
    // group bytes verbatim — a re-made <g> could not reproduce attribute
    // spellings or internal whitespace byte-for-byte.
    expect(result.inverse).toEqual({
      kind: 'batch',
      commands: [
        { kind: 'remove', targets: ['c1', 'c2'] },
        {
          kind: 'insert',
          parent: '#root',
          index: 3,
          svg:
            '<g xmlns="http://www.w3.org/2000/svg" id="grp">' +
            '<circle id="c1" cx="50" cy="50" r="5"/><circle id="c2" cx="60" cy="60" r="5"/></g>',
          id: 'grp',
        },
      ],
    });
  });

  it('ungroup of a <g> carrying extra attributes restores them via a batch inverse', () => {
    const withAttrs = BASE.replace('<g id="grp">', '<g id="grp" transform="matrix(1, 0, 0, 1, 2, 3)" opacity="0.9">');
    const doc = open(withAttrs);
    const result = mustOk(dispatch(doc, { kind: 'ungroup', target: 'grp' }));
    expect(doc.getById('grp')).toBeNull();
    mustOk(dispatch(doc, result.inverse));
    expect(doc.serialize()).toBe(withAttrs);
  });
});

describe('insert', () => {
  it('inserts a fragment at an index with an explicit id; inverse removes it byte-exactly', () => {
    roundTrip(
      {
        kind: 'insert',
        parent: 'grp',
        index: 1,
        svg: '<rect x="1" y="2" width="3" height="4"/>',
        id: 'ins1',
      },
      (doc) => {
        const el = doc.getById('ins1');
        expect(el?.parentElement).toBe(doc.getById('grp'));
        expect(doc.getById('grp')?.children[1]).toBe(el);
      },
    );
  });

  it('defaults to appending to the root and mints an id', () => {
    const doc = open(BASE);
    const result = mustOk(dispatch(doc, { kind: 'insert', svg: '<circle r="3"/>' }));
    const id = result.affected[0] as string;
    expect(id).toMatch(/^suna-e\d+$/);
    expect(doc.root.lastElementChild).toBe(doc.getById(id));
  });

  it('rejects malformed fragments with invalid-svg', () => {
    const doc = open(BASE);
    const result = dispatch(doc, { kind: 'insert', svg: '<rect' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-svg');
    expect(doc.serialize()).toBe(BASE);
  });

  it('rejects duplicate ids', () => {
    const doc = open(BASE);
    const result = dispatch(doc, { kind: 'insert', svg: '<circle r="3"/>', id: 'r1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-command');
    expect(doc.serialize()).toBe(BASE);
  });
});

describe('remove', () => {
  it('removes multiple elements; inverse reinserts them byte-exactly', () => {
    roundTrip({ kind: 'remove', targets: ['r1', 'r3'] }, (doc) => {
      expect(doc.getById('r1')).toBeNull();
      expect(doc.getById('r3')).toBeNull();
      expect(doc.getById('r2')).not.toBeNull();
    });
  });

  it('removes a whole subtree; inverse restores it byte-exactly', () => {
    roundTrip({ kind: 'remove', targets: ['grp'] }, (doc) => {
      expect(doc.getById('grp')).toBeNull();
      expect(doc.getById('c1')).toBeNull();
    });
  });

  it('captures the serialized subtree in the inverse', () => {
    const doc = open(BASE);
    const result = mustOk(dispatch(doc, { kind: 'remove', targets: ['r1'] }));
    expect(result.inverse).toEqual({
      kind: 'insert',
      parent: '#root',
      index: 0,
      svg: '<rect xmlns="http://www.w3.org/2000/svg" id="r1" x="10" y="10" width="20" height="10"/>',
      id: 'r1',
    });
  });

  it('refuses to remove the root', () => {
    const doc = open(BASE);
    const result = dispatch(doc, { kind: 'remove', targets: ['#root'] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-command');
  });
});

describe('align', () => {
  it('aligns attribute-measurable elements to the group start; inverse restores bytes', () => {
    roundTrip({ kind: 'align', targets: ['r1', 'r2', 'r3'], axis: 'x', mode: 'start' }, (doc) => {
      // r1 already at minX=10: untouched (no transform attr churn).
      expect(doc.getById('r1')?.hasAttribute('transform')).toBe(false);
      // r2 minX=40 → dx -30.
      expect(doc.getById('r2')?.getAttribute('transform')).toBe('matrix(1, 0, 0, 1, -30, 0)');
      // r3 minX=80+5(transform)=85 → dx -75, composed onto its matrix.
      expect(doc.getById('r3')?.getAttribute('transform')).toBe('matrix(1, 0, 0, 1, -70, 5)');
    });
  });

  it('aligns vertical centers; inverse restores bytes', () => {
    roundTrip({ kind: 'align', targets: ['r1', 'r2'], axis: 'y', mode: 'center' }, (doc) => {
      // r1 center 15, r2 center 35, union 10..40 → center 25: dy +10 / -10.
      expect(doc.getById('r1')?.getAttribute('transform')).toBe('matrix(1, 0, 0, 1, 0, 10)');
      expect(doc.getById('r2')?.getAttribute('transform')).toBe('matrix(1, 0, 0, 1, 0, -10)');
    });
  });

  it('fails on elements whose geometry needs layout', () => {
    const doc = open(BASE);
    const result = dispatch(doc, { kind: 'align', targets: ['r1', 't1'], axis: 'x', mode: 'start' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-command');
    expect(doc.serialize()).toBe(BASE);
  });
});

describe('distribute', () => {
  it('evenly spaces centers between the outer elements; inverse restores bytes', () => {
    roundTrip({ kind: 'distribute', targets: ['r1', 'r2', 'r3'], axis: 'x' }, (doc) => {
      // Centers: r1 20, r2 50, r3 85+5(transform)=90 → step 35 → r2 target 55 (dx 5).
      expect(doc.getById('r1')?.hasAttribute('transform')).toBe(false);
      expect(doc.getById('r2')?.getAttribute('transform')).toBe('matrix(1, 0, 0, 1, 5, 0)');
      expect(doc.getById('r3')?.getAttribute('transform')).toBe('matrix(1, 0, 0, 1, 5, 5)');
    });
  });

  it('is a no-op below three targets', () => {
    const doc = open(BASE);
    const result = mustOk(dispatch(doc, { kind: 'distribute', targets: ['r1', 'r2'], axis: 'x' }));
    expect(result.inverse).toEqual({ kind: 'batch', commands: [] });
    expect(doc.serialize()).toBe(BASE);
  });
});

describe('set-artboard', () => {
  it('rewrites width/height only; inverse restores bytes', () => {
    roundTrip({ kind: 'set-artboard', widthMm: 183, heightMm: 55 }, (doc) => {
      expect(doc.root.getAttribute('width')).toBe('183mm');
      expect(doc.root.getAttribute('height')).toBe('55mm');
      expect(doc.root.getAttribute('viewBox')).toBe('0 0 100 100');
    });
  });
});

describe('batch', () => {
  it('applies members in order as one command; inverse restores bytes', () => {
    roundTrip(
      {
        kind: 'batch',
        label: 'restyle panel',
        commands: [
          { kind: 'set-attrs', target: 'r1', attrs: { fill: 'teal' } },
          { kind: 'translate', targets: ['r2'], dx: 1, dy: 1 },
          { kind: 'set-text', target: 't1', text: 'batched' },
        ],
      },
      (doc) => {
        expect(doc.getById('r1')?.getAttribute('fill')).toBe('teal');
        expect(doc.getById('r2')?.getAttribute('transform')).toBe('matrix(1, 0, 0, 1, 1, 1)');
        expect(doc.getById('t1')?.textContent).toBe('batched');
      },
    );
  });

  it('nested batches apply and invert', () => {
    roundTrip({
      kind: 'batch',
      commands: [
        { kind: 'set-attrs', target: 'r1', attrs: { fill: 'teal' } },
        {
          kind: 'batch',
          commands: [
            { kind: 'translate', targets: ['c1'], dx: 2, dy: 2 },
            { kind: 'remove', targets: ['r3'] },
          ],
        },
      ],
    });
  });

  it('is atomic: a failing member rolls back the already-applied members', () => {
    const doc = open(BASE);
    const result = dispatch(doc, {
      kind: 'batch',
      commands: [
        { kind: 'set-attrs', target: 'r1', attrs: { fill: 'red' } },
        { kind: 'translate', targets: ['r2'], dx: 5, dy: 5 },
        { kind: 'set-text', target: 'ghost', text: 'boom' }, // member 3 of 4 fails
        { kind: 'set-attrs', target: 'r3', attrs: { fill: 'blue' } },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('target-not-found');
    expect(doc.serialize()).toBe(BASE);
  });

  it('the batch inverse lists member inverses in reverse order', () => {
    const doc = open(BASE);
    const result = mustOk(
      dispatch(doc, {
        kind: 'batch',
        commands: [
          { kind: 'set-text', target: 't1', text: 'one' },
          { kind: 'set-text', target: 't1', text: 'two' },
        ],
      }),
    );
    expect(result.inverse).toEqual({
      kind: 'batch',
      commands: [
        { kind: 'set-text', target: 't1', text: 'one' },
        { kind: 'set-text', target: 't1', text: 'hello' },
      ],
    });
  });
});

describe('structural addressing (spec §1)', () => {
  const DOC =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
    '<g id="parent"><rect width="1" height="1"/><rect width="2" height="1"/><rect width="3" height="1"/></g>' +
    '</svg>';

  it('resolves #parent>nth:2 to the third element child', () => {
    const doc = open(DOC);
    const el = resolveTarget(doc, '#parent>nth:2');
    expect(el?.getAttribute('width')).toBe('3');
  });

  it('resolves chained nth segments', () => {
    const doc = open(BASE);
    expect(resolveTarget(doc, '#root>nth:3>nth:1')?.getAttribute('id')).toBe('c2');
  });

  it('a command on an id-less element mints a stable id recorded in affected', () => {
    const doc = open(DOC);
    const result = mustOk(
      dispatch(doc, { kind: 'set-attrs', target: '#parent>nth:1', attrs: { fill: 'red' } }),
    );
    const minted = result.affected[0] as string;
    expect(minted).toMatch(/^suna-e\d+$/);
    const el = doc.getById(minted);
    expect(el?.getAttribute('width')).toBe('2');
    expect(el?.getAttribute('fill')).toBe('red');
    // The minted id is stable: the same element resolves by id afterwards,
    // and the recorded inverse targets it.
    expect(resolveTarget(doc, minted)).toBe(el);
    expect(result.inverse).toEqual({
      kind: 'set-attrs',
      target: minted,
      attrs: { fill: null },
    });
  });

  it('minted ids never collide with existing suna-e ids', () => {
    const doc = open(
      '<svg xmlns="http://www.w3.org/2000/svg"><g id="suna-e1"><rect width="1" height="1"/></g></svg>',
    );
    const result = mustOk(
      dispatch(doc, { kind: 'set-attrs', target: '#suna-e1>nth:0', attrs: { fill: 'red' } }),
    );
    expect(result.affected[0]).toBe('suna-e2');
  });

  it('unresolvable structural addresses fail with target-not-found', () => {
    const doc = open(DOC);
    const result = dispatch(doc, { kind: 'set-attrs', target: '#parent>nth:9', attrs: { x: '1' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('target-not-found');
  });
});

describe('dispatch validation', () => {
  it('rejects structurally invalid commands with invalid-command', () => {
    const doc = open(BASE);
    const result = dispatch(doc, { kind: 'explode', target: 'r1' } as unknown as CanvasCommand);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-command');
    expect(doc.serialize()).toBe(BASE);
  });
});
