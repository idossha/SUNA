import type { MatrixTuple } from '@suna/core';
import type { HandleId, WorldPoint, WorldRect } from './types';

/**
 * Pure geometry for the interaction layer: rect algebra, transform-handle
 * layout and hit-testing, anchor-relative resize matrices, and rotation.
 *
 * Handle-anchor math follows the OpenPencil model (opposite-edge anchor,
 * dominant-axis uniform constraint) reimplemented against our world-space
 * matrix pipeline — see canvas-editing-suite.md §9.
 */

/** Handle hit radius in screen px; divide by zoom for world units. */
export const HANDLE_HIT_RADIUS = 6;
/** Rotate handle sits this many screen px above the bbox top-center. */
export const ROTATE_HANDLE_OFFSET = 24;
/** Shift snaps rotation to multiples of this many degrees. */
export const ROTATION_SNAP_DEGREES = 15;
/** Screen px of travel before a press becomes a drag (below = click). */
export const DRAG_THRESHOLD = 3;

export const IDENTITY_MATRIX: MatrixTuple = [1, 0, 0, 1, 0, 0];

// ---------------------------------------------------------------------------
// Rect algebra

/** Normalized rect (non-negative size) spanning two corner points. */
export function rectFromPoints(a: WorldPoint, b: WorldPoint): WorldRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** Fold negative width/height across the origin corner. */
export function normalizeRect(r: WorldRect): WorldRect {
  return {
    x: r.width < 0 ? r.x + r.width : r.x,
    y: r.height < 0 ? r.y + r.height : r.y,
    width: Math.abs(r.width),
    height: Math.abs(r.height),
  };
}

