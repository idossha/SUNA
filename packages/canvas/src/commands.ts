import {
  CanvasCommandSchema,
  type AlignCommand,
  type BatchCommand,
  type CanvasCommand,
  type CommandErrorCode,
  type CommandFailure,
  type CommandResult,
  type CommandSuccess,
  type DistributeCommand,
  type GroupCommand,
  type InsertCommand,
  type MatrixTuple,
  type RemoveCommand,
  type ReorderCommand,
  type ReparentCommand,
  type SetArtboardCommand,
  type SetAttrsCommand,
  type SetStyleCommand,
  type SetTextCommand,
  type TransformCommand,
  type TranslateCommand,
  type UngroupCommand,
} from '@suna/core';
import { SVGPathData } from 'svg-pathdata';
import {
  applyToPoint,
  compose,
  fromDefinition,
  fromTransformAttribute,
  translate as translationMatrix,
  type Matrix,
} from 'transformation-matrix';
import { ensureId, resolveTarget } from './address';
import type { CanvasDocument } from './document';
import { SvgParseError } from './dom';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

// ---------------------------------------------------------------------------
// Result helpers

function ok(inverse: CanvasCommand, affected: string[]): CommandSuccess {
  return { ok: true, inverse, affected };
}

function fail(code: CommandErrorCode, message: string): CommandFailure {
  return { ok: false, error: { code, message }, affected: [] };
}

function targetNotFound(target: string): CommandFailure {
  return fail('target-not-found', `no element matches target "${target}"`);
}

// ---------------------------------------------------------------------------
// Target resolution

interface ResolvedTarget {
  el: Element;
  /** Post-mint id, or '#root' for the root element (never minted onto). */
  id: string;
}

/**
 * Resolve every target with zero side effects; returns the first unresolvable
 * target string on a miss. Commands resolve first, run every validation, and
 * only then mint ids via `withIds` — so a failing command never mutates the
 * document (not even by minting an id onto a structurally-addressed element).
 */
function resolveEls(doc: CanvasDocument, targets: readonly string[]): Element[] | string {
  const els: Element[] = [];
  for (const target of targets) {
    const el = resolveTarget(doc, target);
    if (el === null) return target;
    els.push(el);
  }
  return els;
}

/**
 * Commit point of target resolution: ensure each element has a real id —
 * structurally-addressed elements get a minted 'suna-e<n>' recorded in
 * `affected` via the returned id. Call only after all validation has passed.
 */
function withIds(doc: CanvasDocument, els: readonly Element[]): ResolvedTarget[] {
  return els.map((el) => ({
    el,
    id: el === doc.root ? '#root' : ensureId(doc, el).id,
  }));
}

/** Resolve-and-mint for commands with no validation beyond resolution. */
function resolveOne(doc: CanvasDocument, target: string): ResolvedTarget | string {
  const els = resolveEls(doc, [target]);
  if (typeof els === 'string') return els;
  return withIds(doc, els)[0] as ResolvedTarget;
}

function currentId(doc: CanvasDocument, el: Element, fallback: string): string {
  if (el === doc.root) return '#root';
  return el.getAttribute('id') ?? fallback;
}

// ---------------------------------------------------------------------------
// Transform helpers

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function tupleToMatrix(t: MatrixTuple): Matrix {
  return { a: t[0], b: t[1], c: t[2], d: t[3], e: t[4], f: t[5] };
}

function isIdentity(m: Matrix): boolean {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
}

const fmtNumber = (n: number): string => String(n === 0 ? 0 : n);

function formatMatrix(m: Matrix): string {
  return `matrix(${fmtNumber(m.a)}, ${fmtNumber(m.b)}, ${fmtNumber(m.c)}, ${fmtNumber(m.d)}, ${fmtNumber(m.e)}, ${fmtNumber(m.f)})`;
}

/** Parse a transform attribute into a single matrix. Throws on bad syntax. */
function parseTransformAttribute(raw: string): Matrix {
  const descriptors = fromTransformAttribute(raw);
  if (descriptors.length === 0) return IDENTITY;
  return compose(fromDefinition(descriptors));
}

function readTransform(el: Element): Matrix {
  const raw = el.getAttribute('transform');
  if (raw === null || raw.trim() === '') return IDENTITY;
  return parseTransformAttribute(raw);
}

/**
 * Write a composed transform back. A resulting exact identity removes the
 * attribute (so translating an element back to where it started restores the
 * original bytes) — but only when the attribute is absent or last in the
 * attribute list, where a later undo's re-add lands on the same position.
 * A transform sitting mid-list is updated in place instead: removal plus
 * re-add-at-end would shift attribute order and break byte-exact undo.
 */
function writeTransform(el: Element, m: Matrix): void {
  if (isIdentity(m)) {
    const attrs = el.attributes;
    const last = attrs.length > 0 ? attrs[attrs.length - 1] : null;
    if (!el.hasAttribute('transform') || last?.name === 'transform') {
      el.removeAttribute('transform');
      return;
    }
  }
  el.setAttribute('transform', formatMatrix(m));
}

