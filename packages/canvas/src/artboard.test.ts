import { describe, expect, it } from 'vitest';
import { dispatch } from './commands';
import { lengthToMm } from './document';
import { mustOk, open, openFixture } from './testkit';

describe('artboard physical-size contract (spec §2)', () => {
  it('reports ~183mm width for the matplotlib fixture (518.740157pt)', () => {
    const { doc } = openFixture();
    const art = doc.artboard;
    expect(art.widthMm).toBeCloseTo(518.740157 * 0.3528, 9);
    expect(art.widthMm).toBeCloseTo(183.01, 1);
    expect(art.heightMm).toBeCloseTo(170.07874 * 0.3528, 9);
    expect(art.viewBox).toEqual({ minX: 0, minY: 0, width: 518.740157, height: 170.07874 });
    // matplotlib pt user units: 1 user unit = 1 pt = 0.3528 mm.
    expect(art.mmPerUser).toBeCloseTo(0.3528, 9);
  });

  it('round-trips a millimetre-sized document exactly', () => {
    const doc = open(
      '<svg xmlns="http://www.w3.org/2000/svg" width="89mm" height="55mm" viewBox="0 0 253 156"><rect width="1" height="1"/></svg>',
    );
    const art = doc.artboard;
    expect(art.widthMm).toBe(89);
    expect(art.heightMm).toBe(55);
    expect(art.mmPerUser).toBeCloseTo(89 / 253, 12);
  });

  it('converts px, in, cm, and unitless lengths', () => {
    expect(lengthToMm('96px')).toBeCloseTo(25.4, 12);
    expect(lengthToMm('96')).toBeCloseTo(25.4, 12); // unitless → px @ 96 dpi
    expect(lengthToMm('2in')).toBeCloseTo(50.8, 12);
    expect(lengthToMm('1.5cm')).toBeCloseTo(15, 12);
    expect(lengthToMm('72pt')).toBeCloseTo(72 * 0.3528, 12);
    expect(lengthToMm('bogus')).toBeNull();
    expect(lengthToMm(null)).toBeNull();
  });

  it('reports nulls for a document without width/viewBox', () => {
    const doc = open('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');
    const art = doc.artboard;
    expect(art.widthMm).toBeNull();
    expect(art.viewBox).toBeNull();
    expect(art.mmPerUser).toBeNull();
  });

  it('set-artboard rewrites width/height attributes only; viewBox untouched; inverse restores bytes', () => {
    const { doc, source } = openFixture();
    const result = mustOk(dispatch(doc, { kind: 'set-artboard', widthMm: 89, heightMm: 55 }));
    expect(doc.root.getAttribute('width')).toBe('89mm');
    expect(doc.root.getAttribute('height')).toBe('55mm');
    expect(doc.root.getAttribute('viewBox')).toBe('0 0 518.740157 170.07874');
    expect(doc.artboard.widthMm).toBe(89);
    // Content is not rescaled: nothing but the two root attributes changed.
    const reserialized = doc.serialize();
    expect(reserialized.replace('width="89mm"', 'width="518.740157pt"').replace('height="55mm"', 'height="170.07874pt"')).toBe(source);

    mustOk(dispatch(doc, result.inverse));
    expect(doc.serialize()).toBe(source);
  });

  it('set-artboard can change a single dimension', () => {
    const { doc, source } = openFixture();
    const result = mustOk(dispatch(doc, { kind: 'set-artboard', widthMm: 183 }));
    expect(doc.root.getAttribute('width')).toBe('183mm');
    expect(doc.root.getAttribute('height')).toBe('170.07874pt');
    mustOk(dispatch(doc, result.inverse));
    expect(doc.serialize()).toBe(source);
  });
});
