import { describe, expect, it } from 'vitest';
import {
  ARROW_MARKER_ID,
  arrowMarkerDefSnippet,
  arrowSnippet,
  DEFAULT_SHAPE_DEFAULTS,
  ellipseSnippet,
  escapeXml,
  formatNumber,
  lineSnippet,
  rectSnippet,
  textSnippet,
  type ShapeDefaults,
} from './factories';

/** Parse a snippet inside an svg root; fail the test on XML errors. */
function parseSnippet(snippet: string): Element {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${snippet}</svg>`,
    'image/svg+xml',
  );
  expect(doc.querySelector('parsererror')).toBeNull();
  const el = doc.documentElement.firstElementChild;
  expect(el).not.toBeNull();
  return el as Element;
}

const DEFAULTS: ShapeDefaults = {
  strokeWidthPt: 1.5,
  palette: ['#111111', '#222222'],
  fontPt: 7,
  fontFamily: 'Arial',
  userPerPt: 2,
};

describe('formatNumber', () => {
  it('rounds to 3 decimals, trims, and never emits -0', () => {
    expect(formatNumber(1.23456)).toBe('1.235');
    expect(formatNumber(10)).toBe('10');
    expect(formatNumber(-0.0001)).toBe('0');
    expect(formatNumber(Number.NaN)).toBe('0');
  });
});

describe('escapeXml', () => {
  it('escapes markup and quote characters', () => {
    expect(escapeXml(`a<b>&"c"'d'`)).toBe('a&lt;b&gt;&amp;&quot;c&quot;&apos;d&apos;');
  });
});

describe('rectSnippet', () => {
  it('emits a valid rect with palette fill', () => {
    const el = parseSnippet(rectSnippet({ x: 10, y: 20, width: 40, height: 30 }));
    expect(el.tagName).toBe('rect');
    expect(el.getAttribute('x')).toBe('10');
    expect(el.getAttribute('y')).toBe('20');
    expect(el.getAttribute('width')).toBe('40');
    expect(el.getAttribute('height')).toBe('30');
    expect(el.getAttribute('fill')).toBe(DEFAULT_SHAPE_DEFAULTS.palette[0]);
  });

  it('normalizes negative sizes', () => {
    const el = parseSnippet(rectSnippet({ x: 50, y: 60, width: -40, height: -20 }));
    expect(el.getAttribute('x')).toBe('10');
    expect(el.getAttribute('y')).toBe('40');
    expect(el.getAttribute('width')).toBe('40');
    expect(el.getAttribute('height')).toBe('20');
  });

  it('cycles the palette by index', () => {
    const el = parseSnippet(rectSnippet({ x: 0, y: 0, width: 1, height: 1 }, DEFAULTS, 3));
    expect(el.getAttribute('fill')).toBe('#222222'); // 3 % 2
  });
});

describe('ellipseSnippet', () => {
  it('derives center and radii from the rect', () => {
    const el = parseSnippet(ellipseSnippet({ x: 10, y: 20, width: 40, height: 30 }));
    expect(el.tagName).toBe('ellipse');
    expect(el.getAttribute('cx')).toBe('30');
    expect(el.getAttribute('cy')).toBe('35');
    expect(el.getAttribute('rx')).toBe('20');
    expect(el.getAttribute('ry')).toBe('15');
  });
});

describe('lineSnippet / arrowSnippet', () => {
  it('emits endpoints and pt-converted stroke width', () => {
    const el = parseSnippet(lineSnippet({ x: 1, y: 2 }, { x: 3.5, y: 4 }, DEFAULTS));
    expect(el.tagName).toBe('line');
    expect(el.getAttribute('x1')).toBe('1');
    expect(el.getAttribute('y2')).toBe('4');
    expect(el.getAttribute('stroke')).toBe('#111111');
    expect(el.getAttribute('stroke-width')).toBe('3'); // 1.5pt × 2 user/pt
  });

  it('arrow references the shared marker', () => {
    const el = parseSnippet(arrowSnippet({ x: 0, y: 0 }, { x: 10, y: 0 }));
    expect(el.getAttribute('marker-end')).toBe(`url(#${ARROW_MARKER_ID})`);
  });

  it('marker def declares #suna-arrow inside <defs>', () => {
    const el = parseSnippet(arrowMarkerDefSnippet());
    expect(el.tagName).toBe('defs');
    const marker = el.firstElementChild;
    expect(marker?.tagName).toBe('marker');
    expect(marker?.getAttribute('id')).toBe(ARROW_MARKER_ID);
    expect(marker?.getAttribute('orient')).toBe('auto-start-reverse');
  });
});

describe('textSnippet', () => {
  it('emits profile font settings and escapes content', () => {
    const el = parseSnippet(textSnippet({ x: 5, y: 6 }, 'a<b> & "c"', DEFAULTS));
    expect(el.tagName).toBe('text');
    expect(el.getAttribute('x')).toBe('5');
    expect(el.getAttribute('font-family')).toBe('Arial');
    expect(el.getAttribute('font-size')).toBe('14'); // 7pt × 2 user/pt
    expect(el.textContent).toBe('a<b> & "c"');
  });

  it('defaults to placeholder text', () => {
    const el = parseSnippet(textSnippet({ x: 0, y: 0 }));
    expect(el.textContent).toBe('Text');
  });
});