/**
 * Inverse for transform-writing commands: restore each element's prior
 * transform attribute verbatim (null deletes). Numeric re-composition cannot
 * reproduce matplotlib's rotate()/translate() spellings byte-for-byte, and
 * floating-point round-trips are not exact — the captured string is.
 */
function transformRestoreInverse(
  restores: ReadonlyArray<{ id: string; prior: string | null }>,
): CanvasCommand {
  const commands: CanvasCommand[] = [...restores]
    .reverse()
    .map(({ id, prior }) => ({ kind: 'set-attrs', target: id, attrs: { transform: prior } }));
  return commands.length === 1 ? (commands[0] as CanvasCommand) : { kind: 'batch', commands };
}

// ---------------------------------------------------------------------------
// Attribute-derived geometry (no live layout — see canvas-engine.md §8)

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function numAttr(el: Element, name: string, fallback = 0): number {
  const raw = el.getAttribute(name);
  if (raw === null) return fallback;
  const v = Number.parseFloat(raw);
  return Number.isNaN(v) ? fallback : v;
}

function localBBox(el: Element): BBox | null {
  switch (el.localName) {
    case 'rect':
    case 'image':
    case 'use':
    case 'foreignObject': {
      const x = numAttr(el, 'x');
      const y = numAttr(el, 'y');
      return { minX: x, minY: y, maxX: x + numAttr(el, 'width'), maxY: y + numAttr(el, 'height') };
    }
    case 'circle': {
      const cx = numAttr(el, 'cx');
      const cy = numAttr(el, 'cy');
      const r = numAttr(el, 'r');
      return { minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r };
    }
    case 'ellipse': {
      const cx = numAttr(el, 'cx');
      const cy = numAttr(el, 'cy');
      const rx = numAttr(el, 'rx');
      const ry = numAttr(el, 'ry');
      return { minX: cx - rx, minY: cy - ry, maxX: cx + rx, maxY: cy + ry };
    }
    case 'line': {
      const x1 = numAttr(el, 'x1');
      const y1 = numAttr(el, 'y1');
      const x2 = numAttr(el, 'x2');
      const y2 = numAttr(el, 'y2');
      return {
        minX: Math.min(x1, x2),
        minY: Math.min(y1, y2),
        maxX: Math.max(x1, x2),
        maxY: Math.max(y1, y2),
      };
    }
    case 'polyline':
    case 'polygon': {
      const nums = (el.getAttribute('points') ?? '')
        .trim()
        .split(/[\s,]+/)
        .map(Number)
        .filter((n) => !Number.isNaN(n));
      if (nums.length < 4) return null;
      const xs = nums.filter((_, i) => i % 2 === 0);
      const ys = nums.filter((_, i) => i % 2 === 1);
      return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
      };
    }
    case 'path': {
      const d = el.getAttribute('d');
      if (d === null) return null;
      try {
        const b = new SVGPathData(d).getBounds();
        return { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
      } catch {
        return null;
      }
    }
    default:
      // g, text, tspan, … need real layout (getBBox); deferred per spec §8.
      return null;
  }
}

/** Attribute-derived bbox in the parent's coordinate space (own transform applied). */
function attrBBox(el: Element): BBox | null {
  const local = localBBox(el);
  if (local === null) return null;
  const raw = el.getAttribute('transform');
  if (raw === null || raw.trim() === '') return local;
  let m: Matrix;
  try {
    m = parseTransformAttribute(raw);
  } catch {
    return null;
  }
  const corners = [
    applyToPoint(m, { x: local.minX, y: local.minY }),
    applyToPoint(m, { x: local.maxX, y: local.minY }),
    applyToPoint(m, { x: local.minX, y: local.maxY }),
    applyToPoint(m, { x: local.maxX, y: local.maxY }),
  ];
  return {
    minX: Math.min(...corners.map((p) => p.x)),
    minY: Math.min(...corners.map((p) => p.y)),
    maxX: Math.max(...corners.map((p) => p.x)),
    maxY: Math.max(...corners.map((p) => p.y)),
  };
}

// ---------------------------------------------------------------------------
// Style helpers

type StyleEntries = Array<[string, string]>;

function parseStyleEntries(raw: string): StyleEntries {
  const entries: StyleEntries = [];
  for (const part of raw.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const name = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).trim();
    if (name !== '') entries.push([name, value]);
  }
  return entries;
}

function serializeStyleEntries(entries: StyleEntries): string {
  return entries.map(([name, value]) => `${name}: ${value}`).join('; ');
}

// ---------------------------------------------------------------------------
// Structure helpers

function elementIndex(parent: Element, el: Element): number {
  return Array.prototype.indexOf.call(parent.children, el);
}

function isWhitespaceText(node: Node): boolean {
  return node.nodeType === 3 /* TEXT_NODE */ && /^\s+$/.test(node.nodeValue ?? '');
}

