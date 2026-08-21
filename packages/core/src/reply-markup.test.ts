import { describe, expect, it } from 'vitest';
import {
  CHANGE_MARK,
  REPLY_PREFIX,
  RESPONSE_ROLE_COLORS,
  crossReferenceSentence,
  hasQuotedChange,
  insertCrossReference,
  insertQuoteBlock,
  insideQuoteBlock,
  markChange,
  replyBlocks,
  replyDecorations,
  replyPlainText,
  replySpans,
  withReplyPrefix,
} from './reply-markup';

/** The span list rendered back as `text` per role — easier to assert on. */
function paint(source: string): { role: string; text: string }[] {
  return replySpans(source).map((span) => ({
    role: span.role,
    text: source.slice(span.from, span.to),
  }));
}

describe('the observed palette', () => {
  it('is the hex both example documents actually use', () => {
    // examples/peer-review/Findlay-NN-ReplyToRefs-final.docx and
    // reviews_TI-Toolbox.docx. Changing these changes what a co-author sees.
    expect(RESPONSE_ROLE_COLORS.comment).toBe('#000000');
    expect(RESPONSE_ROLE_COLORS.reply).toBe('#0432FF');
    expect(RESPONSE_ROLE_COLORS.change).toBe('#EE0000');
  });
});

describe('replySpans', () => {
  it('covers every character of the source with no holes', () => {
    const source = 'RE: Done.\n\n::quote\nOld text +++and new+++.\n::\n\ntail';
    const spans = replySpans(source);
    expect(spans[0]?.from).toBe(0);
    expect(spans[spans.length - 1]?.to).toBe(source.length);
    for (let i = 1; i < spans.length; i += 1) {
      expect(spans[i]!.from).toBe(spans[i - 1]!.to);
    }
    expect(spans.map((s) => source.slice(s.from, s.to)).join('')).toBe(source);
  });

  it('is empty for an empty reply', () => {
    expect(replySpans('')).toEqual([]);
  });

  it('paints a plain reply as one blue run', () => {
    expect(paint('RE: We have clarified this.')).toEqual([
      { role: 'reply', text: 'RE: We have clarified this.' },
    ]);
  });

  it('paints the fences as markers and the body as a quote', () => {
    const painted = paint('::quote\nSome manuscript prose.\n::');
    expect(painted).toEqual([
      { role: 'marker', text: '::quote' },
      { role: 'quote', text: '\nSome manuscript prose.\n' },
      { role: 'marker', text: '::' },
    ]);
  });

  it('paints +++ marked text red inside a quote', () => {
    const painted = paint('::quote\nOld. +++New.+++\n::');
    expect(painted).toContainEqual({ role: 'change', text: 'New.' });
    expect(painted.filter((p) => p.role === 'marker').map((p) => p.text)).toEqual([
      '::quote',
      CHANGE_MARK,
      CHANGE_MARK,
      '::',
    ]);
  });

  it('paints +++ marked text red outside a quote too', () => {
    expect(paint('RE: +++a promise+++ here')).toEqual([
      { role: 'reply', text: 'RE: ' },
      { role: 'marker', text: '+++' },
      { role: 'change', text: 'a promise' },
      { role: 'marker', text: '+++' },
      { role: 'reply', text: ' here' },
    ]);
  });

  it('leaves an unpaired +++ as literal text', () => {
    expect(paint('RE: a +++ b')).toEqual([{ role: 'reply', text: 'RE: a +++ b' }]);
  });

  it('runs an unclosed quote to the end rather than throwing', () => {
    const painted = paint('RE: see below\n\n::quote\nhalf typed');
    expect(painted[painted.length - 1]).toEqual({ role: 'quote', text: '\nhalf typed' });
  });

  it('dims an HTML note to a co-author', () => {
    expect(paint('RE: ok <!-- AJ check this -->')).toContainEqual({
      role: 'marker',
      text: '<!-- AJ check this -->',
    });
  });
});

