import { CanvasDocument, createBrowserDomAdapter } from '@suna/canvas';
import type { PublisherProfile } from '@suna/core';
import type { Diagnostic, DiagnosticTarget } from './types';
import { fmtNum, sourceSuffix } from './util';

/**
 * Figure compliance checker (ADR-002 §4). Parses an SVG with the canvas
 * engine and flags violations of the profile's stated figure rules. Every
 * rule is skipped when the profile value is null ("the journal does not
 * state this").
 *
 * Unit model: matplotlib SVG exports use user units == px == pt (72 dpi user
 * space), so font-size/stroke-width numbers are read as pt whether they are
 * unitless, `px`, or `pt`. Physical artboard conversions go through the
 * canvas Artboard (mm).
 */

/** pt per mm — inverse of the canvas convention (1 pt = 0.3528 mm). */
const MM_PER_PT = 0.3528;

const LENGTH_RE = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(px|pt)?\s*$/;

/** Parse a font-size / stroke-width value as pt (px == user units == pt). */
function parsePt(raw: string | null): number | null {
  if (raw === null) return null;
  const m = LENGTH_RE.exec(raw);
  if (m === null) return null;
  const value = Number(m[1] ?? '');
  return Number.isFinite(value) ? value : null;
}

function* walk(el: Element): Generator<Element> {
  yield el;
  for (const child of Array.from(el.children)) yield* walk(child);
}

function parentOf(el: Element): Element | null {
  const p = el.parentNode;
  return p !== null && p.nodeType === 1 ? (p as Element) : null;
}

function isInDefs(el: Element): boolean {
  for (let cur: Element | null = el; cur !== null; cur = parentOf(cur)) {
    if (cur.localName === 'defs') return true;
  }
  return false;
}

/** Read a property from the style attribute; presentation attribute fallback. */
function ownProp(el: Element, prop: string): string | null {
  const style = el.getAttribute('style');
  if (style !== null) {
    for (const decl of style.split(';')) {
      const colon = decl.indexOf(':');
      if (colon < 0) continue;
      if (decl.slice(0, colon).trim().toLowerCase() === prop) {
        return decl.slice(colon + 1).trim();
      }
    }
  }
  return el.getAttribute(prop);
}

/** Resolve an inheritable property from the element or its ancestors. */
function inheritedProp(el: Element, prop: string): string | null {
  for (let cur: Element | null = el; cur !== null; cur = parentOf(cur)) {
    const v = ownProp(cur, prop);
    if (v !== null) return v;
  }
  return null;
}

function nearestId(el: Element): string | undefined {
  for (let cur: Element | null = el; cur !== null; cur = parentOf(cur)) {
    const id = cur.getAttribute('id');
    if (id !== null) return id;
  }
  return undefined;
}

function hasClip(el: Element): boolean {
  for (let cur: Element | null = el; cur !== null; cur = parentOf(cur)) {
    if (ownProp(cur, 'clip-path') !== null) return true;
  }
  return false;
}

