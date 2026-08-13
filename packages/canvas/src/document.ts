import { SvgParseError, type DomAdapter } from './dom';

export interface ViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface Artboard {
  widthMm: number | null;
  heightMm: number | null;
  viewBox: ViewBox | null;
  /** Physical size of one root user unit; null when underivable. */
  mmPerUser: number | null;
}

/** 1 pt = 0.3528 mm (canvas-engine.md §2); unitless lengths are px @ 96 dpi. */
const MM_PER_UNIT: Record<string, number> = {
  '': 25.4 / 96,
  px: 25.4 / 96,
  pt: 0.3528,
  pc: 25.4 / 6,
  mm: 1,
  cm: 10,
  in: 25.4,
};

export function lengthToMm(raw: string | null): number | null {
  if (raw === null) return null;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-z%]*)\s*$/.exec(raw);
  if (!m) return null;
  const value = Number(m[1] ?? '');
  const unit = m[2] ?? '';
  const perUnit = MM_PER_UNIT[unit];
  if (perUnit === undefined || Number.isNaN(value)) return null;
  return value * perUnit;
}

function parseViewBox(raw: string | null): ViewBox | null {
  if (raw === null) return null;
  const parts = raw.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return null;
  const [minX, minY, width, height] = parts as [number, number, number, number];
  return { minX, minY, width, height };
}

interface Envelope {
  prologue: string;
  epilogue: string;
}

/**
 * Skip a non-element construct (PI, comment, CDATA, DOCTYPE) starting at
 * `lt`; returns the index just past it, or -1 if `lt` starts an element tag.
 */
function skipNonElement(text: string, lt: number): number {
  const n = text.length;
  if (text.startsWith('<?', lt)) {
    const e = text.indexOf('?>', lt);
    return e < 0 ? n : e + 2;
  }
  if (text.startsWith('<!--', lt)) {
    const e = text.indexOf('-->', lt);
    return e < 0 ? n : e + 3;
  }
  if (text.startsWith('<![CDATA[', lt)) {
    const e = text.indexOf(']]>', lt);
    return e < 0 ? n : e + 3;
  }
  if (text.startsWith('<!', lt)) {
    // DOCTYPE, possibly with an internal subset in [ ].
    let j = lt;
    let depth = 0;
    for (; j < n; j++) {
      const c = text[j];
      if (c === '[') depth++;
      else if (c === ']') depth--;
      else if (c === '>' && depth === 0) break;
    }
    return Math.min(j + 1, n);
  }
  return -1;
}

/**
 * Scan an element tag starting at `lt` (quote-aware — '>' may appear inside
 * attribute values). Returns the index just past the closing '>' and whether
 * the tag was self-closing.
 */
function scanElementTag(text: string, lt: number): { end: number; selfClosing: boolean } | null {
  const n = text.length;
  let quote: string | null = null;
  let lastMeaningful = '';
  for (let j = lt + 1; j < n; j++) {
    const c = text[j] as string;
    if (quote !== null) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '>') return { end: j + 1, selfClosing: lastMeaningful === '/' };
    if (!/\s/.test(c)) lastMeaningful = c;
  }
  return null;
}

/**
 * Capture everything before the root element's start tag (XML declaration,
 * DOCTYPE, leading comments/PIs) and everything after its end tag (trailing
 * whitespace/comments/PIs) verbatim. XMLSerializer drops or mangles these,
 * so serialize() re-splices the original bytes around the root element.
 */
function splitEnvelope(text: string): Envelope {
  const n = text.length;
  // 1. Find the root element's start.
  let i = 0;
  let rootStart = -1;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    const skipped = skipNonElement(text, lt);
    if (skipped >= 0) {
      i = skipped;
      continue;
    }
    rootStart = lt;
    break;
  }
  if (rootStart < 0) return { prologue: '', epilogue: '' };

  // 2. Walk element tags, tracking depth, to find the root element's end.
  let rootEnd = -1;
  let depth = 0;
  i = rootStart;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    const skipped = skipNonElement(text, lt);
    if (skipped >= 0) {
      i = skipped;
      continue;
    }
    const isEndTag = text[lt + 1] === '/';
    const tag = scanElementTag(text, lt);
    if (tag === null) break; // malformed; parse() will report it
    if (isEndTag) depth -= 1;
    else if (!tag.selfClosing) depth += 1;
    i = tag.end;
    if (depth === 0) {
      rootEnd = tag.end;
      break;
    }
  }
  return {
    prologue: text.slice(0, rootStart),
    epilogue: rootEnd < 0 ? '' : text.slice(rootEnd),
  };
}

/**
 * Facade over a parsed SVG document (canvas-engine.md §1). The document IS
 * the DOM: nothing is normalized, and serialize() of an untouched document
 * is byte-identical to the source text.
 */
export class CanvasDocument {
  readonly dom: Document;
  readonly root: Element;
  readonly adapter: DomAdapter;

  /**
   * Ids minted during the current top-level dispatch (reset per dispatch).
   * Batch rollback strips these again so a failed batch leaves the document
   * byte-identical (inverses restore attributes, not mints).
   */
  readonly mintLog: string[] = [];

  private readonly prologue: string;
  private readonly epilogue: string;
  private idIndex: Map<string, Element> | null = null;
  private mintCounter = 0;

  constructor(svgText: string, adapter: DomAdapter) {
    this.adapter = adapter;
    const { prologue, epilogue } = splitEnvelope(svgText);
    this.prologue = prologue;
    this.epilogue = epilogue;
    this.dom = adapter.parse(svgText);
    const root = this.dom.documentElement as Element | null;
    if (!root || root.localName !== 'svg') {
      throw new SvgParseError(`root element is <${root?.localName ?? 'nothing'}>, expected <svg>`);
    }
    this.root = root;
  }

  /** Id lookup via a lazily (re)built index; first occurrence wins on duplicates. */
  getById(id: string): Element | null {
    return this.index().get(id) ?? null;
  }

  /** Drop the id index; commands call this after every mutation. */
  invalidate(): void {
    this.idIndex = null;
  }

  /** Allocate a fresh 'suna-e<n>' id, unique within the document. */
  allocateId(): string {
    let id: string;
    do {
      this.mintCounter += 1;
      id = `suna-e${this.mintCounter}`;
    } while (this.index().has(id));
    return id;
  }

  serialize(): string {
    return this.prologue + this.adapter.serialize(this.root) + this.epilogue;
  }

  get artboard(): Artboard {
    const widthMm = lengthToMm(this.root.getAttribute('width'));
    const heightMm = lengthToMm(this.root.getAttribute('height'));
    const viewBox = parseViewBox(this.root.getAttribute('viewBox'));
    const mmPerUser =
      widthMm !== null && viewBox !== null && viewBox.width !== 0 ? widthMm / viewBox.width : null;
    return { widthMm, heightMm, viewBox, mmPerUser };
  }

  private index(): Map<string, Element> {
    if (this.idIndex === null) {
      const map = new Map<string, Element>();
      const walk = (el: Element): void => {
        const id = el.getAttribute('id');
        if (id !== null && !map.has(id)) map.set(id, el);
        for (const child of el.children) walk(child);
      };
      walk(this.root);
      this.idIndex = map;
    }
    return this.idIndex;
  }
}
