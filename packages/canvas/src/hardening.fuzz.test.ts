import type { CanvasCommand } from '@suna/core';
import { describe, expect, it } from 'vitest';
import { dispatch } from './commands';
import { CommandHistory } from './history';
import { mustOk, open, openFixture } from './testkit';

/**
 * Inverse-integrity fuzz (canvas-engine.md §8): a scripted sequence of 34
 * commands covering every command kind, dispatched against the real
 * matplotlib export through CommandHistory, then:
 *
 *   undo-all  → every intermediate state and the origin are byte-identical
 *   redo-all  → every intermediate state and the final state are byte-identical
 *   undo-all  → byte-identical to the origin again
 *
 * All targets carry real ids (or are structural addresses of id'd elements),
 * so no ids are minted and byte-identity is exact — the one designed residue
 * of minting is covered separately below.
 */

const SEQUENCE: CanvasCommand[] = [
  // Build three attribute-measurable elements to exercise geometry commands.
  { kind: 'insert', parent: 'figure_1', svg: '<rect x="10" y="10" width="30" height="12"/>', id: 'hz1' },
  { kind: 'insert', parent: 'figure_1', svg: '<rect x="60" y="40" width="20" height="8"/>', id: 'hz2' },
  { kind: 'insert', parent: 'figure_1', svg: '<circle cx="100" cy="30" r="6"/>', id: 'hz3' },
  { kind: 'align', targets: ['hz1', 'hz2', 'hz3'], axis: 'x', mode: 'start' },
  { kind: 'distribute', targets: ['hz1', 'hz2', 'hz3'], axis: 'y' },
  { kind: 'align', targets: ['hz1', 'hz2'], axis: 'y', mode: 'center' },
  // Attribute / style / transform churn on real matplotlib groups.
  { kind: 'translate', targets: ['hz1', 'ax0.legend'], dx: 3, dy: -2 },
  { kind: 'set-attrs', target: 'hz2', attrs: { fill: '#123456', opacity: '0.8' } },
  { kind: 'set-style', target: 'ax1.legend', props: { opacity: '0.55' } },
  { kind: 'set-style', target: 'hz3', props: { fill: 'teal', stroke: '#000000' } },
  { kind: 'transform', target: 'hz1', matrix: [1, 0, 0, 1, 4, 4], mode: 'replace' },
  { kind: 'transform', target: 'hz1', matrix: [2, 0, 0, 2, 0, 0], mode: 'compose' },
  { kind: 'translate', targets: ['xtick_1', 'xtick_2'], dx: 0.5, dy: 0 },
  { kind: 'translate', targets: ['ax0.legend'], dx: -3, dy: 2 }, // back to origin: attr drops again
  // Structure: reorder / reparent / group / ungroup.
  { kind: 'reorder', target: 'ax0.legend', mode: 'front' },
  { kind: 'reorder', target: 'xtick_1', mode: 'forward' },
  { kind: 'reorder', target: 'patch_1', mode: 'front' },
  { kind: 'reparent', target: 'hz3', parent: 'ax1' },
  { kind: 'group', targets: ['hz1', 'hz2'], id: 'hz-group' },
  { kind: 'translate', targets: ['hz-group'], dx: 1, dy: 1 },
  { kind: 'ungroup', target: 'hz-group' },
  { kind: 'ungroup', target: 'ax0.legend' }, // real pretty-printed matplotlib group
  // Removals after the ungroup freed the legend's children into ax0.
  { kind: 'remove', targets: ['line2d_15'] },
  { kind: 'remove', targets: ['ytick_2', 'xtick_2'] },
  { kind: 'remove', targets: ['text_16'] },
  // Artboard.
  { kind: 'set-artboard', widthMm: 120 },
  { kind: 'set-artboard', heightMm: 44.9 },
  // Structural addresses of id'd elements resolve without minting.
  { kind: 'set-attrs', target: '#figure_1>nth:0', attrs: { opacity: '0.9' } },
  { kind: 'set-attrs', target: 'ax1.ylabel', attrs: { opacity: '0.7' } },
  // Batches, nested included.
  {
    kind: 'batch',
    label: 'legend nudge',
    commands: [
      { kind: 'translate', targets: ['ax1.legend'], dx: -2, dy: 1 },
      { kind: 'set-attrs', target: 'ax1', attrs: { 'data-mark': '1' } },
    ],
  },
  {
    kind: 'batch',
    commands: [
      { kind: 'batch', commands: [{ kind: 'translate', targets: ['xtick_1'], dx: 0.25, dy: 0 }] },
      { kind: 'set-attrs', target: 'ax0', attrs: { opacity: '0.95' } },
    ],
  },
  // Late inserts and edits inside a surviving legend.
  { kind: 'insert', parent: 'ax1.legend', index: 0, svg: '<rect x="0" y="0" width="5" height="5"/>', id: 'hz4' },
  { kind: 'translate', targets: ['hz4'], dx: 2, dy: 2 },
  { kind: 'set-attrs', target: 'hz4', attrs: { x: null, rx: '1' } },
];