function snippet(el: Element): string {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

/** Renderable stroked/filled shapes; text is handled by the font rules. */
const SHAPE_TAGS = new Set([
  'path',
  'line',
  'polyline',
  'polygon',
  'rect',
  'circle',
  'ellipse',
  'use',
]);

/**
 * Effective font size of a <text> element in pt: own style/attribute, else
 * inherited from ancestors. matplotlib mathtext puts sizes only on <tspan>
 * runs — fall back to the largest run (sub/superscript runs are
 * intentionally smaller and are not independently flagged).
 */
function effectiveFontSizePt(el: Element): number | null {
  const declared = parsePt(inheritedProp(el, 'font-size'));
  if (declared !== null) return declared;
  let max: number | null = null;
  for (const d of walk(el)) {
    if (d === el) continue;
    const v = parsePt(ownProp(d, 'font-size'));
    if (v !== null && (max === null || v > max)) max = v;
  }
  return max;
}

interface Ctx {
  profile: PublisherProfile;
  figureId: string | undefined;
  out: Diagnostic[];
  /** Inline source citation for the figures section. */
  src: string;
}

function target(ctx: Ctx, el: Element | null): DiagnosticTarget | undefined {
  const t: DiagnosticTarget = {};
  if (ctx.figureId !== undefined) t.figureId = ctx.figureId;
  const elementId = el === null ? undefined : nearestId(el);
  if (elementId !== undefined) t.elementId = elementId;
  return t.figureId !== undefined || t.elementId !== undefined ? t : undefined;
}

function checkFonts(doc: CanvasDocument, ctx: Ctx): void {
  const { minFontPt, maxFontPt } = ctx.profile.figures;
  if (minFontPt === null && maxFontPt === null) return;
  for (const el of walk(doc.root)) {
    if (el.localName !== 'text' || isInDefs(el)) continue;
    if ((el.textContent ?? '').trim() === '') continue;
    const size = effectiveFontSizePt(el);
    if (size === null) continue;
    if (minFontPt !== null && size < minFontPt) {
      ctx.out.push({
        id: 'fig.min-font',
        severity: 'error',
        surface: 'figure',
        message: `Text "${snippet(el)}" is ${fmtNum(size)}pt, below the journal's ${fmtNum(minFontPt)}pt minimum${ctx.src}`,
        target: target(ctx, el),
      });
    }
    if (maxFontPt !== null && size > maxFontPt) {
      ctx.out.push({
        id: 'fig.max-font',
        severity: 'error',
        surface: 'figure',
        message: `Text "${snippet(el)}" is ${fmtNum(size)}pt, above the journal's ${fmtNum(maxFontPt)}pt maximum${ctx.src}`,
        target: target(ctx, el),
      });
    }
  }
}

function checkLineWeights(doc: CanvasDocument, ctx: Ctx): void {
  const { min, max } = ctx.profile.figures.lineWeightPt;
  if (min === null && max === null) return;
  for (const el of walk(doc.root)) {
    if (!SHAPE_TAGS.has(el.localName) || isInDefs(el)) continue;
    const stroke = inheritedProp(el, 'stroke');
    if (stroke === null || stroke.toLowerCase() === 'none') continue;
    // SVG initial stroke-width is 1 when a stroked element states none.
    const width = parsePt(inheritedProp(el, 'stroke-width')) ?? 1;
    if (min !== null && width < min) {
      ctx.out.push({
        id: 'fig.line-weight',
        severity: 'error',
        surface: 'figure',
        message: `Stroke width ${fmtNum(width)}pt on <${el.localName}> is below the journal's ${fmtNum(min)}pt minimum${ctx.src}`,
        target: target(ctx, el),
      });
    } else if (max !== null && width > max) {
      ctx.out.push({
        id: 'fig.line-weight',
        severity: 'error',
        surface: 'figure',
        message: `Stroke width ${fmtNum(width)}pt on <${el.localName}> is above the journal's ${fmtNum(max)}pt maximum${ctx.src}`,
        target: target(ctx, el),
      });
    }
  }
}

function checkArtboardWidth(doc: CanvasDocument, ctx: Ctx): void {
  const presets = Object.entries(ctx.profile.figures.widthPresetsMm).filter(
    (entry): entry is [string, number] => entry[1] !== null,
  );
  if (presets.length === 0) return;
  const widthMm = doc.artboard.widthMm;
  if (widthMm === null) return;
  if (presets.some(([, mm]) => Math.abs(widthMm - mm) <= 1)) return;
  const stated = presets.map(([name, mm]) => `${name} ${fmtNum(mm)}mm`).join(', ');
  ctx.out.push({
    id: 'fig.artboard-width',
    severity: 'warning',
    surface: 'figure',
    message: `Artboard width ${fmtNum(widthMm)}mm matches none of the journal's width presets (${stated}) within 1mm${ctx.src}`,
    target: target(ctx, null),
  });
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Pixel width from a base64 PNG's IHDR chunk (header parse only — no image
 * libraries). Returns null whenever the data is not cheaply decodable.
 */
function pngPixelWidth(base64: string): number | null {
  const clean = base64.replace(/\s+/g, '');
  // 24 bytes cover signature + IHDR length/type + width/height = 32 b64 chars.
  const prefix = clean.slice(0, 32);
  if (prefix.length < 32) return null;
  let bin: string;
  try {
    bin = atob(prefix);
  } catch {
    return null;
  }
  if (bin.length < 24) return null;
  for (let i = 0; i < PNG_SIG.length; i++) {
    if (bin.charCodeAt(i) !== PNG_SIG[i]) return null;
  }
  if (bin.slice(12, 16) !== 'IHDR') return null;
  const w =
    ((bin.charCodeAt(16) << 24) |
      (bin.charCodeAt(17) << 16) |
      (bin.charCodeAt(18) << 8) |
      bin.charCodeAt(19)) >>>
    0;
  return w > 0 ? w : null;
}

const PNG_DATA_PREFIX = 'data:image/png;base64,';

function checkRasterDpi(doc: CanvasDocument, ctx: Ctx): void {
  const minDpi = ctx.profile.figures.formats.minDpi;
  if (minDpi === null) return;
  const mmPerUser = doc.artboard.mmPerUser ?? MM_PER_PT;
  for (const el of walk(doc.root)) {
    if (el.localName !== 'image' || isInDefs(el)) continue;
    const href = el.getAttribute('xlink:href') ?? el.getAttribute('href');
    if (href === null || !href.startsWith(PNG_DATA_PREFIX)) continue;
    const widthUser = parsePt(el.getAttribute('width'));
    if (widthUser === null || widthUser <= 0) continue;
    const pxWidth = pngPixelWidth(href.slice(PNG_DATA_PREFIX.length));
    if (pxWidth === null) continue;
    const widthIn = (widthUser * mmPerUser) / 25.4;
    if (widthIn <= 0) continue;
    const dpi = pxWidth / widthIn;
    if (dpi < minDpi) {
      ctx.out.push({
        id: 'fig.raster-dpi',
        severity: 'error',
        surface: 'figure',
        message: `Embedded PNG renders at ~${Math.round(dpi)} dpi (${pxWidth}px over ${fmtNum(widthUser * mmPerUser)}mm), below the journal's ${minDpi} dpi minimum${ctx.src}`,
        target: target(ctx, el),
      });
    }
  }
}

interface Trace {
  el: Element;
  color: string;
  dash: string;
  width: number;
}

function normalizeDash(raw: string | null): string {
  if (raw === null) return 'none';
  const v = raw.replace(/\s+/g, '');
  return v === '' || v.toLowerCase() === 'none' ? 'none' : v;
}

/** Axes-group ids: 'ax0'/'ax1' (SUNA gids), 'axes_1' (matplotlib default). */
const AXES_ID_RE = /^ax(?:es)?[_-]?\d*$/i;

/** Nearest ancestor <g> whose id looks like an axes group; outermost <g> otherwise. */
function axesGroupOf(el: Element, root: Element): Element {
  let outermostG: Element | null = null;
  for (let cur: Element | null = el; cur !== null; cur = parentOf(cur)) {
    if (cur.localName !== 'g') continue;
    const id = cur.getAttribute('id');
    if (id !== null && AXES_ID_RE.test(id)) return cur;
    outermostG = cur;
  }
  return outermostG ?? root;
}

/**
 * Data-trace candidates: stroked, unfilled path/line elements clipped to a
 * plotting area (matplotlib clips data artists to the axes; spines, ticks,
 * and legend samples are unclipped).
 */
function collectTraces(doc: CanvasDocument): Map<Element, Trace[]> {
  const groups = new Map<Element, Trace[]>();
  for (const el of walk(doc.root)) {
    if ((el.localName !== 'path' && el.localName !== 'line') || isInDefs(el)) continue;
    if (!hasClip(el)) continue;
    const stroke = inheritedProp(el, 'stroke');
    if (stroke === null || stroke.toLowerCase() === 'none') continue;
    const fill = inheritedProp(el, 'fill');
    if (fill !== null && fill.toLowerCase() !== 'none') continue;
    const trace: Trace = {
      el,
      color: stroke.trim().toLowerCase(),
      dash: normalizeDash(inheritedProp(el, 'stroke-dasharray')),
      width: parsePt(inheritedProp(el, 'stroke-width')) ?? 1,
    };
    const group = axesGroupOf(el, doc.root);
    const list = groups.get(group);
    if (list === undefined) groups.set(group, [trace]);
    else list.push(trace);
  }
  return groups;
}

function widthsSimilar(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.25 * Math.max(a, b), 0.1);
}

