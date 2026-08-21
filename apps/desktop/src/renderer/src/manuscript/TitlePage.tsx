import { useMemo, type JSX } from 'react'
import type { Affiliation, Author, Manuscript } from '@suna/core'
import { authorMarkers, numberAffiliations } from './title-page'
import { AffiliationsEditor } from './titlepage-edit/AffiliationsEditor'
import { AuthorsEditor } from './titlepage-edit/AuthorsEditor'
import { EditableBlock } from './titlepage-edit/EditableBlock'
import { EditableGroup } from './titlepage-edit/EditableGroup'
import { HighlightsEditor } from './titlepage-edit/HighlightsEditor'
import { abstractPatch, significancePatch, titlePatch } from './titlepage-edit/patches'
import { TexText } from './titlepage-edit/TexText'
import { useInlineField } from './titlepage-edit/useInlineField'

interface TitlePageProps {
  manuscript: Manuscript
  /** The byline (manuscript/authors.json — feature-plan-7 §1 split it out of
   *  manuscript.json), passed separately since ManuscriptSchema no longer
   *  carries it. */
  authors: readonly Author[]
  affiliations: readonly Affiliation[]
  /** Combined manuscript tab passes `true` (gated on the same `!stale`
   *  condition it already renders under); any other caller stays read-only. */
  editable?: boolean
  /** Required (and used) only when `editable` — the project root `dir` for
   *  `manuscript:update` / the authors.json commit path. */
  rootDir?: string
  /**
   * Which document's front page this is. 'supplement' renders the
   * Supplementary Information COVER, which is the manuscript's title page cut
   * down to exactly what the supplement exporter writes (export-docx.ts's
   * buildSupplementDocx, from the published ground truth): the title prefixed
   * `Supplementary Information:` and then the SAME byline block. A supplement
   * carries no abstract, keywords, significance or highlights — showing them
   * here would promise a cover page the export does not produce.
   */
  variant?: 'manuscript' | 'supplement'
}

/**
 * Journal-style title page: title, author line with derived affiliation
 * markers, numbered affiliations, then Abstract / Significance / Highlights.
 * All numbering derives from array order (never stored).
 *
 * When `editable`, each scalar field (title/abstract/significance/
 * each highlight) becomes click-to-edit in place — same typography, no modal,
 * no layout jump (see titlepage-edit/EditableBlock) — while authors and
 * affiliations switch to a compact row editor (titlepage-edit/AuthorsEditor,
 * AffiliationsEditor) since add/remove/reorder/affiliation-membership need
 * real controls, not an inline click target. Every commit is the smallest
 * patch that expresses the change — manuscript.json for the scalar fields,
 * authors.json for authors/affiliations; the manuscript/authors props
 * refresh via the project store's saveBump once the write lands, so
 * affiliation superscripts (derived, not stored) renumber automatically.
 */
