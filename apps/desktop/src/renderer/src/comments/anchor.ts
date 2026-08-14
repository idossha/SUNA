/**
 * Re-exports the shared W3C-style quote-anchoring algorithm from @suna/core.
 *
 * This module — not a local reimplementation — is what the section editor's
 * anchor decorations (comments/anchorExtension.ts) and the comment-creation
 * flow (state/comments.ts) import. The MCP `add_comment`/`list_comments`
 * tools (packages/agent/src/mcp/comments.ts) import the SAME functions
 * directly from @suna/core, so a comment anchored by an agent over raw file
 * text and one anchored by a human here over live editor text resolve to
 * identical spans given identical manuscript content — there is exactly one
 * implementation, shared by both sides.
 */
export { locate, makeAnchor, type AnchorRange, type QuoteAnchorLike } from '@suna/core'
