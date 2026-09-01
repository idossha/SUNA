import { useEffect, useState, type JSX } from 'react'
import type { DocxAffiliationDraft, DocxAnalysis, DocxAuthorDraft } from '@suna/core'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { openManuscriptTab } from '../state/dock'
import { useProjectStore } from '../state/project'
import { useUiStore } from '../state/ui'
import './docximport.css'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function fileNameOf(path: string): string {
  return path.split('/').pop() ?? path
}

type Status = 'loading' | 'ready' | 'error'

/**
 * DOCX Import Review (DECISIONS 2026-08-15). Runs 'docx:analyze' on
 * mount, shows every front-matter heuristic's result with its `reason`, lets
 * the user correct title/authors/affiliations/abstract, and only calls
 * 'docx:commit' — which writes the project — when "Import" is pressed.
 * Nothing reaches disk before that.
 */
export function DocxImportTab({ api, params }: DockPanelProps): JSX.Element {
  const path = typeof params['path'] === 'string' ? params['path'] : ''
  const [status, setStatus] = useState<Status>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<DocxAnalysis | null>(null)
  const [committing, setCommitting] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [force, setForce] = useState(false)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setLoadError(null)
    window.suna
      .invoke('docx:analyze', { path })
      .then((res) => {
        if (cancelled) return
        setAnalysis(res.analysis)
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(errorMessage(err))
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [path])

  const patchAnalysis = (patch: Partial<DocxAnalysis>): void => {
    setAnalysis((a) => (a === null ? a : { ...a, ...patch }))
  }

  const updateAuthor = (index: number, patch: Partial<DocxAuthorDraft>): void => {
    setAnalysis((a) => {
      if (a === null) return a
      return { ...a, authors: a.authors.map((author, i) => (i === index ? { ...author, ...patch } : author)) }
    })
  }
  const removeAuthor = (index: number): void => {
    setAnalysis((a) => (a === null ? a : { ...a, authors: a.authors.filter((_, i) => i !== index) }))
  }
  const addAuthor = (): void => {
    setAnalysis((a) =>
      a === null
        ? a
        : {
            ...a,
            authors: [...a.authors, { name: '', given: '', family: '', markers: [], affiliationRefs: [] }]
          }
    )
  }

  const updateAffiliation = (index: number, patch: Partial<DocxAffiliationDraft>): void => {
    setAnalysis((a) => {
      if (a === null) return a
      return { ...a, affiliations: a.affiliations.map((aff, i) => (i === index ? { ...aff, ...patch } : aff)) }
    })
  }
  const removeAffiliation = (index: number): void => {
    setAnalysis((a) => (a === null ? a : { ...a, affiliations: a.affiliations.filter((_, i) => i !== index) }))
  }
  const addAffiliation = (): void => {
    setAnalysis((a) =>
      a === null ? a : { ...a, affiliations: [...a.affiliations, { marker: String(a.affiliations.length + 1), text: '' }] }
    )
  }

  const runImport = async (): Promise<void> => {
    if (analysis === null) return
    setCommitError(null)
    const picked = await window.suna.invoke('dialog:pick-directory', {
      title: 'Choose a folder for the imported project',
      allowCreate: true
    })
    if (picked.path === null) return
    const dir = picked.path
    setCommitting(true)
    try {
      const { dir: written } = await window.suna.invoke('docx:commit', { analysis, dir, force })
      const opened = await window.suna.invoke('project:open', { dir: written })
      useProjectStore.setState({ rootDir: written, manifest: opened.manifest, tree: null })
      await useProjectStore.getState().refreshTree()
      useUiStore.getState().setStatusNote(`Imported “${opened.manifest.name}” from ${fileNameOf(path)}`)
      openManuscriptTab(written)
      api.close()
    } catch (err) {
      setCommitError(errorMessage(err))
    } finally {
      setCommitting(false)
    }
  }

  return (
    <div className="docximport">
      <div className="docximport__header">
        <div>
          <div className="docximport__eyebrow">Import manuscript</div>
          <div className="docximport__title">{fileNameOf(path)}</div>
        </div>
        <button className="docximport__cancel" onClick={() => api.close()}>
          Close
        </button>
      </div>

      {status === 'loading' && (
        <div className="docximport__body docximport__body--center">
          <p className="docximport__loading">Analyzing {fileNameOf(path)}…</p>
        </div>
      )}

      {status === 'error' && (
        <div className="docximport__body docximport__body--center">
          <div className="docximport__error">Could not analyze this file: {loadError}</div>
        </div>
      )}

      {status === 'ready' && analysis !== null && (
        <>
          <div className="docximport__body">
            <p className="docximport__hint">
              Nothing has been written yet. Review and correct what was detected below, then Import.
            </p>

            <div className="docximport__summary">
              <div>
                <span>Sections</span> {analysis.sections.length}
              </div>
              <div>
                <span>References</span> {analysis.references.length} ({analysis.citationReport.mappedCount} in-text
                citations mapped, {analysis.citationReport.literalCount} left literal)
              </div>
              <div>
                <span>Figures</span> {analysis.figures.length} extracted
              </div>
              <div>
                <span>Warnings</span> {analysis.warnings.length}
              </div>
            </div>

            <div className="docximport__field">
              <label htmlFor="docximport-title">Title</label>
              <input
                id="docximport-title"
                type="text"
                value={analysis.title.value ?? ''}
                onChange={(e) => patchAnalysis({ title: { value: e.target.value, reason: analysis.title.reason } })}
              />
              <div className="docximport__field-hint">Detected: {analysis.title.reason}</div>
            </div>

            <div className="docximport__field">
              <label>Authors</label>
              <div className="docximport__field-hint">Detected: {analysis.authorsReason}</div>
              <div className="docximport__rows">
                {analysis.authors.map((author, i) => (
                  <div className="docximport__author-row" key={i}>
                    <input
                      type="text"
                      placeholder="Given"
                      value={author.given}
                      onChange={(e) => updateAuthor(i, { given: e.target.value })}
                    />
                    <input
                      type="text"
                      placeholder="Family"
                      value={author.family}
                      onChange={(e) => updateAuthor(i, { family: e.target.value })}
                    />
                    <input
                      type="text"
                      placeholder="Affiliation markers (e.g. 1,2)"
                      value={author.affiliationRefs.join(',')}
                      onChange={(e) =>
                        updateAuthor(i, {
                          affiliationRefs: e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter((s) => s !== '')
                        })
                      }
                    />
                    <button className="docximport__row-remove" onClick={() => removeAuthor(i)} title="Remove author">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button className="docximport__row-add" onClick={addAuthor}>
                + Add author
              </button>
            </div>

            <div className="docximport__field">
              <label>Affiliations</label>
              <div className="docximport__field-hint">Detected: {analysis.affiliationsReason}</div>
              <div className="docximport__rows">
                {analysis.affiliations.map((aff, i) => (
                  <div className="docximport__affiliation-row" key={i}>
                    <input
                      type="text"
                      className="docximport__marker-input"
                      placeholder="#"
                      value={aff.marker}
                      onChange={(e) => updateAffiliation(i, { marker: e.target.value })}
                    />
                    <input
                      type="text"
                      placeholder="Institution, city, country"
                      value={aff.text}
                      onChange={(e) => updateAffiliation(i, { text: e.target.value })}
                    />
                    <button
                      className="docximport__row-remove"
                      onClick={() => removeAffiliation(i)}
                      title="Remove affiliation"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button className="docximport__row-add" onClick={addAffiliation}>
                + Add affiliation
              </button>
            </div>

            <div className="docximport__field">
              <label htmlFor="docximport-abstract">Abstract</label>
              <textarea
                id="docximport-abstract"
                rows={5}
                value={analysis.abstract.value ?? ''}
                onChange={(e) =>
                  patchAnalysis({ abstract: { value: e.target.value, reason: analysis.abstract.reason } })
                }
              />
              <div className="docximport__field-hint">Detected: {analysis.abstract.reason}</div>
            </div>

            <div className="docximport__review-grid">
              <div className="docximport__review-section">
                <div className="docximport__review-label">Sections ({analysis.sections.length})</div>
                <div className="docximport__list">
                  {analysis.sections.map((s, i) => (
                    <div className="docximport__list-row" key={i}>
                      <span className="docximport__list-badge">h{s.level}</span>
                      {s.heading ?? '(untitled — introductory text)'}
                    </div>
                  ))}
                  {analysis.sections.length === 0 && <div className="docximport__list-empty">No sections detected.</div>}
                </div>
              </div>

              <div className="docximport__review-section">
                <div className="docximport__review-label">References ({analysis.references.length})</div>
                <div className="docximport__list">
                  {analysis.references.map((r, i) => (
                    <div className="docximport__list-row" key={i}>
                      <span className="docximport__list-badge">{r.style}</span>
                      <span className="docximport__list-key">@{r.citeKey}</span> {r.title ?? r.raw}
                    </div>
                  ))}
                  {analysis.references.length === 0 && (
                    <div className="docximport__list-empty">No references section detected.</div>
                  )}
                </div>
              </div>
            </div>

            {analysis.warnings.length > 0 && (
              <div className="docximport__review-section">
                <div className="docximport__review-label">Warnings ({analysis.warnings.length})</div>
                <div className="docximport__list">
                  {analysis.warnings.map((w, i) => (
                    <div className="docximport__warning-row" key={i}>
                      <span className="docximport__list-badge docximport__list-badge--warn">{w.code}</span>
                      {w.message}
                      {w.context !== null && <span className="docximport__warning-context"> — “{w.context}”</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {commitError !== null && (
              <div className="docximport__error">
                {commitError}
                {/force/i.test(commitError) === false && /not empty/i.test(commitError) && (
                  <span> Check “Import into a non-empty folder” below and try again.</span>
                )}
              </div>
            )}
          </div>

          <div className="docximport__footer">
            <label className="docximport__force">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
              Import into a non-empty folder
            </label>
            <button className="docximport__import" onClick={() => void runImport()} disabled={committing}>
              {committing ? 'Importing…' : 'Import into new project…'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
