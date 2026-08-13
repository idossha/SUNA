import { describe, expect, it } from 'vitest';
import { dispatch } from './commands';
import { mustOk, openFixture } from './testkit';

/** Commands against the real matplotlib export, targeting its semantic gids. */
describe('real-fixture operations', () => {
  it('set-style on the observed line path (structural address) edits only its style attr', () => {
    const { doc, source } = openFixture();
    const result = mustOk(
      dispatch(doc, {
        kind: 'set-style',
        target: '#ax0.line.observed>nth:0',
        props: { stroke: '#ff00ff', 'stroke-width': '1.2' },
      }),
    );
    const minted = result.affected[0] as string;
    expect(minted).toMatch(/^suna-e\d+$/);
    const path = doc.getById(minted);
    expect(path?.localName).toBe('path');
    expect(path?.getAttribute('style')).toBe(
      'fill: none; stroke: #ff00ff; stroke-width: 1.2; stroke-linecap: square',
    );
    // The multi-line d attribute is untouched, newlines intact.
    expect(path?.getAttribute('d')).toContain('\n');

    // Inverse restores the style attribute verbatim; the minted id is the
    // single intentional residue (spec §1: minted ids stay stable so
    // histories and overlays keep working).
    expect(result.inverse).toEqual({
      kind: 'set-attrs',
      target: minted,
      attrs: { style: 'fill: none; stroke: #1f77b4; stroke-width: 0.8; stroke-linecap: square' },
    });
    mustOk(dispatch(doc, result.inverse));
    path?.removeAttribute('id');
    doc.invalidate();
    expect(doc.serialize()).toBe(source);
  });

  it('translate ax0.legend by (4, -2) composes a transform; inverse restores byte-identical output', () => {
    const { doc, source } = openFixture();
    const result = mustOk(dispatch(doc, { kind: 'translate', targets: ['ax0.legend'], dx: 4, dy: -2 }));
    expect(result.affected).toEqual(['ax0.legend']);
    const legend = doc.getById('ax0.legend');
    expect(legend?.getAttribute('transform')).toBe('matrix(1, 0, 0, 1, 4, -2)');

    // Exactly one attribute on one element changed — every other byte is intact.
    expect(doc.serialize()).toBe(
      source.replace(
        '<g id="ax0.legend">',
        '<g id="ax0.legend" transform="matrix(1, 0, 0, 1, 4, -2)">',
      ),
    );

    // The inverse restores the prior transform attribute verbatim (absent
    // here) rather than translating back numerically — matplotlib's
    // rotate()/translate() spellings could not be reproduced byte-for-byte.
    expect(result.inverse).toEqual({
      kind: 'set-attrs',
      target: 'ax0.legend',
      attrs: { transform: null },
    });
    mustOk(dispatch(doc, result.inverse));
    expect(doc.serialize()).toBe(source);
  });

  it('translating the legend twice accumulates into one composed matrix', () => {
    const { doc, source } = openFixture();
    mustOk(dispatch(doc, { kind: 'translate', targets: ['ax0.legend'], dx: 4, dy: -2 }));
    mustOk(dispatch(doc, { kind: 'translate', targets: ['ax0.legend'], dx: 1, dy: 1 }));
    expect(doc.getById('ax0.legend')?.getAttribute('transform')).toBe('matrix(1, 0, 0, 1, 5, -1)');
    mustOk(dispatch(doc, { kind: 'translate', targets: ['ax0.legend'], dx: -5, dy: 1 }));
    expect(doc.serialize()).toBe(source);
  });

  it('remove ax0.legend and undo restores byte-identical output', () => {
    const { doc, source } = openFixture();
    const result = mustOk(dispatch(doc, { kind: 'remove', targets: ['ax0.legend'] }));
    expect(doc.getById('ax0.legend')).toBeNull();
    expect(doc.serialize()).not.toBe(source);
    mustOk(dispatch(doc, result.inverse));
    expect(doc.serialize()).toBe(source);
  });

  it('remove a tick group containing <use xlink:href> and undo restores byte-identical output', () => {
    const { doc, source } = openFixture();
    const result = mustOk(dispatch(doc, { kind: 'remove', targets: ['xtick_1'] }));
    expect(doc.getById('xtick_1')).toBeNull();
    mustOk(dispatch(doc, result.inverse));
    expect(doc.serialize()).toBe(source);
  });

  it('set-text on the legend label text element', () => {
    const { doc, source } = openFixture();
    const result = mustOk(
      dispatch(doc, { kind: 'set-text', target: '#text_16>nth:0', text: 'observed flux' }),
    );
    const minted = result.affected[0] as string;
    const text = doc.getById(minted);
    expect(text?.localName).toBe('text');
    expect(text?.textContent).toBe('observed flux');
    mustOk(dispatch(doc, result.inverse));
    expect(text?.textContent).toBe('observed');
    text?.removeAttribute('id');
    doc.invalidate();
    expect(doc.serialize()).toBe(source);
  });

  it('a batch styling both panel legends applies atomically and undoes byte-identically', () => {
    const { doc, source } = openFixture();
    const result = mustOk(
      dispatch(doc, {
        kind: 'batch',
        label: 'nudge legends',
        commands: [
          { kind: 'translate', targets: ['ax0.legend'], dx: 4, dy: -2 },
          { kind: 'translate', targets: ['ax1.legend'], dx: -3, dy: 0 },
        ],
      }),
    );
    expect(doc.getById('ax1.legend')?.getAttribute('transform')).toBe('matrix(1, 0, 0, 1, -3, 0)');
    mustOk(dispatch(doc, result.inverse));
    expect(doc.serialize()).toBe(source);
  });

  it('a batch with a bad member leaves the fixture byte-identical', () => {
    const { doc, source } = openFixture();
    const result = dispatch(doc, {
      kind: 'batch',
      commands: [
        { kind: 'translate', targets: ['ax0.legend'], dx: 4, dy: -2 },
        { kind: 'set-attrs', target: 'ax9.legend', attrs: { opacity: '0' } },
      ],
    });
    expect(result.ok).toBe(false);
    expect(doc.serialize()).toBe(source);
  });
});
