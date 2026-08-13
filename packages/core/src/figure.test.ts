import { describe, expect, it } from 'vitest';
import { FigureDocumentSchema, OverlayOpSchema, type FigureDocument, type OverlayOp } from './figure';

const figureJson = {
  id: 'fig-cluster',
  caption: {
    title: 'Sky image of CLJ1001.',
    body: '**a**, JWST composite. **b**, X-ray contours.',
    credits: 'NASA/JWST',
    abbreviations: [{ abbr: 'WCS', def: 'world coordinate system' }],
  },
  namespace: 'main',
  widthPreset: 'double',
  panels: [{ letter: 'a' }, { letter: 'b', subLabels: ['i', 'ii'] }],
  provenance: {
    generator: { script: 'source/plot.py', entry: 'main', interpreter: 'python3' },
    baseSvgHash: '3f8a1c9be2d47a60513e9fd0c1b2a3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0',
    overlay: [
      { op: 'set-style', target: 'ax0.title', props: { 'font-size': '8pt' } },
      { op: 'translate', target: 'legend', dx: 4.5, dy: -2 },
      { op: 'reorder', target: 'ax0.line.halpha', mode: 'front' },
    ],
  },
} satisfies FigureDocument;

const opKind = (op: OverlayOp): string => {
  switch (op.op) {
    case 'set-style':
      return `style:${Object.keys(op.props).length}`;
    case 'set-text':
      return `text:${op.text}`;
    case 'set-attr':
      return `attr:${Object.keys(op.attrs).length}`;
    case 'translate':
      return `translate:${op.dx},${op.dy}`;
    case 'scale':
      return `scale:${op.sx},${op.sy}`;
    case 'delete':
      return `delete:${op.target}`;
    case 'reorder':
      return `reorder:${op.mode}`;
    case 'insert':
      return `insert:${op.parent ?? 'root'}`;
  }
};

describe('FigureDocumentSchema', () => {
  it('parses figure.json with a 3-op overlay', () => {
    const parsed = FigureDocumentSchema.parse(figureJson);
    expect(parsed).toEqual(figureJson);
    expect(parsed.provenance?.overlay).toHaveLength(3);
  });

  it('discriminates every overlay op exhaustively', () => {
    const parsed = FigureDocumentSchema.parse(figureJson);
    const kinds = (parsed.provenance?.overlay ?? []).map(opKind);
    expect(kinds).toEqual(['style:1', 'translate:4.5,-2', 'reorder:front']);
  });

  it('accepts null provenance for hand-drawn figures', () => {
    const parsed = FigureDocumentSchema.parse({ ...figureJson, provenance: null });
    expect(parsed.provenance).toBeNull();
  });

  it('rejects an unknown namespace', () => {
    const bad: unknown = { ...figureJson, namespace: 'appendix' };
    expect(FigureDocumentSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a multi-character panel letter', () => {
    const bad: unknown = { ...figureJson, panels: [{ letter: 'ab' }] };
    expect(FigureDocumentSchema.safeParse(bad).success).toBe(false);
  });
});

describe('OverlayOpSchema', () => {
  it('rejects an op with a bad discriminator', () => {
    const bad: unknown = { op: 'set-color', target: 'ax0.title', color: '#ff0000' };
    expect(OverlayOpSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a scale op missing its factors', () => {
    const bad: unknown = { op: 'scale', target: 'ax0' };
    expect(OverlayOpSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts an insert op without a parent target', () => {
    const parsed = OverlayOpSchema.parse({ op: 'insert', svg: '<circle r="2"/>' });
    if (parsed.op !== 'insert') throw new Error('expected insert op');
    expect(parsed.parent).toBeUndefined();
  });
});