/**
 * The contiguous run of whitespace-only text nodes immediately preceding a
 * node, in document order. Capture sites (remove, ungroup, attribute-change
 * capture) consume the whole run so that reordering operations which leave
 * adjacent whitespace runs behind still undo byte-exactly.
 */
function leadingWhitespaceRun(node: Node): Text[] {
  const run: Text[] = [];
  let p = node.previousSibling;
  while (p !== null && isWhitespaceText(p)) {
    run.unshift(p as Text);
    p = p.previousSibling;
  }
  return run;
}

function textOf(run: readonly Text[]): string {
  return run.map((n) => n.nodeValue ?? '').join('');
}

/**
 * Insert nodes at an element-child index. Every element owns its leading
 * whitespace run (all structural commands move / capture the run together
 * with the element), so "at element index k" means before the k-th element's
 * whole run — and appending means before the parent's trailing run.
 */
function insertNodesAtElementIndex(parent: Element, nodes: Node[], index: number | undefined): void {
  let ref: Node | null = index !== undefined ? (parent.children[index] ?? null) : null;
  if (ref !== null) {
    const run = leadingWhitespaceRun(ref);
    if (run.length > 0) ref = run[0] as Text;
  } else {
    let last = parent.lastChild;
    let runStart: Node | null = null;
    while (last !== null && isWhitespaceText(last)) {
      runStart = last;
      last = last.previousSibling;
    }
    ref = runStart;
  }
  for (const node of nodes) parent.insertBefore(node, ref);
}

/**
 * Move an element to an element-child index of `parent`, taking its leading
 * whitespace run along. Keeping element↔indentation pairing intact under
 * every structural move is what makes reorder/reparent undo byte-exact in
 * pretty-printed documents (and prevents orphaned runs from merging).
 */
function moveElementWithRun(parent: Element, el: Element, index: number | undefined): void {
  const nodes: Node[] = [...leadingWhitespaceRun(el), el];
  for (const node of nodes) node.parentNode?.removeChild(node);
  insertNodesAtElementIndex(parent, nodes, index);
}

interface Fragment {
  /** All imported top-level nodes (leading/trailing text kept in order). */
  nodes: Node[];
  /** The single element among them. */
  el: Element;
}

/**
 * Parse an SVG fragment string containing exactly one element (plus optional
 * surrounding text, which remove-inverses use to restore indentation).
 * Throws SvgParseError on malformed or multi-element input.
 */
function parseFragment(doc: CanvasDocument, svg: string): Fragment {
  const wrapped = `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}">${svg}</svg>`;
  const parsed = doc.adapter.parse(wrapped);
  const wrapper = parsed.documentElement;
  if (wrapper.children.length !== 1) {
    throw new SvgParseError('insert expects exactly one root element');
  }
  const nodes = [...wrapper.childNodes].map((n) => doc.dom.importNode(n, true));
  const el = nodes.find((n): n is Element => n.nodeType === 1 /* ELEMENT_NODE */);
  if (el === undefined) throw new SvgParseError('insert expects exactly one root element');
  return { nodes, el };
}

const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

/**
 * Serialize a subtree for remove-inverse capture. Prefixed names inside the
 * subtree (e.g. xlink:href) resolve via declarations on ancestors outside
 * it; without them in scope the serializer would invent ns1-style prefixes.
 * Temporarily declare every needed prefix on the subtree root so the
 * captured bytes keep their original prefixes; reinsertion strips the
 * then-redundant declarations again.
 */
function serializeSubtree(doc: CanvasDocument, el: Element): string {
  const needed = new Map<string, string>();
  const consider = (prefix: string | null): void => {
    if (prefix === null || prefix === 'xml' || prefix === 'xmlns' || needed.has(prefix)) return;
    const uri = el.lookupNamespaceURI(prefix);
    if (uri !== null) needed.set(prefix, uri);
  };
  const collect = (node: Element): void => {
    consider(node.prefix);
    for (const attr of node.attributes) consider(attr.prefix);
    for (const child of node.children) collect(child);
  };
  collect(el);
  const added: string[] = [];
  for (const [prefix, uri] of needed) {
    if (!el.hasAttribute(`xmlns:${prefix}`)) {
      el.setAttributeNS(XMLNS_NS, `xmlns:${prefix}`, uri);
      added.push(prefix);
    }
  }
  try {
    return doc.adapter.serialize(el);
  } finally {
    for (const prefix of added) el.removeAttribute(`xmlns:${prefix}`);
  }
}

/**
 * Drop namespace declarations on an inserted element that its new ancestors
 * already provide. Subtree serialization (remove-inverse capture) adds
 * xmlns/xmlns:* to the fragment root; re-emitting them after reinsertion
 * would break byte-identity of undo.
 */
function stripRedundantNamespaceDeclarations(el: Element): void {
  const parent = el.parentElement;
  if (parent === null) return;
  for (const attr of [...el.attributes]) {
    const isDefault = attr.name === 'xmlns';
    if (!isDefault && !attr.name.startsWith('xmlns:')) continue;
    const prefix = isDefault ? null : attr.name.slice('xmlns:'.length);
    if (parent.lookupNamespaceURI(prefix) === attr.value) {
      el.removeAttribute(attr.name);
    }
  }
}