export function rectCenter(r: WorldRect): WorldPoint {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function translateRect(r: WorldRect, dx: number, dy: number): WorldRect {
  return { x: r.x + dx, y: r.y + dy, width: r.width, height: r.height };
}

export function unionRects(rects: readonly WorldRect[]): WorldRect | null {
  const first = rects[0];
  if (first === undefined) return null;
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x + first.width;
  let maxY = first.y + first.height;
  for (const r of rects.slice(1)) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Open-interval AABB overlap (OpenPencil marquee rule): rects that only
 * touch along an edge do NOT intersect.
 */
export function rectsIntersect(a: WorldRect, b: WorldRect): boolean {
  return (
    a.x + a.width > b.x && a.x < b.x + b.width && a.y + a.height > b.y && a.y < b.y + b.height
  );
}

/** Ids of elements whose bbox intersects the marquee rect. */
export function marqueeHits(
  marquee: WorldRect,
  elements: ReadonlyArray<{ id: string; bbox: WorldRect }>,
): string[] {
  return elements.filter((e) => rectsIntersect(marquee, e.bbox)).map((e) => e.id);
}

export function distance(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---------------------------------------------------------------------------
// Creation constraints (shift modifier)

/** Constrain a drag's end point so the spanned rect is a square (shift). */
export function constrainSquare(start: WorldPoint, current: WorldPoint): WorldPoint {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: start.x + side * Math.sign(dx || 1),
    y: start.y + side * Math.sign(dy || 1),
  };
}

/** Snap a line's end point to the nearest 45° direction, preserving length. */
export function snapTo45(start: WorldPoint, current: WorldPoint): WorldPoint {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { ...current };
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: start.x + len * Math.cos(angle), y: start.y + len * Math.sin(angle) };
}

// ---------------------------------------------------------------------------
// Handle layout & hit-testing

export const HANDLE_IDS: readonly HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const OPPOSITE_HANDLE: Record<HandleId, HandleId> = {
  nw: 'se',
  n: 's',
  ne: 'sw',
  e: 'w',
  se: 'nw',
  s: 'n',
  sw: 'ne',
  w: 'e',
};

export function oppositeHandle(handle: HandleId): HandleId {
  return OPPOSITE_HANDLE[handle];
}

/** World position of a handle on a bbox (corners + edge midpoints). */
export function handlePoint(bbox: WorldRect, handle: HandleId): WorldPoint {
  const x = handle.includes('w')
    ? bbox.x
    : handle.includes('e')
      ? bbox.x + bbox.width
      : bbox.x + bbox.width / 2;
  const y = handle.includes('n')
    ? bbox.y
    : handle.includes('s')
      ? bbox.y + bbox.height
      : bbox.y + bbox.height / 2;
  return { x, y };
}

export interface HandleLayout {
  handles: Array<{ id: HandleId; point: WorldPoint }>;
  /** Rotate handle position: above top-center by ROTATE_HANDLE_OFFSET/zoom. */
  rotate: WorldPoint;
  /** Hit radius in world units (constant on screen). */
  hitRadius: number;
}

/** 8 resize handle positions + rotate handle for a selection bbox. */
export function handleLayout(bbox: WorldRect, zoom: number): HandleLayout {
  const z = Math.max(zoom, 1e-6);
  return {
    handles: HANDLE_IDS.map((id) => ({ id, point: handlePoint(bbox, id) })),
    rotate: { x: bbox.x + bbox.width / 2, y: bbox.y - ROTATE_HANDLE_OFFSET / z },
    hitRadius: HANDLE_HIT_RADIUS / z,
  };
}

/**
 * Which handle (if any) a world point hits. Rotate wins over resize handles
 * so the rotate affordance stays reachable on small selections.
 */
export function hitHandle(
  bbox: WorldRect,
  point: WorldPoint,
  zoom: number,
): HandleId | 'rotate' | null {
  const layout = handleLayout(bbox, zoom);
  if (distance(point, layout.rotate) <= layout.hitRadius) return 'rotate';
  for (const h of layout.handles) {
    if (distance(point, h.point) <= layout.hitRadius) return h.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resize matrix (anchor-relative)

export interface ResizeOptions {
  /** Shift: uniform scale — dominant axis drives, per-axis flip preserved. */
  uniform?: boolean;
  /** Alt: scale about the bbox center instead of the opposite anchor. */
  centered?: boolean;
}

/**
 * Affine matrix for dragging `handle` by (dx, dy) world units. Scales about
 * the opposite corner/edge-midpoint (or the center with `centered`), so the
 * anchor stays fixed. Dragging across the anchor yields a negative scale
 * (mirror) — no gimbal, matching the crossing-flip resize model.
 */
export function resizeMatrix(
  bbox: WorldRect,
  handle: HandleId,
  dx: number,
  dy: number,
  opts: ResizeOptions = {},
): MatrixTuple {
  const hp = handlePoint(bbox, handle);
  const anchor = opts.centered ? rectCenter(bbox) : handlePoint(bbox, oppositeHandle(handle));
  const affectsX = handle.includes('e') || handle.includes('w');
  const affectsY = handle.includes('n') || handle.includes('s');

  let sx = 1;
  let sy = 1;
  if (affectsX && hp.x !== anchor.x) sx = (hp.x + dx - anchor.x) / (hp.x - anchor.x);
  if (affectsY && hp.y !== anchor.y) sy = (hp.y + dy - anchor.y) / (hp.y - anchor.y);

  if (opts.uniform) {
    if (affectsX && affectsY) {
      // Corner: dominant pointer axis sets the magnitude; each axis keeps
      // its own sign so a crossing flip stays a flip.
      const mag = Math.abs(dx) >= Math.abs(dy) ? Math.abs(sx) : Math.abs(sy);
      sx = mag * (sx < 0 ? -1 : 1);
      sy = mag * (sy < 0 ? -1 : 1);
    } else if (affectsX) {
      sy = Math.abs(sx);
    } else if (affectsY) {
      sx = Math.abs(sy);
    }
  }

  return [sx, 0, 0, sy, anchor.x * (1 - sx), anchor.y * (1 - sy)];
}

/** Axis-aligned bbox of a rect mapped through an affine matrix. */
export function applyMatrixToRect(m: MatrixTuple, r: WorldRect): WorldRect {
  const [a, b, c, d, e, f] = m;
  const corners: WorldPoint[] = [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x, y: r.y + r.height },
    { x: r.x + r.width, y: r.y + r.height },
  ].map((p) => ({ x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f }));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

export function isIdentityMatrix(m: MatrixTuple, epsilon = 1e-9): boolean {
  return IDENTITY_MATRIX.every((v, i) => Math.abs((m[i] as number) - v) <= epsilon);
}

// ---------------------------------------------------------------------------
// Rotation

/**
 * Signed rotation (degrees, normalized to (-180, 180]) swept by the pointer
 * from `start` to `current` around `center`. Screen convention: y grows
 * downward, so positive angles are clockwise.
 */
export function rotationDelta(
  center: WorldPoint,
  start: WorldPoint,
  current: WorldPoint,
): number {
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  const a1 = Math.atan2(current.y - center.y, current.x - center.x);
  let deg = ((a1 - a0) * 180) / Math.PI;
  deg = ((((deg + 180) % 360) + 360) % 360) - 180;
  return deg === -180 ? 180 : deg;
}

/** Snap an angle to 15° steps when `snap` (shift held). */
export function snapRotation(angleDeg: number, snap: boolean): number {
  return snap ? Math.round(angleDeg / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES : angleDeg;
}

/** Rotation matrix (degrees) about a world point: T(c)·R(θ)·T(−c). */
export function rotationMatrix(center: WorldPoint, angleDeg: number): MatrixTuple {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    cos,
    sin,
    -sin,
    cos,
    center.x - cos * center.x + sin * center.y,
    center.y - sin * center.x - cos * center.y,
  ];
}

// ---------------------------------------------------------------------------
// Cursors

/** Outward direction of each handle in screen degrees (y-down, 0 = east). */
const HANDLE_BASE_ANGLE: Record<HandleId, number> = {
  e: 0,
  se: 45,
  s: 90,
  sw: 135,
  w: 180,
  nw: 225,
  n: 270,
  ne: 315,
};

const CURSOR_BY_BUCKET = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'] as const;

/**
 * CSS cursor name for a resize handle on a selection rotated by
 * `rotationDeg`, quantized to the four resize cursors.
 */
export function cursorForHandle(handle: HandleId, rotationDeg = 0): string {
  const angle = (((HANDLE_BASE_ANGLE[handle] + rotationDeg) % 180) + 180) % 180;
  const bucket = Math.round(angle / 45) % 4;
  return CURSOR_BY_BUCKET[bucket] as string;
}
