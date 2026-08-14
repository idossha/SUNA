import { describe, expect, it } from 'vitest';
import { CanvasCommandSchema } from '@suna/core';
import {
  DUPLICATE_OFFSET,
  duplicateCommand,
  nudgeCommand,
  nudgeDirectionForKey,
  zOrderCommand,
  zOrderModeForKey,
} from './nudge';

describe('nudge', () => {
  it('maps arrow keys to directions', () => {
    expect(nudgeDirectionForKey('ArrowLeft')).toBe('left');
    expect(nudgeDirectionForKey('ArrowRight')).toBe('right');
    expect(nudgeDirectionForKey('ArrowUp')).toBe('up');
    expect(nudgeDirectionForKey('ArrowDown')).toBe('down');
    expect(nudgeDirectionForKey('a')).toBeNull();
  });

  it('emits 1-unit translates, 10 with shift', () => {
    expect(nudgeCommand(['a'], 'left')).toEqual({
      kind: 'translate',
      targets: ['a'],
      dx: -1,
      dy: 0,
    });
    expect(nudgeCommand(['a', 'b'], 'down', true)).toEqual({
      kind: 'translate',
      targets: ['a', 'b'],
      dx: 0,
      dy: 10,
    });
    expect(nudgeCommand([], 'left')).toBeNull();
  });
});

describe('z-order', () => {
  it('maps ⌘]/⌘[ to forward/backward and ⌥⌘ variants to front/back', () => {
    expect(zOrderModeForKey(']', { metaKey: true, altKey: false })).toBe('forward');
    expect(zOrderModeForKey('[', { metaKey: true, altKey: false })).toBe('backward');
    expect(zOrderModeForKey(']', { metaKey: true, altKey: true })).toBe('front');
    expect(zOrderModeForKey('[', { metaKey: true, altKey: true })).toBe('back');
    expect(zOrderModeForKey(']', { metaKey: false, altKey: false })).toBeNull();
    expect(zOrderModeForKey(']', { metaKey: false, ctrlKey: true, altKey: false })).toBe(
      'forward', // ctrl works for non-mac
    );
    expect(zOrderModeForKey('x', { metaKey: true, altKey: false })).toBeNull();
  });

  it('emits a single reorder for one id, a batch for many', () => {
    expect(zOrderCommand(['a'], 'front')).toEqual({ kind: 'reorder', target: 'a', mode: 'front' });
    const multi = zOrderCommand(['a', 'b'], 'backward');
    expect(multi).toEqual({
      kind: 'batch',
      commands: [
        { kind: 'reorder', target: 'a', mode: 'backward' },
        { kind: 'reorder', target: 'b', mode: 'backward' },
      ],
      label: 'Reorder',
    });
    expect(zOrderCommand([], 'front')).toBeNull();
  });
});

describe('duplicate', () => {
  it('batches inserts + one (+8,+8) translate over the new ids', () => {
    const cmd = duplicateCommand([
      { id: 'c1', svg: '<rect x="0" y="0" width="1" height="1"/>' },
      { id: 'c2', svg: '<circle cx="0" cy="0" r="1"/>', parent: 'g1', index: 2 },
    ]);
    expect(DUPLICATE_OFFSET).toBe(8);
    expect(cmd).toEqual({
      kind: 'batch',
      commands: [
        { kind: 'insert', svg: '<rect x="0" y="0" width="1" height="1"/>', id: 'c1' },
        { kind: 'insert', svg: '<circle cx="0" cy="0" r="1"/>', id: 'c2', parent: 'g1', index: 2 },
        { kind: 'translate', targets: ['c1', 'c2'], dx: 8, dy: 8 },
      ],
      label: 'Duplicate',
    });
    expect(CanvasCommandSchema.safeParse(cmd).success).toBe(true);
    expect(duplicateCommand([])).toBeNull();
  });
});
