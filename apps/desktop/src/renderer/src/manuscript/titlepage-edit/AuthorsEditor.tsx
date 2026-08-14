import { useMemo, type JSX } from 'react'
import type { Affiliation, Author } from '@suna/core'
import { numberAffiliations } from '../title-page'
import {
  authorsPatch,
  blankAuthor,
  isValidEmail,
  isValidOrcid,
  moveAuthorById,
  removeAuthorById,
  toggleAffiliationRef,
  updateAuthor,
  validateAuthors
} from './patches'
import { useArrayField } from './useArrayField'

/**
 * Compact row editor: order (up/down), given/family/ORCID/email, flags
 * (corresponding/equal contribution), an affiliation multi-select (chips
 * carrying the DERIVED superscript number, so the chip a user presses reads
 * the same as the marker the title page renders), remove, add. Text fields
 * debounce+commit-on-blur; flags/order/membership commit immediately.
 */
export function AuthorsEditor({
  rootDir,
  authors,
  affiliations
}: {
  rootDir: string
  authors: readonly Author[]
  affiliations: readonly Affiliation[]
}): JSX.Element {
  const field = useArrayField<Author>({
    rootDir,
    value: authors,
    buildPatch: authorsPatch,
    validate: validateAuthors
  })
  const numberOf = useMemo(
    () => numberAffiliations(field.list, affiliations).numberOf,
    [field.list, affiliations]
  )

  return (
    <div className="tp__authors-editor">
      {field.list.map((author, i) => {
        const orcidText = author.orcid ?? ''
        const emailText = author.email ?? ''
        const orcidInvalid = orcidText !== '' && !isValidOrcid(orcidText)
        const emailInvalid = emailText !== '' && !isValidEmail(emailText)
        return (
          <div key={author.id} className="tp__author-row">
            <div className="tp__author-order">
              <button
                type="button"
                className="tp__author-move-up"
                disabled={i === 0}
                onClick={() => field.mutate(moveAuthorById(field.list, author.id, -1))}
                aria-label="Move author up"
              >
                ↑
              </button>
              <button
                type="button"
                className="tp__author-move-down"
                disabled={i === field.list.length - 1}
                onClick={() => field.mutate(moveAuthorById(field.list, author.id, 1))}
                aria-label="Move author down"
              >
                ↓
              </button>
            </div>
            <input
              className="tp__author-given"
              value={author.given}
              placeholder="Given"
              onChange={(e) => field.edit(updateAuthor(field.list, author.id, { given: e.target.value }))}
              onBlur={field.flush}
            />
            <input
              className="tp__author-family"
              value={author.family}
              placeholder="Family"
              onChange={(e) => field.edit(updateAuthor(field.list, author.id, { family: e.target.value }))}
              onBlur={field.flush}
            />
            <input
              className={`tp__author-orcid${orcidInvalid ? ' tp__author-orcid--invalid' : ''}`}
              value={orcidText}
              placeholder="0000-0000-0000-0000"
              title={orcidInvalid ? 'ORCID must look like 0000-0002-1825-0097' : 'ORCID'}
              onChange={(e) =>
                field.edit(
                  updateAuthor(field.list, author.id, { orcid: e.target.value === '' ? null : e.target.value })
                )
              }
              onBlur={field.flush}
            />
            <input
              className={`tp__author-email${emailInvalid ? ' tp__author-email--invalid' : ''}`}
              value={emailText}
              placeholder="email@example.com"
              title={emailInvalid ? 'Email address looks invalid' : 'Email'}
              onChange={(e) =>
                field.edit(
                  updateAuthor(field.list, author.id, { email: e.target.value === '' ? null : e.target.value })
                )
              }
              onBlur={field.flush}
            />
            <label className="tp__author-flag">
              <input
                type="checkbox"
                className="tp__author-corresponding"
                checked={author.corresponding}
                onChange={(e) =>
                  field.mutate(updateAuthor(field.list, author.id, { corresponding: e.target.checked }))
                }
              />
              Corresponding
            </label>
            <label className="tp__author-flag">
              <input
                type="checkbox"
                className="tp__author-equal"
                checked={author.equalContribution}
                onChange={(e) =>
                  field.mutate(updateAuthor(field.list, author.id, { equalContribution: e.target.checked }))
                }
              />
              Equal contribution
            </label>
            <div className="tp__author-affiliations">
              {affiliations.map((aff, ai) => {
                const active = author.affiliationRefs.includes(aff.id)
                return (
                  <button
                    type="button"
                    key={aff.id}
                    className={`tp__author-affiliation-chip${active ? ' tp__author-affiliation-chip--active' : ''}`}
                    aria-pressed={active}
                    title={aff.text}
                    onClick={() =>
                      field.mutate(
                        updateAuthor(field.list, author.id, {
                          affiliationRefs: toggleAffiliationRef(author.affiliationRefs, aff.id)
                        })
                      )
                    }
                  >
                    {numberOf.get(aff.id) ?? ai + 1}
                  </button>
                )
              })}
              {affiliations.length === 0 && <span className="tp__hint-inline">Add an affiliation first</span>}
            </div>
            <button
              type="button"
              className="tp__author-remove"
              disabled={field.list.length <= 1}
              title={field.list.length <= 1 ? 'At least one author is required' : 'Remove author'}
              onClick={() => field.mutate(removeAuthorById(field.list, author.id))}
              aria-label="Remove author"
            >
              ✕
            </button>
          </div>
        )
      })}
      <button
        type="button"
        className="tp__add-author"
        onClick={() => field.mutate([...field.list, blankAuthor(field.list)])}
      >
        + Add author
      </button>
      {field.error !== null && <div className="tp__field-error">{field.error}</div>}
    </div>
  )
}