// ---------------------------------------------------------------------------
// Per-command application

/**
 * Apply attribute sets/deletes and build a byte-exact inverse.
 *
 * - Plain sets and additions invert as one set-attrs: updates restore in
 *   place, additions delete.
 * - Deleting an existing attribute is the hard case: the DOM can only append
 *   re-added attributes, so the inverse is a two-step batch that clears every
 *   attribute from the first deleted position onward and re-adds them in the
 *   original order with the original values.
 * - When the id attribute itself sits in that reordered tail, transiently
 *   clearing it would break the inverse's own addressing — so (except on the
 *   root, which is addressable as '#root' without an id) the inverse instead
 *   captures the element's pre-state bytes and position, and restores via
 *   remove + insert, the same machinery remove-undo already relies on.
 */
function applyAttributeChanges(
  doc: CanvasDocument,
  el: Element,
  fallbackId: string,
  changes: Record<string, string | null>,
): CanvasCommand {
  const hasOwn = (n: string): boolean => Object.prototype.hasOwnProperty.call(changes, n);
  const preNames = [...el.attributes].map((a) => a.name);
  const preValue = new Map(preNames.map((n) => [n, el.getAttribute(n) as string]));
  const firstDeleted = preNames.findIndex((n) => hasOwn(n) && changes[n] === null);
  const suffix = firstDeleted < 0 ? [] : preNames.slice(firstDeleted);

  let capture: { parentId: string; index: number; svg: string } | null = null;
  if (firstDeleted >= 0 && suffix.includes('id') && el !== doc.root) {
    const parent = el.parentElement as Element;
    const parentId = parent === doc.root ? '#root' : ensureId(doc, parent).id;
    capture = {
      parentId,
      index: elementIndex(parent, el),
      svg: textOf(leadingWhitespaceRun(el)) + serializeSubtree(doc, el),
    };
  }

  const prior: Record<string, string | null> = {};
  for (const [name, value] of Object.entries(changes)) {
    prior[name] = el.getAttribute(name);
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
  }
  const target = currentId(doc, el, fallbackId);

  if (capture !== null) {
    return {
      kind: 'batch',
      commands: [
        { kind: 'remove', targets: [target] },
        { kind: 'insert', parent: capture.parentId, index: capture.index, svg: capture.svg },
      ],
    };
  }
  if (firstDeleted < 0) return { kind: 'set-attrs', target, attrs: prior };
  const clear: Record<string, string | null> = {};
  for (const [name, value] of Object.entries(changes)) {
    if (value !== null && prior[name] === null) clear[name] = null; // added by this command
  }
  for (const name of suffix) clear[name] = null;
  const restore: Record<string, string | null> = {};
  for (const name of preNames.slice(0, firstDeleted)) {
    if (hasOwn(name) && changes[name] !== null) {
      restore[name] = preValue.get(name) ?? null; // updated in the prefix
    }
  }
  for (const name of suffix) restore[name] = preValue.get(name) ?? null;
  return {
    kind: 'batch',
    commands: [
      { kind: 'set-attrs', target, attrs: clear },
      { kind: 'set-attrs', target, attrs: restore },
    ],
  };
}

function deletesId(changes: Record<string, string | null>): boolean {
  return Object.prototype.hasOwnProperty.call(changes, 'id') && changes['id'] === null;
}

function applySetAttrs(doc: CanvasDocument, cmd: SetAttrsCommand): CommandResult {
  const els = resolveEls(doc, [cmd.target]);
  if (typeof els === 'string') return targetNotFound(els);
  const el = els[0] as Element;
  // Deleting the id attribute would orphan the inverse's target (and spec §1
  // ids are the stability anchor for histories and overlays). Renames stay
  // allowed: the inverse targets the new id. The root is exempt — '#root'
  // addressing does not depend on an id attribute.
  if (deletesId(cmd.attrs) && el !== doc.root) {
    return fail('invalid-command', 'deleting the id attribute would break addressing and undo');
  }
  const r = withIds(doc, els)[0] as ResolvedTarget;
  const inverse = applyAttributeChanges(doc, el, r.id, cmd.attrs);
  const id = currentId(doc, el, r.id);
  return ok(inverse, [id]);
}

