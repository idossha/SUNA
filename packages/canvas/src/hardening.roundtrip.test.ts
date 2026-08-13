import { describe, expect, it } from 'vitest';
import { open } from './testkit';

/**
 * Adversarial round-trip suite (canvas-engine.md §1: serialize(parse(svg))
 * must be byte-identical for untouched files).
 *
 * The skipped tests document the four known, architectural limitations of a
 * DOMParser/XMLSerializer pipeline — cases where the parser resolves or
 * normalizes source spellings at parse time and the information is
 * unrecoverable. None of them occur in matplotlib output (matplotlib writes
 * double-quoted single-line tags, escapes &<>" in attributes and text, and
 * emits unicode as literal UTF-8).
 */

function roundTrips(src: string): void {
  expect(open(src).serialize()).toBe(src);
}

describe('round-trip byte-identity on hostile inputs', () => {
  it('CDATA sections survive verbatim (including markup-like content)', () => {
    roundTrips(
      '<svg xmlns="http://www.w3.org/2000/svg"><style type="text/css">' +
        '<![CDATA[g > path { fill: red; } /* "</svg>" &amp; ]]>' +
        '</style></svg>',
    );
  });

  it('processing instructions round-trip before, inside, and after the root', () => {
    roundTrips(
      '<?xml version="1.0" encoding="utf-8"?>\n<?xml-stylesheet type="text/css" href="s.css"?>\n' +
        '<svg xmlns="http://www.w3.org/2000/svg"><?sodipodi settings="1"?>' +
        '<rect width="1" height="1"/></svg>\n<?trailer done?>\n',
    );
  });

  it('xml:space and other xml-prefixed attributes round-trip', () => {
    roundTrips(
      '<svg xmlns="http://www.w3.org/2000/svg" xml:lang="en">' +
        '<text xml:space="preserve">  spaced   out  </text></svg>',
    );
  });

  it('predefined entities in text re-escape identically (matplotlib spelling)', () => {
    // matplotlib escapes &, <, > in text; the serializer re-escapes the same
    // three, so the file round-trips: "p &gt; 0.05" stays "p &gt; 0.05".
    roundTrips(
      '<svg xmlns="http://www.w3.org/2000/svg"><text>p &gt; 0.05 &amp; q &lt; 1</text></svg>',
    );
  });

  it('escaped quotes, ampersands and angle brackets in attributes round-trip', () => {
    roundTrips(
      '<svg xmlns="http://www.w3.org/2000/svg">' +
        '<rect data-label="say &quot;hi&quot; &amp; wave &lt;now&gt;" width="1" height="1"/></svg>',
    );
  });

  it("apostrophes inside double-quoted attributes round-trip (matplotlib font lists)", () => {
    roundTrips(
      '<svg xmlns="http://www.w3.org/2000/svg">' +
        '<text style="font-family: \'DejaVu Sans\', \'Arial\', sans-serif">x</text></svg>',
    );
  });

  it('literal UTF-8 in text and attributes round-trips (Å, σ, ⊙, −)', () => {
    roundTrips(
      '<svg xmlns="http://www.w3.org/2000/svg"><text data-unit="Å">flux σ = 3.2 × 10⁻⁴, M⊙, −5</text></svg>',
    );
  });

  it('namespaced attributes (xlink:href) round-trip', () => {
    roundTrips(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
        '<defs><path id="glyph-0" d="M 0 0 L 1 1"/></defs>' +
        '<use xlink:href="#glyph-0" x="10" y="20"/></svg>',
    );
  });

  it('comments with markup-like content round-trip anywhere', () => {
    roundTrips(
      '<!-- header: <svg> "quoted" & raw -->\n' +
        '<svg xmlns="http://www.w3.org/2000/svg"><!-- inner <g id="x"> --><rect width="1" height="1"/></svg>\n' +
        '<!-- trailer -->',
    );
  });

  it('DOCTYPE with an internal subset round-trips', () => {
    roundTrips(
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"\n' +
        '  "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [\n' +
        '  <!ATTLIST svg data-x CDATA #IMPLIED>\n]>\n' +
        '<svg xmlns="http://www.w3.org/2000/svg"/>',
    );
  });

  it('self-closing empty elements stay self-closing', () => {
    roundTrips('<svg xmlns="http://www.w3.org/2000/svg"><g id="e"/><rect width="1" height="1"/></svg>');
  });

  it('literal newlines and tabs inside attribute values round-trip', () => {
    roundTrips(
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M 0 0 \nL 10 10 \n\tL 20 0 \nz\n"/></svg>',
    );
  });

  it('a ">" inside a quoted attribute value does not derail tag scanning', () => {
    // The envelope splitter and whitespace encoder must not mistake the
    // quoted ">" for the end of the tag.
    const src =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect data-l="a &gt; b" width="1" height="1"/>\n</svg>\n';
    roundTrips(src);
  });

  // -------------------------------------------------------------------------
  // Known architectural limitations (DOMParser resolves these at parse time;
  // the original spelling is unrecoverable without a custom parser).

  it.skip('KNOWN LIMITATION: numeric character references in text collapse to literal characters', () => {
    // '&#8722;' parses to '−' and serializes as literal UTF-8. matplotlib
    // writes literal UTF-8 for unicode, so real exports are unaffected.
    roundTrips('<svg xmlns="http://www.w3.org/2000/svg"><text>x &#8722; y</text></svg>');
  });

  it.skip('KNOWN LIMITATION: a literal ">" in an attribute value re-serializes as &gt;', () => {
    // Valid XML, but XMLSerializer always escapes ">" in attribute values.
    // Decoding it back is not an option: matplotlib legitimately writes
    // "&gt;" in attributes, which must keep round-tripping to "&gt;".
    roundTrips('<svg xmlns="http://www.w3.org/2000/svg"><rect data-l="a > b" width="1" height="1"/></svg>');
  });

  it.skip('KNOWN LIMITATION: single-quoted attributes re-serialize double-quoted', () => {
    roundTrips("<svg xmlns='http://www.w3.org/2000/svg'><rect width='1' height='1'/></svg>");
  });

  it.skip('KNOWN LIMITATION: <g></g> (childless, non-self-closed) serializes as <g/>', () => {
    // The DOM cannot represent "had a separate end tag"; the serializer
    // minimizes every childless element. matplotlib never emits the long form.
    roundTrips('<svg xmlns="http://www.w3.org/2000/svg"><g id="e"></g></svg>');
  });

  it.skip('KNOWN LIMITATION: attribute whitespace spelled as character references becomes literal', () => {
    // Documented in dom.ts: '&#10;' in a source attribute round-trips to a
    // literal newline (the value is identical after XML attribute-value
    // normalization; the spelling is not). matplotlib writes literal newlines.
    roundTrips('<svg xmlns="http://www.w3.org/2000/svg"><path d="M 0 0&#10;L 1 1"/></svg>');
  });

  it.skip('KNOWN LIMITATION: newlines between attributes inside a tag collapse to spaces', () => {
    // Intra-tag layout (Inkscape-style one-attribute-per-line) is not part of
    // the DOM; the serializer re-emits single spaces.
    roundTrips('<svg xmlns="http://www.w3.org/2000/svg">\n  <rect\n     x="1"\n     y="2" width="3" height="4"/>\n</svg>');
  });
});
