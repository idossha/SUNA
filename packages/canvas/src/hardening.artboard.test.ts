import { describe, expect, it } from 'vitest';
import { dispatch } from './commands';
import { mustOk, open, openFixture } from './testkit';

/** Artboard math hardening (canvas-engine.md §2). */
describe('artboard unit conversion', () => {
  it('the fixture 518.740157pt × 170.07874pt converts to ≈183.01mm × 60.00mm (±0.05mm)', () => {
    const { doc } = openFixture();
    const { widthMm, heightMm, viewBox, mmPerUser } = doc.artboard;
    expect(widthMm).not.toBeNull();
    expect(heightMm).not.toBeNull();
    expect(Math.abs((widthMm as number) - 183.01)).toBeLessThanOrEqual(0.05);
    expect(Math.abs((heightMm as number) - 60.0)).toBeLessThanOrEqual(0.05);
    // 1 pt user unit = 0.3528 mm.
    expect(viewBox?.width).toBe(518.740157);
    expect(mmPerUser).toBeCloseTo(0.3528, 6);
  });

  it('a unitless width falls back to px @ 96dpi', () => {
    const doc = open('<svg xmlns="http://www.w3.org/2000/svg" width="384" height="192" viewBox="0 0 384 192"/>');
    expect(doc.artboard.widthMm).toBeCloseTo(384 * (25.4 / 96), 10); // 101.6mm
    expect(doc.artboard.heightMm).toBeCloseTo(50.8, 10);
    expect(doc.artboard.mmPerUser).toBeCloseTo(25.4 / 96, 10);
  });

  it('percentage and garbage widths degrade to null instead of NaN', () => {
    for (const width of ['100%', '3em', 'auto', 'pt', '']) {
      const doc = open(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" viewBox="0 0 10 10"/>`);
      expect(doc.artboard.widthMm).toBeNull();
      expect(doc.artboard.mmPerUser).toBeNull();
    }
  });

  it('a missing width leaves widthMm and mmPerUser null; the viewBox still parses', () => {
    const doc = open('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 253 156"/>');
    expect(doc.artboard.widthMm).toBeNull();
    expect(doc.artboard.mmPerUser).toBeNull();
    expect(doc.artboard.viewBox).toEqual({ minX: 0, minY: 0, width: 253, height: 156 });
  });

  it('a zero-width viewBox never divides: mmPerUser is null', () => {
    const doc = open('<svg xmlns="http://www.w3.org/2000/svg" width="89mm" viewBox="0 0 0 156"/>');
    expect(doc.artboard.widthMm).toBe(89);
    expect(doc.artboard.mmPerUser).toBeNull();
  });

  it('scientific notation and exotic units convert (5e1mm, 2pc, 1.5in, 10cm)', () => {
    const cases: Array<[string, number]> = [
      ['5e1mm', 50],
      ['2pc', 2 * (25.4 / 6)],
      ['1.5in', 38.1],
      ['10cm', 100],
    ];
    for (const [width, mm] of cases) {
      const doc = open(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" viewBox="0 0 10 10"/>`);
      expect(doc.artboard.widthMm).toBeCloseTo(mm, 9);
    }
  });

  it('set-artboard on a unitless document rewrites only width/height; inverse is byte-identical', () => {
    const src =
      '<svg xmlns="http://www.w3.org/2000/svg" width="384" height="192" viewBox="0 0 384 192"><rect width="10" height="10"/></svg>';
    const doc = open(src);
    const result = mustOk(dispatch(doc, { kind: 'set-artboard', widthMm: 89, heightMm: 55 }));
    expect(doc.root.getAttribute('width')).toBe('89mm');
    expect(doc.root.getAttribute('height')).toBe('55mm');
    expect(doc.root.getAttribute('viewBox')).toBe('0 0 384 192');
    expect(doc.artboard.widthMm).toBe(89);
    mustOk(dispatch(doc, result.inverse));
    expect(doc.serialize()).toBe(src);
  });

  it('set-artboard on a document without width/height attributes undoes byte-identically', () => {
    const src = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"/>';
    const doc = open(src);
    const result = mustOk(dispatch(doc, { kind: 'set-artboard', widthMm: 100 }));
    expect(doc.root.getAttribute('width')).toBe('100mm');
    mustOk(dispatch(doc, result.inverse));
    expect(doc.serialize()).toBe(src);
  });
});
