import type { SnapGuide, WorldPoint, WorldRect } from './types';

/**
 * Smart-guide snapping (canvas-editing-suite.md §3). Candidate lines come
 * from the artboard's edges + centers and visible sibling bbox edges +
 * centers (capped); a point or rect snaps when a candidate lies within
 * SNAP_THRESHOLD / zoom world units, and every snap reports guide segments
 * for the overlay.
 *
 * Candidate collection follows the OpenPencil snap model (edge/center pairs,
 * best-|delta| per axis, ties accumulate) with the threshold zoom-normalized.
 */

/** Snap radius in screen px; world threshold is SNAP_THRESHOLD / zoom. */
export const SNAP_THRESHOLD = 6;
/** Sibling bboxes beyond this many are ignored (spec §3 cap). */
export const MAX_SNAP_CANDIDATES = 200;

const EPSILON = 1e-9;

interface AxisCandidate {
  /** Line position on the snapping axis. */
  value: number;
  /** Source rect's span on the perpendicular axis (for guide segments). */
  from: number;
  to: number;
}

interface AxisSnap {
  delta: number;
  matches: AxisCandidate[];
}

function bestAxisSnap(
  candidates: readonly AxisCandidate[],
  movingValues: readonly number[],
  threshold: number,
): AxisSnap | null {
  let best: AxisSnap | null = null;
  for (const candidate of candidates) {
    for (const value of movingValues) {
      const delta = candidate.value - value;
      if (Math.abs(delta) > threshold) continue;
      if (best === null || Math.abs(delta) < Math.abs(best.delta) - EPSILON) {
        best = { delta, matches: [candidate] };
      } else if (Math.abs(delta - best.delta) <= EPSILON) {
        best.matches.push(candidate);
      }
    }
  }
  return best;
}

/** Merge matched candidates into guides, one per distinct line position. */
function guidesFor(
  axis: 'x' | 'y',
  snap: AxisSnap,
  movingFrom: number,
  movingTo: number,
): SnapGuide[] {
  const byPosition = new Map<number, SnapGuide>();
  for (const match of snap.matches) {
    const existing = byPosition.get(match.value);
    if (existing) {
      existing.from = Math.min(existing.from, match.from);
      existing.to = Math.max(existing.to, match.to);
    } else {
      byPosition.set(match.value, {
        axis,
        position: match.value,
        from: Math.min(match.from, movingFrom),
        to: Math.max(match.to, movingTo),
      });
    }
  }
  return [...byPosition.values()];
}

export interface SnapPointResult {
  point: WorldPoint;
  guides: SnapGuide[];
}

export interface SnapRectResult {
  rect: WorldRect;
  /** Correction applied on each axis (0 when no snap). */
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

export class SnapEngine {
  private readonly xs: AxisCandidate[] = [];
  private readonly ys: AxisCandidate[] = [];

  /**
   * @param artboard  world rect of the artboard (edges + centers snap).
   * @param siblingBboxes  visible element bboxes supplied by the caller;
   *   entries beyond MAX_SNAP_CANDIDATES are dropped.
   */
  constructor(artboard: WorldRect, siblingBboxes: readonly WorldRect[] = []) {
    for (const r of [artboard, ...siblingBboxes.slice(0, MAX_SNAP_CANDIDATES)]) {
      const ySpan = { from: r.y, to: r.y + r.height };
      const xSpan = { from: r.x, to: r.x + r.width };
      for (const v of [r.x, r.x + r.width / 2, r.x + r.width]) {
        this.xs.push({ value: v, ...ySpan });
      }
      for (const v of [r.y, r.y + r.height / 2, r.y + r.height]) {
        this.ys.push({ value: v, ...xSpan });
      }
    }
  }

  /** World-space snap threshold at a zoom level. */
  static threshold(zoom: number): number {
    return SNAP_THRESHOLD / Math.max(zoom, 1e-6);
  }

  /** Snap a bare point (creation drags, resize handle positions). */
  snapPoint(point: WorldPoint, zoom: number): SnapPointResult {
    const threshold = SnapEngine.threshold(zoom);
    const sx = bestAxisSnap(this.xs, [point.x], threshold);
    const sy = bestAxisSnap(this.ys, [point.y], threshold);
    const snapped: WorldPoint = {
      x: point.x + (sx?.delta ?? 0),
      y: point.y + (sy?.delta ?? 0),
    };
    const guides: SnapGuide[] = [];
    if (sx) guides.push(...guidesFor('x', sx, snapped.y, snapped.y));
    if (sy) guides.push(...guidesFor('y', sy, snapped.x, snapped.x));
    return { point: snapped, guides };
  }

  /** Snap a rect by its edges + centers (move drags use the union bbox). */
  snapRect(rect: WorldRect, zoom: number): SnapRectResult {
    const threshold = SnapEngine.threshold(zoom);
    const sx = bestAxisSnap(
      this.xs,
      [rect.x, rect.x + rect.width / 2, rect.x + rect.width],
      threshold,
    );
    const sy = bestAxisSnap(
      this.ys,
      [rect.y, rect.y + rect.height / 2, rect.y + rect.height],
      threshold,
    );
    const dx = sx?.delta ?? 0;
    const dy = sy?.delta ?? 0;
    const snapped: WorldRect = { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height };
    const guides: SnapGuide[] = [];
    if (sx) guides.push(...guidesFor('x', sx, snapped.y, snapped.y + snapped.height));
    if (sy) guides.push(...guidesFor('y', sy, snapped.x, snapped.x + snapped.width));
    return { rect: snapped, dx, dy, guides };
  }
}