function applySetStyle(doc: CanvasDocument, cmd: SetStyleCommand): CommandResult {
  const els = resolveEls(doc, [cmd.target]);
  if (typeof els === 'string') return targetNotFound(els);
  const preEl = els[0] as Element;
  if (deletesId(cmd.props) && preEl !== doc.root && preEl.getAttribute('style') === null) {
    return fail('invalid-command', 'deleting the id attribute would break addressing and undo');
  }
  const r = withIds(doc, els)[0] as ResolvedTarget;
  const el = r.el;
  const styleRaw = el.getAttribute('style');
  let inverse: CanvasCommand;
  if (styleRaw !== null) {
    // The element styles itself via a style attribute (the matplotlib way):
    // edit within it so the change actually wins the cascade.
    let entries = parseStyleEntries(styleRaw);
    for (const [prop, value] of Object.entries(cmd.props)) {
      const at = entries.findIndex(([name]) => name === prop);
      if (value === null) {
        if (at >= 0) entries = entries.filter((_, i) => i !== at);
      } else if (at >= 0) {
        entries[at] = [prop, value];
      } else {
        entries.push([prop, value]);
      }
    }
    const newRaw = entries.length === 0 ? null : serializeStyleEntries(entries);
    inverse = applyAttributeChanges(doc, el, r.id, { style: newRaw });
  } else {
    // No style attribute: write presentation attributes (spec §3).
    inverse = applyAttributeChanges(doc, el, r.id, cmd.props);
  }
  return ok(inverse, [r.id]);
}

const TEXT_BEARING = new Set(['text', 'tspan', 'textPath', 'title', 'desc']);

function applySetText(doc: CanvasDocument, cmd: SetTextCommand): CommandResult {
  const els = resolveEls(doc, [cmd.target]);
  if (typeof els === 'string') return targetNotFound(els);
  const el = els[0] as Element;
  if (!TEXT_BEARING.has(el.localName)) {
    return fail(
      'text-on-non-text',
      `<${el.localName}> ("${cmd.target}") does not carry text content`,
    );
  }
  const r = withIds(doc, els)[0] as ResolvedTarget;
  const prior = el.textContent ?? '';
  el.textContent = cmd.text;
  return ok({ kind: 'set-text', target: r.id, text: prior }, [r.id]);
}

function applyTranslate(doc: CanvasDocument, cmd: TranslateCommand): CommandResult {
  const els = resolveEls(doc, cmd.targets);
  if (typeof els === 'string') return targetNotFound(els);
  // Parse every existing transform before mutating (or minting) anything.
  const next: Matrix[] = [];
  for (let i = 0; i < els.length; i++) {
    try {
      next.push(compose(translationMatrix(cmd.dx, cmd.dy), readTransform(els[i] as Element)));
    } catch {
      return fail('invalid-command', `unparseable transform attribute on "${cmd.targets[i]}"`);
    }
  }
  const resolved = withIds(doc, els);
  const restores = resolved.map(({ el, id }) => ({ id, prior: el.getAttribute('transform') }));
  resolved.forEach(({ el }, i) => {
    writeTransform(el, next[i] as Matrix);
  });
  const ids = resolved.map((r) => r.id);
  return ok(transformRestoreInverse(restores), ids);
}

function applyTransform(doc: CanvasDocument, cmd: TransformCommand): CommandResult {
  const els = resolveEls(doc, [cmd.target]);
  if (typeof els === 'string') return targetNotFound(els);
  const el = els[0] as Element;
  const m = tupleToMatrix(cmd.matrix);
  if (cmd.mode === 'replace') {
    const r = withIds(doc, els)[0] as ResolvedTarget;
    const prior = el.getAttribute('transform');
    el.setAttribute('transform', formatMatrix(m));
    return ok({ kind: 'set-attrs', target: r.id, attrs: { transform: prior } }, [r.id]);
  }
  let composed: Matrix;
  try {
    composed = compose(m, readTransform(el));
  } catch {
    return fail('invalid-command', `unparseable transform attribute on "${cmd.target}"`);
  }
  const r = withIds(doc, els)[0] as ResolvedTarget;
  const prior = el.getAttribute('transform');
  writeTransform(el, composed);
  return ok({ kind: 'set-attrs', target: r.id, attrs: { transform: prior } }, [r.id]);
}

function applyReorder(doc: CanvasDocument, cmd: ReorderCommand): CommandResult {
  const els = resolveEls(doc, [cmd.target]);
  if (typeof els === 'string') return targetNotFound(els);
  const el = els[0] as Element;
  const parent = el.parentElement;
  if (parent === null) return fail('invalid-command', `cannot reorder the root element`);
  const r = withIds(doc, els)[0] as ResolvedTarget;
  const priorIndex = elementIndex(parent, el);
  const parentEnsured = parent === doc.root ? { id: '#root', minted: false } : ensureId(doc, parent);
  switch (cmd.mode) {
    case 'front':
      if (parent.lastElementChild !== el) moveElementWithRun(parent, el, undefined);
      break;
    case 'back':
      if (parent.firstElementChild !== el) moveElementWithRun(parent, el, 0);
      break;
    case 'forward':
      if (el.nextElementSibling !== null) moveElementWithRun(parent, el, priorIndex + 1);
      break;
    case 'backward':
      if (el.previousElementSibling !== null) moveElementWithRun(parent, el, priorIndex - 1);
      break;
  }
  const affected = parentEnsured.minted ? [r.id, parentEnsured.id] : [r.id];
  return ok(
    { kind: 'reparent', target: r.id, parent: parentEnsured.id, index: priorIndex },
    affected,
  );
}

