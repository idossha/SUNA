import { describe, expect, it } from 'vitest';
import { CanvasCommandSchema, type CanvasCommand } from '@suna/core';
import { dispatch } from '../commands';
import { open } from '../testkit';
import { SnapEngine } from './snap';
import { ToolController } from './tools';
import type {
  EditorEvent,
  KeyInput,
  PointerInput,
  ToolContext,
  WorldPoint,
  WorldRect,
} from './types';

// ---------------------------------------------------------------------------
// Harness

const ARTBOARD: WorldRect = { x: 0, y: 0, width: 200, height: 200 };

const ELEMENTS: Array<{ id: string; bbox: WorldRect }> = [
  { id: 'a', bbox: { x: 10, y: 10, width: 60, height: 40 } },
  { id: 'b', bbox: { x: 120, y: 120, width: 30, height: 30 } },
];

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  let counter = 0;
  const elements = overrides.elements ?? ELEMENTS;
  return {
    selection: [],
    bboxOf: (id) => elements.find((e) => e.id === id)?.bbox ?? null,
    hitTest: (p: WorldPoint) => {
      for (const el of [...elements].reverse()) {
        const { x, y, width, height } = el.bbox;
        if (p.x >= x && p.x <= x + width && p.y >= y && p.y <= y + height) return el.id;
      }
      return null;
    },
    artboard: ARTBOARD,
    zoom: 1,
    snap: new SnapEngine(ARTBOARD, []),
    elements,
    allocateId: () => `t${++counter}`,
    hasId: () => false,
    ...overrides,
  };
}

function pt(x: number, y: number, mods: Partial<PointerInput> = {}): PointerInput {
  return { x, y, shiftKey: false, altKey: false, ...mods };
}

function key(k: string, mods: Partial<KeyInput> = {}): KeyInput {
  return { key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods };
}

function isKind<K extends EditorEvent['kind']>(kind: K) {
  return (e: EditorEvent): e is Extract<EditorEvent, { kind: K }> => e.kind === kind;
}

function commitsOf(events: EditorEvent[]): Array<{ command: CanvasCommand; label: string }> {
  const commits = events.filter(isKind('commit'));
  // Every emitted command must validate against the engine schema.
  for (const c of commits) {
    expect(CanvasCommandSchema.safeParse(c.command).success).toBe(true);
  }
  return commits;
}

function selectionsOf(events: EditorEvent[]): string[][] {
  return events.filter(isKind('selection')).map((e) => e.ids);
}

function lastPreview(events: EditorEvent[]): Extract<EditorEvent, { kind: 'preview' }> {
  const last = events.filter(isKind('preview')).at(-1);
  if (last === undefined) throw new Error('expected a preview event');
  return last;
}

function matrixOf(command: CanvasCommand | undefined): readonly number[] {
  if (command?.kind !== 'transform') throw new Error('expected a transform command');
  return command.matrix;
}

