import { describe, expect, it } from 'vitest';
import { open, openFixture } from './testkit';

describe('round-trip byte identity (spec §1)', () => {
  it('parse→serialize of the untouched matplotlib fixture is byte-identical', () => {
    const { doc, source } = openFixture();
    expect(doc.serialize()).toBe(source);
  });

  it('parse→serialize→parse→serialize is stable', () => {
    const { doc, source } = openFixture();
    const once = doc.serialize();
    expect(open(once).serialize()).toBe(source);
  });

  it('preserves DOCTYPE, XML declaration, comments, unknown attrs and namespaces', () => {
    const handcrafted = `<?xml version="1.0" encoding="utf-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"
  "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<!-- prologue comment -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:sodipodi="urn:x-sodipodi" width="89mm" height="55mm" viewBox="0 0 253 156" data-unknown="kept">
 <!-- inner comment -->
 <sodipodi:namedview bordercolor="#666666" pagecolor="#ffffff"/>
 <defs>
  <path id="tick" d="M 0 0
L 0 3.5
" style="stroke: #000000"/>
 </defs>
 <g id="layer" unknown-attr="42">
  <use xlink:href="#tick" x="10" y="10"/>
  <text id="label" x="5" y="20">&amp;alpha; &amp; β &lt;sub&gt;</text>
 </g>
</svg>
<!-- trailing comment -->
`;
    expect(open(handcrafted).serialize()).toBe(handcrafted);
  });

  it('preserves literal newlines and tabs inside attribute values', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M 0 0 \nL 1 1 \n\tz\n"/></svg>';
    const doc = open(svg);
    expect(doc.serialize()).toBe(svg);
    // The DOM must hold the true characters, not entity text.
    const path = doc.root.firstElementChild;
    expect(path?.getAttribute('d')).toBe('M 0 0 \nL 1 1 \n\tz\n');
  });

  it('preserves single quotes and entity escapes in attribute values', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><text style="font-family: \'DejaVu Sans\', sans-serif" data-x="a&amp;b">t</text></svg>';
    expect(open(svg).serialize()).toBe(svg);
  });

  it('preserves a file with no prologue and no trailing newline', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    expect(open(svg).serialize()).toBe(svg);
  });

  it('rejects malformed SVG', () => {
    expect(() => open('<svg xmlns="http://www.w3.org/2000/svg"><rect</svg>')).toThrow();
  });

  it('rejects a non-svg root', () => {
    expect(() => open('<div xmlns="http://www.w3.org/1999/xhtml"/>')).toThrow(/expected <svg>/);
  });
});
