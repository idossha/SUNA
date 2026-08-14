import { useMemo, type JSX } from 'react'
import type { Manuscript } from '@suna/core'
import { authorMarkers, numberAffiliations } from './title-page'
import { AffiliationsEditor } from './titlepage-edit/AffiliationsEditor'
import { ArticleTypeField } from './titlepage-edit/ArticleTypeField'
import { AuthorsEditor } from './titlepage-edit/AuthorsEditor'
import { EditableBlock } from './titlepage-edit/EditableBlock'
import { EditableGroup } from './titlepage-edit/EditableGroup'
import { HighlightsEditor } from './titlepage-edit/HighlightsEditor'
import { abstractPatch, shortTitlePatch, significancePatch, titlePatch } from './titlepage-edit/patches'
import { TexText } from './titlepage-edit/TexText'
import { useInlineField } from './titlepage-edit/useInlineField'

interface TitlePageProps {
  manuscript: Manuscript
  /** Combined manuscript tab passes `true` (gated on the same `!stale`
   *  condition it already renders under); any other caller stays read-only. */
  editable?: boolean
  /** Required (and used) only when `editable` — the project root `dir` for
   *  `manuscript:update`. */
  rootDir?: string
}

/**
 * Journal-style title page: title, author line with derived affiliation
 * markers, numbered affiliations, then Abstract / Significance / Highlights.
 * All numbering derives from array order (never stored).
 *
 * When `editable`, each scalar field (title/shortTitle/abstract/significance/
 * each highlight) becomes click-to-edit in place — same typography, no modal,
 * no layout jump (see titlepage-edit/EditableBlock) — while authors and
 * affiliations switch to a compact row editor (titlepage-edit/AuthorsEditor,
 * AffiliationsEditor) since add/remove/reorder/affiliation-membership need
 * real controls, not an inline click target. Every commit is the smallest
 * manuscript.json patch that expresses the change; the manuscript prop
 * refreshes via the project store's saveBump once the write lands, so
 * affiliation superscripts (derived, not stored) renumber automatically.
 */
export function TitlePage({ manuscript, editable = false, rootDir = '' }: TitlePageProps): JSX.Element {
  const numbering = useMemo(
    () => numberAffiliations(manuscript.authors, manuscript.affiliations),
    [manuscript.authors, manuscript.affiliations]
  )

  const correspondenceEmails = manuscript.authors
    .filter((a) => a.corresponding && a.email !== null)
    .map((a) => a.email)
    .filter((e): e is string => e !== null)

  const highlights = manuscript.highlights ?? null

  const titleField = useInlineField({
    rootDir,
    value: manuscript.title,
    validate: (raw) => (raw.trim() === '' ? 'Title cannot be empty.' : null),
    buildPatch: titlePatch
  })
  const shortTitleField = useInlineField({
    rootDir,
    value: manuscript.shortTitle,
    validate: (raw) => (raw.trim() === '' ? 'Running title cannot be empty.' : null),
    buildPatch: shortTitlePatch
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
  const authorLine = manuscript.authors.map((author, i) => {
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
      {editable ? (
        <EditableBlock className="msdoc__title tp__title" field={titleField} ariaLabel="title">
          <TexText text={manuscript.title} />
        </EditableBlock>
      ) : (
        <h1 className="msdoc__title">
          <TexText text={manuscript.title} />
        </h1>
      )}

      {editable && (
        <div className="tp__meta-row">
          <div className="tp__meta-field">
            <span className="tp__meta-label">Running title</span>
            <EditableBlock className="tp__short-title" field={shortTitleField} ariaLabel="running title">
              <TexText text={manuscript.shortTitle} />
            </EditableBlock>
          </div>
          <ArticleTypeField rootDir={rootDir} value={manuscript.articleType} />
        </div>
      )}

      {editable ? (
        <EditableGroup className="msdoc__authors" ariaLabel="authors" display={authorLine}>
          <AuthorsEditor
            rootDir={rootDir}
            authors={manuscript.authors}
            affiliations={manuscript.affiliations}
          />
        </EditableGroup>
      ) : (
        <div className="msdoc__authors">{authorLine}</div>
      )}

      {editable ? (
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
            affiliations={manuscript.affiliations}
            authors={manuscript.authors}
          />
        </EditableGroup>
      ) : (
        numbering.ordered.length > 0 && <div className="msdoc__affiliations">{affiliationList}</div>
      )}

      {correspondenceEmails.length > 0 && (
        <div className="msdoc__correspondence">*e-mail: {correspondenceEmails.join(', ')}</div>
      )}

      <section>
        <div className="msdoc__label">Abstract</div>
        {editable ? (
          <EditableBlock className="msdoc__front-text tp__abstract" field={abstractField} ariaLabel="abstract">
            <TexText text={manuscript.abstract.content} />
          </EditableBlock>
        ) : (
          <p className="msdoc__front-text">
            <TexText text={manuscript.abstract.content} />
          </p>
        )}
      </section>

      {(editable || manuscript.significance != null) && (
        <section>
          <div className="msdoc__label">Significance</div>
          {editable ? (
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

      {(editable || (highlights !== null && highlights.length > 0)) && (
        <section>
          <div className="msdoc__label">Highlights</div>
          {editable ? (
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
