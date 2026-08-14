import type { CanvasCommand, MatrixTuple, TransformCommand } from '@suna/core';
import {
  ARROW_MARKER_ID,
  arrowMarkerDefSnippet,
  arrowSnippet,
  DEFAULT_SHAPE_DEFAULTS,
  ellipseSnippet,
  lineSnippet,
  rectSnippet,
  textSnippet,
} from './factories';
import {
  constrainSquare,
  DRAG_THRESHOLD,
  distance,
  handlePoint,
  hitHandle,
  IDENTITY_MATRIX,
  isIdentityMatrix,
  marqueeHits,
  rectCenter,
  rectFromPoints,
  resizeMatrix,
  rotationDelta,
  rotationMatrix,
  snapRotation,
  snapTo45,
  translateRect,
  unionRects,
} from './geometry';
import type {
  CreationToolId,
  EditorEvent,
  GestureState,
  HandleId,
  KeyInput,
  PointerInput,
  SnapGuide,
  ToolContext,
  ToolId,
  WorldPoint,
  WorldRect,
} from './types';
import { nudgeCommand, nudgeDirectionForKey, zOrderCommand, zOrderModeForKey } from './nudge';

/**
 * ToolController — the interaction FSM (canvas-editing-suite.md §1).
 *
 * idle → armed(tool) → gesture(tool, data) → idle. Pointer events arrive in
 * world coordinates; the controller emits EditorEvents: ephemeral previews
 * and guides (applied to the mirror only) or commit commands (dispatched to
 * the engine). It owns no document state — everything it reads comes through
 * the per-call ToolContext.
 *
 * Not handled here (host responsibilities): undo/redo keys (CommandHistory),
 * ⌘D duplicate (needs serialization — use `duplicateCommand`), and the
 * text-resize-as-font-size refinement (spec §2, needs tag knowledge).
 */

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  a: 'arrow',
  t: 'text',
};

const CREATE_LABELS: Record<CreationToolId, string> = {
  rect: 'Create rectangle',
  ellipse: 'Create ellipse',
  line: 'Create line',
  arrow: 'Create arrow',
  text: 'Create text',
};

/** Internal drag bookkeeping (richer than the public GestureState). */
type DragState =
  | { kind: 'none' }
  | {
      kind: 'press-move';
      ids: string[];
      start: WorldPoint;
      hitId: string;
      /** Down landed on an already-selected member without shift → click narrows. */
      narrowOnClick: boolean;
    }
  | { kind: 'move'; ids: string[]; start: WorldPoint; bbox: WorldRect }
  | { kind: 'resize'; ids: string[]; handle: HandleId; start: WorldPoint; bbox: WorldRect }
  | { kind: 'rotate'; ids: string[]; center: WorldPoint; start: WorldPoint }
  | { kind: 'marquee'; start: WorldPoint }
  | { kind: 'create'; tool: Exclude<CreationToolId, 'text'>; start: WorldPoint }
  | { kind: 'press-text'; start: WorldPoint };

function preview(gesture: GestureState): EditorEvent {
  return { kind: 'preview', gesture };
}

function guides(g: SnapGuide[]): EditorEvent {
  return { kind: 'guides', guides: g };
}

function commit(command: CanvasCommand, label: string): EditorEvent {
  return { kind: 'commit', command, label };
}

function selectionEvent(ids: string[]): EditorEvent {
  return { kind: 'selection', ids };
}

/** Union bbox of the selection's element bboxes (null when unknown). */
function selectionBbox(ids: readonly string[], ctx: ToolContext): WorldRect | null {
  const rects: WorldRect[] = [];
  for (const id of ids) {
    const bbox = ctx.bboxOf(id);
    if (bbox !== null) rects.push(bbox);
  }
  return unionRects(rects);
}

/** One `transform compose` per member — one batch for multi-selections. */
function transformCommand(ids: readonly string[], matrix: MatrixTuple): CanvasCommand | null {
  const first = ids[0];
  if (first === undefined) return null;
  if (ids.length === 1) {
    return { kind: 'transform', target: first, matrix, mode: 'compose' };
  }
  return {
    kind: 'batch',
    commands: ids.map(
      (target): TransformCommand => ({ kind: 'transform', target, matrix, mode: 'compose' }),
    ),
  };
}

export class ToolController {
  tool: ToolId = 'select';
  gesture: GestureState = { kind: 'idle' };
  private drag: DragState = { kind: 'none' };

