import { normalizeRect } from './geometry';
import type { WorldPoint, WorldRect } from './types';

/**
 * Shape factories: SVG snippets for creation gestures (canvas-editing-suite.md
 * §4). Snippets are plain fragments — the engine's `insert` command parses
 * them, mints/assigns the id, and appends to the artboard root.
 *
 * All coordinates arrive in world units. Style defaults are profile-aware:
 * pt-valued knobs are converted with `userPerPt` (matplotlib SVGs use pt user
 * units, so the default of 1 is exact there).
 */

export interface ShapeDefaults {
  /** Stroke width for lines/arrows, in pt. */
  strokeWidthPt: number;
  /** Color cycle for new fills/strokes (Wong order for Nature profiles). */
  palette: string[];
  /** Font size for new text, in pt. */
  fontPt: number;
  fontFamily: string;
  /** Root user units per pt; 1 for matplotlib pt-unit SVGs. */
  userPerPt?: number;
}

/**
 * Wong (2011) colorblind-safe palette in canonical order, with black moved
 * last so new shapes default to a visible chromatic color.
 */
export const DEFAULT_SHAPE_DEFAULTS: ShapeDefaults = {
  strokeWidthPt: 1,
  palette: [
    '#E69F00', // orange
    '#56B4E9', // sky blue
    '#009E73', // bluish green
    '#F0E442', // yellow
    '#0072B2', // blue
    '#D55E00', // vermillion
    '#CC79A7', // reddish purple
    '#000000', // black
  ],
  fontPt: 8,
  fontFamily: 'Helvetica',
  userPerPt: 1,
};

/** Marker id the arrow tool references; insert the def once per document. */
export const ARROW_MARKER_ID = 'suna-arrow';

/** Compact number formatting for attribute values (≤3 decimals, no -0). */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** Escape text for use in XML attribute values and text content. */
export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function pickColor(defaults: ShapeDefaults, paletteIndex: number): string {
  const palette = defaults.palette.length > 0 ? defaults.palette : ['#000000'];
  return palette[((paletteIndex % palette.length) + palette.length) % palette.length] as string;
}

function strokeWidthUser(defaults: ShapeDefaults): number {
  return defaults.strokeWidthPt * (defaults.userPerPt ?? 1);
}

export function rectSnippet(
  rect: WorldRect,
  defaults: ShapeDefaults = DEFAULT_SHAPE_DEFAULTS,
  paletteIndex = 0,
): string {
  const r = normalizeRect(rect);
  const fill = pickColor(defaults, paletteIndex);
  return (
    `<rect x="${formatNumber(r.x)}" y="${formatNumber(r.y)}" ` +
    `width="${formatNumber(r.width)}" height="${formatNumber(r.height)}" fill="${fill}"/>`
  );
}

export function ellipseSnippet(
  rect: WorldRect,
  defaults: ShapeDefaults = DEFAULT_SHAPE_DEFAULTS,
  paletteIndex = 0,
): string {
  const r = normalizeRect(rect);
  const fill = pickColor(defaults, paletteIndex);
  return (
    `<ellipse cx="${formatNumber(r.x + r.width / 2)}" cy="${formatNumber(r.y + r.height / 2)}" ` +
    `rx="${formatNumber(r.width / 2)}" ry="${formatNumber(r.height / 2)}" fill="${fill}"/>`
  );
}

export function lineSnippet(
  from: WorldPoint,
  to: WorldPoint,
  defaults: ShapeDefaults = DEFAULT_SHAPE_DEFAULTS,
  paletteIndex = 0,
): string {
  const stroke = pickColor(defaults, paletteIndex);
  return (
    `<line x1="${formatNumber(from.x)}" y1="${formatNumber(from.y)}" ` +
    `x2="${formatNumber(to.x)}" y2="${formatNumber(to.y)}" ` +
    `stroke="${stroke}" stroke-width="${formatNumber(strokeWidthUser(defaults))}" ` +
    `stroke-linecap="round"/>`
  );
}

/**
 * Arrowhead marker definition, inserted once per document (the caller checks
 * for #suna-arrow before inserting). `context-stroke` inherits each arrow's
 * stroke color; the wrapping <defs> receives a minted id from `insert`.
 */
export function arrowMarkerDefSnippet(): string {
  return (
    `<defs><marker id="${ARROW_MARKER_ID}" viewBox="0 0 10 10" refX="8" refY="5" ` +
    `markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="strokeWidth">` +
    `<path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/>` +
    `</marker></defs>`
  );
}

export function arrowSnippet(
  from: WorldPoint,
  to: WorldPoint,
  defaults: ShapeDefaults = DEFAULT_SHAPE_DEFAULTS,
  paletteIndex = 0,
): string {
  const stroke = pickColor(defaults, paletteIndex);
  return (
    `<line x1="${formatNumber(from.x)}" y1="${formatNumber(from.y)}" ` +
    `x2="${formatNumber(to.x)}" y2="${formatNumber(to.y)}" ` +
    `stroke="${stroke}" stroke-width="${formatNumber(strokeWidthUser(defaults))}" ` +
    `stroke-linecap="round" marker-end="url(#${ARROW_MARKER_ID})"/>`
  );
}

export function textSnippet(
  at: WorldPoint,
  text = 'Text',
  defaults: ShapeDefaults = DEFAULT_SHAPE_DEFAULTS,
): string {
  const fontSize = defaults.fontPt * (defaults.userPerPt ?? 1);
  return (
    `<text x="${formatNumber(at.x)}" y="${formatNumber(at.y)}" ` +
    `font-family="${escapeXml(defaults.fontFamily)}" font-size="${formatNumber(fontSize)}" ` +
    `fill="#000000">${escapeXml(text)}</text>`
  );
}
