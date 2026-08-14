import { describe, expect, it } from 'vitest';
import type { MatrixTuple } from '@suna/core';
import {
  applyMatrixToRect,
  constrainSquare,
  cursorForHandle,
  handleLayout,
  handlePoint,
  HANDLE_IDS,
  hitHandle,
  isIdentityMatrix,
  marqueeHits,
  normalizeRect,
  oppositeHandle,
  rectCenter,
  rectFromPoints,
  rectsIntersect,
  resizeMatrix,
  rotationDelta,
  rotationMatrix,
  snapRotation,
  snapTo45,
  unionRects,
} from './geometry';
import type { WorldPoint, WorldRect } from './types';

const B: WorldRect = { x: 10, y: 20, width: 40, height: 20 };

function applyToPoint(m: MatrixTuple, p: WorldPoint): WorldPoint {
  const [a, b, c, d, e, f] = m;
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f };
}

function expectRectClose(actual: WorldRect, expected: WorldRect): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
  expect(actual.width).toBeCloseTo(expected.width, 9);
  expect(actual.height).toBeCloseTo(expected.height, 9);
}

describe('rect algebra', () => {
  it('rectFromPoints normalizes reversed corners', () => {
    expect(rectFromPoints({ x: 50, y: 60 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 40,
    });
  });

  it('normalizeRect folds negative sizes', () => {
    expect(normalizeRect({ x: 50, y: 60, width: -40, height: -20 })).toEqual({
      x: 10,
      y: 40,
      width: 40,
      height: 20,
    });
  });

  it('unionRects spans all rects and returns null for empty input', () => {
    expect(unionRects([])).toBeNull();
    expect(
      unionRects([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: -5, width: 10, height: 10 },
      ]),
    ).toEqual({ x: 0, y: -5, width: 30, height: 15 });
  });

  it('rectsIntersect uses open intervals: edge-touching rects do not intersect', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectsIntersect(a, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
    expect(rectsIntersect(a, { x: 9.9, y: 0, width: 10, height: 10 })).toBe(true);
    expect(rectsIntersect(a, { x: 2, y: 2, width: 2, height: 2 })).toBe(true); // containment
    expect(rectsIntersect(a, { x: 0, y: 10, width: 10, height: 10 })).toBe(false);
  });

  it('marqueeHits returns intersecting element ids', () => {
    const elements = [
      { id: 'a', bbox: { x: 10, y: 10, width: 20, height: 10 } },
      { id: 'b', bbox: { x: 50, y: 50, width: 10, height: 10 } },
    ];
    expect(marqueeHits({ x: 5, y: 5, width: 10, height: 10 }, elements)).toEqual(['a']);
    expect(marqueeHits({ x: 0, y: 0, width: 100, height: 100 }, elements)).toEqual(['a', 'b']);
    expect(marqueeHits({ x: 0, y: 0, width: 10, height: 10 }, elements)).toEqual([]); // edge touch
  });
});

describe('creation constraints', () => {
  it('constrainSquare grows to the dominant axis, preserving direction', () => {
    expect(constrainSquare({ x: 0, y: 0 }, { x: 10, y: -4 })).toEqual({ x: 10, y: -10 });
    expect(constrainSquare({ x: 0, y: 0 }, { x: -3, y: 8 })).toEqual({ x: -8, y: 8 });
  });

  it('snapTo45 snaps direction to 45° steps, preserving length', () => {
    const flat = snapTo45({ x: 0, y: 0 }, { x: 10, y: 1 });
    expect(flat.y).toBeCloseTo(0, 9);
    expect(flat.x).toBeCloseTo(Math.hypot(10, 1), 9);

    const diag = snapTo45({ x: 0, y: 0 }, { x: 10, y: 9 });
    const len = Math.hypot(10, 9);
    expect(diag.x).toBeCloseTo(len / Math.SQRT2, 9);
    expect(diag.y).toBeCloseTo(len / Math.SQRT2, 9);
  });
});