function applyReparent(doc: CanvasDocument, cmd: ReparentCommand): CommandResult {
  const els = resolveEls(doc, [cmd.target]);
  if (typeof els === 'string') return targetNotFound(els);
  const el = els[0] as Element;
  const newParent = resolveTarget(doc, cmd.parent);
  if (newParent === null) return targetNotFound(cmd.parent);
  if (el === doc.root) return fail('invalid-command', 'cannot reparent the root element');
  if (el === newParent || el.contains(newParent)) {
    return fail('invalid-command', `"${cmd.parent}" is inside "${cmd.target}"`);
  }
  const oldParent = el.parentElement;
  if (oldParent === null) return fail('invalid-command', 'target has no parent element');
  const r = withIds(doc, els)[0] as ResolvedTarget;
  const priorIndex = elementIndex(oldParent, el);
  const oldEnsured = oldParent === doc.root ? { id: '#root', minted: false } : ensureId(doc, oldParent);
  moveElementWithRun(newParent, el, cmd.index);
  const affected = oldEnsured.minted ? [r.id, oldEnsured.id] : [r.id];
  return ok({ kind: 'reparent', target: r.id, parent: oldEnsured.id, index: priorIndex }, affected);
}

function applyGroup(doc: CanvasDocument, cmd: GroupCommand): CommandResult {
  const els = resolveEls(doc, cmd.targets);
  if (typeof els === 'string') return targetNotFound(els);
  if (els[0] === undefined) return fail('invalid-command', 'group requires at least one target');
  for (let i = 0; i < els.length; i++) {
    const el = els[i] as Element;
    if (el === doc.root) return fail('invalid-command', 'cannot group the root element');
    if (el.parentElement === null) {
      return fail('invalid-command', `"${cmd.targets[i]}" has no parent element`);
    }
  }
  if (cmd.id !== undefined && doc.getById(cmd.id) !== null) {
    return fail('invalid-command', `id "${cmd.id}" is already in use`);
  }
  const resolved = withIds(doc, els);
  const first = resolved[0] as ResolvedTarget;
  const gid = cmd.id ?? doc.allocateId();
  const parent = first.el.parentElement as Element;
  const g = doc.dom.createElementNS(SVG_NS, 'g');
  g.setAttribute('id', gid);
  // Each target's leading indentation moves with it into the group (and the
  // group takes the first target's slot before that indentation), so that
  // ungroup — which moves every child node back out — is a byte-exact undo
  // even in pretty-printed documents.
  const firstRun = leadingWhitespaceRun(first.el);
  parent.insertBefore(g, firstRun[0] ?? first.el);
  for (const { el } of resolved) {
    for (const ws of leadingWhitespaceRun(el)) g.appendChild(ws);
    g.appendChild(el);
  }
  return ok({ kind: 'ungroup', target: gid }, [gid, ...resolved.map((r) => r.id)]);
}

function applyUngroup(doc: CanvasDocument, cmd: UngroupCommand): CommandResult {
  const els = resolveEls(doc, [cmd.target]);
  if (typeof els === 'string') return targetNotFound(els);
  const g = els[0] as Element;
  if (g.localName !== 'g') return fail('invalid-command', `"${cmd.target}" is not a <g> element`);
  const parent = g.parentElement;
  if (parent === null) return fail('invalid-command', 'cannot ungroup the root element');
  // Commit point: mint the ids the inverse will reference.
  const r = withIds(doc, els)[0] as ResolvedTarget;
  const childIds = [...g.children].map((child) => ensureId(doc, child).id);
  // Byte-exact undo: capture the group's serialized bytes (post-mint) and its
  // position; the inverse removes the freed children again and reinserts the
  // captured subtree verbatim — attribute spellings, internal whitespace and
  // all (a re-made <g> could not reproduce those).
  const index = elementIndex(parent, g);
  const parentId = parent === doc.root ? '#root' : ensureId(doc, parent).id;
  const leadRun = leadingWhitespaceRun(g);
  const captured = textOf(leadRun) + serializeSubtree(doc, g);
  // The group's own pretty-printing dies with it: its leading indentation and
  // a trailing whitespace-only child are dropped rather than leaked into the
  // parent (the captured bytes above restore both on undo).
  const last = g.lastChild;
  if (last !== null && isWhitespaceText(last)) g.removeChild(last);
  while (g.firstChild !== null) parent.insertBefore(g.firstChild, g);
  for (const ws of leadRun) parent.removeChild(ws);
  g.remove();
  const reinsert: InsertCommand = { kind: 'insert', parent: parentId, index, svg: captured, id: r.id };
  const inverse: CanvasCommand =
    childIds.length === 0
      ? reinsert
      : { kind: 'batch', commands: [{ kind: 'remove', targets: childIds }, reinsert] };
  return ok(inverse, [r.id, ...childIds]);
}