/** Light validity check: the snippet parses as XML inside an svg root. */
function expectValidSvgSnippet(svg: string): Element {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`,
    'image/svg+xml',
  );
  expect(doc.querySelector('parsererror')).toBeNull();
  const el = doc.documentElement.firstElementChild;
  expect(el).not.toBeNull();
  return el as Element;
}

// ---------------------------------------------------------------------------
// Tool switching

describe('tool keys', () => {
  it('maps V/R/O/L/A/T to tools, ignoring modifier chords', () => {
    const c = new ToolController();
    const ctx = makeCtx();
    c.keyDown(key('r'), ctx);
    expect(c.tool).toBe('rect');
    c.keyDown(key('o'), ctx);
    expect(c.tool).toBe('ellipse');
    c.keyDown(key('l'), ctx);
    expect(c.tool).toBe('line');
    c.keyDown(key('a'), ctx);
    expect(c.tool).toBe('arrow');
    c.keyDown(key('t'), ctx);
    expect(c.tool).toBe('text');
    c.keyDown(key('v'), ctx);
    expect(c.tool).toBe('select');
    c.keyDown(key('r', { metaKey: true }), ctx);
    expect(c.tool).toBe('select'); // ⌘R is not a tool switch
  });

  it('Escape backs out: gesture → tool → selection', () => {
    const c = new ToolController();
    // 1. armed tool falls back to select
    c.keyDown(key('r'), makeCtx());
    c.keyDown(key('Escape'), makeCtx());
    expect(c.tool).toBe('select');
    // 2. selection clears
    const events = c.keyDown(key('Escape'), makeCtx({ selection: ['a'] }));
    expect(selectionsOf(events)).toEqual([[]]);
    // 3. mid-gesture Escape cancels the gesture and only the gesture
    c.keyDown(key('r'), makeCtx());
    c.pointerDown(pt(60, 60), makeCtx());
    const cancel = c.keyDown(key('Escape'), makeCtx());
    expect(c.gesture).toEqual({ kind: 'idle' });
    expect(c.tool).toBe('rect'); // tool untouched by gesture cancel
    expect(lastPreview(cancel).gesture).toEqual({ kind: 'idle' });
    expect(commitsOf(c.pointerUp(pt(100, 100), makeCtx()))).toEqual([]); // drag is dead
  });
});

// ---------------------------------------------------------------------------
// Selection

describe('select tool: click selection', () => {
  it('click on an element replaces the selection', () => {
    const c = new ToolController();
    const down = c.pointerDown(pt(40, 30), makeCtx());
    expect(selectionsOf(down)).toEqual([['a']]);
    const up = c.pointerUp(pt(40, 30), makeCtx({ selection: ['a'] }));
    expect(commitsOf(up)).toEqual([]);
  });

  it('shift-click toggles membership', () => {
    const c = new ToolController();
    const add = c.pointerDown(pt(135, 135, { shiftKey: true }), makeCtx({ selection: ['a'] }));
    expect(selectionsOf(add)).toEqual([['a', 'b']]);
    c.pointerUp(pt(135, 135, { shiftKey: true }), makeCtx({ selection: ['a', 'b'] }));
    const remove = c.pointerDown(
      pt(135, 135, { shiftKey: true }),
      makeCtx({ selection: ['a', 'b'] }),
    );
    expect(selectionsOf(remove)).toEqual([['a']]);
  });

  it('plain click on a multi-selection member narrows on mouse-up (drag keeps all)', () => {
    const c = new ToolController();
    const ctx = makeCtx({ selection: ['a', 'b'] });
    const down = c.pointerDown(pt(40, 30), ctx);
    expect(selectionsOf(down)).toEqual([]); // selection kept for a potential drag
    const up = c.pointerUp(pt(40, 30), ctx);
    expect(selectionsOf(up)).toEqual([['a']]);
  });

  it('click on empty canvas clears selection and arms a marquee', () => {
    const c = new ToolController();
    const events = c.pointerDown(pt(190, 190), makeCtx({ selection: ['a'] }));
    expect(selectionsOf(events)).toEqual([[]]);
    expect(lastPreview(events).gesture.kind).toBe('marquee');
  });
});

describe('select tool: marquee', () => {
  it('selects elements whose bbox intersects the marquee, live', () => {
    const c = new ToolController();
    c.pointerDown(pt(5, 5), makeCtx());
    const move = c.pointerMove(pt(15, 15), makeCtx());
    expect(selectionsOf(move)).toEqual([['a']]);
    const g = lastPreview(move).gesture;
    expect(g).toEqual({ kind: 'marquee', start: { x: 5, y: 5 }, current: { x: 15, y: 15 } });
    const up = c.pointerUp(pt(15, 15), makeCtx({ selection: ['a'] }));
    expect(commitsOf(up)).toEqual([]);
    expect(lastPreview(up).gesture).toEqual({ kind: 'idle' });
  });

  it('edge-touching bboxes are not selected (open-interval rule)', () => {
    const c = new ToolController();
    c.pointerDown(pt(0, 0), makeCtx());
    const move = c.pointerMove(pt(10, 10), makeCtx()); // a starts exactly at x=10
    expect(selectionsOf(move)).toEqual([[]]);
  });

  it('spanning both elements selects both', () => {
    const c = new ToolController();
    c.pointerDown(pt(5, 5), makeCtx());
    const move = c.pointerMove(pt(160, 160), makeCtx());
    expect(selectionsOf(move)).toEqual([['a', 'b']]);
  });
});

// ---------------------------------------------------------------------------
// Move

describe('select tool: move', () => {
  it('ignores sub-threshold jitter, then previews and commits a translate', () => {
    const c = new ToolController();
    c.pointerDown(pt(40, 30), makeCtx());
    const ctx = makeCtx({ selection: ['a'] });
    expect(c.pointerMove(pt(41, 30), ctx)).toEqual([]); // 1 < 3px threshold
    const move = c.pointerMove(pt(50, 30), ctx);
    expect(lastPreview(move).gesture).toEqual({ kind: 'move', ids: ['a'], dx: 10, dy: 0 });
    const up = c.pointerUp(pt(50, 30), ctx);
    const commits = commitsOf(up);
    expect(commits).toHaveLength(1);
    expect(commits[0]?.command).toEqual({ kind: 'translate', targets: ['a'], dx: 10, dy: 0 });
    expect(commits[0]?.label).toBe('Move');
    expect(up.some((e) => e.kind === 'guides' && e.guides.length === 0)).toBe(true);
    expect(c.gesture).toEqual({ kind: 'idle' });
  });

  it('snaps the union bbox to sibling edges and emits guides', () => {
    const snap = new SnapEngine(ARTBOARD, [{ x: 75, y: 300, width: 10, height: 10 }]);
    const c = new ToolController();
    c.pointerDown(pt(40, 30), makeCtx({ snap }));
    const ctx = makeCtx({ selection: ['a'], snap });
    const move = c.pointerMove(pt(44.5, 30), ctx); // raw dx 4.5; right edge 74.5 → 75
    const g = lastPreview(move).gesture;
    expect(g.kind).toBe('move');
    if (g.kind === 'move') {
      expect(g.dx).toBeCloseTo(5, 9);
      expect(g.dy).toBe(0);
    }
    const guideEvents = move.filter(isKind('guides'));
    expect(guideEvents.at(-1)?.guides.some((s) => s.axis === 'x' && s.position === 75)).toBe(true);
    const commits = commitsOf(c.pointerUp(pt(44.5, 30), ctx));
    expect(commits[0]?.command).toEqual({ kind: 'translate', targets: ['a'], dx: 5, dy: 0 });
  });

  it('drags every member of a multi-selection', () => {
    const c = new ToolController();
    const ctx = makeCtx({ selection: ['a', 'b'] });
    c.pointerDown(pt(40, 30), ctx); // on 'a', already selected → keep both
    c.pointerMove(pt(50, 40), ctx);
    const commits = commitsOf(c.pointerUp(pt(50, 40), ctx));
    expect(commits[0]?.command).toEqual({
      kind: 'translate',
      targets: ['a', 'b'],
      dx: 10,
      dy: 10,
    });
  });

  it('click without movement commits nothing', () => {
    const c = new ToolController();
    c.pointerDown(pt(40, 30), makeCtx());
    const up = c.pointerUp(pt(40, 30), makeCtx({ selection: ['a'] }));
    expect(commitsOf(up)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Resize

describe('select tool: resize', () => {
  const ctxA = (): ToolContext => makeCtx({ selection: ['a'] }); // bbox {10,10,60,40}

  it('se-handle drag composes a scale about the nw anchor', () => {
    const c = new ToolController();
    const down = c.pointerDown(pt(70, 50), ctxA()); // se handle
    expect(lastPreview(down).gesture.kind).toBe('resize');
    const move = c.pointerMove(pt(130, 90), ctxA());
    const g = lastPreview(move).gesture;
    expect(g.kind).toBe('resize');
    if (g.kind === 'resize') {
      expect(g.handle).toBe('se');
      expect(g.matrix[0]).toBeCloseTo(2, 9);
      expect(g.matrix[3]).toBeCloseTo(2, 9);
    }
    const commits = commitsOf(c.pointerUp(pt(130, 90), ctxA()));
    expect(commits).toHaveLength(1);
    expect(commits[0]?.label).toBe('Resize');
    expect(commits[0]?.command).toMatchObject({
      kind: 'transform',
      target: 'a',
      mode: 'compose',
    });
    const matrix = matrixOf(commits[0]?.command);
    expect(matrix[0]).toBeCloseTo(2, 9);
    expect(matrix[4]).toBeCloseTo(-10, 9);
    expect(matrix[5]).toBeCloseTo(-10, 9);
  });

  it('shift makes the scale uniform (dominant axis)', () => {
    const c = new ToolController();
    c.pointerDown(pt(70, 50), ctxA());
    const move = c.pointerMove(pt(130, 60, { shiftKey: true }), ctxA());
    const g = lastPreview(move).gesture;
    expect(g.kind).toBe('resize');
    if (g.kind === 'resize') {
      expect(g.matrix[0]).toBeCloseTo(2, 9);
      expect(g.matrix[3]).toBeCloseTo(2, 9); // sy follows dominant sx
    }
  });

  it('alt anchors the scale at the bbox center', () => {
    const c = new ToolController();
    c.pointerDown(pt(70, 50), ctxA());
    c.pointerMove(pt(100, 70, { altKey: true }), ctxA());
    const commits = commitsOf(c.pointerUp(pt(100, 70, { altKey: true }), ctxA()));
    const matrix = matrixOf(commits[0]?.command);
    expect(matrix[0]).toBeCloseTo(2, 9);
    expect(matrix[3]).toBeCloseTo(2, 9);
    expect(matrix[4]).toBeCloseTo(-40, 9); // 40·(1−2), center (40,30)
    expect(matrix[5]).toBeCloseTo(-30, 9);
  });

  it('multi-selection resize batches the same matrix per member', () => {
    const c = new ToolController();
    const ctx = makeCtx({ selection: ['a', 'b'] }); // union {10,10,140,140}
    c.pointerDown(pt(150, 150), ctx); // union se handle
    c.pointerMove(pt(290, 290), ctx);
    const commits = commitsOf(c.pointerUp(pt(290, 290), ctx));
    const command = commits[0]?.command;
    expect(command?.kind).toBe('batch');
    if (command?.kind === 'batch') {
      expect(command.commands).toHaveLength(2);
      expect(command.commands[0]).toMatchObject({ kind: 'transform', target: 'a', mode: 'compose' });
      expect(command.commands[1]).toMatchObject({ kind: 'transform', target: 'b', mode: 'compose' });
    }
  });

  it('a handle press without movement commits nothing', () => {
    const c = new ToolController();
    c.pointerDown(pt(70, 50), ctxA());
    expect(commitsOf(c.pointerUp(pt(70, 50), ctxA()))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rotate

describe('select tool: rotate', () => {
  const ctxA = (): ToolContext => makeCtx({ selection: ['a'] }); // center (40,30)

  it('sweeps the angle around the bbox center and commits a rotation', () => {
    const c = new ToolController();
    const down = c.pointerDown(pt(40, -14), ctxA()); // rotate handle (24px above top)
    expect(lastPreview(down).gesture).toEqual({ kind: 'rotate', ids: ['a'], angle: 0 });
    const move = c.pointerMove(pt(84, 30), ctxA()); // +90° cw
    const g = lastPreview(move).gesture;
    expect(g.kind).toBe('rotate');
    if (g.kind === 'rotate') expect(g.angle).toBeCloseTo(90, 9);
    const commits = commitsOf(c.pointerUp(pt(84, 30), ctxA()));
    expect(commits[0]?.label).toBe('Rotate');
    const matrix = matrixOf(commits[0]?.command);
    expect(matrix[0]).toBeCloseTo(0, 9);
    expect(matrix[1]).toBeCloseTo(1, 9);
    expect(matrix[2]).toBeCloseTo(-1, 9);
    expect(matrix[3]).toBeCloseTo(0, 9);
    expect(matrix[4]).toBeCloseTo(70, 9); // rotation about (40,30)
    expect(matrix[5]).toBeCloseTo(-10, 9);
  });

  it('shift snaps the preview angle to 15°', () => {
    const c = new ToolController();
    c.pointerDown(pt(40, -14), ctxA());
    // 47° clockwise from the start vector (0,−44).
    const rad = (47 * Math.PI) / 180;
    const p = pt(40 + 44 * Math.sin(rad), 30 - 44 * Math.cos(rad), { shiftKey: true });
    const move = c.pointerMove(p, ctxA());
    const g = lastPreview(move).gesture;
    expect(g.kind).toBe('rotate');
    if (g.kind === 'rotate') expect(g.angle).toBe(45);
  });

  it('zero-angle release commits nothing', () => {
    const c = new ToolController();
    c.pointerDown(pt(40, -14), ctxA());
    expect(commitsOf(c.pointerUp(pt(40, -14), ctxA()))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Creation tools

describe('creation tools', () => {
  it('R + drag inserts a rect, selects it, and returns to Select', () => {
    const c = new ToolController();
    const ctx = makeCtx();
    c.keyDown(key('r'), ctx);
    c.pointerDown(pt(60, 60), ctx);
    const move = c.pointerMove(pt(100, 90), ctx);
    expect(lastPreview(move).gesture.kind).toBe('create');
    const up = c.pointerUp(pt(100, 90), ctx);
    const commits = commitsOf(up);
    expect(commits).toHaveLength(1);
    expect(commits[0]?.label).toBe('Create rectangle');
    const command = commits[0]?.command;
    expect(command?.kind).toBe('insert');
    if (command?.kind === 'insert') {
      expect(command.id).toBe('t1');
      const el = expectValidSvgSnippet(command.svg);
      expect(el.tagName).toBe('rect');
      expect(el.getAttribute('x')).toBe('60');
      expect(el.getAttribute('y')).toBe('60');
      expect(el.getAttribute('width')).toBe('40');
      expect(el.getAttribute('height')).toBe('30');
    }
    expect(selectionsOf(up)).toEqual([['t1']]);
    expect(c.tool).toBe('select');
  });

  it('shift constrains rects to squares', () => {
    const c = new ToolController();
    const ctx = makeCtx();
    c.keyDown(key('r'), ctx);
    c.pointerDown(pt(60, 60), ctx);
    c.pointerMove(pt(100, 80, { shiftKey: true }), ctx);
    const commits = commitsOf(c.pointerUp(pt(100, 80, { shiftKey: true }), ctx));
    const command = commits[0]?.command;
    if (command?.kind === 'insert') {
      const el = expectValidSvgSnippet(command.svg);
      expect(el.getAttribute('width')).toBe('40');
      expect(el.getAttribute('height')).toBe('40');
    }
  });

  it('O + drag inserts an ellipse sized to the drag rect', () => {
    const c = new ToolController();
    const ctx = makeCtx();
    c.keyDown(key('o'), ctx);
    c.pointerDown(pt(60, 60), ctx);
    c.pointerMove(pt(90, 80), ctx);
    const commits = commitsOf(c.pointerUp(pt(90, 80), ctx));
    const command = commits[0]?.command;
    if (command?.kind === 'insert') {
      const el = expectValidSvgSnippet(command.svg);
      expect(el.tagName).toBe('ellipse');
      expect(el.getAttribute('cx')).toBe('75');
      expect(el.getAttribute('cy')).toBe('70');
      expect(el.getAttribute('rx')).toBe('15');
      expect(el.getAttribute('ry')).toBe('10');
    }
  });

  it('L + drag inserts a line; shift snaps to 45° directions', () => {
    const c = new ToolController();
    const ctx = makeCtx();
    c.keyDown(key('l'), ctx);
    c.pointerDown(pt(60, 60), ctx);
    c.pointerMove(pt(90, 60.5, { shiftKey: true }), ctx);
    const commits = commitsOf(c.pointerUp(pt(90, 60.5, { shiftKey: true }), ctx));
    const command = commits[0]?.command;
    expect(commits[0]?.label).toBe('Create line');
    if (command?.kind === 'insert') {
      const el = expectValidSvgSnippet(command.svg);
      expect(el.tagName).toBe('line');
      expect(el.getAttribute('x1')).toBe('60');
      expect(el.getAttribute('y1')).toBe('60');
      expect(el.getAttribute('y2')).toBe('60'); // 45°-snapped flat
    }
  });

  it('A + drag: first arrow batches the marker def, later arrows do not', () => {
    const c = new ToolController();
    const fresh = makeCtx({ hasId: () => false });
    c.keyDown(key('a'), fresh);
    c.pointerDown(pt(60, 60), fresh);
    c.pointerMove(pt(100, 60), fresh);
    const commits = commitsOf(c.pointerUp(pt(100, 60), fresh));
    const command = commits[0]?.command;
    expect(command?.kind).toBe('batch');
    if (command?.kind === 'batch') {
      expect(command.commands).toHaveLength(2);
      const def = command.commands[0];
      const arrow = command.commands[1];
      if (def?.kind === 'insert') {
        const defs = expectValidSvgSnippet(def.svg);
        expect(defs.querySelector('marker')?.getAttribute('id')).toBe('suna-arrow');
      } else {
        expect.unreachable('first batch entry must insert the marker def');
      }
      if (arrow?.kind === 'insert') {
        const line = expectValidSvgSnippet(arrow.svg);
        expect(line.getAttribute('marker-end')).toBe('url(#suna-arrow)');
      } else {
        expect.unreachable('second batch entry must insert the arrow');
      }
    }

    const marked = makeCtx({ hasId: (id) => id === 'suna-arrow' });
    c.keyDown(key('a'), marked);
    c.pointerDown(pt(60, 80), marked);
    c.pointerMove(pt(100, 80), marked);
    const second = commitsOf(c.pointerUp(pt(100, 80), marked));
    expect(second[0]?.command.kind).toBe('insert'); // no def re-insert
  });

  it('sub-threshold create drags are cancelled, tool stays armed', () => {
    const c = new ToolController();
    const ctx = makeCtx();
    c.keyDown(key('r'), ctx);
    c.pointerDown(pt(60, 60), ctx);
    const up = c.pointerUp(pt(61, 60), ctx);
    expect(commitsOf(up)).toEqual([]);
    expect(c.tool).toBe('rect');
  });

  it('T + click inserts text, selects it, and enters text editing', () => {
    const c = new ToolController();
    const ctx = makeCtx();
    c.keyDown(key('t'), ctx);
    c.pointerDown(pt(70, 80), ctx);
    const up = c.pointerUp(pt(70, 80), ctx);
    const commits = commitsOf(up);
    expect(commits[0]?.label).toBe('Create text');
    const command = commits[0]?.command;
    if (command?.kind === 'insert') {
      const el = expectValidSvgSnippet(command.svg);
      expect(el.tagName).toBe('text');
      expect(el.getAttribute('x')).toBe('70');
      expect(el.textContent).toBe('Text');
    }
    expect(selectionsOf(up)).toEqual([['t1']]);
    expect(up.some((e) => e.kind === 'enter-text-edit' && e.id === 't1')).toBe(true);
    expect(c.tool).toBe('select');
  });
});

// ---------------------------------------------------------------------------
// Keyboard editing

describe('keyDown editing commands', () => {
  it('arrows nudge by 1, shift-arrows by 10', () => {
    const c = new ToolController();
    const ctx = makeCtx({ selection: ['a'] });
    const left = commitsOf(c.keyDown(key('ArrowLeft'), ctx));
    expect(left[0]?.command).toEqual({ kind: 'translate', targets: ['a'], dx: -1, dy: 0 });
    expect(left[0]?.label).toBe('Nudge');
    const down = commitsOf(c.keyDown(key('ArrowDown', { shiftKey: true }), ctx));
    expect(down[0]?.command).toEqual({ kind: 'translate', targets: ['a'], dx: 0, dy: 10 });
    expect(c.keyDown(key('ArrowLeft'), makeCtx())).toEqual([]); // empty selection
  });

  it('Delete removes the selection and clears it', () => {
    const c = new ToolController();
    const events = c.keyDown(key('Delete'), makeCtx({ selection: ['a', 'b'] }));
    const commits = commitsOf(events);
    expect(commits[0]?.command).toEqual({ kind: 'remove', targets: ['a', 'b'] });
    expect(selectionsOf(events)).toEqual([[]]);
    expect(c.keyDown(key('Backspace'), makeCtx())).toEqual([]);
  });

  it('⌘]/⌘[ reorder; ⌥⌘ variants go to front/back', () => {
    const c = new ToolController();
    const ctx = makeCtx({ selection: ['a'] });
    const fwd = commitsOf(c.keyDown(key(']', { metaKey: true }), ctx));
    expect(fwd[0]?.command).toEqual({ kind: 'reorder', target: 'a', mode: 'forward' });
    const back = commitsOf(c.keyDown(key('[', { metaKey: true, altKey: true }), ctx));
    expect(back[0]?.command).toEqual({ kind: 'reorder', target: 'a', mode: 'back' });
  });

  it('⌘G groups, ⇧⌘G ungroups', () => {
    const c = new ToolController();
    const ctx = makeCtx({ selection: ['a', 'b'] });
    const group = commitsOf(c.keyDown(key('g', { metaKey: true }), ctx));
    expect(group[0]?.command).toEqual({ kind: 'group', targets: ['a', 'b'] });
    const ungroup = commitsOf(
      c.keyDown(key('g', { metaKey: true, shiftKey: true }), makeCtx({ selection: ['g1'] })),
    );
    expect(ungroup[0]?.command).toEqual({ kind: 'ungroup', target: 'g1' });
  });
});

// ---------------------------------------------------------------------------
// End-to-end: emitted commands run on the real engine

describe('emitted commands dispatch cleanly against a CanvasDocument', () => {
  const BLANK =
    '<svg xmlns="http://www.w3.org/2000/svg" width="70.5mm" height="70.5mm" viewBox="0 0 200 200"></svg>';

  it('create-rect insert applies and lands in the document', () => {
    const doc = open(BLANK);
    const c = new ToolController();
    const ctx = makeCtx({ allocateId: () => doc.allocateId(), hasId: (id) => doc.getById(id) !== null });
    c.keyDown(key('r'), ctx);
    c.pointerDown(pt(60, 60), ctx);
    c.pointerMove(pt(100, 90), ctx);
    const commits = commitsOf(c.pointerUp(pt(100, 90), ctx));
    const command = commits[0]?.command;
    expect(command).toBeDefined();
    const result = dispatch(doc, command as CanvasCommand);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const id = result.affected[0] as string;
      expect(doc.getById(id)?.tagName).toBe('rect');
      expect(doc.serialize()).toContain('<rect x="60" y="60" width="40" height="30"');
    }
  });

  it('first-arrow batch inserts the marker def exactly once', () => {
    const doc = open(BLANK);
    const c = new ToolController();
    const ctx = makeCtx({ allocateId: () => doc.allocateId(), hasId: (id) => doc.getById(id) !== null });
    c.keyDown(key('a'), ctx);
    c.pointerDown(pt(20, 20), ctx);
    c.pointerMove(pt(80, 20), ctx);
    const first = commitsOf(c.pointerUp(pt(80, 20), ctx));
    expect(dispatch(doc, first[0]?.command as CanvasCommand).ok).toBe(true);
    expect(doc.getById('suna-arrow')?.tagName).toBe('marker');

    c.keyDown(key('a'), ctx);
    c.pointerDown(pt(20, 40), ctx);
    c.pointerMove(pt(80, 40), ctx);
    const second = commitsOf(c.pointerUp(pt(80, 40), ctx));
    expect(second[0]?.command.kind).toBe('insert'); // hasId now sees the marker
    expect(dispatch(doc, second[0]?.command as CanvasCommand).ok).toBe(true);
    expect(doc.serialize().match(/id="suna-arrow"/g)).toHaveLength(1);
  });
});
