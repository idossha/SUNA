import { describe, expect, it } from 'vitest';
import {
  HTML_SNIFF_WINDOW_BYTES,
  PDF_MAGIC_WINDOW_BYTES,
  asciiSample,
  isPdfBytes,
  looksLikeHtml,
} from './pdf-bytes.js';

/** Latin-1 encode — the exact inverse of what `asciiSample` decodes. */
function bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

const REAL_PDF = bytes(
  '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
);

const LOGIN_PAGE = bytes(
  '<!DOCTYPE html>\n<html lang="en">\n<head><title>Sign in to continue</title></head>\n' +
    '<body><form action="/login"><input name="password" type="password"></form></body>\n</html>\n',
);

describe('isPdfBytes', () => {
  it('accepts the %PDF- magic at offset 0', () => {
    expect(isPdfBytes(REAL_PDF)).toBe(true);
  });

  it('tolerates a byte-order mark or blank lines in front of the magic', () => {
    expect(isPdfBytes(bytes('\xef\xbb\xbf\n\n%PDF-1.4\n1 0 obj\n'))).toBe(true);
  });

  it('refuses magic that only turns up past the first kilobyte', () => {
    const buried = bytes(`${' '.repeat(PDF_MAGIC_WINDOW_BYTES)}%PDF-1.4\n`);
    expect(isPdfBytes(buried)).toBe(false);
  });

  it('refuses an HTML page handed back with a PDF filename', () => {
    expect(isPdfBytes(LOGIN_PAGE)).toBe(false);
  });

  it('refuses an empty body', () => {
    expect(isPdfBytes(new Uint8Array(0))).toBe(false);
  });

  it('is not fooled by a lowercase spelling — the magic is literal', () => {
    expect(isPdfBytes(bytes('%pdf-1.7\n'))).toBe(false);
  });
});

describe('looksLikeHtml', () => {
  it('catches a publisher login page', () => {
    expect(looksLikeHtml(LOGIN_PAGE)).toBe(true);
  });

  it('catches an interstitial that leads with whitespace and no doctype', () => {
    const wall = bytes('\n\n  <html><body>Checking your browser before accessing...</body></html>');
    expect(looksLikeHtml(wall)).toBe(true);
  });

  it('catches a bare fragment with only a <script> redirect', () => {
    expect(looksLikeHtml(bytes('<script>location="/cookieAbsent"</script>'))).toBe(true);
  });

  it('leaves a real PDF alone even when it embeds a whole HTML page', () => {
    const withAttachment = bytes(
      `${'%PDF-1.7\n1 0 obj\n<< /Type /EmbeddedFile >>\nstream\n'}<html><body>supplement</body></html>\nendstream\n`,
    );
    expect(looksLikeHtml(withAttachment)).toBe(false);
    expect(isPdfBytes(withAttachment)).toBe(true);
  });

  it('leaves the uncompressed XMP packet a publisher PDF carries alone', () => {
    const xmp = bytes(
      '%PDF-1.6\n<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description>' +
        '<prism:doi>10.1086/151605</prism:doi></rdf:Description></rdf:RDF></x:xmpmeta>\n',
    );
    expect(looksLikeHtml(xmp)).toBe(false);
  });

  it('still flags markup that arrives before the magic', () => {
    const wrapped = bytes('<html><body>error</body></html>\n%PDF-1.4\n');
    expect(looksLikeHtml(wrapped)).toBe(true);
  });

  it('says nothing about bytes with no markup at all', () => {
    expect(looksLikeHtml(bytes('plain text, no tags here'))).toBe(false);
    expect(looksLikeHtml(new Uint8Array(0))).toBe(false);
  });

  it('does not look past its window', () => {
    const late = bytes(`${'x'.repeat(HTML_SNIFF_WINDOW_BYTES)}<html>`);
    expect(looksLikeHtml(late)).toBe(false);
  });
});

describe('asciiSample', () => {
  it('round-trips latin-1 text, high bytes included', () => {
    expect(asciiSample(bytes('Jáchym, Ramírez © 1972'), 64)).toBe('Jáchym, Ramírez © 1972');
  });

  it('stops at the limit', () => {
    expect(asciiSample(bytes('%PDF-1.7 and then some'), 5)).toBe('%PDF-');
  });

  it('returns everything when the limit exceeds the buffer', () => {
    expect(asciiSample(bytes('short'), 4096)).toBe('short');
  });

  it('treats a zero, negative or non-finite limit as "sample nothing"', () => {
    expect(asciiSample(REAL_PDF, 0)).toBe('');
    expect(asciiSample(REAL_PDF, -10)).toBe('');
    expect(asciiSample(REAL_PDF, Number.NaN)).toBe('');
  });

  it('keeps every byte distinct, so a DOI straddling binary noise survives', () => {
    const noisy = new Uint8Array([0x00, 0xff, 0x80, ...bytes('10.1086/151605'), 0xfe]);
    expect(asciiSample(noisy, 64)).toContain('10.1086/151605');
  });

  it('decodes far past one spread-chunk without blowing the stack', () => {
    const big = new Uint8Array(300_000).fill(0x61);
    const sample = asciiSample(big);
    expect(sample.length).toBe(262_144);
    expect(sample.endsWith('a')).toBe(true);
  });
});