  /** Switch tools, cancelling any in-flight gesture. */
  setTool(tool: ToolId): EditorEvent[] {
    const events = this.cancelGesture();
    this.tool = tool;
    return events;
  }

  /** Abort the current gesture without committing; clears previews/guides. */
  cancelGesture(): EditorEvent[] {
    const wasActive = this.drag.kind !== 'none' || this.gesture.kind !== 'idle';
    this.drag = { kind: 'none' };
    this.gesture = { kind: 'idle' };
    return wasActive ? [preview(this.gesture), guides([])] : [];
  }

  pointerDown(e: PointerInput, ctx: ToolContext): EditorEvent[] {
    const point: WorldPoint = { x: e.x, y: e.y };
    switch (this.tool) {
      case 'select':
        return this.selectDown(e, point, ctx);
      case 'text':
        this.drag = { kind: 'press-text', start: point };
        return [];
      default: {
        this.drag = { kind: 'create', tool: this.tool, start: point };
        this.gesture = { kind: 'create', tool: this.tool, start: point, current: point };
        return [preview(this.gesture)];
      }
    }
  }

  pointerMove(e: PointerInput, ctx: ToolContext): EditorEvent[] {
    const point: WorldPoint = { x: e.x, y: e.y };
    const drag = this.drag;
    switch (drag.kind) {
      case 'none':
      case 'press-text':
        return [];
      case 'press-move': {
        if (distance(point, drag.start) < DRAG_THRESHOLD / Math.max(ctx.zoom, 1e-6)) return [];
        const bbox = selectionBbox(drag.ids, ctx);
        if (bbox === null) return [];
        this.drag = { kind: 'move', ids: drag.ids, start: drag.start, bbox };
        return this.moveUpdate(point, ctx);
      }
      case 'move':
        return this.moveUpdate(point, ctx);
      case 'resize': {
        const hp = handlePoint(drag.bbox, drag.handle);
        const raw: WorldPoint = {
          x: hp.x + (point.x - drag.start.x),
          y: hp.y + (point.y - drag.start.y),
        };
        const snapped = ctx.snap.snapPoint(raw, ctx.zoom);
        const affectsX = drag.handle.includes('e') || drag.handle.includes('w');
        const affectsY = drag.handle.includes('n') || drag.handle.includes('s');
        // Only snap (and show guides for) axes this handle actually drives.
        const target: WorldPoint = {
          x: affectsX ? snapped.point.x : raw.x,
          y: affectsY ? snapped.point.y : raw.y,
        };
        const matrix = resizeMatrix(drag.bbox, drag.handle, target.x - hp.x, target.y - hp.y, {
          uniform: e.shiftKey,
          centered: e.altKey,
        });
        this.gesture = { kind: 'resize', ids: drag.ids, handle: drag.handle, matrix };
        const kept = snapped.guides.filter(
          (g) => (g.axis === 'x' && affectsX) || (g.axis === 'y' && affectsY),
        );
        return [preview(this.gesture), guides(kept)];
      }
      case 'rotate': {
        let angle = rotationDelta(drag.center, drag.start, point);
        angle = snapRotation(angle, e.shiftKey);
        this.gesture = { kind: 'rotate', ids: drag.ids, angle };
        return [preview(this.gesture)];
      }
      case 'marquee': {
        this.gesture = { kind: 'marquee', start: drag.start, current: point };
        const hits = marqueeHits(rectFromPoints(drag.start, point), ctx.elements);
        return [selectionEvent(hits), preview(this.gesture)];
      }
      case 'create': {
        const constrained = e.shiftKey
          ? drag.tool === 'line' || drag.tool === 'arrow'
            ? snapTo45(drag.start, point)
            : constrainSquare(drag.start, point)
          : point;
        const snapped = ctx.snap.snapPoint(constrained, ctx.zoom);
        // Shift constraints win over snapping (a snapped square is no square).
        const current = e.shiftKey ? constrained : snapped.point;
        this.gesture = { kind: 'create', tool: drag.tool, start: drag.start, current };
        return [preview(this.gesture), guides(e.shiftKey ? [] : snapped.guides)];
      }
    }
  }

