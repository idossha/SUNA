import { describe, expect, it } from 'vitest';
import { dispatch } from './commands';
import { mustOk, open, openFixture } from './testkit';

/**
 * Error-path hardening: every failed command must return the structured
 * error AND leave the document byte-identical — including commands that
 * target structurally-addressed (id-less) elements, where a naive
 * implementation mints an id before discovering the command is invalid.
 */

const PRETTY = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
  '  <g id="wrap">',
  '    <path d="M 0 0 L 1 1"/>',
  '    <rect x="1" y="1" width="4" height="4"/>',
  '    <text>label</text>',
  '  </g>',
  '</svg>',
].join('\n');

function expectFailureLeavesBytes(
  src: string,
  command: Parameters<typeof dispatch>[1],
  code: string,
): void {
  const doc = open(src);
  const result = dispatch(doc, command);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
  expect(doc.serialize()).toBe(src);
}

describe('failed commands leave the document byte-identical', () => {
  it('set-text on a <path> fails with text-on-non-text', () => {
    expectFailureLeavesBytes(
      PRETTY,
      { kind: 'set-text', target: '#wrap>nth:0', text: 'nope' },
      'text-on-non-text',
    );
  });

  it('set-text via a structural address does not leave a minted id behind', () => {
    // Regression: resolution used to mint 'suna-e1' onto the path before the
    // text-on-non-text check, mutating the document on a failed command.
    const doc = open(PRETTY);
    dispatch(doc, { kind: 'set-text', target: '#wrap>nth:0', text: 'nope' });
    expect(doc.serialize()).not.toContain('suna-e');
  });

  it('unknown targets fail with target-not-found across command kinds', () => {
    for (const command of [
      { kind: 'set-attrs', target: 'ghost', attrs: { fill: 'red' } },
      { kind: 'set-style', target: 'ghost', props: { fill: 'red' } },
      { kind: 'set-text', target: 'ghost', text: 'x' },
      { kind: 'translate', targets: ['wrap', 'ghost'], dx: 1, dy: 1 },
      { kind: 'transform', target: '#wrap>nth:9', matrix: [1, 0, 0, 1, 0, 0], mode: 'replace' },
      { kind: 'reorder', target: 'ghost', mode: 'front' },
      { kind: 'reparent', target: 'ghost', parent: 'wrap' },
      { kind: 'reparent', target: 'wrap', parent: 'ghost' },
      { kind: 'group', targets: ['ghost'] },
      { kind: 'ungroup', target: 'ghost' },
      { kind: 'insert', parent: 'ghost', svg: '<rect width="1" height="1"/>' },
      { kind: 'remove', targets: ['ghost'] },
      { kind: 'align', targets: ['ghost'], axis: 'x', mode: 'start' },
      { kind: 'distribute', targets: ['ghost', 'ghost', 'ghost'], axis: 'x' },
    ] as const) {
      expectFailureLeavesBytes(PRETTY, command as never, 'target-not-found');
    }
  });

  it('malformed insert fragments fail with invalid-svg', () => {
    for (const svg of ['<rect', '<rect/><circle r="1"/>', 'no element here', '<a><b></a></b>']) {
      expectFailureLeavesBytes(PRETTY, { kind: 'insert', parent: 'wrap', svg }, 'invalid-svg');
    }
  });

  it('align on a layout-dependent element fails without minting ids on the measurable ones', () => {
    // #wrap>nth:1 (rect) is measurable and id-less; nth:2 (text) is not.
    // Failure must not leave a minted id on the rect.
    expectFailureLeavesBytes(
      PRETTY,
      { kind: 'align', targets: ['#wrap>nth:1', '#wrap>nth:2'], axis: 'x', mode: 'start' },
      'invalid-command',
    );
  });

  it('translate over an unparseable transform fails without minting', () => {
    const src = PRETTY.replace('<rect x="1"', '<rect transform="rotate(bad" x="1"');
    expectFailureLeavesBytes(
      src,
      { kind: 'translate', targets: ['#wrap>nth:1'], dx: 1, dy: 1 },
      'invalid-command',
    );
  });

  it('ungroup of a non-<g> via structural address fails without minting', () => {
    expectFailureLeavesBytes(
      PRETTY,
      { kind: 'ungroup', target: '#wrap>nth:1' },
      'invalid-command',
    );
  });

  it('group with an in-use id fails without minting onto structural targets', () => {
    expectFailureLeavesBytes(
      PRETTY,
      { kind: 'group', targets: ['#wrap>nth:0', '#wrap>nth:1'], id: 'wrap' },
      'invalid-command',
    );
  });

  it('schema-invalid commands fail without touching the document', () => {
    expectFailureLeavesBytes(
      PRETTY,
      { kind: 'explode', target: 'wrap' } as never,
      'invalid-command',
    );
  });
});

