/**
 * DOM adapter: the only place `@suna/canvas` touches a parser/serializer.
 *
 * The engine's round-trip invariant (canvas-engine.md §1) requires
 * `serialize(parse(svg))` to be byte-identical for untouched files. Two
 * standards-mandated behaviors would break that on real matplotlib exports:
 *
 * 1. XML attribute-value normalization turns literal newlines/tabs inside
 *    attribute values (matplotlib writes multi-line path `d` attributes)
 *    into spaces at parse time — irreversibly.
 * 2. XMLSerializer emits `&#xA;`/`&#x9;`/`&#xD;` for whitespace it finds in
 *    attribute values.
 *
 * The adapter therefore pre-encodes literal attribute whitespace as
 * character references before parsing (so the DOM holds the true
 * characters), and decodes the serializer's escapes back to literal
 * whitespace on output. Both passes touch only quoted attribute values
 * inside element tags — comments, PIs, DOCTYPEs, CDATA, and text are left
 * verbatim.
 *
 * Known, accepted limitation: a source file that spells attribute
 * whitespace as an explicit character reference (`&#10;`) round-trips to
 * the literal character instead. Matplotlib never does this.
 */

export interface DomAdapter {
  parse(svgText: string): Document;
  serialize(node: Node): string;
}

export class SvgParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SvgParseError';
  }
}

/**
 * Apply `fn` to every quoted attribute-value region of an XML/SVG string,
 * leaving all other content (tags, text, comments, PIs, DOCTYPE, CDATA)
 * byte-for-byte untouched.
 */
export function mapAttributeValues(text: string, fn: (value: string) => string): string {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, lt);
    if (text.startsWith('<?', lt)) {
      const e = text.indexOf('?>', lt);
      const end = e < 0 ? n : e + 2;
      out += text.slice(lt, end);
      i = end;
      continue;
    }
    if (text.startsWith('<!--', lt)) {
      const e = text.indexOf('-->', lt);
      const end = e < 0 ? n : e + 3;
      out += text.slice(lt, end);
      i = end;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const e = text.indexOf(']]>', lt);
      const end = e < 0 ? n : e + 3;
      out += text.slice(lt, end);
      i = end;
      continue;
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
      const end = Math.min(j + 1, n);
      out += text.slice(lt, end);
      i = end;
      continue;
    }
    // Element tag (start, end, or empty tag): scan to '>', respecting quotes.
    let j = lt;
    let quote: string | null = null;
    let segStart = lt;
    let closed = false;
    for (; j < n; j++) {
      const c = text[j];
      if (quote !== null) {
        if (c === quote) {
          out += fn(text.slice(segStart, j));
          out += c;
          segStart = j + 1;
          quote = null;
        }
      } else if (c === '"' || c === "'") {
        quote = c;
        out += text.slice(segStart, j + 1);
        segStart = j + 1;
      } else if (c === '>') {
        out += text.slice(segStart, j + 1);
        i = j + 1;
        closed = true;
        break;
      }
    }
    if (!closed) {
      out += text.slice(segStart);
      break;
    }
  }
  return out;
}

/** Protect literal attribute whitespace from XML attribute-value normalization. */
export function encodeAttributeWhitespace(text: string): string {
  return mapAttributeValues(text, (v) =>
    v.includes('\n') || v.includes('\t') || v.includes('\r')
      ? v.replaceAll('\r', '&#13;').replaceAll('\n', '&#10;').replaceAll('\t', '&#9;')
      : v,
  );
}

/**
 * Undo XMLSerializer's attribute-whitespace escapes. jsdom emits hex forms
 * (&#xA;), Chromium emits decimal (&#10;) — decode both.
 */
export function decodeAttributeWhitespace(text: string): string {
  return mapAttributeValues(text, (v) =>
    v.includes('&#')
      ? v
          .replaceAll('&#xA;', '\n')
          .replaceAll('&#x9;', '\t')
          .replaceAll('&#xD;', '\r')
          .replaceAll('&#10;', '\n')
          .replaceAll('&#9;', '\t')
          .replaceAll('&#13;', '\r')
      : v,
  );
}

const PARSERERROR_NS = 'http://www.mozilla.org/newlayout/xml/parsererror.xml';

function findParseError(doc: Document): string | null {
  const root = doc.documentElement as Element | null;
  if (!root) return 'empty document';
  if (root.localName === 'parsererror' || root.namespaceURI === PARSERERROR_NS) {
    return root.textContent ?? 'XML parse error';
  }
  // Browsers may nest the parsererror inside the returned root.
  const nested = root.getElementsByTagNameNS(PARSERERROR_NS, 'parsererror')[0];
  if (nested) return nested.textContent ?? 'XML parse error';
  return null;
}

/**
 * DomAdapter over the ambient `DOMParser`/`XMLSerializer` globals — the
 * browser/Electron renderer in production, jsdom's implementations under
 * vitest's jsdom environment.
 */
export function createBrowserDomAdapter(): DomAdapter {
  return {
    parse(svgText: string): Document {
      const doc = new DOMParser().parseFromString(
        encodeAttributeWhitespace(svgText),
        'image/svg+xml',
      );
      const error = findParseError(doc);
      if (error !== null) throw new SvgParseError(error);
      return doc;
    },
    serialize(node: Node): string {
      return decodeAttributeWhitespace(new XMLSerializer().serializeToString(node));
    },
  };
}
