/**
 * Byte-level sniffing for files that claim to be PDFs (ARCHITECTURE §9,
 * "pdf-bytes.ts"). Two callers need it and neither may trust what it is told:
 * `downloadPdf` gets a `Content-Type` from a server that is often wrong (a
 * publisher's paywall interstitial is served as `application/pdf` more often
 * than anyone would like), and the local scanner gets a `.pdf` extension from
 * a filesystem that never checked it.
 *
 * Deliberately `Uint8Array`, not `Buffer`: @suna/bib must import unchanged
 * into the Electron main process and the standalone MCP server, so `node:*` is
 * off limits here. The host reads the bytes; this module only looks at them.
 */

/** `%PDF-1.7` etc. The magic is at offset 0 in a well-formed file. */
const PDF_MAGIC = '%PDF-';

/**
 * How far in the magic may sit. Zero in a clean file, but real-world PDFs
 * acquire a byte-order mark or a stray blank line from a proxy that rewrote
 * them, and every reader tolerates that, so we do too.
 */
export const PDF_MAGIC_WINDOW_BYTES = 1024;

/** The window `looksLikeHtml` reads: a login page declares itself long before this. */
export const HTML_SNIFF_WINDOW_BYTES = 4096;

/**
 * What the scanner reads off the front of a candidate file before re-scoring it
 * with byte-level evidence (ARCHITECTURE §15.5). 256 KB is enough
 * to cover the header, the XMP metadata packet and the first page's text of a
 * typical article, and small enough that reading twelve of them is free.
 */
export const PDF_SAMPLE_BYTES = 262_144;

/**
 * Markers of a page that is HTML, in the order they appear in nothing in
 * particular — the FIRST one found is what matters, not which one. Restricted
 * to structural tags: `<meta>` and `<title>` alone would also match the XMP
 * packet that publisher PDFs carry, and that packet is exactly what we want to
 * keep reading, not reject.
 */
const HTML_MARKERS = [
  '<!doctype html',
  '<html',
  '<head',
  '<body',
  '<script',
  '<frameset',
  '<meta http-equiv',
];

/** Chunked so a 50 MB download cannot blow the argument stack on the spread. */
const DECODE_CHUNK = 8192;

/**
 * Latin-1 decode of the first `limit` bytes — byte 0xE9 becomes 'é', every
 * byte becomes exactly one char, nothing throws on invalid UTF-8. That fidelity
 * is the point: the byte rules in `pdf-match.ts` search a PDF's raw bytes for a
 * DOI, and a UTF-8 decoder would mangle the binary stretches between the
 * readable ones (or replace them wholesale with U+FFFD) and could swallow an
 * identifier straddling the damage.
 *
 * A non-finite or negative `limit` yields '' rather than an error: this is a
 * sampler, and "sample nothing" is a coherent answer.
 */
export function asciiSample(bytes: Uint8Array, limit: number = PDF_SAMPLE_BYTES): string {
  const wanted = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const end = Math.min(bytes.length, wanted);
  let out = '';
  for (let offset = 0; offset < end; offset += DECODE_CHUNK) {
    const stop = Math.min(offset + DECODE_CHUNK, end);
    out += String.fromCharCode(...bytes.subarray(offset, stop));
  }
  return out;
}

/**
 * Does this blob carry the `%PDF-` magic in its first kilobyte? This is the
 * only test that says "these bytes are a PDF" — a `.pdf` extension and a
 * `Content-Type: application/pdf` header are both claims by parties with no
 * obligation to be right.
 */
export function isPdfBytes(bytes: Uint8Array): boolean {
  return asciiSample(bytes, PDF_MAGIC_WINDOW_BYTES).includes(PDF_MAGIC);
}

/**
 * Does this blob look like a web page rather than a document? Catches the
 * failure mode that makes `downloadPdf` worth guarding at all: a publisher's
 * sign-in form, a Cloudflare interstitial or a cookie wall handed back with a
 * 200 and a PDF filename.
 *
 * Whichever signature appears FIRST decides. A genuine PDF may well contain
 * markup — its XMP metadata packet is uncompressed XML, and an embedded file
 * attachment can be a whole HTML page — but never before its own `%PDF-`
 * magic, so ordering separates the two cases without a parser.
 */
export function looksLikeHtml(bytes: Uint8Array): boolean {
  const window = asciiSample(bytes, HTML_SNIFF_WINDOW_BYTES);
  const lower = window.toLowerCase();

  let firstMarker = -1;
  for (const marker of HTML_MARKERS) {
    const at = lower.indexOf(marker);
    if (at >= 0 && (firstMarker < 0 || at < firstMarker)) firstMarker = at;
  }
  if (firstMarker < 0) return false;

  const magic = window.slice(0, PDF_MAGIC_WINDOW_BYTES).indexOf(PDF_MAGIC);
  return magic < 0 || firstMarker < magic;
}
