/**
 * Compliance diagnostics (ADR-002 §4): profile-driven checks FLAG violations
 * of a journal's stated author guidelines — they never rewrite content.
 * A `null` rule in the profile means "the journal does not state this" and
 * the corresponding check is skipped entirely.
 */

export type DiagnosticSeverity = 'error' | 'warning';

export type DiagnosticSurface =
  | 'figure'
  | 'manuscript'
  | 'export'
  /** feature-plan-12 §2 — cover-letter assertions and journal requirements. */
  | 'letter'
  /** feature-plan-12 §6 — unaddressed reviewer points, response structure. */
  | 'response'
  /** feature-plan-12 §9 — sponsor package slots and rendered-page limits. */
  | 'package';

export interface DiagnosticTarget {
  figureId?: string;
  elementId?: string;
  sectionPath?: string;
  /** Registry id of the document the diagnostic belongs to (ADR-009). */
  documentId?: string;
  slotId?: string;
  pointId?: string;
  assertionId?: string;
}

export interface Diagnostic {
  /** Stable rule id, e.g. 'fig.min-font' or 'ms.abstract-words'. */
  id: string;
  severity: DiagnosticSeverity;
  surface: DiagnosticSurface;
  /**
   * Human-readable message: measured value vs the stated rule, plus the
   * profile's stated source URL when it is short enough to keep inline.
   */
  message: string;
  target?: DiagnosticTarget;
}