function applyInsert(doc: CanvasDocument, cmd: InsertCommand): CommandResult {
  const parent = cmd.parent === undefined ? doc.root : resolveTarget(doc, cmd.parent);
  if (parent === null) return targetNotFound(cmd.parent ?? '#root');
  let fragment: Fragment;
  try {
    fragment = parseFragment(doc, cmd.svg);
  } catch (err) {
    return fail('invalid-svg', err instanceof Error ? err.message : 'malformed SVG fragment');
  }
  const { nodes, el } = fragment;
  const requestedId = cmd.id ?? el.getAttribute('id');
  if (requestedId !== null && doc.getById(requestedId) !== null) {
    return fail('invalid-command', `id "${requestedId}" is already in use`);
  }
  const id = requestedId ?? doc.allocateId();
  el.setAttribute('id', id);
  insertNodesAtElementIndex(parent, nodes, cmd.index);
  stripRedundantNamespaceDeclarations(el);
  return ok({ kind: 'remove', targets: [id] }, [id]);
}

function applyRemove(doc: CanvasDocument, cmd: RemoveCommand): CommandResult {
  const els = resolveEls(doc, cmd.targets);
  if (typeof els === 'string') return targetNotFound(els);
  // Collapse repeated targets, and drop any target inside another removed
  // subtree — it is deleted (and restored) with that subtree. The naive
  // per-target loop would otherwise crash on the already-detached element.
  const unique = els.filter((el, i) => els.indexOf(el) === i);
  const roots = unique.filter((el) => !unique.some((other) => other !== el && other.contains(el)));
  for (const el of roots) {
    if (el === doc.root) return fail('invalid-command', 'cannot remove the root element');
    if (el.parentElement === null) return fail('invalid-command', 'target has no parent element');
  }
  const resolved = withIds(doc, roots);
  const restores: InsertCommand[] = [];
  for (const { el, id } of resolved) {
    const parent = el.parentElement as Element;
    const parentId = parent === doc.root ? '#root' : ensureId(doc, parent).id;
    // An element's leading indentation belongs to it: consume the whole
    // preceding whitespace run and capture it in the inverse's svg so undo
    // restores pretty-printed files byte-exactly (reordering can leave
    // adjacent runs; taking the full run keeps capture and reinsert exact
    // mirrors).
    const leadRun = leadingWhitespaceRun(el);
    // Capture position and bytes at the moment of this removal so replaying
    // the reversed inserts walks the states back exactly.
    restores.push({
      kind: 'insert',
      parent: parentId,
      index: elementIndex(parent, el),
      svg: textOf(leadRun) + serializeSubtree(doc, el),
      id,
    });
    for (const ws of leadRun) parent.removeChild(ws);
    el.remove();
    doc.invalidate();
  }
  const ids = resolved.map((r) => r.id);
  const reversed = [...restores].reverse();
  const inverse: CanvasCommand =
    reversed.length === 1 ? (reversed[0] as CanvasCommand) : { kind: 'batch', commands: reversed };
  return ok(inverse, ids);
}

interface Placement {
  resolved: ResolvedTarget;
  bbox: BBox;
}

function measureAll(doc: CanvasDocument, targets: readonly string[]): Placement[] | CommandFailure {
  const els = resolveEls(doc, targets);
  if (typeof els === 'string') return targetNotFound(els);
  const bboxes: BBox[] = [];
  for (let i = 0; i < els.length; i++) {
    const bbox = attrBBox(els[i] as Element);
    if (bbox === null) {
      return fail(
        'invalid-command',
        `cannot derive geometry for "${targets[i]}" from attributes; layout-dependent alignment is deferred (spec §8)`,
      );
    }
    bboxes.push(bbox);
  }
  const resolved = withIds(doc, els);
  return resolved.map((r, i) => ({ resolved: r, bbox: bboxes[i] as BBox }));
}

function applyDeltas(placements: Placement[], deltas: number[], axis: 'x' | 'y'): CommandResult {
  const restores: Array<{ id: string; prior: string | null }> = [];
  placements.forEach(({ resolved }, i) => {
    const d = deltas[i] ?? 0;
    if (d === 0) return;
    const dx = axis === 'x' ? d : 0;
    const dy = axis === 'y' ? d : 0;
    const prior = resolved.el.getAttribute('transform');
    writeTransform(resolved.el, compose(translationMatrix(dx, dy), readTransform(resolved.el)));
    restores.push({ id: resolved.id, prior });
  });
  const inverse: CanvasCommand = {
    kind: 'batch',
    commands: [...restores]
      .reverse()
      .map(({ id, prior }) => ({ kind: 'set-attrs', target: id, attrs: { transform: prior } })),
  };
  return ok(inverse, placements.map((p) => p.resolved.id));
}

function applyAlign(doc: CanvasDocument, cmd: AlignCommand): CommandResult {
  const placements = measureAll(doc, cmd.targets);
  if (!Array.isArray(placements)) return placements;
  const lo = (b: BBox): number => (cmd.axis === 'x' ? b.minX : b.minY);
  const hi = (b: BBox): number => (cmd.axis === 'x' ? b.maxX : b.maxY);
  const start = Math.min(...placements.map((p) => lo(p.bbox)));
  const end = Math.max(...placements.map((p) => hi(p.bbox)));
  const deltas = placements.map(({ bbox }) => {
    switch (cmd.mode) {
      case 'start':
        return start - lo(bbox);
      case 'center':
        return (start + end) / 2 - (lo(bbox) + hi(bbox)) / 2;
      case 'end':
        return end - hi(bbox);
    }
  });
  return applyDeltas(placements, deltas, cmd.axis);
}

