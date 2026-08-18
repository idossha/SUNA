import type { Comment } from '@suna/core'

/**
 * The comments outline: a chronological, one-line-per-thread index that sits
 * at the top of the rail so a reviewer can see every open thread at once and
 * jump to any of them — the cards themselves are anchor-aligned, so without
 * this the only way to find a thread is to scroll the whole document.
 *
 * Pure half here (ordering, labels, the collapse rule); the component and
 * its inactivity timer live in CommentsOutline.tsx.
 */

/** Above this many open threads the outline is collapsed by default — a long
 *  stack would saturate the rail it is supposed to summarise. */
export const OUTLINE_COLLAPSE_THRESHOLD = 6
/** Expanded-by-a-click outlines re-collapse after this much inactivity. */
export const OUTLINE_IDLE_MS = 4000
/** Longest one-line label before ellipsis. */
const LABEL_MAX = 52

export interface OutlineEntry {
  id: string
  /** 1-based position in the chronological list, shown as the row's index. */
  index: number
  /** One line: the anchored quote when there is one, else the comment body. */
  label: string
  createdAt: string
  detached: boolean
  /** Replies count, so a busy thread is visible without expanding it. */
  replies: number
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > LABEL_MAX ? `${flat.slice(0, LABEL_MAX - 1)}…` : flat
}

/**
 * Open threads, oldest first — chronological by creation, NOT by document
 * position: the outline is the review's timeline, while the cards already
 * carry the document order.
 */
export function outlineEntries(comments: readonly Comment[]): OutlineEntry[] {
  return comments
    .filter((c) => !c.resolved)
    .slice()
    .sort((a, b) =>
      a.createdAt === b.createdAt
        ? a.id.localeCompare(b.id)
        : a.createdAt.localeCompare(b.createdAt)
    )
    .map((c, i) => ({
      id: c.id,
      index: i + 1,
      label: oneLine(c.target.kind === 'section' ? c.target.anchor.quote : c.body) || oneLine(c.body),
      createdAt: c.createdAt,
      detached: c.detached,
      replies: c.replies.length
    }))
}

/** Collapsed by default only once the list would saturate the rail. */
export function outlineStartsCollapsed(count: number): boolean {
  return count > OUTLINE_COLLAPSE_THRESHOLD
}
