/**
 * Adversarial hardening tests for the figure checker: inheritance attacks,
 * <defs> exclusion, null-rule silence, and an end-to-end run of the real
 * bundled science profile (through the loader) against the shared matplotlib
 * fixture.
 */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PublisherProfile } from '@suna/core';
import { loadProfile } from '../profiles';
import { checkFigureSvg } from './figure';
import type { Diagnostic } from './types';
import { apjProfile } from './testkit';

const here: string = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
// packages/formatter/src/check -> repo root -> resources/profiles
const profilesDir = join(here, '..', '..', '..', '..', 'resources', 'profiles');
/** vitest runs with cwd = the package root (same convention as figure.test.ts). */
const FIXTURE_PATH = resolve(process.cwd(), '../canvas/fixtures/mpl-two-panel.svg');

function realProfile(id: string): PublisherProfile {
  return loadProfile(JSON.parse(readFileSync(join(profilesDir, `${id}.json`), 'utf8')));
}

function svg(body: string, attrs = 'width="360pt" height="240pt" viewBox="0 0 360 240"'): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>` +
    `${body}</svg>`
  );
}

function byId(diags: Diagnostic[], id: string): Diagnostic[] {
  return diags.filter((d) => d.id === id);
}

describe('hardening — font-size inheritance attacks', () => {
  it('catches text inheriting a tiny size from <g style="font-size:5px"> (apj min 6pt)', () => {
    const diags = checkFigureSvg(
      svg('<g style="font-size:5px"><text id="t">tick</text></g>'),
      apjProfile(),
    );
    const minFont = byId(diags, 'fig.min-font');
    expect(minFont).toHaveLength(1);
    expect(minFont[0]?.message).toContain('5pt');
    expect(minFont[0]?.message).toContain('6pt');
  });

  it('catches inheritance through multiple nesting levels and from presentation attributes', () => {
    const deep = checkFigureSvg(
      svg('<g style="font-size:5px"><g><g><text>deep</text></g></g></g>'),
      apjProfile(),
    );
    expect(byId(deep, 'fig.min-font')).toHaveLength(1);

    const attr = checkFigureSvg(
      svg('<g font-size="4.2"><text>attr inherited</text></g>'),
      apjProfile(),
    );
    expect(byId(attr, 'fig.min-font')).toHaveLength(1);
    expect(byId(attr, 'fig.min-font')[0]?.message).toContain('4.2pt');
  });

  it('lets the element\'s own larger size override a tiny ancestor size', () => {
    const diags = checkFigureSvg(
      svg('<g style="font-size:4px"><text style="font-size:8px">fine</text></g>'),
      apjProfile(),
    );
    expect(byId(diags, 'fig.min-font')).toEqual([]);
  });
});

describe('hardening — stroke inheritance attacks', () => {
  it('catches stroke-width declared on the group, not the path', () => {
    const diags = checkFigureSvg(
      svg('<g style="stroke:#000000;stroke-width:0.2"><path id="p" d="M 0 0 L 9 9" style="fill:none"/></g>'),
      apjProfile(),
    );
    const lw = byId(diags, 'fig.line-weight');
    expect(lw).toHaveLength(1);
    expect(lw[0]?.message).toContain('0.2pt');
    expect(lw[0]?.message).toContain('0.5pt');
  });

  it('catches stroke-width split across levels (stroke on group, width on grandparent)', () => {
    const diags = checkFigureSvg(
      svg(
        '<g stroke-width="0.1"><g style="stroke:#333333">' +
          '<line x1="0" y1="0" x2="9" y2="0"/></g></g>',
      ),
      apjProfile(),
    );
    expect(byId(diags, 'fig.line-weight')).toHaveLength(1);
  });

  it('does not flag an element that opts out with its own stroke:none', () => {
    const diags = checkFigureSvg(
      svg(
        '<g style="stroke:#000000;stroke-width:0.1">' +
          '<path d="M 0 0 L 9 9" style="fill:none;stroke:none"/></g>',
      ),
      apjProfile(),
    );
    expect(byId(diags, 'fig.line-weight')).toEqual([]);
  });
});

describe('hardening — <defs> content is never checked', () => {
  it('ignores tiny text, thin strokes, low-dpi images, and traces inside <defs>', () => {
    // Real PNG header bytes for a 10px-wide image (low dpi at 72pt width).
    const png = [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
      0, 0, 0, 10, 0, 0, 0, 10, 8, 6, 0, 0, 0, 0, 0, 0, 0,
    ];
    const uri = `data:image/png;base64,${btoa(String.fromCharCode(...png))}`;
    const profile = apjProfile();
    profile.figures.palette.suggestedHex = ['#1f77b4'];
    const diags = checkFigureSvg(
      svg(
        '<defs>' +
          '<text style="font-size:2px">hidden</text>' +
          '<path d="M 0 0 L 9 9" style="fill:none;stroke:#000000;stroke-width:0.1"/>' +
          `<image width="72" height="48" xlink:href="${uri}"/>` +
          '<g id="axes_1">' +
          '<path d="M 0 0 L 9 0" clip-path="url(#c)" style="fill:none;stroke:#ff0000;stroke-width:1"/>' +
          '<path d="M 0 5 L 9 5" clip-path="url(#c)" style="fill:none;stroke:#00ff00;stroke-width:1"/>' +
          '</g>' +
          '</defs>' +
          '<text style="font-size:8px">visible ok</text>',
      ),
      profile,
    );
    expect(diags).toEqual([]);
  });
});

describe('hardening — null rules stay silent', () => {
  it('a profile with every figure rule null yields zero diagnostics on a violating SVG', () => {
    const profile = apjProfile();
    profile.figures.minFontPt = null;
    profile.figures.maxFontPt = null;
    profile.figures.lineWeightPt = { min: null, max: null };
    profile.figures.widthPresetsMm = { single: null, onehalf: null, double: null };
    profile.figures.formats.minDpi = null;
    profile.figures.palette.suggestedHex = null;
    profile.figures.palette.colorAsSoleDelimiter = null;
    const violating = svg(
      '<g id="axes_1">' +
        '<text style="font-size:1px">micro</text>' +
        '<path d="M 0 0 L 9 0" clip-path="url(#c)" style="fill:none;stroke:#ff0000;stroke-width:0.01"/>' +
        '<path d="M 0 5 L 9 5" clip-path="url(#c)" style="fill:none;stroke:#00ff00;stroke-width:0.01"/>' +
        '</g>',
      'width="9999mm" height="80mm" viewBox="0 0 999 8"',
    );
    expect(checkFigureSvg(violating, profile)).toEqual([]);
  });

  it('the null science colorAsSoleDelimiter (audit correction) emits no sole-delimiter warning', () => {
    const science = realProfile('science');
    expect(science.figures.palette.colorAsSoleDelimiter).toBeNull();
    const twoTraces = svg(
      '<g id="axes_1">' +
        '<path d="M 0 0 L 9 0" clip-path="url(#c)" style="fill:none;stroke:#ff0000;stroke-width:1"/>' +
        '<path d="M 0 5 L 9 5" clip-path="url(#c)" style="fill:none;stroke:#0000ff;stroke-width:1"/>' +
        '</g>',
    );
    expect(byId(checkFigureSvg(twoTraces, science), 'fig.color-sole-delimiter')).toEqual([]);
  });
});

describe('hardening — real science.json through the loader against mpl-two-panel', () => {
  const profile = realProfile('science');
  const source = readFileSync(FIXTURE_PATH, 'utf8');
  const diags = checkFigureSvg(source, profile, { figureId: 'two-panel' });

  it('emits no font diagnostics (fixture text is 6.5-7pt inside the 6-9pt band)', () => {
    expect(byId(diags, 'fig.min-font')).toEqual([]);
    expect(byId(diags, 'fig.max-font')).toEqual([]);
  });

  it("emits no line-weight diagnostics (the fixture's thinnest stroke is 0.4pt, over the stated 0.28pt floor)", () => {
    expect(byId(diags, 'fig.line-weight')).toEqual([]);
  });

  it('emits no artboard, dpi, or palette diagnostics for the real profile', () => {
    expect(byId(diags, 'fig.artboard-width')).toEqual([]);
    expect(byId(diags, 'fig.raster-dpi')).toEqual([]);
    expect(byId(diags, 'fig.palette')).toEqual([]);
  });
});
