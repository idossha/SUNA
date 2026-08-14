import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SvgParseError } from '@suna/canvas';
import { checkFigureSvg } from './figure';
import type { Diagnostic } from './types';
import { apjProfile } from './testkit';

/** vitest runs with cwd = the package root (same convention as @suna/canvas). */
const FIXTURE_PATH = resolve(process.cwd(), '../canvas/fixtures/mpl-two-panel.svg');

/** Wrap body in an artboard where user units == pt (360pt x 240pt). */
function svg(body: string, attrs = 'width="360pt" height="240pt" viewBox="0 0 360 240"'): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>` +
    `${body}</svg>`
  );
}

function byId(diags: Diagnostic[], id: string): Diagnostic[] {
  return diags.filter((d) => d.id === id);
}

/** Minimal PNG data URI: real signature + IHDR, truncated after the header. */
function pngDataUri(pxWidth: number, pxHeight = 10): string {
  const bytes = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 13,
    0x49, 0x48, 0x44, 0x52,
    (pxWidth >>> 24) & 255, (pxWidth >>> 16) & 255, (pxWidth >>> 8) & 255, pxWidth & 255,
    (pxHeight >>> 24) & 255, (pxHeight >>> 16) & 255, (pxHeight >>> 8) & 255, pxHeight & 255,
    8, 6, 0, 0, 0, 0, 0, 0, 0,
  ];
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
}

describe('checkFigureSvg — fonts', () => {
  it('flags text below minFontPt with measured value and rule in the message', () => {
    const diags = checkFigureSvg(
      svg('<text id="lbl" x="10" y="20" style="font-size: 4px">tiny label</text>'),
      apjProfile(),
      { figureId: 'fig1' },
    );
    const minFont = byId(diags, 'fig.min-font');
    expect(minFont).toHaveLength(1);
    expect(minFont[0]?.severity).toBe('error');
    expect(minFont[0]?.surface).toBe('figure');
    expect(minFont[0]?.message).toContain('4pt');
    expect(minFont[0]?.message).toContain('6pt');
    expect(minFont[0]?.message).toContain('tiny label');
    expect(minFont[0]?.message).toContain('journals.aas.org');
    expect(minFont[0]?.target).toEqual({ figureId: 'fig1', elementId: 'lbl' });
  });

  it('passes text at or above the minimum', () => {
    const diags = checkFigureSvg(
      svg(
        '<text style="font-size: 6px">exactly six</text>' +
          '<text style="font-size: 7pt">seven pt</text>' +
          '<text font-size="10">attr ten</text>',
      ),
      apjProfile(),
    );
    expect(byId(diags, 'fig.min-font')).toEqual([]);
  });

  it('inherits font-size from ancestors when the element has none', () => {
    const diags = checkFigureSvg(
      svg('<g style="font-size: 5px"><g><text id="inherited">nested</text></g></g>'),
      apjProfile(),
    );
    const minFont = byId(diags, 'fig.min-font');
    expect(minFont).toHaveLength(1);
    expect(minFont[0]?.message).toContain('5pt');
    expect(minFont[0]?.target?.elementId).toBe('inherited');
  });

  it('reads the font-size attribute as well as the style attribute', () => {
    const diags = checkFigureSvg(svg('<text font-size="4.5">attr sized</text>'), apjProfile());
    expect(byId(diags, 'fig.min-font')).toHaveLength(1);
    expect(byId(diags, 'fig.min-font')[0]?.message).toContain('4.5pt');
  });

  it('sizes mathtext-style <text> without its own font-size by its largest tspan run', () => {
    const mathtext =
      '<text><tspan style="font-size: 6.5px">10</tspan>' +
      '<tspan style="font-size: 4.55px">9</tspan></text>';
    expect(byId(checkFigureSvg(svg(mathtext), apjProfile()), 'fig.min-font')).toEqual([]);
  });

  it('flags text above maxFontPt', () => {
    const profile = apjProfile();
    profile.figures.maxFontPt = 12;
    const diags = checkFigureSvg(svg('<text style="font-size: 14px">huge</text>'), profile);
    const maxFont = byId(diags, 'fig.max-font');
    expect(maxFont).toHaveLength(1);
    expect(maxFont[0]?.message).toContain('14pt');
    expect(maxFont[0]?.message).toContain('12pt');
  });

  it('skips font rules entirely when the profile does not state them', () => {
    const profile = apjProfile();
    profile.figures.minFontPt = null;
    const diags = checkFigureSvg(svg('<text style="font-size: 2px">micro</text>'), profile);
    expect(byId(diags, 'fig.min-font')).toEqual([]);
    expect(byId(diags, 'fig.max-font')).toEqual([]);
  });

  it('ignores text inside <defs> and whitespace-only text', () => {
    const diags = checkFigureSvg(
      svg('<defs><text style="font-size: 2px">hidden</text></defs><text style="font-size: 3px">  </text>'),
      apjProfile(),
    );
    expect(byId(diags, 'fig.min-font')).toEqual([]);
  });
});

describe('checkFigureSvg — line weights', () => {
  it('flags strokes below the stated minimum with measured value', () => {
    const diags = checkFigureSvg(
      svg('<path id="trace" d="M 0 0 L 10 10" style="fill: none; stroke: #1f77b4; stroke-width: 0.2"/>'),
      apjProfile(),
    );
    const lw = byId(diags, 'fig.line-weight');
    expect(lw).toHaveLength(1);
    expect(lw[0]?.severity).toBe('error');
    expect(lw[0]?.message).toContain('0.2pt');
    expect(lw[0]?.message).toContain('0.5pt');
    expect(lw[0]?.target?.elementId).toBe('trace');
  });

  it('flags strokes above the stated maximum', () => {
    const profile = apjProfile();
    profile.figures.lineWeightPt = { min: null, max: 1.5 };
    const diags = checkFigureSvg(
      svg('<line x1="0" y1="0" x2="10" y2="0" style="stroke: #000000; stroke-width: 3"/>'),
      profile,
    );
    expect(byId(diags, 'fig.line-weight')).toHaveLength(1);
    expect(byId(diags, 'fig.line-weight')[0]?.message).toContain('3pt');
    expect(byId(diags, 'fig.line-weight')[0]?.message).toContain('1.5pt');
  });

  it('inherits stroke properties from ancestor groups', () => {
    const diags = checkFigureSvg(
      svg('<g style="stroke: #000000; stroke-width: 0.3"><path id="p" d="M 0 0 L 5 5"/></g>'),
      apjProfile(),
    );
    expect(byId(diags, 'fig.line-weight')).toHaveLength(1);
    expect(byId(diags, 'fig.line-weight')[0]?.message).toContain('0.3pt');
  });

  it('treats a stroked element with no stroke-width as the SVG default 1pt', () => {
    const diags = checkFigureSvg(
      svg('<path d="M 0 0 L 5 5" style="fill: none; stroke: #000000"/>'),
      apjProfile(),
    );
    expect(byId(diags, 'fig.line-weight')).toEqual([]);
  });

  it('ignores stroke:none, unstroked elements, and elements inside <defs>', () => {
    const diags = checkFigureSvg(
      svg(
        '<path d="M 0 0 L 5 5" style="stroke: none; stroke-width: 0.1"/>' +
          '<rect x="0" y="0" width="5" height="5" style="fill: #000000"/>' +
          '<defs><path d="M 0 0 L 5 5" style="stroke: #000000; stroke-width: 0.1"/></defs>',
      ),
      apjProfile(),
    );
    expect(byId(diags, 'fig.line-weight')).toEqual([]);
  });

  it('skips the rule when the profile states no line-weight bounds', () => {
    const profile = apjProfile();
    profile.figures.lineWeightPt = { min: null, max: null };
    const diags = checkFigureSvg(
      svg('<path d="M 0 0 L 5 5" style="stroke: #000000; stroke-width: 0.01"/>'),
      profile,
    );
    expect(byId(diags, 'fig.line-weight')).toEqual([]);
  });
});

describe('checkFigureSvg — artboard width', () => {
  function presetsProfile() {
    const profile = apjProfile();
    profile.figures.widthPresetsMm = { single: 89, onehalf: null, double: 183 };
    return profile;
  }

  it('warns when the artboard width matches no stated preset within 1mm', () => {
    const diags = checkFigureSvg(
      svg('<text style="font-size: 8px">t</text>', 'width="120mm" height="80mm" viewBox="0 0 340 227"'),
      presetsProfile(),
    );
    const ab = byId(diags, 'fig.artboard-width');
    expect(ab).toHaveLength(1);
    expect(ab[0]?.severity).toBe('warning');
    expect(ab[0]?.message).toContain('120mm');
    expect(ab[0]?.message).toContain('89mm');
    expect(ab[0]?.message).toContain('183mm');
  });

  it('accepts a width within 1mm of a preset', () => {
    const diags = checkFigureSvg(
      svg('<text style="font-size: 8px">t</text>', 'width="183.5mm" height="80mm" viewBox="0 0 520 227"'),
      presetsProfile(),
    );
    expect(byId(diags, 'fig.artboard-width')).toEqual([]);
  });

  it('skips the rule when the profile states no presets', () => {
    const diags = checkFigureSvg(
      svg('<text style="font-size: 8px">t</text>', 'width="999mm" height="80mm" viewBox="0 0 999 80"'),
      apjProfile(),
    );
    expect(byId(diags, 'fig.artboard-width')).toEqual([]);
  });
});

describe('checkFigureSvg — raster dpi', () => {
  it('flags an embedded PNG whose effective dpi is under minDpi', () => {
    // 72 user units == 72pt == 1 inch; 150px across 1in => 150 dpi < 300.
    const diags = checkFigureSvg(
      svg(`<image id="im" x="0" y="0" width="72" height="48" xlink:href="${pngDataUri(150)}"/>`),
      apjProfile(),
    );
    const dpi = byId(diags, 'fig.raster-dpi');
    expect(dpi).toHaveLength(1);
    expect(dpi[0]?.severity).toBe('error');
    expect(dpi[0]?.message).toContain('150 dpi');
    expect(dpi[0]?.message).toContain('300 dpi');
    expect(dpi[0]?.target?.elementId).toBe('im');
  });

  it('passes an embedded PNG at or above minDpi', () => {
    const diags = checkFigureSvg(
      svg(`<image x="0" y="0" width="72" height="48" xlink:href="${pngDataUri(400)}"/>`),
      apjProfile(),
    );
    expect(byId(diags, 'fig.raster-dpi')).toEqual([]);
  });

  it('emits nothing when the image is not cheaply decodable', () => {
    const notPng = `data:image/png;base64,${btoa('this is not a png header, truly')}`;
    const diags = checkFigureSvg(
      svg(
        `<image width="72" height="48" xlink:href="${notPng}"/>` +
          '<image width="72" height="48" xlink:href="data:image/png;base64,AAAA"/>' +
          '<image width="72" height="48" xlink:href="data:image/jpeg;base64,/9j/4AAQ"/>' +
          `<image height="48" xlink:href="${pngDataUri(10)}"/>`,
      ),
      apjProfile(),
    );
    expect(byId(diags, 'fig.raster-dpi')).toEqual([]);
  });

  it('skips the rule when the profile states no minDpi', () => {
    const profile = apjProfile();
    profile.figures.formats.minDpi = null;
    const diags = checkFigureSvg(
      svg(`<image width="72" height="48" xlink:href="${pngDataUri(10)}"/>`),
      profile,
    );
    expect(byId(diags, 'fig.raster-dpi')).toEqual([]);
  });
});

describe('checkFigureSvg — color as sole delimiter', () => {
  const twoSolidTraces =
    '<g id="axes_1">' +
    '<path d="M 0 0 L 10 0" clip-path="url(#c)" style="fill: none; stroke: #ff0000; stroke-width: 1"/>' +
    '<path d="M 0 5 L 10 5" clip-path="url(#c)" style="fill: none; stroke: #0000ff; stroke-width: 1"/>' +
    '</g>';

  it('warns when sibling traces differ only by stroke color (forbidden)', () => {
    const diags = checkFigureSvg(svg(twoSolidTraces), apjProfile());
    const sole = byId(diags, 'fig.color-sole-delimiter');
    expect(sole).toHaveLength(1);
    expect(sole[0]?.severity).toBe('warning');
    expect(sole[0]?.message).toContain('#ff0000');
    expect(sole[0]?.message).toContain('#0000ff');
    expect(sole[0]?.message).toContain('forbids');
    expect(sole[0]?.message).toContain('axes_1');
  });

  it('uses "discourages" wording for the discouraged policy', () => {
    const profile = apjProfile();
    profile.figures.palette.colorAsSoleDelimiter = 'discouraged';
    const sole = byId(checkFigureSvg(svg(twoSolidTraces), profile), 'fig.color-sole-delimiter');
    expect(sole).toHaveLength(1);
    expect(sole[0]?.message).toContain('discourages');
  });

  it('does not warn when a dash pattern also distinguishes the traces', () => {
    const dashed =
      '<g id="axes_1">' +
      '<path d="M 0 0 L 10 0" clip-path="url(#c)" style="fill: none; stroke: #ff0000; stroke-width: 1"/>' +
      '<path d="M 0 5 L 10 5" clip-path="url(#c)" style="fill: none; stroke: #0000ff; stroke-width: 1; stroke-dasharray: 3,1"/>' +
      '</g>';
    expect(byId(checkFigureSvg(svg(dashed), apjProfile()), 'fig.color-sole-delimiter')).toEqual([]);
  });

  it('does not warn when widths clearly differ', () => {
    const widths =
      '<g id="axes_1">' +
      '<path d="M 0 0 L 10 0" clip-path="url(#c)" style="fill: none; stroke: #ff0000; stroke-width: 0.6"/>' +
      '<path d="M 0 5 L 10 5" clip-path="url(#c)" style="fill: none; stroke: #0000ff; stroke-width: 2"/>' +
      '</g>';
    expect(byId(checkFigureSvg(svg(widths), apjProfile()), 'fig.color-sole-delimiter')).toEqual([]);
  });

  it('ignores unclipped decoration such as spines and legend samples', () => {
    const unclipped =
      '<g id="axes_1">' +
      '<path d="M 0 0 L 10 0" style="fill: none; stroke: #ff0000; stroke-width: 1"/>' +
      '<path d="M 0 5 L 10 5" style="fill: none; stroke: #0000ff; stroke-width: 1"/>' +
      '</g>';
    expect(byId(checkFigureSvg(svg(unclipped), apjProfile()), 'fig.color-sole-delimiter')).toEqual([]);
  });

  it('skips the rule when the profile allows or does not state the policy', () => {
    for (const policy of ['allowed', null] as const) {
      const profile = apjProfile();
      profile.figures.palette.colorAsSoleDelimiter = policy;
      expect(byId(checkFigureSvg(svg(twoSolidTraces), profile), 'fig.color-sole-delimiter')).toEqual(
        [],
      );
    }
  });

  it('falls back to the outermost group when no axes-like id exists', () => {
    const noAxesId =
      '<g id="plot">' +
      '<path d="M 0 0 L 10 0" clip-path="url(#c)" style="fill: none; stroke: #ff0000; stroke-width: 1"/>' +
      '<path d="M 0 5 L 10 5" clip-path="url(#c)" style="fill: none; stroke: #0000ff; stroke-width: 1"/>' +
      '</g>';
    const sole = byId(checkFigureSvg(svg(noAxesId), apjProfile()), 'fig.color-sole-delimiter');
    expect(sole).toHaveLength(1);
    expect(sole[0]?.message).toContain('"plot"');
  });
});

describe('checkFigureSvg — palette', () => {
  function paletteProfile() {
    const profile = apjProfile();
    profile.figures.palette.suggestedHex = ['#1f77b4', '#ff7f0e'];
    return profile;
  }

  it('flags off-palette colors on data traces only, deduplicated per color', () => {
    const body =
      '<g id="axes_1">' +
      '<path d="M 0 0 L 10 0" clip-path="url(#c)" style="fill: none; stroke: #dc143c; stroke-width: 1"/>' +
      '<path d="M 0 5 L 10 5" clip-path="url(#c)" style="fill: none; stroke: #dc143c; stroke-width: 1"/>' +
      '<path d="M 0 9 L 10 9" clip-path="url(#c)" style="fill: none; stroke: #1f77b4; stroke-width: 1"/>' +
      '<path d="M 0 0 L 0 10" style="fill: none; stroke: #000000; stroke-width: 1"/>' +
      '<text style="font-size: 8px; fill: #123456">axis label</text>' +
      '</g>';
    const diags = checkFigureSvg(svg(body), paletteProfile());
    const palette = byId(diags, 'fig.palette');
    expect(palette).toHaveLength(1);
    expect(palette[0]?.severity).toBe('warning');
    expect(palette[0]?.message).toContain('#dc143c');
    expect(palette[0]?.message).toContain('#1f77b4');
  });

  it('checks marker fills inside clipped groups', () => {
    const body =
      '<g clip-path="url(#c)"><use xlink:href="#m0" x="1" y="1" style="fill: #00ff00; stroke: #00ff00"/></g>';
    const palette = byId(checkFigureSvg(svg(body), paletteProfile()), 'fig.palette');
    expect(palette).toHaveLength(1);
    expect(palette[0]?.message).toContain('#00ff00');
  });

  it('skips the rule when the profile suggests no palette', () => {
    const body =
      '<path d="M 0 0 L 10 0" clip-path="url(#c)" style="fill: none; stroke: #dc143c; stroke-width: 1"/>';
    expect(byId(checkFigureSvg(svg(body), apjProfile()), 'fig.palette')).toEqual([]);
  });
});

describe('checkFigureSvg — crafted violating figure', () => {
  it('reports both font and line-weight violations with measured values', () => {
    const violating = svg(
      '<g id="axes_1">' +
        '<text id="lbl" x="10" y="20" style="font-size: 4px">tiny</text>' +
        '<path id="thin" d="M 0 0 L 10 10" style="fill: none; stroke: #1f77b4; stroke-width: 0.2"/>' +
        '</g>',
    );
    const diags = checkFigureSvg(violating, apjProfile(), { figureId: 'bad-fig' });
    const minFont = byId(diags, 'fig.min-font');
    const lineWeight = byId(diags, 'fig.line-weight');
    expect(minFont).toHaveLength(1);
    expect(minFont[0]?.message).toContain('4pt');
    expect(minFont[0]?.message).toContain('6pt');
    expect(lineWeight).toHaveLength(1);
    expect(lineWeight[0]?.message).toContain('0.2pt');
    expect(lineWeight[0]?.message).toContain('0.5pt');
    for (const d of [...minFont, ...lineWeight]) {
      expect(d.target?.figureId).toBe('bad-fig');
    }
  });

  it('throws SvgParseError on unparseable input', () => {
    expect(() => checkFigureSvg('<svg><unclosed', apjProfile())).toThrow(SvgParseError);
  });
});

describe('checkFigureSvg — mpl-two-panel fixture (integration)', () => {
  const source = readFileSync(FIXTURE_PATH, 'utf8');

  it('passes ApJ\'s 6pt font minimum (journal_rc text is 6.5-7pt)', () => {
    const diags = checkFigureSvg(source, apjProfile(), { figureId: 'two-panel' });
    expect(byId(diags, 'fig.min-font')).toEqual([]);
    expect(byId(diags, 'fig.max-font')).toEqual([]);
  });

  it('flags the 0.4pt minor tick strokes against ApJ\'s 0.5pt minimum', () => {
    const diags = checkFigureSvg(source, apjProfile(), { figureId: 'two-panel' });
    const lw = byId(diags, 'fig.line-weight');
    expect(lw.length).toBeGreaterThan(0);
    for (const d of lw) {
      expect(d.message).toContain('0.4pt');
      expect(d.message).toContain('0.5pt');
      expect(d.target?.figureId).toBe('two-panel');
    }
  });

  it('warns that panel a\'s two solid traces are delimited only by color', () => {
    const diags = checkFigureSvg(source, apjProfile());
    const sole = byId(diags, 'fig.color-sole-delimiter');
    expect(sole).toHaveLength(1);
    expect(sole[0]?.message).toContain('#1f77b4');
    expect(sole[0]?.message).toContain('#dc143c');
    expect(sole[0]?.message).toContain('ax0');
  });

  it('flags off-palette trace colors when the profile suggests a palette', () => {
    const profile = apjProfile();
    profile.figures.palette.suggestedHex = ['#1f77b4'];
    const flagged = byId(checkFigureSvg(source, profile), 'fig.palette').map((d) => {
      const hex = /#[0-9a-f]{6}/.exec(d.message)?.[0];
      return hex ?? '';
    });
    expect(flagged).toContain('#dc143c');
    expect(flagged).not.toContain('#1f77b4');
  });

  it('skips artboard and dpi rules on the fixture (no presets stated, no rasters)', () => {
    const diags = checkFigureSvg(source, apjProfile());
    expect(byId(diags, 'fig.artboard-width')).toEqual([]);
    expect(byId(diags, 'fig.raster-dpi')).toEqual([]);
  });
});
