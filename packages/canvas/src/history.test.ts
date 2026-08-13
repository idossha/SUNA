import { describe, expect, it } from 'vitest';
import { CommandHistory } from './history';
import { mustOk, open } from './testkit';

const BASE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<rect id="r1" x="10" y="10" width="20" height="10"/>' +
  '<text id="t1" x="5" y="5">hello</text>' +
  '</svg>';

describe('CommandHistory', () => {
  it('undo/redo round-trips serialized state across a mixed sequence', () => {
    const doc = open(BASE);
    const history = new CommandHistory(doc);
    const snapshots = [doc.serialize()];

    mustOk(history.apply({ kind: 'set-attrs', target: 'r1', attrs: { fill: 'teal' } }));
    snapshots.push(doc.serialize());
    mustOk(history.apply({ kind: 'translate', targets: ['r1'], dx: 4, dy: -2 }));
    snapshots.push(doc.serialize());
    mustOk(history.apply({ kind: 'set-text', target: 't1', text: 'edited' }));
    snapshots.push(doc.serialize());
    mustOk(history.apply({ kind: 'remove', targets: ['r1'] }));
    snapshots.push(doc.serialize());

    // Walk all the way back…
    for (let i = snapshots.length - 2; i >= 0; i--) {
      expect(history.undo()?.ok).toBe(true);
      expect(doc.serialize()).toBe(snapshots[i]);
    }
    expect(history.undo()).toBeNull();

    // …and all the way forward again.
    for (let i = 1; i < snapshots.length; i++) {
      expect(history.redo()?.ok).toBe(true);
      expect(doc.serialize()).toBe(snapshots[i]);
    }
    expect(history.redo()).toBeNull();
  });

  it('new work clears the redo stack', () => {
    const doc = open(BASE);
    const history = new CommandHistory(doc);
    mustOk(history.apply({ kind: 'set-text', target: 't1', text: 'one' }));
    history.undo();
    expect(history.redoDepth).toBe(1);
    mustOk(history.apply({ kind: 'set-text', target: 't1', text: 'two' }));
    expect(history.redoDepth).toBe(0);
    expect(history.undoDepth).toBe(1);
  });

  it('evicts the oldest entries beyond the bound', () => {
    const doc = open(BASE);
    const history = new CommandHistory(doc, 2);
    const afterFirst = (() => {
      mustOk(history.apply({ kind: 'set-text', target: 't1', text: 'v1' }));
      return doc.serialize();
    })();
    mustOk(history.apply({ kind: 'set-text', target: 't1', text: 'v2' }));
    mustOk(history.apply({ kind: 'set-text', target: 't1', text: 'v3' }));
    expect(history.undoDepth).toBe(2);
    expect(history.undo()?.ok).toBe(true);
    expect(history.undo()?.ok).toBe(true);
    // The first edit's entry was evicted: undo stops at the post-v1 state.
    expect(history.undo()).toBeNull();
    expect(doc.serialize()).toBe(afterFirst);
  });

  it('coalesces an open transaction into a single batch undo step', () => {
    const doc = open(BASE);
    const history = new CommandHistory(doc);
    const original = doc.serialize();

    history.begin('drag');
    mustOk(history.apply({ kind: 'translate', targets: ['r1'], dx: 1, dy: 0 }));
    mustOk(history.apply({ kind: 'translate', targets: ['r1'], dx: 1, dy: 0 }));
    mustOk(history.apply({ kind: 'set-attrs', target: 'r1', attrs: { fill: 'red' } }));
    history.commit();

    expect(history.undoDepth).toBe(1);
    const moved = doc.serialize();
    expect(history.undo()?.ok).toBe(true);
    expect(doc.serialize()).toBe(original);
    expect(history.redo()?.ok).toBe(true);
    expect(doc.serialize()).toBe(moved);
  });

  it('a dispatched batch lands as one undo step', () => {
    const doc = open(BASE);
    const history = new CommandHistory(doc);
    const original = doc.serialize();
    mustOk(
      history.apply({
        kind: 'batch',
        commands: [
          { kind: 'set-text', target: 't1', text: 'a' },
          { kind: 'set-text', target: 't1', text: 'b' },
        ],
      }),
    );
    expect(history.undoDepth).toBe(1);
    history.undo();
    expect(doc.serialize()).toBe(original);
  });
});
