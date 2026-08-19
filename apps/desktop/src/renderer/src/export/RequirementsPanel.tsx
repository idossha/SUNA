import { useMemo, type JSX } from 'react'
import type { PublisherProfile } from '@suna/core'
import { profileRequirements, type Fact, type RequirementStatus } from './requirements'

/** `publisher` of the house style — the one profile that is ours, not a journal's. */
const HOUSE_PUBLISHER = 'SUNA'

const STATUS_TEXT: Record<RequirementStatus, string> = {
  required: 'required',
  'do-not-use': 'do not use',
  'not-stated': 'not stated'
}

/**
 * The house style has nobody to require anything on its behalf — its stances
 * are conventions we keep, so they read as on/off rather than as a mandate.
 */
const HOUSE_STATUS_TEXT: Record<RequirementStatus, string> = {
  required: 'on',
  'do-not-use': 'off',
  'not-stated': 'not stated'
}

function StatusBadge({ status, house = false }: { status: RequirementStatus; house?: boolean }): JSX.Element {
  return (
    <span className={`req-panel__badge req-panel__badge--${status}`}>
      {(house ? HOUSE_STATUS_TEXT : STATUS_TEXT)[status]}
    </span>
  )
}

function FactRows({ facts }: { facts: Fact[] }): JSX.Element {
  return (
    <div className="req-panel__facts">
      {facts.map((f) => (
        <div key={f.label} className="req-panel__fact">
          <span className="req-panel__fact-label">{f.label}</span>
          <span className="req-panel__fact-value">{f.value}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Requirements summary — the right half of the export page. Entirely
 * schema-driven off the selected PublisherProfile (requirements.ts derives
 * the rows), so it stays correct for whichever journal is picked. Everything
 * here is INFORMATIONAL: it shows what the journal's author guidelines state
 * (null = "not stated", rendered as such, never invented) — SUNA flags
 * mismatches in the compliance check but never enforces any of it. For the
 * SUNA house style the explainer says so plainly: those rules are ours, not
 * a publisher's, and the panel must not dress them up as somebody's
 * guidelines.
 *
 * `articleTypeId` (the dialog's Article type selector; null = None) narrows
 * the view: the selected type is spotlighted with its limits and the other
 * types recede, so the user sees exactly the numbers that apply to what they
 * are submitting. With None, every type shows equally — the generic summary.
 */
export function RequirementsPanel({
  profile,
  articleTypeId = null
}: {
  profile: PublisherProfile
  articleTypeId?: string | null
}): JSX.Element {
  const req = useMemo(() => profileRequirements(profile), [profile])
  const house = req.publisher === HOUSE_PUBLISHER
  const selectedType = articleTypeId === null ? null : (req.articleTypes.find((t) => t.id === articleTypeId) ?? null)

  return (
    <div className="req-panel">
      <div className="req-panel__head">
        <div className="req-panel__journal">{req.journalName}</div>
        <div className="req-panel__publisher">
          {req.publisher} · {house ? 'revised' : 'verified'} {req.lastVerified}
        </div>
        <p className="req-panel__explainer">
          {house
            ? 'SUNA\u2019s own house conventions \u2014 an internal style we invented, not any journal\u2019s guidelines. It states what we do and stays silent everywhere else, so a draft is never flagged for a rule nobody made.'
            : 'The journal\u2019s own stated requirements, from its author guidelines \u2014 shown for reference. SUNA flags mismatches; it never silently reformats.'}
        </p>
      </div>

      {req.submission !== null && (
        <section className="req-panel__section">
          <div className="req-panel__section-title">Submission format</div>
          <div className="req-panel__status-rows">
            {req.submission.rows.map((row) => (
              <div key={row.id} className="req-panel__status-row">
                <span className="req-panel__status-label">{row.label}</span>
                <StatusBadge status={row.status} house={house} />
              </div>
            ))}
          </div>
          {req.submission.fileTypes.length > 0 && (
            <div className="req-panel__chips">
              <span className="req-panel__chips-label">{house ? 'Formats we exchange' : 'Accepted files'}</span>
              {req.submission.fileTypes.map((t) => (
                <span key={t} className="req-panel__chip">
                  {t}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {req.articleTypes.length > 0 && (
        <section className="req-panel__section">
          <div className="req-panel__section-title">
            {selectedType !== null ? 'Your article type' : 'Article types'}
          </div>
          {req.articleTypes.map((t) => {
            const active = selectedType !== null && t.id === selectedType.id
            const muted = selectedType !== null && t.id !== selectedType.id
            return (
              <div
                key={t.id}
                className={`req-panel__article-type${active ? ' req-panel__article-type--active' : ''}${muted ? ' req-panel__article-type--muted' : ''}`}
              >
                <span className="req-panel__article-name">{t.name}</span>
                {t.chips.map((chip) => (
                  <span key={chip} className="req-panel__chip req-panel__chip--limit">
                    {chip}
                  </span>
                ))}
                {t.chips.length === 0 && <span className="req-panel__none">no stated limits</span>}
              </div>
            )
          })}
        </section>
      )}

      {req.sections.length > 0 && (
        <section className="req-panel__section">
          <div className="req-panel__section-title">Required sections</div>
          <div className="req-panel__chips req-panel__chips--wrap">
            {req.sections.map((s) => (
              <span
                key={s.id}
                className={`req-panel__chip ${s.required ? '' : 'req-panel__chip--optional'}`}
              >
                {s.label}
                {!s.required && <span className="req-panel__optional"> (optional)</span>}
              </span>
            ))}
          </div>
        </section>
      )}

      {req.citations.length > 0 && (
        <section className="req-panel__section">
          <div className="req-panel__section-title">Citations &amp; references</div>
          <FactRows facts={req.citations} />
        </section>
      )}

      {req.figures !== null && (
        <section className="req-panel__section">
          <div className="req-panel__section-title">Figures</div>
          {req.figures.widthChips.length > 0 && (
            <div className="req-panel__chips">
              {req.figures.widthChips.map((w) => (
                <span key={w} className="req-panel__chip">
                  {w}
                </span>
              ))}
            </div>
          )}
          {(req.figures.vectorFormats.length > 0 || req.figures.rasterFormats.length > 0) && (
            <div className="req-panel__chips">
              <span className="req-panel__chips-label">Formats</span>
              {req.figures.vectorFormats.map((f) => (
                <span key={f} className="req-panel__chip req-panel__chip--vector">
                  {f} · vector preferred
                </span>
              ))}
              {req.figures.rasterFormats.map((f) => (
                <span key={f} className="req-panel__chip">
                  {f}
                </span>
              ))}
            </div>
          )}
          {req.figures.facts.length > 0 && <FactRows facts={req.figures.facts} />}
        </section>
      )}

      {req.availability.length > 0 && (
        <section className="req-panel__section">
          <div className="req-panel__section-title">Availability statements</div>
          <FactRows facts={req.availability} />
        </section>
      )}

      {req.notes.length > 0 && (
        <section className="req-panel__section">
          <div className="req-panel__section-title">Notes</div>
          <ul className="req-panel__notes">
            {req.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      {req.sources.length > 0 && (
        <div className="req-panel__sources">
          Source{req.sources.length === 1 ? '' : 's'}:{' '}
          {req.sources.map((source, i) => (
            <span key={source.url}>
              {i > 0 && ' · '}
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.label}
              </a>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