  pointerUp(e: PointerInput, ctx: ToolContext): EditorEvent[] {
    const drag = this.drag;
    this.drag = { kind: 'none' };
    switch (drag.kind) {
      case 'none':
        return [];
      case 'press-move': {
        // Click without drag: narrow a multi-selection to the clicked element.
        if (drag.narrowOnClick && ctx.selection.length > 1) {
          return [selectionEvent([drag.hitId])];
        }
        return [];
      }
      case 'move': {
        const g = this.gesture;
        this.gesture = { kind: 'idle' };
        const events: EditorEvent[] = [];
        if (g.kind === 'move' && (g.dx !== 0 || g.dy !== 0)) {
          events.push(
            commit({ kind: 'translate', targets: g.ids, dx: g.dx, dy: g.dy }, 'Move'),
          );
        }
        events.push(guides([]), preview(this.gesture));
        return events;
      }
      case 'resize': {
        const g = this.gesture;
        this.gesture = { kind: 'idle' };
        const events: EditorEvent[] = [];
        if (g.kind === 'resize' && !isIdentityMatrix(g.matrix)) {
          const command = transformCommand(g.ids, g.matrix);
          if (command !== null) events.push(commit(command, 'Resize'));
        }
        events.push(guides([]), preview(this.gesture));
        return events;
      }
      case 'rotate': {
        const g = this.gesture;
        this.gesture = { kind: 'idle' };
        const events: EditorEvent[] = [];
        if (g.kind === 'rotate' && g.angle !== 0) {
          const command = transformCommand(g.ids, rotationMatrix(drag.center, g.angle));
          if (command !== null) events.push(commit(command, 'Rotate'));
        }
        events.push(guides([]), preview(this.gesture));
        return events;
      }
      case 'marquee': {
        this.gesture = { kind: 'idle' };
        return [preview(this.gesture)];
      }
      case 'create':
        return this.commitCreate(drag, ctx);
      case 'press-text':
        return this.commitText(drag.start, ctx);
    }
  }

  keyDown(e: KeyInput, ctx: ToolContext): EditorEvent[] {
    const mod = e.metaKey || e.ctrlKey;

    if (e.key === 'Escape') {
      const cancelled = this.cancelGesture();
      if (cancelled.length > 0) return cancelled;
      if (this.tool !== 'select') {
        this.tool = 'select';
        return [];
      }
      return ctx.selection.length > 0 ? [selectionEvent([])] : [];
    }

    // Tool keys (bare letters only).
    if (!mod && !e.altKey) {
      const tool = TOOL_KEYS[e.key.toLowerCase()];
      if (tool !== undefined && e.key.length === 1) {
        return this.setTool(tool);
      }
    }

    // Nudge (arrows; shift = 10 units).
    const direction = nudgeDirectionForKey(e.key);
    if (direction !== null && !mod && !e.altKey) {
      const command = nudgeCommand(ctx.selection, direction, e.shiftKey);
      return command === null ? [] : [commit(command, 'Nudge')];
    }

    // Delete selection.
    if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) {
      if (ctx.selection.length === 0) return [];
      return [
        commit({ kind: 'remove', targets: [...ctx.selection] }, 'Delete'),
        selectionEvent([]),
      ];
    }

    // Z-order: ⌘] ⌘[ ⌥⌘] ⌥⌘[.
    const zMode = zOrderModeForKey(e.key, e);
    if (zMode !== null) {
      const command = zOrderCommand(ctx.selection, zMode);
      return command === null ? [] : [commit(command, 'Reorder')];
    }

    // Group / ungroup.
    if (mod && e.key.toLowerCase() === 'g') {
      const targets = [...ctx.selection];
      const first = targets[0];
      if (first === undefined) return [];
      if (e.shiftKey) {
        const command: CanvasCommand =
          targets.length === 1
            ? { kind: 'ungroup', target: first }
            : {
                kind: 'batch',
                commands: targets.map((target) => ({ kind: 'ungroup' as const, target })),
                label: 'Ungroup',
              };
        return [commit(command, 'Ungroup')];
      }
      return [commit({ kind: 'group', targets }, 'Group')];
    }

