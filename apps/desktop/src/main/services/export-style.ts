import type { DocumentStyle, PublisherProfile } from '@suna/core'

/**
 * The one place a document's typography is decided, shared by the DOCX writer
 * (export-docx.ts) and the HTML/PDF writer (export-html.ts) so the two can
 * never drift.
 *
 * A profile that states a `documentStyle` (currently only the SUNA house
 * style) gets exactly that. Every journal profile leaves it absent and gets
 * LEGACY_STYLE below — the generic A4/12 pt manuscript geometry the exporters
 * used before house styles existed. That is deliberate: the published author
 * guidelines say nothing about the submitted manuscript's page setup
 * (ADR-002), so changing a journal export's typography would be inventing a
 * rule, and would silently change output people may already have submitted.
 */

/**
 * Generic submission-manuscript geometry: A4, 1 in margins, 12 pt Times New
 * Roman, single-spaced. Used for every profile that states no style of its
 * own. Values match what export-docx.ts and export-html.ts hardcoded before
 * this module existed, so journal exports are byte-comparable across the
 * change.
 */
export const LEGACY_STYLE: DocumentStyle = {
  name: 'Generic manuscript',
  page: { widthMm: 210, heightMm: 297, marginMm: 25.4 },
  fonts: { body: 'Times New Roman', mono: 'Courier New' },
  sizesPt: {
    body: 12,
    title: 16,
    author: 12,
    affiliation: 9,
    heading1: 14,
    heading2: 12,
    caption: 12,
    reference: 12,
    tableCell: 12,
    footer: 12
  },
  lineSpacing: 1,
  bodySpaceAfterPt: 6,
  referenceHangingMm: 8,
  figureWidthMm: 160,
  figureCaptionPosition: 'below',
  tableCaptionPosition: 'above',
  pageBreakAfterFrontMatter: false
}

/** The typography to set a manuscript in under `profile`. */
export function documentStyleFor(profile: PublisherProfile): DocumentStyle {
  return profile.documentStyle ?? LEGACY_STYLE
}

/** True when this profile brings its own typography (a house style, not a journal). */
export function isHouseStyle(profile: PublisherProfile): boolean {
  return profile.documentStyle !== undefined
}

// ---- unit conversions, done once so the two writers agree ----------------

/** Points → OOXML half-points (docx `size`). */
export function halfPoints(pt: number): number {
  return Math.round(pt * 2)
}

/** Points → twips (OOXML spacing/indent unit: 1 pt = 20 twips). */
export function ptToTwips(pt: number): number {
  return Math.round(pt * 20)
}

/** Millimetres → twips (1 in = 1440 twips = 25.4 mm). */
export function mmToTwips(mm: number): number {
  return Math.round((mm / 25.4) * 1440)
}

/**
 * A line-spacing multiple as OOXML's `w:line` in 240ths, paired with the
 * "auto" rule. 1.15 → 276, which is what Word's own default template uses and
 * therefore what docx-tools inherits.
 */
export function lineSpacingTwips(multiple: number): number {
  return Math.round(multiple * 240)
}
