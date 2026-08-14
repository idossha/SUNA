import { useMemo, type JSX } from 'react'
import katex from 'katex'
import type { Manuscript } from '@suna/core'
import { authorMarkers, numberAffiliations, splitTexSpans } from './title-page'

/** Prose with $...$ spans rendered through KaTeX (title, abstract, extras). */
function TexText({ text }: { text: string }): JSX.Element {
  const segments = useMemo(() => splitTexSpans(text), [text])
  return (
    <>
      {segments.map((segment, i) =>
        segment.kind === 'math' ? (
          <span
            key={i}
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(segment.value, { throwOnError: false })
            }}
          />
        ) : (
          <span key={i}>{segment.value}</span>
        )
      )}
    </>
  )
}

/**
 * Rendered journal-style title page (not editable in v1): title, author line
 * with derived affiliation markers, numbered affiliations, then Abstract /
 * Significance / Highlights blocks. All numbering derives from array order.
 */
export function TitlePage({ manuscript }: { manuscript: Manuscript }): JSX.Element {
  const numbering = useMemo(
    () => numberAffiliations(manuscript.authors, manuscript.affiliations),
    [manuscript.authors, manuscript.affiliations]
  )

  const correspondenceEmails = manuscript.authors
    .filter((a) => a.corresponding && a.email !== null)
    .map((a) => a.email)
    .filter((e): e is string => e !== null)

  const highlights = manuscript.highlights ?? null

  return (
    <div className="msdoc__titlepage msdoc__block">
      <h1 className="msdoc__title">
        <TexText text={manuscript.title} />
      </h1>

      <div className="msdoc__authors">
        {manuscript.authors.map((author, i) => {
          const markers = authorMarkers(author, numbering.numberOf)
          return (
            <span key={author.id} className="msdoc__author">
              {i > 0 && ', '}
              {author.given} {author.family}
              {markers.length > 0 && <sup>{markers.join(',')}</sup>}
            </span>
          )
        })}
      </div>

      {numbering.ordered.length > 0 && (
        <div className="msdoc__affiliations">
          {numbering.ordered.map((affiliation, i) => (
            <div key={affiliation.id}>
              <sup>{i + 1}</sup>
              {affiliation.text}
            </div>
          ))}
        </div>
      )}

      {correspondenceEmails.length > 0 && (
        <div className="msdoc__correspondence">*e-mail: {correspondenceEmails.join(', ')}</div>
      )}

      <section>
        <div className="msdoc__label">Abstract</div>
        <p className="msdoc__front-text">
          <TexText text={manuscript.abstract.content} />
        </p>
      </section>

      {manuscript.significance != null && (
        <section>
          <div className="msdoc__label">Significance</div>
          <p className="msdoc__front-text">
            <TexText text={manuscript.significance} />
          </p>
        </section>
      )}

      {highlights !== null && highlights.length > 0 && (
        <section>
          <div className="msdoc__label">Highlights</div>
          <ul className="msdoc__highlights">
            {highlights.map((highlight, i) => (
              <li key={i}>
                <TexText text={highlight} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
