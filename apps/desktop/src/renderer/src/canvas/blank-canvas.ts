/**
 * Blank-canvas affordance (DECISIONS 2026-08-14): a fresh artboard shows a
 * centered drop hint until the document has any drawable content, then it
 * disappears. `ElementLike` mirrors panel-letters.ts's structural DOM shape
 * so this is unit-testable against plain object fixtures, no DOM required.
 */

export interface ElementLike {
  readonly localName: string
  readonly children: ArrayLike<ElementLike>
}

/**
 * Non-drawable top-level tags: bookkeeping/definitions that render nothing
 * on their own. Everything else (rect, path, circle, text, image, a plain
 * or imported <g>, …) counts as content.
 */
const NON_DRAWABLE_TAGS = new Set(['defs', 'metadata', 'title', 'desc', 'style'])

/** True once the artboard root has any top-level child that is not pure bookkeeping. */
export function hasDrawableContent(root: ElementLike): boolean {
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i]
    if (child && !NON_DRAWABLE_TAGS.has(child.localName.toLowerCase())) return true
  }
  return false
}