describe('replyBlocks', () => {
  it('parses a reply written before this module existed as plain paragraphs', () => {
    expect(replyBlocks('First para.\n\nSecond para.')).toEqual([
      { kind: 'paragraph', level: 0, runs: [{ text: 'First para.', role: 'reply' }] },
      { kind: 'paragraph', level: 0, runs: [{ text: 'Second para.', role: 'reply' }] },
    ]);
  });

  it('keeps headings', () => {
    const blocks = replyBlocks('## Analysis\n\nBody.');
    expect(blocks[0]).toEqual({
      kind: 'heading',
      level: 2,
      runs: [{ text: 'Analysis', role: 'reply' }],
    });
  });

  it('produces the three voices of a real reply', () => {
    const source = [
      'RE: We agree, and have said so in the Discussion:',
      '',
      '::quote',
      'However, LIA in the hippocampus can occur independently of cortical slow waves.',
      '+++The results presented here show that this is indeed the case.+++',
      '::',
    ].join('\n');
    expect(replyBlocks(source)).toEqual([
      {
        kind: 'paragraph',
        level: 0,
        runs: [{ text: 'RE: We agree, and have said so in the Discussion:', role: 'reply' }],
      },
      {
        kind: 'quote',
        level: 0,
        runs: [
          {
            text: 'However, LIA in the hippocampus can occur independently of cortical slow waves.\n',
            role: 'quote',
          },
          {
            text: 'The results presented here show that this is indeed the case.',
            role: 'change',
          },
        ],
      },
    ]);
  });

  it('splits a quote block on blank lines and keeps every part a quote', () => {
    const blocks = replyBlocks('::quote\nOne.\n\nTwo.\n::');
    expect(blocks.map((b) => b.kind)).toEqual(['quote', 'quote']);
  });

  it('does not read a # inside a quote as a heading', () => {
    const blocks = replyBlocks('::quote\n# not our heading\n::');
    expect(blocks[0]?.kind).toBe('quote');
    expect(blocks[0]?.runs[0]?.text).toBe('# not our heading');
  });

  it('drops an HTML note from the exported prose', () => {
    const blocks = replyBlocks('RE: done <!-- ask AT -->');
    expect(blocks[0]?.runs.map((r) => r.text).join('')).toBe('RE: done');
  });

  it('yields nothing for an empty or whitespace-only reply', () => {
    expect(replyBlocks('')).toEqual([]);
    expect(replyBlocks('   \n\n  ')).toEqual([]);
    expect(replyBlocks('::quote\n\n::')).toEqual([]);
  });

  it('flattens to plain text for a prompt or a word count', () => {
    expect(replyPlainText('RE: done.\n\n::quote\n+++New line.+++\n::')).toBe(
      'RE: done.\n\nNew line.',
    );
  });

  it('reports whether a reply carries a quoted change', () => {
    expect(hasQuotedChange('RE: Done.')).toBe(false);
    expect(hasQuotedChange('RE: Done.\n\n::quote\nprose\n::')).toBe(true);
    expect(hasQuotedChange('RE: +++we will add this+++')).toBe(true);
  });
});

describe('quick insertions', () => {
  it('opens an empty scaffold with the caret on the body line', () => {
    const edit = insertQuoteBlock('', 0, 0);
    expect(edit.text).toBe('::quote\n\n::\n');
    expect(edit.text.slice(0, edit.selectionStart)).toBe('::quote\n');
    expect(edit.selectionEnd).toBe(edit.selectionStart);
  });

  it('wraps a selection and leaves it selected', () => {
    const source = 'RE: we now say the thing';
    const edit = insertQuoteBlock(source, 11, source.length);
    expect(edit.text).toBe('RE: we now\n\n::quote\nsay the thing\n::\n');
    expect(edit.text.slice(edit.selectionStart, edit.selectionEnd)).toBe('say the thing');
  });

  it('does not double the blank line before an existing paragraph break', () => {
    const edit = insertQuoteBlock('RE: as follows:\n\n', 17, 17);
    expect(edit.text).toBe('RE: as follows:\n\n::quote\n\n::\n');
  });

  it('marks a selection as changed and leaves the marks selected', () => {
    const edit = markChange('Old and new.', 8, 11);
    expect(edit.text).toBe('Old and +++new+++.');
    expect(edit.text.slice(edit.selectionStart, edit.selectionEnd)).toBe('+++new+++');
  });

  it('keeps whitespace at the edges of a sloppy selection outside the marks', () => {
    const edit = markChange('Old and new.', 7, 11);
    expect(edit.text).toBe('Old and +++new+++.');
  });

  it('toggles a marked selection back off', () => {
    const marked = markChange('Old and new.', 8, 11);
    const off = markChange(marked.text, marked.selectionStart, marked.selectionEnd);
    expect(off.text).toBe('Old and new.');
    expect(off.text.slice(off.selectionStart, off.selectionEnd)).toBe('new');
  });

  it('drops an empty pair with the caret between the marks', () => {
    const edit = markChange('RE: ', 4, 4);
    expect(edit.text).toBe('RE: ++++++');
    expect(edit.selectionStart).toBe(7);
    expect(edit.selectionEnd).toBe(7);
  });

  it('writes the cross-reference the PEER-REVIEW guide asks for', () => {
    expect(crossReferenceSentence(1, 3)).toBe(
      'This point is also addressed in our reply to Reviewer 1, point 3.',
    );
  });

  it('spaces a cross-reference off the surrounding text', () => {
    const edit = insertCrossReference('RE: agreed.', 11, 11, crossReferenceSentence(2, 4));
    expect(edit.text).toBe(
      'RE: agreed. This point is also addressed in our reply to Reviewer 2, point 4.',
    );
    expect(edit.selectionStart).toBe(edit.text.length);
  });

  it('adds the RE: opening to a fresh reply and moves the caret past it', () => {
    const edit = withReplyPrefix('W', 1);
    expect(edit.text).toBe(`${REPLY_PREFIX}W`);
    expect(edit.selectionStart).toBe(REPLY_PREFIX.length + 1);
  });

  it('never adds a second RE:', () => {
    expect(withReplyPrefix('RE: already', 5).text).toBe('RE: already');
    expect(withReplyPrefix('RE12: numbered', 5).text).toBe('RE12: numbered');
    expect(withReplyPrefix('re: lowercase', 5).text).toBe('re: lowercase');
  });
});

