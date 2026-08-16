import { z } from 'zod';

/**
 * comments.json — sidecar review data for humans AND agents.
 * RULE: comments are never inline prose markers. The manuscript text stays
 * clean and diffable; anchoring is by quote + context (W3C-style), so an
 * edit around the quote keeps the comment attached and deleting the quote
 * marks it `detached` rather than dropping it.
 */

/** W3C-style text-quote selector: exact quote plus surrounding context. */
export const CommentAnchorSchema = z.object({
  quote: z.string().min(1),
  /** Text immediately before the quote; '' when the quote starts the file. */
  prefix: z.string().default(''),
  /** Text immediately after the quote; '' when the quote ends the file. */
  suffix: z.string().default(''),
});
export type CommentAnchor = z.infer<typeof CommentAnchorSchema>;

/**
 * A comment on a passage of prose. Since feature-plan-7 §1 there is exactly
 * one prose file, so `path` is the manuscript's `manuscriptFile`
 * ("manuscript.md"); the `kind` is kept as 'section' so existing comments.json
 * files stay valid, and migration retargets old `sections/NN-name.md` paths.
 */
export const SectionCommentTargetSchema = z.object({
  kind: z.literal('section'),
  /** Manuscript-relative path, i.e. "manuscript.md". */
  path: z.string().min(1),
  anchor: CommentAnchorSchema,
});
export type SectionCommentTarget = z.infer<typeof SectionCommentTargetSchema>;

/** A comment on a figure, optionally on one SVG element inside it. */
export const FigureCommentTargetSchema = z.object({
  kind: z.literal('figure'),
  /** Figure directory id, e.g. "fig-spectrum". */
  figureId: z.string().min(1),
  /** Stable SVG element id / gid, e.g. "ax0.title". */
  elementId: z.string().min(1).optional(),
});
export type FigureCommentTarget = z.infer<typeof FigureCommentTargetSchema>;

/** A comment on the manuscript as a whole (no anchor). */
export const ManuscriptCommentTargetSchema = z.object({
  kind: z.literal('manuscript'),
});
export type ManuscriptCommentTarget = z.infer<typeof ManuscriptCommentTargetSchema>;

export const CommentTargetSchema = z.discriminatedUnion('kind', [
  SectionCommentTargetSchema,
  FigureCommentTargetSchema,
  ManuscriptCommentTargetSchema,
]);
export type CommentTarget = z.infer<typeof CommentTargetSchema>;

/** `model` is the agent's model id (e.g. "claude-opus-4"); absent for humans. */
export const CommentAuthorSchema = z.object({
  kind: z.enum(['human', 'agent']),
  name: z.string().min(1),
  model: z.string().min(1).optional(),
});
export type CommentAuthor = z.infer<typeof CommentAuthorSchema>;

export const ReplySchema = z.object({
  id: z.string().min(1),
  body: z.string().min(1),
  author: CommentAuthorSchema,
  createdAt: z.iso.datetime(),
});
export type Reply = z.infer<typeof ReplySchema>;

export const CommentSchema = z.object({
  id: z.string().min(1),
  target: CommentTargetSchema,
  body: z.string().min(1),
  author: CommentAuthorSchema,
  createdAt: z.iso.datetime(),
  resolved: z.boolean(),
  /** Set when re-anchoring failed. Detached comments are kept, never deleted. */
  detached: z.boolean().default(false),
  replies: z.array(ReplySchema).default([]),
});
export type Comment = z.infer<typeof CommentSchema>;

export const CommentsFileSchema = z.object({
  schemaVersion: z.literal(1),
  comments: z.array(CommentSchema),
});
export type CommentsFile = z.infer<typeof CommentsFileSchema>;

/** The file written when a project has no comments yet. */
export function emptyCommentsFile(): CommentsFile {
  return { schemaVersion: 1, comments: [] };
}
