import { describe, expect, it } from 'vitest';
import {
  CanvasCommandSchema,
  CommandErrorCodeSchema,
  CommandResultSchema,
  type CanvasCommand,
} from './canvas-commands';

describe('CanvasCommandSchema', () => {
  const valid: CanvasCommand[] = [
    { kind: 'set-attrs', target: 'ax0.legend', attrs: { fill: '#ff0000', stroke: null } },
    { kind: 'set-style', target: 'ax0.line.observed', props: { stroke: 'crimson', opacity: null } },
    { kind: 'set-text', target: 'text_1', text: 'Halpha flux' },
    { kind: 'translate', targets: ['ax0.legend', '#ax0>nth:2'], dx: 4, dy: -2 },
    { kind: 'transform', target: 'ax1', matrix: [1, 0, 0, 1, 10, 0], mode: 'compose' },
    { kind: 'reorder', target: 'patch_1', mode: 'front' },
    { kind: 'reparent', target: 'text_1', parent: 'ax1', index: 0 },
    { kind: 'group', targets: ['a', 'b'], id: 'panel-a' },
    { kind: 'ungroup', target: 'panel-a' },
    { kind: 'insert', parent: 'ax0', index: 2, svg: '<rect width="5" height="5"/>', id: 'scalebar' },
    { kind: 'insert', svg: '<circle r="3"/>' },
    { kind: 'remove', targets: ['scalebar'] },
    { kind: 'align', targets: ['a', 'b', 'c'], axis: 'x', mode: 'center' },
    { kind: 'distribute', targets: ['a', 'b', 'c'], axis: 'y' },
    { kind: 'set-artboard', widthMm: 183 },
    { kind: 'batch', commands: [{ kind: 'remove', targets: ['a'] }], label: 'cleanup' },
  ];

  it.each(valid.map((c) => [c.kind, c] as const))('parses %s', (_kind, command) => {
    const parsed = CanvasCommandSchema.parse(command);
    expect(parsed).toEqual(command);
  });

  it('parses a nested batch (batch inside batch inside batch)', () => {
    const cmd: CanvasCommand = {
      kind: 'batch',
      label: 'outer',
      commands: [
        { kind: 'set-text', target: 't', text: 'x' },
        {
          kind: 'batch',
          commands: [
            { kind: 'translate', targets: ['a'], dx: 1, dy: 2 },
            { kind: 'batch', commands: [] },
          ],
        },
      ],
    };
    expect(CanvasCommandSchema.parse(cmd)).toEqual(cmd);
  });

  it('rejects an unknown kind', () => {
    expect(CanvasCommandSchema.safeParse({ kind: 'explode', target: 'a' }).success).toBe(false);
  });

  it('rejects a missing discriminator', () => {
    expect(CanvasCommandSchema.safeParse({ target: 'a', text: 'x' }).success).toBe(false);
  });

  it('rejects set-attrs with non-string non-null values', () => {
    expect(
      CanvasCommandSchema.safeParse({ kind: 'set-attrs', target: 'a', attrs: { x: 4 } }).success,
    ).toBe(false);
  });

  it('rejects transform with a short matrix', () => {
    expect(
      CanvasCommandSchema.safeParse({
        kind: 'transform',
        target: 'a',
        matrix: [1, 0, 0, 1, 0],
        mode: 'replace',
      }).success,
    ).toBe(false);
  });

  it('rejects transform with an invalid mode', () => {
    expect(
      CanvasCommandSchema.safeParse({
        kind: 'transform',
        target: 'a',
        matrix: [1, 0, 0, 1, 0, 0],
        mode: 'append',
      }).success,
    ).toBe(false);
  });

  it('rejects translate with a non-numeric delta', () => {
    expect(
      CanvasCommandSchema.safeParse({ kind: 'translate', targets: ['a'], dx: '4', dy: 0 }).success,
    ).toBe(false);
  });

  it('rejects reparent with a negative index', () => {
    expect(
      CanvasCommandSchema.safeParse({ kind: 'reparent', target: 'a', parent: 'b', index: -1 })
        .success,
    ).toBe(false);
  });

  it('rejects remove with an empty target list', () => {
    expect(CanvasCommandSchema.safeParse({ kind: 'remove', targets: [] }).success).toBe(false);
  });

  it('rejects insert with empty svg', () => {
    expect(CanvasCommandSchema.safeParse({ kind: 'insert', svg: '' }).success).toBe(false);
  });

  it('rejects an invalid command nested inside a batch', () => {
    const cmd = {
      kind: 'batch',
      commands: [
        { kind: 'set-text', target: 't', text: 'x' },
        { kind: 'batch', commands: [{ kind: 'nope' }] },
      ],
    };
    expect(CanvasCommandSchema.safeParse(cmd).success).toBe(false);
  });
});

describe('CommandErrorCodeSchema', () => {
  it('accepts all documented codes', () => {
    for (const code of ['target-not-found', 'invalid-svg', 'text-on-non-text', 'invalid-command']) {
      expect(CommandErrorCodeSchema.parse(code)).toBe(code);
    }
  });

  it('rejects unknown codes', () => {
    expect(CommandErrorCodeSchema.safeParse('out-of-cheese').success).toBe(false);
  });
});

describe('CommandResultSchema', () => {
  it('parses a success result carrying an inverse command', () => {
    const result = {
      ok: true,
      inverse: { kind: 'translate', targets: ['a'], dx: -4, dy: 2 },
      affected: ['a'],
    };
    expect(CommandResultSchema.parse(result)).toEqual(result);
  });

  it('parses a failure result carrying a structured error', () => {
    const result = {
      ok: false,
      error: { code: 'target-not-found', message: 'no element "ghost"' },
      affected: [],
    };
    expect(CommandResultSchema.parse(result)).toEqual(result);
  });

  it('rejects a success result without an inverse', () => {
    expect(CommandResultSchema.safeParse({ ok: true, affected: [] }).success).toBe(false);
  });

  it('rejects a failure result with an unknown error code', () => {
    expect(
      CommandResultSchema.safeParse({
        ok: false,
        error: { code: 'kaboom', message: 'x' },
        affected: [],
      }).success,
    ).toBe(false);
  });
});