    return [];
  }

  // -------------------------------------------------------------------------
  // Select-tool pointer down

  private selectDown(e: PointerInput, point: WorldPoint, ctx: ToolContext): EditorEvent[] {
    // 1. Transform handles of the current selection win over body hits.
    if (ctx.selection.length > 0) {
      const bbox = selectionBbox(ctx.selection, ctx);
      if (bbox !== null) {
        const handle = hitHandle(bbox, point, ctx.zoom);
        if (handle === 'rotate') {
          this.drag = { kind: 'rotate', ids: [...ctx.selection], center: rectCenter(bbox), start: point };
          this.gesture = { kind: 'rotate', ids: [...ctx.selection], angle: 0 };
          return [preview(this.gesture)];
        }
        if (handle !== null) {
          this.drag = { kind: 'resize', ids: [...ctx.selection], handle, start: point, bbox };
          this.gesture = {
            kind: 'resize',
            ids: [...ctx.selection],
            handle,
            matrix: [...IDENTITY_MATRIX] as MatrixTuple,
          };
          return [preview(this.gesture)];
        }
      }
    }

    // 2. Body hit-test.
    const hit = ctx.hitTest(point);
    if (hit !== null) {
      const events: EditorEvent[] = [];
      let ids: string[];
      let narrowOnClick = false;
      if (e.shiftKey) {
        ids = ctx.selection.includes(hit)
          ? ctx.selection.filter((id) => id !== hit)
          : [...ctx.selection, hit];
        events.push(selectionEvent(ids));
      } else if (ctx.selection.includes(hit)) {
        ids = [...ctx.selection]; // keep multi-selection for the drag…
        narrowOnClick = true; // …but a plain click narrows to the hit
      } else {
        ids = [hit];
        events.push(selectionEvent(ids));
      }
      if (ids.length > 0) {
        this.drag = { kind: 'press-move', ids, start: point, hitId: hit, narrowOnClick };
      }
      return events;
    }

    // 3. Empty canvas: clear selection, start marquee.
    const events: EditorEvent[] = [];
    if (ctx.selection.length > 0) events.push(selectionEvent([]));
    this.drag = { kind: 'marquee', start: point };
    this.gesture = { kind: 'marquee', start: point, current: point };
    events.push(preview(this.gesture));
    return events;
  }

  // -------------------------------------------------------------------------
  // Gesture updates & commits

  private moveUpdate(point: WorldPoint, ctx: ToolContext): EditorEvent[] {
    const drag = this.drag;
    if (drag.kind !== 'move') return [];
    const rawDx = point.x - drag.start.x;
    const rawDy = point.y - drag.start.y;
    const snapped = ctx.snap.snapRect(translateRect(drag.bbox, rawDx, rawDy), ctx.zoom);
    this.gesture = {
      kind: 'move',
      ids: drag.ids,
      dx: rawDx + snapped.dx,
      dy: rawDy + snapped.dy,
    };
    return [preview(this.gesture), guides(snapped.guides)];
  }

  private commitCreate(
    drag: Extract<DragState, { kind: 'create' }>,
    ctx: ToolContext,
  ): EditorEvent[] {
    const g = this.gesture;
    this.gesture = { kind: 'idle' };
    if (g.kind !== 'create') return [preview(this.gesture)];

    // A click (or sub-threshold drag) creates nothing; the tool stays armed.
    if (distance(g.start, g.current) < DRAG_THRESHOLD / Math.max(ctx.zoom, 1e-6)) {
      return [preview(this.gesture), guides([])];
    }

    const defaults = ctx.defaults ?? DEFAULT_SHAPE_DEFAULTS;
    const id = ctx.allocateId();
    const rect = rectFromPoints(g.start, g.current);
    let command: CanvasCommand;
    switch (drag.tool) {
      case 'rect':
        command = { kind: 'insert', svg: rectSnippet(rect, defaults), id };
        break;
      case 'ellipse':
        command = { kind: 'insert', svg: ellipseSnippet(rect, defaults), id };
        break;
      case 'line':
        command = { kind: 'insert', svg: lineSnippet(g.start, g.current, defaults), id };
        break;
      case 'arrow': {
        const insert: CanvasCommand = {
          kind: 'insert',
          svg: arrowSnippet(g.start, g.current, defaults),
          id,
        };
        command = ctx.hasId(ARROW_MARKER_ID)
          ? insert
          : {
              kind: 'batch',
              commands: [{ kind: 'insert', svg: arrowMarkerDefSnippet() }, insert],
              label: CREATE_LABELS.arrow,
            };
        break;
      }
    }
    this.tool = 'select'; // new elements land selected in Select (spec §4)
    return [
      commit(command, CREATE_LABELS[drag.tool]),
      selectionEvent([id]),
      guides([]),
      preview(this.gesture),
    ];
  }

  private commitText(at: WorldPoint, ctx: ToolContext): EditorEvent[] {
    const defaults = ctx.defaults ?? DEFAULT_SHAPE_DEFAULTS;
    const id = ctx.allocateId();
    this.gesture = { kind: 'idle' };
    this.tool = 'select';
    return [
      commit({ kind: 'insert', svg: textSnippet(at, 'Text', defaults), id }, CREATE_LABELS.text),
      selectionEvent([id]),
      { kind: 'enter-text-edit', id },
      preview(this.gesture),
    ];
  }
}