export function TitlePage({
  manuscript,
  authors,
  affiliations,
  editable = false,
  rootDir = '',
  variant = 'manuscript'
}: TitlePageProps): JSX.Element {
  // The cover is never edited in place: its title is not a field (it is the
  // manuscript's title with a prefix), and the byline it shows belongs to the
  // manuscript, which is where it is edited.
  const supplement = variant === 'supplement'
  const editing = editable && !supplement
  const numbering = useMemo(
    () => numberAffiliations(authors, affiliations),
    [authors, affiliations]
  )

  const correspondenceEmails = authors
    .filter((a) => a.corresponding && a.email !== null)
    .map((a) => a.email)
    .filter((e): e is string => e !== null)

  const highlights = manuscript.highlights ?? null
  const keywords = manuscript.keywords ?? []

  const titleField = useInlineField({
    rootDir,
    value: manuscript.title,
    validate: (raw) => (raw.trim() === '' ? 'Title cannot be empty.' : null),
    buildPatch: titlePatch
  })
  const abstractField = useInlineField({
    rootDir,
    value: manuscript.abstract.content,
    validate: (raw) => (raw.trim() === '' ? 'Abstract cannot be empty.' : null),
    buildPatch: abstractPatch
  })
  const significanceField = useInlineField({
    rootDir,
    value: manuscript.significance ?? '',
    validate: () => null,
    buildPatch: significancePatch
  })

  // The journal rendering of the two list blocks — shown read-only, and shown
  // as the click-to-edit face of the editors when `editable`, so the derived
  // affiliation superscripts stay on screen and visibly renumber after an
  // author/affiliation reorder.
  const authorLine = authors.map((author, i) => {
    const markers = authorMarkers(author, numbering.numberOf)
    return (
      <span key={author.id} className="msdoc__author">
        {i > 0 && ', '}
        {author.given} {author.family}
        {markers.length > 0 && <sup>{markers.join(',')}</sup>}
      </span>
    )
  })
  const affiliationList = numbering.ordered.map((affiliation, i) => (
    <div key={affiliation.id} className="msdoc__affiliation">
      <sup>{i + 1}</sup>
      {affiliation.text}
    </div>
  ))

  return (
    <div className="msdoc__titlepage msdoc__block">
      {editing ? (
        <EditableBlock className="msdoc__title tp__title" field={titleField} ariaLabel="title">
          <TexText text={manuscript.title} />
        </EditableBlock>
      ) : (
        <h1 className="msdoc__title">
          {supplement && 'Supplementary Information: '}
          <TexText text={manuscript.title} />
        </h1>
      )}

      {editing ? (
        <EditableGroup className="msdoc__authors" ariaLabel="authors" display={authorLine}>
          <AuthorsEditor
            rootDir={rootDir}
            authors={authors}
            affiliations={affiliations}
          />
        </EditableGroup>
      ) : (
        <div className="msdoc__authors">{authorLine}</div>
      )}

      {editing ? (
        <EditableGroup
          className="msdoc__affiliations"
          ariaLabel="affiliations"
          display={
            affiliationList.length > 0 ? (
              affiliationList
            ) : (
              <span className="tp__placeholder">Click to add an affiliation…</span>
            )
          }
        >
          <AffiliationsEditor
            rootDir={rootDir}
            affiliations={affiliations}
            authors={authors}
          />
        </EditableGroup>
      ) : (
        numbering.ordered.length > 0 && <div className="msdoc__affiliations">{affiliationList}</div>
      )}

      {correspondenceEmails.length > 0 && (
        <div className="msdoc__correspondence">*e-mail: {correspondenceEmails.join(', ')}</div>
      )}

      {!supplement && (
      <section>
        <div className="msdoc__label">Abstract</div>
        {editing ? (
          <EditableBlock className="msdoc__front-text tp__abstract" field={abstractField} ariaLabel="abstract">
            <TexText text={manuscript.abstract.content} />
          </EditableBlock>
        ) : (
          <p className="msdoc__front-text">
            <TexText text={manuscript.abstract.content} />
          </p>
        )}
      </section>
      )}

      {/* Keywords sit where the exporters put them — straight after the
          abstract — and are read-only here: they come from manuscript.json,
          which the Manuscript view's own JSON editing covers. */}
      {!supplement && keywords.length > 0 && (
        <section>
          <div className="msdoc__label">Keywords</div>
          <p className="msdoc__front-text tp__keywords">{keywords.join('; ')}</p>
        </section>
      )}

      {!supplement && (editing || manuscript.significance != null) && (
        <section>
          <div className="msdoc__label">Significance</div>
          {editing ? (
            <EditableBlock
              className="msdoc__front-text tp__significance"
              field={significanceField}
              ariaLabel="significance"
              placeholder="Click to add a significance statement…"
            >
              <TexText text={manuscript.significance ?? ''} />
            </EditableBlock>
          ) : (
            <p className="msdoc__front-text">
              <TexText text={manuscript.significance ?? ''} />
            </p>
          )}
        </section>
      )}

      {!supplement && (editing || (highlights !== null && highlights.length > 0)) && (
        <section>
          <div className="msdoc__label">Highlights</div>
          {editing ? (
            <HighlightsEditor rootDir={rootDir} highlights={manuscript.highlights ?? []} />
          ) : (
            <ul className="msdoc__highlights">
              {(highlights ?? []).map((highlight, i) => (
                <li key={i}>
                  <TexText text={highlight} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
