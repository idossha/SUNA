import type { CanvasDocument } from './document';

/**
 * Target resolution (canvas-engine.md §1):
 *
 * - Plain string        → id lookup ('ax0.legend').
 * - '#root'             → the document's root <svg> element (reserved; used
 *                         by set-artboard inverses so the root never needs a
 *                         minted id).
 * - '#<id>>nth:<k>'     → structural address: the k-th (0-based) element
 *                         child of the element with that id. `>nth:<k>`
 *                         segments chain for deeper paths
 *                         ('#ax0>nth:1>nth:0').
 */
export function resolveTarget(doc: CanvasDocument, target: string): Element | null {
  if (target === '#root') return doc.root;
  if (target.startsWith('#')) return resolveStructural(doc, target);
  return doc.getById(target);
}

function resolveStructural(doc: CanvasDocument, address: string): Element | null {
  const segments = address.slice(1).split('>');
  const anchorId = segments.shift();
  if (anchorId === undefined || anchorId === '') return null;
  let el: Element | null = anchorId === 'root' ? doc.root : doc.getById(anchorId);
  for (const segment of segments) {
    if (el === null) return null;
    const m = /^nth:(\d+)$/.exec(segment);
    if (!m) return null;
    const k = Number(m[1] ?? '');
    el = el.children[k] ?? null;
  }
  return el;
}

/**
 * Mint a fresh stable id ('suna-e<n>') onto an element that has none.
 * Commands that touch structurally-addressed elements call this so their
 * inverses, history entries, and overlays reference a real id.
 */
export function mintId(doc: CanvasDocument, el: Element): string {
  const id = doc.allocateId();
  el.setAttribute('id', id);
  doc.mintLog.push(id);
  doc.invalidate();
  return id;
}

export interface EnsuredId {
  id: string;
  minted: boolean;
}

/** Return the element's id, minting one if absent. */
export function ensureId(doc: CanvasDocument, el: Element): EnsuredId {
  const existing = el.getAttribute('id');
  if (existing !== null && existing !== '') return { id: existing, minted: false };
  return { id: mintId(doc, el), minted: true };
}