describe('batch rollback strips minted ids', () => {
  it('a failing batch whose earlier member minted an id leaves the document byte-identical', () => {
    const doc = open(PRETTY);
    const result = dispatch(doc, {
      kind: 'batch',
      commands: [
        { kind: 'set-attrs', target: '#wrap>nth:1', attrs: { fill: 'red' } }, // mints
        { kind: 'set-text', target: 'ghost', text: 'boom' }, // fails
      ],
    });
    expect(result.ok).toBe(false);
    expect(doc.serialize()).toBe(PRETTY);
  });

  it('rollback of an ungroup that minted child ids restores the exact bytes', () => {
    const doc = open(PRETTY);
    const result = dispatch(doc, {
      kind: 'batch',
      commands: [
        { kind: 'ungroup', target: 'wrap' }, // mints ids for all three children
        { kind: 'remove', targets: ['ghost'] }, // fails
      ],
    });
    expect(result.ok).toBe(false);
    expect(doc.serialize()).toBe(PRETTY);
  });

  it('a failing batch against the matplotlib fixture leaves it byte-identical', () => {
    const { doc, source } = openFixture();
    const result = dispatch(doc, {
      kind: 'batch',
      commands: [
        { kind: 'set-style', target: '#ax0.line.observed>nth:0', props: { stroke: '#ff0000' } },
        { kind: 'translate', targets: ['ax0.legend'], dx: 3, dy: 3 },
        { kind: 'ungroup', target: 'ax1.legend' },
        { kind: 'set-text', target: 'nope', text: 'x' },
      ],
    });
    expect(result.ok).toBe(false);
    expect(doc.serialize()).toBe(source);
  });
});

describe('remove with overlapping targets', () => {
  const SRC =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
    '<g id="g1"><rect id="a" width="1" height="1"/></g>' +
    '<rect id="b" width="2" height="2"/>' +
    '</svg>';

  it('duplicate targets collapse instead of crashing', () => {
    const doc = open(SRC);
    const result = mustOk(dispatch(doc, { kind: 'remove', targets: ['b', 'b'] }));
    expect(result.affected).toEqual(['b']);
    expect(doc.getById('b')).toBeNull();
    mustOk(dispatch(doc, result.inverse));
    expect(doc.serialize()).toBe(SRC);
  });

  it('a target inside another removed subtree is removed (and restored) with it', () => {
    for (const targets of [['g1', 'a'], ['a', 'g1']]) {
      const doc = open(SRC);
      const result = mustOk(dispatch(doc, { kind: 'remove', targets: [...targets] }));
      expect(result.affected).toEqual(['g1']);
      expect(doc.getById('g1')).toBeNull();
      expect(doc.getById('a')).toBeNull();
      mustOk(dispatch(doc, result.inverse));
      expect(doc.serialize()).toBe(SRC);
    }
  });
});

describe('error paths on the real fixture', () => {
  it('every failure mode leaves the 52KB matplotlib export byte-identical', () => {
    const { doc, source } = openFixture();
    const failures = [
      { kind: 'set-text', target: 'ax0.legend', text: 'x' }, // g, not text
      { kind: 'set-attrs', target: 'ax7', attrs: { opacity: '0' } },
      { kind: 'insert', parent: 'ax0', svg: '<oops' },
      { kind: 'remove', targets: ['#root'] },
      { kind: 'align', targets: ['ax0.legend', 'ax1.legend'], axis: 'x', mode: 'start' }, // <g> geometry needs layout
      { kind: 'ungroup', target: '#ax0.line.observed>nth:0' }, // path, not <g>
    ] as const;
    for (const command of failures) {
      const result = dispatch(doc, command as never);
      expect(result.ok).toBe(false);
    }
    expect(doc.serialize()).toBe(source);
  });
});
