/**
 * Compliance diagnostics (ARCHITECTURE §12.1): profile-driven checks FLAG violations
 * of a journal's stated author guidelines — they never rewrite content.
 * A `null` rule in the profile means "the journal does not state this" and
 * the corresponding check is skipped entirely.
 */

export type DiagnosticSeverity = 'error' | 'warning';

export type DiagnosticSurface =
  | 'figure'
  | 'manuscript'
  | 'export'
  /** ARCHITECTURE §14.3 — cover-letter assertions and journal requirements. */
  | 'letter'
  /** ARCHITECTURE §4.5 — unaddressed reviewer points, response structure. */
  | 'response'
  /** ARCHITECTURE §20.12 — sponsor package slots and rendered-page limits. */
  | 'package';

export interface DiagnosticTarget {
  figureId?: string;
  elementId?: string;
  sectionPath?: string;
  /** Registry id of the document the diagnostic belongs to (ARCHITECTURE §4.2). */
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