function checkColorSoleDelimiter(doc: CanvasDocument, ctx: Ctx): void {
  const rule = ctx.profile.figures.palette.colorAsSoleDelimiter;
  if (rule !== 'forbidden' && rule !== 'discouraged') return;
  for (const [group, traces] of collectTraces(doc)) {
    const colors = new Set<string>();
    let firstEl: Element | null = null;
    for (let i = 0; i < traces.length; i++) {
      for (let j = i + 1; j < traces.length; j++) {
        const a = traces[i];
        const b = traces[j];
        if (a === undefined || b === undefined) continue;
        if (a.color === b.color) continue;
        if (a.dash !== b.dash || !widthsSimilar(a.width, b.width)) continue;
        colors.add(a.color);
        colors.add(b.color);
        firstEl ??= a.el;
      }
    }
    if (firstEl === null) continue;
    const groupId = group.getAttribute('id');
    const where = groupId === null ? 'an axes group' : `group "${groupId}"`;
    const verb = rule === 'forbidden' ? 'forbids' : 'discourages';
    ctx.out.push({
      id: 'fig.color-sole-delimiter',
      severity: 'warning',
      surface: 'figure',
      message: `Traces in ${where} differ only by stroke color (${[...colors].join(', ')}) — same dash pattern and similar widths; the journal ${verb} color as the sole delimiter${ctx.src}`,
      target: target(ctx, firstEl),
    });
  }
}