describe('inverse-integrity fuzz against the matplotlib fixture', () => {
  it('34 commands apply, undo-all, redo-all, undo-all — byte-identical at every step', () => {
    const { doc, source } = openFixture();
    const history = new CommandHistory(doc);
    const snapshots: string[] = [source];

    for (const command of SEQUENCE) {
      mustOk(history.apply(command));
      snapshots.push(doc.serialize());
    }
    expect(history.undoDepth).toBe(SEQUENCE.length);
    // No command minted an id: every target already carried one.
    for (const snap of snapshots) expect(snap).not.toContain('suna-e');

    // Undo all the way back, checking every intermediate state.
    for (let i = snapshots.length - 2; i >= 0; i--) {
      expect(history.undo()?.ok).toBe(true);
      expect(doc.serialize()).toBe(snapshots[i]);
    }
    expect(history.undo()).toBeNull();
    expect(doc.serialize()).toBe(source);

    // Redo all the way forward again.
    for (let i = 1; i < snapshots.length; i++) {
      expect(history.redo()?.ok).toBe(true);
      expect(doc.serialize()).toBe(snapshots[i]);
    }
    expect(history.redo()).toBeNull();

    // And back once more.
    while (history.undo() !== null) {
      /* drain */
    }
    expect(doc.serialize()).toBe(source);
  });

  it('translate + undo is byte-exact over matplotlib rotate()/translate() spellings', () => {
    // The fixture writes transforms like rotate(-0 x y); a numeric inverse
    // would rewrite (or drop) them — the verbatim-capture inverse must not.
    const src =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      '<text id="t" x="5" y="5" transform="rotate(-0 5 5)">hi</text>' +
      '<g id="g" transform="translate(2 3) scale(0.1 -0.1)"><path id="p" d="M 0 0 L 1 1"/></g>' +
      '</svg>';
    for (const targets of [['t'], ['g'], ['t', 'g']]) {
      const doc = open(src);
      const result = mustOk(dispatch(doc, { kind: 'translate', targets: [...targets], dx: 1.7, dy: -0.3 }));
      expect(doc.serialize()).not.toBe(src);
      mustOk(dispatch(doc, result.inverse));
      expect(doc.serialize()).toBe(src);
    }
  });

  it('compose-transform + undo is byte-exact over a non-matrix transform', () => {
    const src =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      '<rect id="r" transform="rotate(30 5 5)" x="1" y="1" width="2" height="2"/>' +
      '</svg>';
    const doc = open(src);
    const result = mustOk(
      dispatch(doc, { kind: 'transform', target: 'r', matrix: [2, 0, 0, 2, 1, 1], mode: 'compose' }),
    );
    mustOk(dispatch(doc, result.inverse));
    expect(doc.serialize()).toBe(src);
  });

  it('a transform attribute mid-attribute-list survives a translate-to-identity round trip', () => {
    // Composing to exact identity must not remove-and-re-append the
    // attribute (that would shift its position and break byte-exact undo).
    const src =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      '<rect id="r" transform="matrix(1, 0, 0, 1, 5, 5)" x="1" y="1" width="2" height="2"/>' +
      '</svg>';
    const doc = open(src);
    const r1 = mustOk(dispatch(doc, { kind: 'translate', targets: ['r'], dx: -5, dy: -5 }));
    expect(doc.getById('r')?.getAttribute('transform')).toBe('matrix(1, 0, 0, 1, 0, 0)');
    mustOk(dispatch(doc, r1.inverse));
    expect(doc.serialize()).toBe(src);
  });

  it('ungroup + undo of a pretty-printed matplotlib group is byte-exact', () => {
    const { doc, source } = openFixture();
    const result = mustOk(dispatch(doc, { kind: 'ungroup', target: 'ax0.legend' }));
    expect(doc.getById('ax0.legend')).toBeNull();
    expect(doc.getById('line2d_15')?.parentElement?.getAttribute('id')).toBe('ax0');
    mustOk(dispatch(doc, result.inverse));
    expect(doc.serialize()).toBe(source);
  });

  it('group + undo in a pretty-printed document is byte-exact', () => {
    const src = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">',
      '  <rect id="a" width="1" height="1"/>',
      '  <rect id="b" width="2" height="1"/>',
      '</svg>',
    ].join('\n');
    const doc = open(src);
    const result = mustOk(dispatch(doc, { kind: 'group', targets: ['a', 'b'], id: 'g9' }));
    mustOk(dispatch(doc, result.inverse));
    expect(doc.serialize()).toBe(src);
  });

  it('minting is the one designed residue: undo restores everything but the minted id', () => {
    // Spec §1: minted ids stay stable so histories/overlays keep working.
    const { doc, source } = openFixture();
    const result = mustOk(
      dispatch(doc, {
        kind: 'set-style',
        target: '#ax0.line.observed>nth:0',
        props: { stroke: '#ff00ff' },
      }),
    );
    const minted = result.affected[0] as string;
    expect(minted).toMatch(/^suna-e\d+$/);
    mustOk(dispatch(doc, result.inverse));
    const el = doc.getById(minted);
    expect(el).not.toBeNull();
    el?.removeAttribute('id');
    doc.invalidate();
    expect(doc.serialize()).toBe(source);
  });
});