function applyDistribute(doc: CanvasDocument, cmd: DistributeCommand): CommandResult {
  const placements = measureAll(doc, cmd.targets);
  if (!Array.isArray(placements)) return placements;
  if (placements.length < 3) {
    return ok({ kind: 'batch', commands: [] }, placements.map((p) => p.resolved.id));
  }
  const center = (b: BBox): number =>
    cmd.axis === 'x' ? (b.minX + b.maxX) / 2 : (b.minY + b.maxY) / 2;
  const sorted = [...placements].sort((a, b) => center(a.bbox) - center(b.bbox));
  const firstCenter = center((sorted[0] as Placement).bbox);
  const lastCenter = center((sorted[sorted.length - 1] as Placement).bbox);
  const step = (lastCenter - firstCenter) / (sorted.length - 1);
  const deltas = sorted.map(({ bbox }, i) => firstCenter + i * step - center(bbox));
  return applyDeltas(sorted, deltas, cmd.axis);
}

function applySetArtboard(doc: CanvasDocument, cmd: SetArtboardCommand): CommandResult {
  const prior: Record<string, string | null> = {};
  if (cmd.widthMm !== undefined) {
    prior['width'] = doc.root.getAttribute('width');
    doc.root.setAttribute('width', `${cmd.widthMm}mm`);
  }
  if (cmd.heightMm !== undefined) {
    prior['height'] = doc.root.getAttribute('height');
    doc.root.setAttribute('height', `${cmd.heightMm}mm`);
  }
  return ok({ kind: 'set-attrs', target: '#root', attrs: prior }, ['#root']);
}

function applyBatch(doc: CanvasDocument, cmd: BatchCommand): CommandResult {
  const applied: CommandSuccess[] = [];
  const affected = new Set<string>();
  const mintMark = doc.mintLog.length;
  for (const member of cmd.commands) {
    const result = applyOne(doc, member);
    if (!result.ok) {
      // Atomicity: roll back already-applied members, newest first, then
      // strip the ids those members minted (inverses restore attributes,
      // not mints) so the failed batch leaves the document byte-identical.
      for (const done of [...applied].reverse()) applyOne(doc, done.inverse);
      for (const id of doc.mintLog.splice(mintMark)) {
        doc.getById(id)?.removeAttribute('id');
      }
      doc.invalidate();
      return { ok: false, error: result.error, affected: [] };
    }
    applied.push(result);
    for (const id of result.affected) affected.add(id);
  }
  const inverse: BatchCommand = {
    kind: 'batch',
    commands: applied.map((r) => r.inverse).reverse(),
  };
  if (cmd.label !== undefined) inverse.label = cmd.label;
  return ok(inverse, [...affected]);
}

// ---------------------------------------------------------------------------
// Dispatch

function applyOne(doc: CanvasDocument, cmd: CanvasCommand): CommandResult {
  let result: CommandResult;
  switch (cmd.kind) {
    case 'set-attrs':
      result = applySetAttrs(doc, cmd);
      break;
    case 'set-style':
      result = applySetStyle(doc, cmd);
      break;
    case 'set-text':
      result = applySetText(doc, cmd);
      break;
    case 'translate':
      result = applyTranslate(doc, cmd);
      break;
    case 'transform':
      result = applyTransform(doc, cmd);
      break;
    case 'reorder':
      result = applyReorder(doc, cmd);
      break;
    case 'reparent':
      result = applyReparent(doc, cmd);
      break;
    case 'group':
      result = applyGroup(doc, cmd);
      break;
    case 'ungroup':
      result = applyUngroup(doc, cmd);
      break;
    case 'insert':
      result = applyInsert(doc, cmd);
      break;
    case 'remove':
      result = applyRemove(doc, cmd);
      break;
    case 'align':
      result = applyAlign(doc, cmd);
      break;
    case 'distribute':
      result = applyDistribute(doc, cmd);
      break;
    case 'set-artboard':
      result = applySetArtboard(doc, cmd);
      break;
    case 'batch':
      result = applyBatch(doc, cmd);
      break;
  }
  doc.invalidate();
  return result;
}

/**
 * Validate and apply a command against the document (canvas-engine.md §3).
 * Every success carries an inverse computed from pre-state; batches apply
 * atomically.
 */
export function dispatch(doc: CanvasDocument, command: CanvasCommand): CommandResult {
  const parsed = CanvasCommandSchema.safeParse(command);
  if (!parsed.success) {
    return fail('invalid-command', parsed.error.issues[0]?.message ?? 'invalid command');
  }
  // Scope the mint log to this dispatch (batch rollback marks are relative,
  // so per-dispatch truncation keeps the log bounded).
  doc.mintLog.length = 0;
  return applyOne(doc, parsed.data);
}