const HEX_RE = /^#[0-9a-f]{6}$/;

function checkPalette(doc: CanvasDocument, ctx: Ctx): void {
  const suggested = ctx.profile.figures.palette.suggestedHex;
  if (suggested === null || suggested.length === 0) return;
  const allowed = new Set(suggested.map((h) => h.toLowerCase()));
  const flagged = new Map<string, Element>();
  for (const el of walk(doc.root)) {
    if (!SHAPE_TAGS.has(el.localName) || isInDefs(el)) continue;
    // Data traces only: clipped to a plotting area (never text or axes chrome).
    if (!hasClip(el)) continue;
    for (const prop of ['stroke', 'fill']) {
      const raw = inheritedProp(el, prop);
      if (raw === null) continue;
      const hex = raw.trim().toLowerCase();
      if (!HEX_RE.test(hex) || allowed.has(hex) || flagged.has(hex)) continue;
      flagged.set(hex, el);
    }
  }
  const stated =
    suggested.length <= 6 ? suggested.join(', ') : `${suggested.length} suggested colors`;
  for (const [hex, el] of flagged) {
    ctx.out.push({
      id: 'fig.palette',
      severity: 'warning',
      surface: 'figure',
      message: `Trace color ${hex} is not in the journal's suggested palette (${stated})${ctx.src}`,
      target: target(ctx, el),
    });
  }
}

/**
 * Check one figure SVG against the profile's stated figure rules. Flags
 * only — the SVG is never modified. Throws SvgParseError on unparseable
 * input (via the canvas engine).
 */
export function checkFigureSvg(
  svgText: string,
  profile: PublisherProfile,
  opts?: { figureId?: string },
): Diagnostic[] {
  const doc = new CanvasDocument(svgText, createBrowserDomAdapter());
  const ctx: Ctx = {
    profile,
    figureId: opts?.figureId,
    out: [],
    src: sourceSuffix(profile.figures.sources),
  };
  checkFonts(doc, ctx);
  checkLineWeights(doc, ctx);
  checkArtboardWidth(doc, ctx);
  checkRasterDpi(doc, ctx);
  checkColorSoleDelimiter(doc, ctx);
  checkPalette(doc, ctx);
  return ctx.out;
}
