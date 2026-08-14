import type {
  BatchCommand,
  CanvasCommand,
  ReorderCommand,
  TranslateCommand,
} from '@suna/core';

/**
 * Pure keyboard-editing helpers: nudge, duplicate offset, and z-order key
 * mapping (canvas-editing-suite.md §1). Each returns engine commands for a
 * selection, or null when the selection is empty / the key is not handled.
 */

/** Arrow-key nudge distance in world units. */
export const NUDGE_STEP = 1;
/** Shift+arrow nudge distance in world units. */
export const NUDGE_STEP_LARGE = 10;
/** ⌘D duplicate offset in world units (spec: +8,+8). */
export const DUPLICATE_OFFSET = 8;

export type NudgeDirection = 'left' | 'right' | 'up' | 'down';

const NUDGE_KEYS: Record<string, NudgeDirection> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

export function nudgeDirectionForKey(key: string): NudgeDirection | null {
  return NUDGE_KEYS[key] ?? null;
}

/** Translate command for an arrow-key nudge; null for empty selections. */
export function nudgeCommand(
  selection: readonly string[],
  direction: NudgeDirection,
  large = false,
): TranslateCommand | null {
  if (selection.length === 0) return null;
  const step = large ? NUDGE_STEP_LARGE : NUDGE_STEP;
  const dx = direction === 'left' ? -step : direction === 'right' ? step : 0;
  const dy = direction === 'up' ? -step : direction === 'down' ? step : 0;
  return { kind: 'translate', targets: [...selection], dx, dy };
}

export type ZOrderMode = ReorderCommand['mode'];

/**
 * Keyboard map (spec §1): ⌘] forward · ⌘[ backward · ⌥⌘] front · ⌥⌘[ back.
 * Returns null when the key/modifiers are not a z-order chord.
 */
export function zOrderModeForKey(
  key: string,
  modifiers: { metaKey: boolean; ctrlKey?: boolean; altKey: boolean },
): ZOrderMode | null {
  if (!modifiers.metaKey && !(modifiers.ctrlKey ?? false)) return null;
  if (key === ']') return modifiers.altKey ? 'front' : 'forward';
  if (key === '[') return modifiers.altKey ? 'back' : 'backward';
  return null;
}

/**
 * Reorder command(s) for a selection; multi-selections batch one reorder per
 * id (document order of the ids as given). Null for empty selections.
 */
export function zOrderCommand(
  selection: readonly string[],
  mode: ZOrderMode,
): CanvasCommand | null {
  const first = selection[0];
  if (first === undefined) return null;
  if (selection.length === 1) return { kind: 'reorder', target: first, mode };
  return {
    kind: 'batch',
    commands: selection.map((target): ReorderCommand => ({ kind: 'reorder', target, mode })),
    label: 'Reorder',
  };
}

export interface DuplicateSource {
  /** Pre-allocated id for the copy (CanvasDocument.allocateId). */
  id: string;
  /** Serialized subtree of the element being duplicated (id stripped/replaced by `insert`). */
  svg: string;
  /** Parent target for the copy; defaults to the artboard root. */
  parent?: string;
  index?: number;
}

/**
 * ⌘D duplicate: insert serialized copies, then offset them by (+8, +8) —
 * one undo step. The caller serializes the selection and allocates ids
 * (the pure core never touches the document).
 */
export function duplicateCommand(
  copies: readonly DuplicateSource[],
  dx = DUPLICATE_OFFSET,
  dy = DUPLICATE_OFFSET,
): BatchCommand | null {
  if (copies.length === 0) return null;
  const commands: CanvasCommand[] = copies.map((copy) => ({
    kind: 'insert',
    svg: copy.svg,
    id: copy.id,
    ...(copy.parent !== undefined ? { parent: copy.parent } : {}),
    ...(copy.index !== undefined ? { index: copy.index } : {}),
  }));
  commands.push({ kind: 'translate', targets: copies.map((c) => c.id), dx, dy });
  return { kind: 'batch', commands, label: 'Duplicate' };
}
