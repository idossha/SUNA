import { useMemo, type JSX } from 'react'
import type { PublisherProfile } from '@suna/core'
import { profileRequirements, type Fact, type RequirementStatus } from './requirements'

const STATUS_TEXT: Record<RequirementStatus, string> = {
  required: 'required',
  'do-not-use': 'do not use',
  'not-stated': 'not stated'
}

function StatusBadge({ status }: { status: RequirementStatus }): JSX.Element {
  return <span className={`req-panel__badge req-panel__badge--${status}`}>{STATUS_TEXT[status]}</span>
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
 * Journal-requirements summary — the right half of the export page. Entirely
 * schema-driven off the selected PublisherProfile (requirements.ts derives
 * the rows), so it stays correct for whichever journal is picked. Everything
 * here is INFORMATIONAL: it shows what the journal's author guidelines state
 * (null = "not stated", rendered as such, never invented) — SUNA flags
 * mismatches in the compliance check but never enforces any of it.
 */
export function RequirementsPanel({ profile }: { profile: PublisherProfile }): JSX.Element {
  const req = useMemo(() => profileRequirements(profile), [profile])

  return (
    <div className="req-panel">
      <div className="req-panel__head">
        <div className="req-panel__journal">{req.journalName}</div>
        <div className="req-panel__publisher">
          {req.publisher} · verified {req.lastVerified}
        </div>
        <p className="req-panel__explainer">
          The journal&rsquo;s own stated requirements, from its author guidelines — shown for reference. SUNA
          flags mismatches; it never silently reformats.
        </p>
      </div>

      {req.submission !== null && (
        <section className="req-panel__section">
          <div className="req-panel__section-title">Submission format</div>
          <div className="req-panel__status-rows">
            {req.submission.rows.map((row) => (
              <div key={row.id} className="req-panel__status-row">
                <span className="req-panel__status-label">{row.label}</span>
                <StatusBadge status={row.status} />
              </div>
            ))}
          </div>
          {req.submission.fileTypes.length > 0 && (
            <div className="req-panel__chips">
              <span className="req-panel__chips-label">Accepted files</span>
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
          <div className="req-panel__section-title">Article types</div>
          {req.articleTypes.map((t) => (
            <div key={t.id} className="req-panel__article-type">
              <span className="req-panel__article-name">{t.name}</span>
              {t.chips.map((chip) => (
                <span key={chip} className="req-panel__chip req-panel__chip--limit">
                  {chip}
                </span>
              ))}
              {t.chips.length === 0 && <span className="req-panel__none">no stated limits</span>}
            </div>
          ))}
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