describe('handle layout & hit-testing', () => {
  const B2: WorldRect = { x: 10, y: 10, width: 60, height: 40 };

  it('lays out 8 handles at corners and edge midpoints', () => {
    expect(handlePoint(B2, 'nw')).toEqual({ x: 10, y: 10 });
    expect(handlePoint(B2, 'n')).toEqual({ x: 40, y: 10 });
    expect(handlePoint(B2, 'ne')).toEqual({ x: 70, y: 10 });
    expect(handlePoint(B2, 'e')).toEqual({ x: 70, y: 30 });
    expect(handlePoint(B2, 'se')).toEqual({ x: 70, y: 50 });
    expect(handlePoint(B2, 's')).toEqual({ x: 40, y: 50 });
    expect(handlePoint(B2, 'sw')).toEqual({ x: 10, y: 50 });
    expect(handlePoint(B2, 'w')).toEqual({ x: 10, y: 30 });
  });

  it('scales the rotate offset and hit radius by zoom', () => {
    const layout = handleLayout(B2, 2);
    expect(layout.rotate).toEqual({ x: 40, y: -2 }); // 24/2 above top-center
    expect(layout.hitRadius).toBe(3); // 6/2
    expect(layout.handles).toHaveLength(8);
  });

  it('hit-tests handles with a zoom-constant screen radius', () => {
    expect(hitHandle(B2, { x: 71, y: 51 }, 1)).toBe('se');
    expect(hitHandle(B2, { x: 72, y: 51 }, 1)).toBe('se');
    expect(hitHandle(B2, { x: 72, y: 51 }, 4)).toBeNull(); // radius 1.5 at zoom 4
    expect(hitHandle(B2, { x: 40, y: 30 }, 1)).toBeNull(); // body, not a handle
  });

  it('hit-tests the rotate handle above top-center', () => {
    expect(hitHandle(B2, { x: 40, y: -14 }, 1)).toBe('rotate');
    expect(hitHandle(B2, { x: 44, y: -12 }, 1)).toBe('rotate');
  });
});

describe('resizeMatrix', () => {
  it('se drag scales about the nw anchor', () => {
    const m = resizeMatrix(B, 'se', 40, 20);
    expect(m).toEqual([2, 0, 0, 2, -10, -20]);
    expectRectClose(applyMatrixToRect(m, B), { x: 10, y: 20, width: 80, height: 40 });
  });

  it('e drag scales width only', () => {
    const m = resizeMatrix(B, 'e', 20, 999); // dy ignored for pure-x handles
    expectRectClose(applyMatrixToRect(m, B), { x: 10, y: 20, width: 60, height: 20 });
  });

  it('n drag keeps the bottom edge fixed', () => {
    const m = resizeMatrix(B, 'n', 0, -10);
    expectRectClose(applyMatrixToRect(m, B), { x: 10, y: 10, width: 40, height: 30 });
  });

  it('keeps the opposite anchor fixed for all 8 handles', () => {
    for (const handle of HANDLE_IDS) {
      const m = resizeMatrix(B, handle, 5, -3);
      const anchor = handlePoint(B, oppositeHandle(handle));
      const mapped = applyToPoint(m, anchor);
      expect(mapped.x).toBeCloseTo(anchor.x, 9);
      expect(mapped.y).toBeCloseTo(anchor.y, 9);
    }
  });

  it('dragging across the anchor flips (negative scale), no gimbal', () => {
    const m = resizeMatrix(B, 'e', -60, 0);
    expect(m[0]).toBeCloseTo(-0.5, 9);
    expectRectClose(applyMatrixToRect(m, B), { x: -10, y: 20, width: 20, height: 20 });
  });

  it('corner flip across both axes', () => {
    const B2: WorldRect = { x: 10, y: 10, width: 60, height: 40 };
    const m = resizeMatrix(B2, 'se', -120, -100);
    expect(m[0]).toBeCloseTo(-1, 9);
    expect(m[3]).toBeCloseTo(-1.5, 9);
    expectRectClose(applyMatrixToRect(m, B2), { x: -50, y: -50, width: 60, height: 60 });
  });

  it('shift on a corner: dominant axis drives a uniform scale', () => {
    const mx = resizeMatrix(B, 'se', 40, 0, { uniform: true });
    expect(mx[0]).toBeCloseTo(2, 9);
    expect(mx[3]).toBeCloseTo(2, 9);
    const my = resizeMatrix(B, 'se', 0, 20, { uniform: true });
    expect(my[0]).toBeCloseTo(2, 9);
    expect(my[3]).toBeCloseTo(2, 9);
  });

  it('shift on a corner preserves per-axis flips', () => {
    const m = resizeMatrix(B, 'se', -90, -10);
    expect(m[0]).toBeCloseTo(-1.25, 9);
    const mu = resizeMatrix(B, 'se', -90, -10, { uniform: true });
    expect(mu[0]).toBeCloseTo(-1.25, 9); // dominant |dx|
    expect(mu[3]).toBeCloseTo(1.25, 9); // sy kept positive: no y flip yet
  });

  it('shift on an edge: uniform scale centered on the perpendicular axis', () => {
    const m = resizeMatrix(B, 'e', 20, 0, { uniform: true });
    expect(m[0]).toBeCloseTo(1.5, 9);
    expect(m[3]).toBeCloseTo(1.5, 9);
    const out = applyMatrixToRect(m, B);
    // Vertical center preserved (anchor = w edge midpoint).
    expect(out.y + out.height / 2).toBeCloseTo(rectCenter(B).y, 9);
    expectRectClose(out, { x: 10, y: 15, width: 60, height: 30 });
  });

  it('alt scales about the center', () => {
    const m = resizeMatrix(B, 'se', 20, 10, { centered: true });
    expect(m).toEqual([2, 0, 0, 2, -30, -30]);
    expectRectClose(applyMatrixToRect(m, B), { x: -10, y: 10, width: 80, height: 40 });
  });

  it('alt+shift: uniform scale about the center', () => {
    const m = resizeMatrix(B, 'se', 20, 0, { uniform: true, centered: true });
    expect(m[0]).toBeCloseTo(2, 9);
    expect(m[3]).toBeCloseTo(2, 9);
    const out = applyMatrixToRect(m, B);
    expect(rectCenter(out)).toEqual(rectCenter(B));
  });

  it('degenerate zero-size axes stay at scale 1', () => {
    const flat: WorldRect = { x: 10, y: 20, width: 40, height: 0 };
    const m = resizeMatrix(flat, 'se', 40, 10);
    expect(m[0]).toBeCloseTo(2, 9);
    expect(m[3]).toBe(1);
  });

  it('no-op drag yields the identity', () => {
    expect(isIdentityMatrix(resizeMatrix(B, 'se', 0, 0))).toBe(true);
    expect(isIdentityMatrix(resizeMatrix(B, 'se', 1, 0))).toBe(false);
  });
});

