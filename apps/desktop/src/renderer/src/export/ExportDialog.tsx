import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { BUNDLED_PROFILE_IDS, getBundledProfile, type BundledProfileId, type Diagnostic } from '@suna/formatter'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { useManuscriptStore } from '../state/manuscript'
import { useProjectStore } from '../state/project'
import { resolvePreviewProfileId } from '../state/renderProfile'
import { rasterizeManuscriptFigures } from './rasterizeFigures'
import { runComplianceCheck } from './complianceCheck'
import './export.css'

type ExportFormat = 'docx' | 'pdf'

/** Lowercase, hyphenated, ASCII — a reasonable default output/<name>.<ext>. */
function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base === '' ? 'manuscript' : base
}

function severityDot(severity: Diagnostic['severity']): string {
  return severity === 'error' ? 'export-dialog__dot--error' : 'export-dialog__dot--warning'
}

/**
 * Export dialog (feature-plan-6 §5): choose format, profile (defaults to
 * the project's), and the submission-format options the active profile
 * leaves optional; runs the compliance checker first and shows violations
 * as non-blocking warnings; on Export, rasterizes every manuscript figure to
 * PNG at the profile's width/dpi (rasterizeFigures.ts) and calls
 * 'export:docx' / 'export:pdf'.
 */
