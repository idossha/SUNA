import type { DocumentStyle, PublisherProfile } from '@suna/core'

/**
 * The one place a document's typography is decided, shared by the DOCX writer
 * (export-docx.ts), the HTML writer (export-html.ts) and the PDF printer
 * (export-pdf.ts) so the three can never drift.
 *
 * SUNA_DEFAULT_STYLE — the house drafting style, extracted from the real
 * docx-tools output the user has published with — is the ALWAYS-ON base for
 * EVERY export profile. A profile's `documentStyle` is a PARTIAL delta merged
 * on top of it by `resolveDocumentStyle`: a journal profile states only what
 * its published author guidelines actually say (a figure-label word, a
 * captions-list requirement), because guidelines almost never state page
 * geometry or point sizes for the submitted manuscript (ADR-002), and
 * inventing per-journal typography would be exactly the kind of guess this
 * codebase refuses to make. Everything a profile leaves unstated inherits the
 * SUNA default below.
 */

/** A DocumentStyle with every field resolved — what the writers consume. */
export interface ResolvedDocumentStyle {
  name: string
  page: { widthMm: number; heightMm: number; marginMm: number }
  fonts: { body: string; mono: string }
  sizesPt: {
    body: number
    title: number
    author: number
    affiliation: number
    heading1: number
    heading2: number
    caption: number
    reference: number
    tableCell: number
    footer: number
  }
  lineSpacing: number
  bodySpaceAfterPt: number
  referenceHangingMm: number
  figureWidthMm: number
  figureCaptionPosition: 'above' | 'below'
  tableCaptionPosition: 'above' | 'below'
  pageBreakAfterFrontMatter: boolean
  figureLabel: 'Figure' | 'Fig.'
  figurePlacement: 'inline' | 'captions-list'
  tablePlacement: 'inline' | 'end'
  referencesStartNewPage: boolean
}

/**
 * One editor theme's export palette. The PDF and web-page exports render in
 * the app's ACTIVE theme so an exported document looks like the reading tab
 * it came from. Values MIRROR renderer/src/styles/tokens.css (the `--s-*`
 * chrome tokens per `data-suna-theme`) — keep the two in sync by hand; the
 * main process cannot read the renderer's stylesheet.
 */
export interface ExportPalette {
  bg: string
  ink: string
  inkMuted: string
  inkFaint: string
  border: string
  accent: string
  link: string
  colorScheme: 'dark' | 'light'
}

export const EXPORT_THEME_PALETTES: Record<string, ExportPalette> = {
  'suna-dark': {
    bg: '#1e1e26',
    ink: '#e8e6e1',
    inkMuted: '#a09d97',
    inkFaint: '#6b6963',
    border: '#3a3a45',
    accent: '#e8b45c',
    link: '#8ab4d8',
    colorScheme: 'dark'
  },
  'suna-light': {
    bg: '#f7f2e9',
    ink: '#2b2620',
    inkMuted: '#6b6257',
    inkFaint: '#9a9184',
    border: '#c2b8a5',
    accent: '#8a6a2f',
    link: '#3d6d99',
    colorScheme: 'light'
  },
  gruvbox: {
    bg: '#282828',
    ink: '#ebdbb2',
    inkMuted: '#bdae93',
    inkFaint: '#928374',
    border: '#504945',
    accent: '#fabd2f',
    link: '#83a598',
    colorScheme: 'dark'
  },
  jellybeans: {
    bg: '#151515',
    ink: '#e8e8d3',
    inkMuted: '#a8a89a',
    inkFaint: '#888888',
    border: '#404040',
    accent: '#fad07a',
    link: '#8197bf',
    colorScheme: 'dark'
  },
  'mono-blue-dark': {
    bg: '#0e0e10',
    ink: '#f2f2f2',
    inkMuted: '#a6a6a8',
    inkFaint: '#6e6e72',
    border: '#3a3a3f',
    accent: '#5b9dd9',
    link: '#7fb6e6',
    colorScheme: 'dark'
  },
  'mono-blue-light': {
    bg: '#ffffff',
    ink: '#17171a',
    inkMuted: '#5c5c63',
    inkFaint: '#8e8e96',
    border: '#c9c9d0',
    accent: '#2f6fae',
    link: '#2f6fae',
    colorScheme: 'light'
  }
}

/** The palette for an export request's `options.theme`, or undefined for the untinted print/default look. */
export function exportPalette(theme: string | undefined): ExportPalette | undefined {
  return theme === undefined ? undefined : EXPORT_THEME_PALETTES[theme]
}

/**
 * The SUNA house style: US Letter, 0.5 in margins, Times New Roman 11 pt at
 * 1.15 line spacing, 14 pt bold centred title, 8 pt author line, 9 pt
 * affiliations, 13/11 pt black headings, 10 pt captions/references/table
 * cells with a 0.5 in reference hanging indent, figure captions below and
 * table captions above, a page break after the front matter and before the
 * references. Values match resources/profiles/suna.json's documentStyle,
 * which is where their provenance (docx-tools' output shape) is recorded.
 */
export const SUNA_DEFAULT_STYLE: ResolvedDocumentStyle = {
  name: 'SUNA style',
  page: { widthMm: 215.9, heightMm: 279.4, marginMm: 12.7 },
  fonts: { body: 'Times New Roman', mono: 'Courier New' },
  sizesPt: {
    body: 11,
    title: 14,
    author: 8,
    affiliation: 9,
    heading1: 13,
    heading2: 11,
    caption: 10,
    reference: 10,
    tableCell: 10,
    footer: 9
  },
  lineSpacing: 1.15,
  bodySpaceAfterPt: 6,
  referenceHangingMm: 12.7,
  figureWidthMm: 127,
  figureCaptionPosition: 'below',
  tableCaptionPosition: 'above',
  pageBreakAfterFrontMatter: true,
  figureLabel: 'Figure',
  figurePlacement: 'inline',
  tablePlacement: 'inline',
  referencesStartNewPage: true
}

/** The entries of a partial object that are actually present (guards a handwritten `undefined`). */
function defined<T extends object>(part: T | undefined): Partial<T> {
  if (part === undefined) return {}
  return Object.fromEntries(Object.entries(part).filter(([, v]) => v !== undefined)) as Partial<T>
}

/**
 * The typography to set a manuscript in under `profile`: the SUNA default
 * with the profile's partial `documentStyle` deep-merged over it. A field the
 * profile states wins; everything else inherits the house default.
 */
export function resolveDocumentStyle(profile: PublisherProfile): ResolvedDocumentStyle {
  const delta: DocumentStyle = profile.documentStyle ?? {}
  return {
    ...SUNA_DEFAULT_STYLE,
    ...defined(delta),
    page: { ...SUNA_DEFAULT_STYLE.page, ...defined(delta.page) },
    fonts: { ...SUNA_DEFAULT_STYLE.fonts, ...defined(delta.fonts) },
    sizesPt: { ...SUNA_DEFAULT_STYLE.sizesPt, ...defined(delta.sizesPt) }
  }
}

// ---- unit conversions, done once so the writers agree --------------------

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
