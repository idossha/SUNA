import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { DEFAULT_PROJECT_DIRS } from '@suna/core'
import { PICKER_PROFILE_IDS, getBundledProfile, type BundledProfileId, type Diagnostic } from '@suna/formatter'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { useManuscriptStore } from '../state/manuscript'
import { useProjectStore } from '../state/project'
import { resolvePreviewProfileId } from '../state/renderProfile'
import { rasterizeManuscriptFigures } from './rasterizeFigures'
import { runComplianceCheck } from './complianceCheck'
import { RequirementsPanel } from './RequirementsPanel'
import { stanceTag } from './requirements'
import './export.css'

type ExportFormat = 'docx' | 'pdf' | 'html'
type ExportTarget = 'manuscript' | 'supplement'

const FORMAT_LABEL: Record<ExportFormat, string> = { docx: 'Word', pdf: 'PDF', html: 'Web page' }

/** The supplement source file convention (main's export-content.ts SUPPLEMENT_FILE). */
const SUPPLEMENT_FILE = 'supplementary.md'

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
 * Export page (feature-plan-6 §5): the left column holds the controls —
 * format, profile (defaults to the project's), output name, submission-format
 * options — and the right column is a dynamic journal-requirements summary
 * (RequirementsPanel) for whichever profile is selected. A profile-stated
 * submission option (double spacing / line numbers) seeds the checkbox
 * default on profile switch but is NEVER forced: the journal's stance shows
 * as an informational tag and the user can override it. Runs the compliance
 * checker first and shows violations as non-blocking warnings; on Export,
 * rasterizes every manuscript figure to PNG at the profile's width/dpi
 * (rasterizeFigures.ts) and calls 'export:docx' / 'export:pdf'.
 */
export function ExportDialog({ params }: DockPanelProps): JSX.Element {
  const rootDir = String(params['rootDir'] ?? '')
  const manuscript = useManuscriptStore((s) => s.manuscript)
  const manifest = useProjectStore((s) => s.manifest)

  const defaultProfileId = resolvePreviewProfileId(undefined, manifest?.activeProfileId ?? null)

  const [format, setFormat] = useState<ExportFormat>('docx')
  const [target, setTarget] = useState<ExportTarget>('manuscript')
  /** null while the probe is in flight; the supplement option stays disabled until it lands. */
  const [supplementAvailable, setSupplementAvailable] = useState<boolean | null>(null)
  const [profileId, setProfileId] = useState<BundledProfileId>(defaultProfileId)
  /** '' = None: the requirements panel shows the generic journal overview. */
  const [articleTypeId, setArticleTypeId] = useState<string>('')
  const [outputName, setOutputName] = useState<string>('')
  const [doubleSpacing, setDoubleSpacing] = useState(true)
  const [lineNumbers, setLineNumbers] = useState(true)
  const [pageNumbers, setPageNumbers] = useState(true)

  const [diagnostics, setDiagnostics] = useState<Diagnostic[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const profile = getBundledProfile(profileId)

  // A hidden profile a project already points at stays selectable — the
  // picker offers the visible set plus, when needed, the current selection.
  const pickerIds: readonly BundledProfileId[] = PICKER_PROFILE_IDS.includes(profileId)
    ? PICKER_PROFILE_IDS
    : [...PICKER_PROFILE_IDS, profileId]

  // Article-type ids are journal-specific — switching journals resets the
  // selector to None (the generic overview).
  useEffect(() => {
    setArticleTypeId('')
  }, [profileId])

  // suna.json can remap the manuscript directory; fall back to the default
  // layout when the manifest is absent or leaves it unset.
  const manuscriptDir = manifest?.directories.manuscript ?? DEFAULT_PROJECT_DIRS.manuscript

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

  // Default output names per document target: <slug> for the manuscript,
  // <slug>-supplement for the supplement. Switching targets swaps the default
  // in place, but never clobbers a name the user typed themselves.
  const baseSlug = manuscript !== null ? slugify(manuscript.shortTitle || manuscript.title) : ''
  const defaultNameFor = (t: ExportTarget): string => (t === 'supplement' ? `${baseSlug}-supplement` : baseSlug)
  useEffect(() => {
    if (manuscript === null) return
    const other: ExportTarget = target === 'supplement' ? 'manuscript' : 'supplement'
    if (outputName === '' || outputName === defaultNameFor(other)) {
      setOutputName(defaultNameFor(target))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- defaultNameFor is derived from manuscript
  }, [manuscript, target, outputName])

  // Probe for manuscript/supplementary.md so the supplement target is only
  // offered when the file exists. Re-probed whenever the project tree could
  // have changed under us is overkill; on open is enough — a stale "missing"
  // simply keeps the option disabled until the panel reopens.
  useEffect(() => {
    if (rootDir === '') {
      setSupplementAvailable(false)
      return
    }
    let cancelled = false
    void window.suna
      .invoke('fs:list', { dir: `${rootDir}/${manuscriptDir}` })
      .then(({ root }) => {
        if (cancelled) return
        const present =
          root.kind === 'dir' && root.children.some((c) => c.kind === 'file' && c.name === SUPPLEMENT_FILE)
        setSupplementAvailable(present)
        if (!present) setTarget('manuscript')
      })
      .catch(() => {
        if (!cancelled) setSupplementAvailable(false)
      })
    return () => {
      cancelled = true
    }
  }, [rootDir, manuscriptDir])

  // Submission-format defaults: a profile-stated value seeds the checkbox on
  // every profile switch, but only as a DEFAULT — the checkbox stays enabled
  // and the user can override the journal's stance. A null value ("the
  // journal does not state this") leaves the prior user choice alone rather
  // than resetting it.
  useEffect(() => {
    if (profile === null) return
    const stated = profile.manuscript.submissionFormat.doubleSpacing
    if (stated !== null) setDoubleSpacing(stated)
    const statedLines = profile.manuscript.submissionFormat.lineNumbers
    if (statedLines !== null) setLineNumbers(statedLines)
  }, [profile])

  useEffect(() => {
    if (rootDir === '' || manuscript === null || profile === null || target === 'supplement') {
      // Compliance rules describe the MAIN manuscript; for the supplement
      // target the panel shows a note instead of running them.
      setDiagnostics(null)
      return
    }
    let cancelled = false
    setChecking(true)
    void runComplianceCheck(rootDir, manuscriptDir, manuscript, profile, articleTypeId || null)
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
  }, [rootDir, manuscriptDir, manuscript, profile, target, articleTypeId])

  const errorCount = useMemo(() => diagnostics?.filter((d) => d.severity === 'error').length ?? 0, [diagnostics])
  const warningCount = useMemo(
    () => diagnostics?.filter((d) => d.severity === 'warning').length ?? 0,
    [diagnostics]
  )

  // The journal's stated stance — informational only, never a lock.
  const doubleSpacingStated = profile?.manuscript.submissionFormat.doubleSpacing ?? null
  const lineNumbersStated = profile?.manuscript.submissionFormat.lineNumbers ?? null
  const journalName = profile?.journalName ?? ''
  const doubleSpacingTag = stanceTag(journalName, doubleSpacingStated)
  const lineNumbersTag = stanceTag(journalName, lineNumbersStated)

  const ready = rootDir !== '' && manuscript !== null && profile !== null && outputName.trim() !== '' && !busy

  const runExport = async (): Promise<void> => {
    if (!ready || manuscript === null || profile === null) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const figurePngPaths = await rasterizeManuscriptFigures(rootDir, manuscript, profile)
      const request = {
        dir: rootDir,
        profileId,
        outputName: outputName.trim(),
        figurePngPaths,
        options: { doubleSpacing, lineNumbers, pageNumbers },
        target
      }
      const channel = format === 'docx' ? ('export:docx' as const) : format === 'pdf' ? ('export:pdf' as const) : ('export:html' as const)
      const res = await window.suna.invoke(channel, request)
      setResult(res.path)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="export-dialog">
      <div className="export-dialog__columns">
        <div className="export-dialog__form">
          <div className="export-dialog__header">Export manuscript</div>

          {rootDir === '' || manuscript === null ? (
            <p className="export-dialog__hint">No manuscript to export in this project yet.</p>
          ) : (
            <>
              <label className="export-dialog__field export-dialog__field--wide">
                <span>Document</span>
                <select value={target} onChange={(e) => setTarget(e.target.value as ExportTarget)}>
                  <option value="manuscript">Manuscript</option>
                  <option value="supplement" disabled={supplementAvailable !== true}>
                    Supplementary Information
                    {supplementAvailable === false ? ` (no ${SUPPLEMENT_FILE})` : ''}
                  </option>
                </select>
              </label>

              <div className="export-dialog__row">
                <label className="export-dialog__field">
                  <span>Format</span>
                  <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
                    <option value="docx">Word (.docx)</option>
                    <option value="pdf">PDF</option>
                    <option value="html">Web page (.html)</option>
                  </select>
                </label>
                <label className="export-dialog__field">
                  <span>Journal profile</span>
                  <select value={profileId} onChange={(e) => setProfileId(e.target.value as BundledProfileId)}>
                    {pickerIds.map((id) => (
                      <option key={id} value={id}>
                        {getBundledProfile(id)?.journalName ?? id}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {profile !== null && profile.manuscript.articleTypes.length > 0 && (
                <label className="export-dialog__field export-dialog__field--wide">
                  <span>Article type</span>
                  <select value={articleTypeId} onChange={(e) => setArticleTypeId(e.target.value)}>
                    <option value="">None — generic journal overview</option>
                    {profile.manuscript.articleTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

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
              {format === 'html' && (
                <p className="export-dialog__hint">
                  The web page renders the reading layout — print options do not apply.
                </p>
              )}
              <label className="export-dialog__checkbox">
                <input
                  type="checkbox"
                  disabled={format === 'html'}
                  checked={doubleSpacing}
                  onChange={(e) => setDoubleSpacing(e.target.checked)}
                />
                Double spacing
                {doubleSpacingTag !== null && <span className="export-dialog__stance">{doubleSpacingTag}</span>}
              </label>
              <label className="export-dialog__checkbox">
                <input
                  type="checkbox"
                  disabled={format === 'html'}
                  checked={lineNumbers}
                  onChange={(e) => setLineNumbers(e.target.checked)}
                />
                Line numbers
                {lineNumbersTag !== null && <span className="export-dialog__stance">{lineNumbersTag}</span>}
              </label>
              <label className="export-dialog__checkbox">
                <input
                  type="checkbox"
                  disabled={format === 'html'}
                  checked={pageNumbers}
                  onChange={(e) => setPageNumbers(e.target.checked)}
                />
                Page numbers
              </label>
              <div className="export-dialog__title">Compliance check</div>
              {target === 'supplement' && (
                <p className="export-dialog__hint">
                  Compliance checks apply to the main manuscript — they are not run for the
                  Supplementary Information document.
                </p>
              )}
              {target !== 'supplement' && checking && (
                <p className="export-dialog__hint">Checking against {profile?.journalName}…</p>
              )}
              {!checking && diagnostics !== null && diagnostics.length === 0 && (
                <p className="export-dialog__hint export-dialog__hint--ok">No issues found.</p>
              )}
              {!checking && diagnostics !== null && diagnostics.length > 0 && (
                <div className="export-dialog__diagnostics">
                  <p className="export-dialog__hint">
                    {errorCount > 0 && `${errorCount} error${errorCount === 1 ? '' : 's'}`}
                    {errorCount > 0 && warningCount > 0 && ', '}
                    {warningCount > 0 && `${warningCount} warning${warningCount === 1 ? '' : 's'}`} — export anyway
                    if you choose; nothing here blocks it.
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
                  {busy ? 'Exporting…' : `Export ${FORMAT_LABEL[format]}`}
                </button>
              </div>

              {result !== null && <p className="export-dialog__result">Exported → {result}</p>}
              {error !== null && <p className="export-dialog__error">{error}</p>}
            </>
          )}
        </div>

        {profile !== null && (
          <aside className="export-dialog__requirements">
            <RequirementsPanel profile={profile} articleTypeId={articleTypeId || null} />
          </aside>
        )}
      </div>
    </div>
  )
}