export function ExportDialog({ params }: DockPanelProps): JSX.Element {
  const rootDir = String(params['rootDir'] ?? '')
  const manuscript = useManuscriptStore((s) => s.manuscript)
  const manifest = useProjectStore((s) => s.manifest)

  const defaultProfileId = resolvePreviewProfileId(undefined, manifest?.activeProfileId ?? null)

  const [format, setFormat] = useState<ExportFormat>('docx')
  const [profileId, setProfileId] = useState<BundledProfileId>(defaultProfileId)
  const [outputName, setOutputName] = useState<string>('')
  const [doubleSpacing, setDoubleSpacing] = useState(true)
  const [lineNumbers, setLineNumbers] = useState(true)
  const [pageNumbers, setPageNumbers] = useState(true)
  const [useDocxTools, setUseDocxTools] = useState(false)
  const [docxToolsAvailable, setDocxToolsAvailable] = useState(false)

  const [diagnostics, setDiagnostics] = useState<Diagnostic[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const profile = getBundledProfile(profileId)

  // manifest loads asynchronously after mount — seed the profile picker from
  // it once, the moment it arrives, rather than being stuck on the
  // pre-manifest fallback for the rest of the panel's life.
  const profileSeeded = useRef(false)
  useEffect(() => {
    if (!profileSeeded.current && manifest !== null) {
      profileSeeded.current = true
      setProfileId(resolvePreviewProfileId(undefined, manifest.activeProfileId))
    }
  }, [manifest])

  useEffect(() => {
    if (outputName === '' && manuscript !== null) {
      setOutputName(slugify(manuscript.shortTitle || manuscript.title))
    }
  }, [manuscript, outputName])

  useEffect(() => {
    void window.suna.invoke('export:tools-available', {}).then(({ docxTools }) => {
      setDocxToolsAvailable(docxTools)
      if (!docxTools) setUseDocxTools(false)
    })
  }, [])

  // Submission-format defaults: a profile-stated value is forced (and the
  // checkbox below disables); a null value leaves the prior user choice
  // alone rather than resetting it on every profile switch.
  useEffect(() => {
    if (profile === null) return
    const stated = profile.manuscript.submissionFormat.doubleSpacing
    if (stated !== null) setDoubleSpacing(stated)
    const statedLines = profile.manuscript.submissionFormat.lineNumbers
    if (statedLines !== null) setLineNumbers(statedLines)
  }, [profile])

  useEffect(() => {
    if (rootDir === '' || manuscript === null || profile === null) {
      setDiagnostics(null)
      return
    }
    let cancelled = false
    setChecking(true)
    void runComplianceCheck(rootDir, manuscript, profile)
      .then((result) => {
        if (!cancelled) setDiagnostics(result)
      })
      .catch((err) => {
        if (!cancelled) setDiagnostics([])
        console.warn('compliance check failed:', err)
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [rootDir, manuscript, profile])

  const errorCount = useMemo(() => diagnostics?.filter((d) => d.severity === 'error').length ?? 0, [diagnostics])
  const warningCount = useMemo(
    () => diagnostics?.filter((d) => d.severity === 'warning').length ?? 0,
    [diagnostics]
  )

  const doubleSpacingForced = profile?.manuscript.submissionFormat.doubleSpacing !== null
  const lineNumbersForced = profile?.manuscript.submissionFormat.lineNumbers !== null

  const ready = rootDir !== '' && manuscript !== null && profile !== null && outputName.trim() !== '' && !busy

  const runExport = async (): Promise<void> => {
    if (!ready || manuscript === null || profile === null) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const figurePngPaths = await rasterizeManuscriptFigures(rootDir, manuscript, profile)
      const options = { doubleSpacing, lineNumbers, pageNumbers }
      if (format === 'docx') {
        const res = await window.suna.invoke('export:docx', {
          dir: rootDir,
          profileId,
          outputName: outputName.trim(),
          figurePngPaths,
          options,
          useDocxTools: useDocxTools && docxToolsAvailable
        })
        setResult(res.usedDocxTools ? `${res.path} (built via docx-tools)` : res.path)
      } else {
        const res = await window.suna.invoke('export:pdf', {
          dir: rootDir,
          profileId,
          outputName: outputName.trim(),
          figurePngPaths,
          options
        })
        setResult(res.path)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="export-dialog">
      <div className="export-dialog__header">Export manuscript</div>

      {rootDir === '' || manuscript === null ? (
        <p className="export-dialog__hint">No manuscript to export in this project yet.</p>
      ) : (
        <>
          <div className="export-dialog__row">
            <label className="export-dialog__field">
              <span>Format</span>
              <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
                <option value="docx">Word (.docx)</option>
                <option value="pdf">PDF</option>
              </select>
            </label>
            <label className="export-dialog__field">
              <span>Journal profile</span>
              <select value={profileId} onChange={(e) => setProfileId(e.target.value as BundledProfileId)}>
                {BUNDLED_PROFILE_IDS.map((id) => (
                  <option key={id} value={id}>
                    {getBundledProfile(id)?.journalName ?? id}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="export-dialog__field export-dialog__field--wide">
            <span>Output file name</span>
            <div className="export-dialog__filename">
              <input
                type="text"
                value={outputName}
                onChange={(e) => setOutputName(e.target.value)}
                placeholder="manuscript"
              />
              <span className="export-dialog__ext">.{format}</span>
            </div>
          </label>

          <div className="export-dialog__title">Submission format</div>
          <label className="export-dialog__checkbox">
            <input
              type="checkbox"
              checked={doubleSpacing}
              disabled={doubleSpacingForced}
              onChange={(e) => setDoubleSpacing(e.target.checked)}
            />
            Double spacing
            {doubleSpacingForced && <span className="export-dialog__forced">required by {profile?.journalName}</span>}
          </label>
          <label className="export-dialog__checkbox">
            <input
              type="checkbox"
              checked={lineNumbers}
              disabled={lineNumbersForced}
              onChange={(e) => setLineNumbers(e.target.checked)}
            />
            Line numbers
            {lineNumbersForced && <span className="export-dialog__forced">required by {profile?.journalName}</span>}
          </label>
          <label className="export-dialog__checkbox">
            <input type="checkbox" checked={pageNumbers} onChange={(e) => setPageNumbers(e.target.checked)} />
            Page numbers
          </label>
          {format === 'docx' && docxToolsAvailable && (
            <label className="export-dialog__checkbox">
              <input type="checkbox" checked={useDocxTools} onChange={(e) => setUseDocxTools(e.target.checked)} />
              Build via docx-tools <span className="export-dialog__forced">optional accelerator, detected on PATH</span>
            </label>
          )}

          <div className="export-dialog__title">Compliance check</div>
          {checking && <p className="export-dialog__hint">Checking against {profile?.journalName}…</p>}
          {!checking && diagnostics !== null && diagnostics.length === 0 && (
            <p className="export-dialog__hint export-dialog__hint--ok">No issues found.</p>
          )}
          {!checking && diagnostics !== null && diagnostics.length > 0 && (
            <div className="export-dialog__diagnostics">
              <p className="export-dialog__hint">
                {errorCount > 0 && `${errorCount} error${errorCount === 1 ? '' : 's'}`}
                {errorCount > 0 && warningCount > 0 && ', '}
                {warningCount > 0 && `${warningCount} warning${warningCount === 1 ? '' : 's'}`} — export anyway if you
                choose; nothing here blocks it.
              </p>
              {diagnostics.slice(0, 30).map((d, i) => (
                <div key={`${d.id}-${i}`} className="export-dialog__diag-row">
                  <span className={`export-dialog__dot ${severityDot(d.severity)}`} />
                  <span className="export-dialog__diag-msg">{d.message}</span>
                </div>
              ))}
            </div>
          )}

          <div className="export-dialog__actions">
            <button className="export-dialog__export" disabled={!ready} onClick={() => void runExport()}>
              {busy ? 'Exporting…' : `Export ${format === 'docx' ? 'Word' : 'PDF'}`}
            </button>
          </div>

          {result !== null && <p className="export-dialog__result">Exported → {result}</p>}
          {error !== null && <p className="export-dialog__error">{error}</p>}
        </>
      )}
    </div>
  )
}
