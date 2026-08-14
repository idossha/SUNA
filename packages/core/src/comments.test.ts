import { describe, expect, it } from 'vitest';
import {
  CommentSchema,
  CommentTargetSchema,
  CommentsFileSchema,
  emptyCommentsFile,
  type CommentsFile,
} from './comments';

const sectionComment = {
  id: 'c-2026-08-14-a1b2',
  target: {
    kind: 'section',
    path: 'sections/02-results.md',
    anchor: {
      quote: 'best-fit centroid of 6563.3',
      prefix: '…with a ',
      suffix: ' Å and σ…',
    },
  },
  body: 'Should this be the vacuum wavelength?',
  author: { kind: 'human', name: 'Ada' },
  createdAt: '2026-08-14T21:03:00Z',
  resolved: false,
  detached: false,
  replies: [
    {
      id: 'r-1',
      body: 'Air, matching the instrument docs.',
      author: { kind: 'agent', name: 'Reviewer', model: 'claude-opus-4' },
      createdAt: '2026-08-14T21:20:00Z',
    },
  ],
};

describe('CommentsFileSchema', () => {
  it('parses a valid comments file with a nested reply', () => {
    const file = CommentsFileSchema.parse({ schemaVersion: 1, comments: [sectionComment] });
    const comment = file.comments[0];
    if (comment === undefined) throw new Error('expected a comment');
    expect(comment.replies[0]?.author).toEqual({
      kind: 'agent',
      name: 'Reviewer',
      model: 'claude-opus-4',
    });
    if (comment.target.kind !== 'section') throw new Error('expected a section target');
    expect(comment.target.anchor.quote).toBe('best-fit centroid of 6563.3');
  });

  it('parses the empty file emptyCommentsFile() produces', () => {
    const empty: CommentsFile = emptyCommentsFile();
    expect(CommentsFileSchema.parse(empty)).toEqual({ schemaVersion: 1, comments: [] });
  });

  it('rejects a schemaVersion other than 1', () => {
    expect(CommentsFileSchema.safeParse({ schemaVersion: 2, comments: [] }).success).toBe(false);
  });

  it('rejects a malformed reply inside an otherwise valid comment', () => {
    const bad = {
      schemaVersion: 1,
      comments: [
        {
          ...sectionComment,
          replies: [{ id: 'r-1', body: 'no author or timestamp' }],
        },
      ],
    };
    expect(CommentsFileSchema.safeParse(bad).success).toBe(false);
  });
});

describe('CommentTargetSchema', () => {
  it('rejects an unknown target kind', () => {
    const bad: unknown = { kind: 'table', tableId: 't1' };
    expect(CommentTargetSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts a figure target with and without an element id', () => {
    expect(CommentTargetSchema.parse({ kind: 'figure', figureId: 'fig-spectrum' })).toEqual({
      kind: 'figure',
      figureId: 'fig-spectrum',
    });
    expect(
      CommentTargetSchema.parse({
        kind: 'figure',
        figureId: 'fig-spectrum',
        elementId: 'ax0.title',
      }),
    ).toEqual({ kind: 'figure', figureId: 'fig-spectrum', elementId: 'ax0.title' });
  });

  it('accepts a whole-manuscript target with no anchor', () => {
    expect(CommentTargetSchema.parse({ kind: 'manuscript' })).toEqual({ kind: 'manuscript' });
  });

  it('requires a quote on a section anchor and defaults the context', () => {
    const parsed = CommentTargetSchema.parse({
      kind: 'section',
      path: 'sections/01-introduction.md',
      anchor: { quote: 'ram pressure' },
    });
    if (parsed.kind !== 'section') throw new Error('expected a section target');
    expect(parsed.anchor).toEqual({ quote: 'ram pressure', prefix: '', suffix: '' });
    expect(
      CommentTargetSchema.safeParse({
        kind: 'section',
        path: 'sections/01-introduction.md',
        anchor: { quote: '' },
      }).success,
    ).toBe(false);
  });
});

describe('CommentSchema', () => {
  it('defaults detached to false and replies to an empty list', () => {
    const parsed = CommentSchema.parse({
      id: 'c-1',
      target: { kind: 'manuscript' },
      body: 'Tighten the abstract.',
      author: { kind: 'human', name: 'Ada' },
      createdAt: '2026-08-14T21:03:00Z',
      resolved: false,
    });
    expect(parsed.detached).toBe(false);
    expect(parsed.replies).toEqual([]);
  });

  it('keeps a detached comment parseable — detaching never deletes', () => {
    const parsed = CommentSchema.parse({ ...sectionComment, detached: true });
    expect(parsed.detached).toBe(true);
  });

  it('rejects a non-ISO createdAt', () => {
    expect(CommentSchema.safeParse({ ...sectionComment, createdAt: 'yesterday' }).success).toBe(
      false,
    );
  });

  it('rejects an author kind outside human|agent', () => {
    const bad = { ...sectionComment, author: { kind: 'bot', name: 'x' } };
    expect(CommentSchema.safeParse(bad).success).toBe(false);
  });
});
