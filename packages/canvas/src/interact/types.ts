import type { CanvasCommand, MatrixTuple } from '@suna/core';
import type { ShapeDefaults } from './factories';
import type { SnapEngine } from './snap';

/**
 * Framework-free interaction core types (canvas-editing-suite.md §1–§4).
 *
 * Everything speaks world coordinates (root viewBox user units); the caller
 * converts pointer events from screen space before they arrive here, and the
 * controller emits either ephemeral state (previews, guides) or engine
 * commands — never DOM mutations.
 */

export type ToolId = 'select' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text';

/** Tools that create elements via a drag (or click, for text). */
export type CreationToolId = Exclude<ToolId, 'select'>;

export interface WorldPoint {
  x: number;
  y: number;
}

export interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pointer event already converted to world coordinates. */
export interface PointerInput extends WorldPoint {
  shiftKey: boolean;
  altKey: boolean;
}

/** Keyboard event subset the controller consumes (KeyboardEvent.key names). */
export interface KeyInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Resize handle ids, clockwise from top-left. */
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export type GestureState =
  | { kind: 'idle' }
  | { kind: 'marquee'; start: WorldPoint; current: WorldPoint }
  | { kind: 'move'; ids: string[]; dx: number; dy: number }
  | { kind: 'resize'; ids: string[]; handle: HandleId; matrix: MatrixTuple }
  | { kind: 'rotate'; ids: string[]; angle: number }
  | { kind: 'create'; tool: CreationToolId; start: WorldPoint; current: WorldPoint };

/**
 * A smart-guide segment. `position` is the world coordinate on `axis`
 * (axis 'x' = a vertical line at x=position); `from`/`to` span the
 * perpendicular axis so the overlay can draw a finite segment.
 */
export interface SnapGuide {
  axis: 'x' | 'y';
  position: number;
  from: number;
  to: number;
}

/**
 * Controller output. Previews describe ephemeral state the UI applies to the
 * mirror clone only (canvas-editing-suite.md §8); commits are engine commands
 * dispatched against the pristine document.
 */
export type EditorEvent =
  | { kind: 'preview'; gesture: GestureState }
  | { kind: 'guides'; guides: SnapGuide[] }
  | { kind: 'commit'; command: CanvasCommand; label: string }
  | { kind: 'selection'; ids: string[] }
  | { kind: 'enter-text-edit'; id: string };

/**
 * Everything the controller needs from the host per event. The host owns
 * selection state and the document; the controller only reads through this
 * interface, which keeps it pure and unit-testable.
 */
export interface ToolContext {
  /** Current selection (ids); the host updates it on 'selection' events. */
  selection: string[];
  /** World-space bbox of an element, or null when unknown/invisible. */
  bboxOf(id: string): WorldRect | null;
  /** Topmost selectable element at a world point (semantic-unit resolved). */
  hitTest(point: WorldPoint): string | null;
  /** World-space rect of the artboard (the root viewBox). */
  artboard: WorldRect;
  /** Current zoom (screen px per world unit); scales hit radii/thresholds. */
  zoom: number;
  /** Snap engine built by the host from artboard + visible sibling bboxes. */
  snap: SnapEngine;
  /** Visible selectable elements — marquee candidates (id + world bbox). */
  elements: ReadonlyArray<{ id: string; bbox: WorldRect }>;
  /** Allocate a document-unique id for inserts (CanvasDocument.allocateId). */
  allocateId(): string;
  /** True when an element with this id exists (arrow marker def de-dup). */
  hasId(id: string): boolean;
  /** Style defaults from the active publisher profile; core defaults if absent. */
  defaults?: ShapeDefaults;
}