describe('replyDecorations', () => {
  it('conceals both fences and reveals them from anywhere in the block', () => {
    const source = 'RE: ok\n\n::quote\nprose\n::\n\ntail'
    const { hides } = replyDecorations(source);
    const fences = hides.filter((h) => h.revealTo - h.revealFrom > 10);
    expect(fences).toHaveLength(2);
    // Both fences share ONE reveal range — the whole block — so a caret in
    // the prose shows where the excerpt begins AND ends.
    expect(fences[0]!.revealFrom).toBe(fences[1]!.revealFrom);
    expect(fences[0]!.revealTo).toBe(fences[1]!.revealTo);
    expect(source.slice(fences[0]!.revealFrom, fences[0]!.revealTo)).toBe('::quote\nprose\n::');
  });

  it('swallows the newline beside each fence, so a hidden block leaves no blank line', () => {
    const source = '::quote\nprose\n::';
    const { hides } = replyDecorations(source);
    expect(source.slice(hides[0]!.from, hides[0]!.to)).toBe('::quote\n');
    expect(source.slice(hides[1]!.from, hides[1]!.to)).toBe('\n::');
  });

  it('never emits overlapping hides for an empty block', () => {
    const { hides } = replyDecorations('::quote\n::');
    for (let i = 1; i < hides.length; i += 1) {
      expect(hides[i]!.from).toBeGreaterThanOrEqual(hides[i - 1]!.to);
    }
  });

  it('hides each change mark and reveals the pair together', () => {
    const source = 'RE: +++new+++';
    const { hides } = replyDecorations(source);
    expect(hides.map((h) => source.slice(h.from, h.to))).toEqual(['+++', '+++']);
    expect(hides.every((h) => source.slice(h.revealFrom, h.revealTo) === '+++new+++')).toBe(true);
  });

  it('marks every line of a quote block for indenting, fences included', () => {
    const source = 'RE: ok\n\n::quote\none\ntwo\n::';
    const { quoteLineStarts } = replyDecorations(source);
    const lineStart = (needle: string): number => source.indexOf(needle);
    expect(quoteLineStarts).toEqual([
      lineStart('::quote'),
      lineStart('one'),
      lineStart('two'),
      source.lastIndexOf('::')
    ]);
  });

  it('indents nothing when there is no quote', () => {
    expect(replyDecorations('RE: Done.').quoteLineStarts).toEqual([]);
  });

  it('paints the same voices the span view does, minus the markers', () => {
    const source = '::quote\nold +++new+++\n::';
    const { marks } = replyDecorations(source);
    expect(marks.map((m) => [m.role, source.slice(m.from, m.to)])).toEqual([
      ['quote', '\nold '],
      ['change', 'new'],
      ['quote', '\n']
    ]);
  });

  it('treats an unclosed block as running to the end', () => {
    const source = 'RE: ok\n\n::quote\nstill typing';
    const { hides, quoteLineStarts } = replyDecorations(source);
    expect(hides).toHaveLength(1);
    expect(hides[0]!.revealTo).toBe(source.length);
    expect(quoteLineStarts).toHaveLength(2);
  });
});

describe('insideQuoteBlock', () => {
  const source = 'RE: ok\n\n::quote\nprose\n::\n\ntail';

  it('is false in the reply and true in the excerpt', () => {
    expect(insideQuoteBlock(source, 2)).toBe(false);
    expect(insideQuoteBlock(source, source.indexOf('prose') + 2)).toBe(true);
    expect(insideQuoteBlock(source, source.indexOf('tail') + 2)).toBe(false);
  });

  it('counts both fences as inside — `::` there is the block, not a trigger', () => {
    expect(insideQuoteBlock(source, source.indexOf('::quote') + 3)).toBe(true);
    expect(insideQuoteBlock(source, source.lastIndexOf('::') + 1)).toBe(true);
  });

  it('is false in an empty reply, which is where the trigger has to fire', () => {
    expect(insideQuoteBlock('', 0)).toBe(false);
  });

  it('stays true after an unclosed fence', () => {
    expect(insideQuoteBlock('::quote\nhalf typed', 12)).toBe(true);
  });
});