describe('rotation', () => {
  it('measures signed pointer sweep around a center (y-down, cw positive)', () => {
    expect(rotationDelta({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(90, 9);
    expect(rotationDelta({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: -10 })).toBeCloseTo(-90, 9);
  });

  it('normalizes across the ±180° seam', () => {
    const at = (deg: number): WorldPoint => ({
      x: 10 * Math.cos((deg * Math.PI) / 180),
      y: 10 * Math.sin((deg * Math.PI) / 180),
    });
    expect(rotationDelta({ x: 0, y: 0 }, at(170), at(-170))).toBeCloseTo(20, 9);
    expect(rotationDelta({ x: 0, y: 0 }, at(-170), at(170))).toBeCloseTo(-20, 9);
  });

  it('snaps to 15° steps only when shift is held', () => {
    expect(snapRotation(47, true)).toBe(45);
    expect(snapRotation(47, false)).toBe(47);
    expect(Math.abs(snapRotation(-7.4, true))).toBe(0);
    expect(snapRotation(52.5, true)).toBe(60);
  });

  it('rotationMatrix rotates about the given center', () => {
    const m = rotationMatrix({ x: 30, y: 30 }, 90);
    const p = applyToPoint(m, { x: 50, y: 30 });
    expect(p.x).toBeCloseTo(30, 9);
    expect(p.y).toBeCloseTo(50, 9);
    const c = applyToPoint(m, { x: 30, y: 30 });
    expect(c.x).toBeCloseTo(30, 9);
    expect(c.y).toBeCloseTo(30, 9);
  });
});

describe('cursorForHandle', () => {
  it('maps unrotated handles to the four resize cursors', () => {
    expect(cursorForHandle('e')).toBe('ew-resize');
    expect(cursorForHandle('w')).toBe('ew-resize');
    expect(cursorForHandle('n')).toBe('ns-resize');
    expect(cursorForHandle('s')).toBe('ns-resize');
    expect(cursorForHandle('se')).toBe('nwse-resize');
    expect(cursorForHandle('nw')).toBe('nwse-resize');
    expect(cursorForHandle('ne')).toBe('nesw-resize');
    expect(cursorForHandle('sw')).toBe('nesw-resize');
  });

  it('rotates cursor buckets with the selection', () => {
    expect(cursorForHandle('e', 45)).toBe('nwse-resize');
    expect(cursorForHandle('e', 90)).toBe('ns-resize');
    expect(cursorForHandle('n', 90)).toBe('ew-resize');
    expect(cursorForHandle('se', -45)).toBe('ew-resize');
    expect(cursorForHandle('e', 170)).toBe('ew-resize'); // near-horizontal rounds home
    expect(cursorForHandle('e', -360)).toBe('ew-resize');
  });
});
