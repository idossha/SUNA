import { describe, expect, it } from 'vitest';
import { SnapEngine, SNAP_THRESHOLD } from './snap';
import type { WorldRect } from './types';

const ARTBOARD: WorldRect = { x: 0, y: 0, width: 100, height: 100 };

describe('SnapEngine.snapPoint', () => {
  it('snaps to artboard center lines and reports a guide', () => {
    const engine = new SnapEngine(ARTBOARD);
    const { point, guides } = engine.snapPoint({ x: 49.7, y: 80 }, 1);
    expect(point).toEqual({ x: 50, y: 80 });
    expect(guides).toHaveLength(1);
    expect(guides[0]).toEqual({ axis: 'x', position: 50, from: 0, to: 100 });
  });

  it('snaps to artboard edges', () => {
    const engine = new SnapEngine(ARTBOARD);
    const { point } = engine.snapPoint({ x: 2, y: 98.5 }, 1);
    expect(point).toEqual({ x: 0, y: 100 });
  });

  it('threshold shrinks with zoom (6 / zoom world units)', () => {
    const engine = new SnapEngine(ARTBOARD);
    expect(SNAP_THRESHOLD).toBe(6);
    const zoom1 = engine.snapPoint({ x: 54, y: 80 }, 1);
    expect(zoom1.point.x).toBe(50); // |4| <= 6
    const zoom2 = engine.snapPoint({ x: 54, y: 80 }, 2);
    expect(zoom2.point.x).toBe(54); // |4| > 3
    expect(zoom2.guides).toEqual([]);
  });

  it('does not snap far points', () => {
    const engine = new SnapEngine(ARTBOARD);
    const { point, guides } = engine.snapPoint({ x: 30, y: 80 }, 1);
    expect(point).toEqual({ x: 30, y: 80 });
    expect(guides).toEqual([]);
  });
});

describe('SnapEngine.snapRect', () => {
  it('snaps a moving edge to a sibling edge with a spanning guide', () => {
    const engine = new SnapEngine(ARTBOARD, [{ x: 10, y: 10, width: 20, height: 20 }]);
    const { rect, dx, dy, guides } = engine.snapRect({ x: 28.5, y: 63, width: 10, height: 10 }, 1);
    expect(dx).toBeCloseTo(1.5, 9);
    expect(dy).toBe(0);
    expect(rect.x).toBeCloseTo(30, 9);
    const guide = guides.find((g) => g.axis === 'x');
    expect(guide).toBeDefined();
    expect(guide?.position).toBe(30);
    // Spans both the sibling (y 10..30) and the moving rect (y 63..73).
    expect(guide?.from).toBe(10);
    expect(guide?.to).toBe(73);
  });

  it('snaps center-to-center', () => {
    const engine = new SnapEngine(ARTBOARD, [{ x: 10, y: 10, width: 20, height: 20 }]);
    const { rect, dx } = engine.snapRect({ x: 14.2, y: 63, width: 12, height: 10 }, 1);
    expect(dx).toBeCloseTo(-0.2, 9); // moving centerX 20.2 → sibling centerX 20
    expect(rect.x + rect.width / 2).toBeCloseTo(20, 9);
  });

  it('picks the minimum-|delta| candidate per axis independently', () => {
    const engine = new SnapEngine(ARTBOARD, [{ x: 10, y: 10, width: 20, height: 20 }]);
    // x: sibling right edge (30) is 1.5 away; y: artboard top (0) is 2 away.
    const { dx, dy } = engine.snapRect({ x: 28.5, y: 2, width: 10, height: 4 }, 1);
    expect(dx).toBeCloseTo(1.5, 9);
    expect(dy).toBeCloseTo(-2, 9);
  });

  it('merges tied candidates at the same position into one guide', () => {
    const engine = new SnapEngine(ARTBOARD, [
      { x: 10, y: 10, width: 20, height: 20 }, // right edge 30, y span 10..30
      { x: 10, y: 40, width: 20, height: 5 }, // right edge 30, y span 40..45
    ]);
    const { guides } = engine.snapRect({ x: 28.5, y: 63, width: 10, height: 10 }, 1);
    const xGuides = guides.filter((g) => g.axis === 'x');
    expect(xGuides).toHaveLength(1);
    expect(xGuides[0]).toEqual({ axis: 'x', position: 30, from: 10, to: 73 });
  });

  it('caps sibling candidates at 200', () => {
    const far: WorldRect[] = Array.from({ length: 200 }, (_, i) => ({
      x: 1000 + i,
      y: 1000,
      width: 1,
      height: 1,
    }));
    const near: WorldRect = { x: 230, y: 400, width: 10, height: 10 };
    const moving: WorldRect = { x: 228.5, y: 263, width: 10, height: 10 };

    const capped = new SnapEngine(ARTBOARD, [...far, near]); // near is #201 → dropped
    expect(capped.snapRect(moving, 1).dx).toBe(0);

    const kept = new SnapEngine(ARTBOARD, [near, ...far]);
    expect(kept.snapRect(moving, 1).dx).toBeCloseTo(1.5, 9);
  });

  it('reports zero-delta alignment (already aligned) with guides', () => {
    const engine = new SnapEngine(ARTBOARD);
    const { dx, guides } = engine.snapRect({ x: 0, y: 63, width: 10, height: 10 }, 1);
    expect(dx).toBe(0);
    expect(guides.some((g) => g.axis === 'x' && g.position === 0)).toBe(true);
  });
});
