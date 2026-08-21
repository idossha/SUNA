import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { DEFAULT_PROJECT_DIRS, formatVersionId, workingVersion } from '@suna/core'
import { PICKER_PROFILE_IDS, getBundledProfile, type BundledProfileId, type Diagnostic } from '@suna/formatter'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { useManuscriptStore } from '../state/manuscript'
import { useProjectStore } from '../state/project'
import { refreshDocuments, useDocumentsStore } from '../state/documents'
import { HOUSE_PROFILE_ID, resolvePreviewProfileId } from '../state/renderProfile'
import { useEditorSettings } from '../editor/settings'
import { useResolved } from '../state/settings'
import { COMPRESSED_DPI, rasterizeManuscriptFigures } from './rasterizeFigures'
import { runComplianceCheck } from './complianceCheck'
import { ExportPreview } from './ExportPreview'
import { RequirementsPanel } from './RequirementsPanel'
import { stanceTag } from './requirements'
import { notifyExported } from './exportToast'
import { oversizedToastDetail } from './oversized'
import './export.css'

type ExportFormat = 'docx' | 'pdf' | 'html'
type ExportTarget = 'manuscript' | 'supplement'

const FORMAT_LABEL: Record<ExportFormat, string> = { docx: 'Word', pdf: 'PDF', html: 'Web page' }

/** The supplement source file convention (main's export-content.ts SUPPLEMENT_FILE). */
const SUPPLEMENT_FILE = 'supplementary.md'

function fileSizeLabel(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`
}

/** A file's size on disk, or null when it cannot be measured (never fatal). */
async function fileSizeOf(path: string): Promise<number | null> {
  try {
    const { bytes } = await window.suna.invoke('fs:file-size', { path })
    return bytes
  } catch {
    return null
  }
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
 *
 * Figure compression is the user's decision and nothing else's: a checkbox
 * in the Figures section, off by default, that a PDF / web-page export
 * honours by embedding the figures at COMPRESSED_DPI as JPEG instead of at
 * the profile's stated minimum as PNG. The app never compresses on its own
 * and never withholds the choice — the size of the result is shown either
 * way, and a full-resolution export that turns out too big can be rewritten
 * compressed in place by the Compress button beside it (which just flips the
 * same checkbox and re-exports).
 *
 * The Document picker only exists when there is a second document to pick:
 * a project with no manuscript/supplementary.md has exactly one thing to
 * export, and a one-choice selector is noise. It appears the moment a
 * supplement file does.
 */
export function ExportDialog({ params }: DockPanelProps): JSX.Element {
  const rootDir = String(params['rootDir'] ?? '')
  const manuscript = useManuscriptStore((s) => s.manuscript)
  const versions = useDocumentsStore((s) => s.versions)
  const manifest = useProjectStore((s) => s.manifest)
  // Reactive here, not read imperatively as the export does: the preview has
  // to repaint when the theme changes under it.
  const editorTheme = useEditorSettings((s) => s.editorTheme)

  // Which profile the page OPENS on, in the order somebody actually chose
  // it: the Settings 'Preview / render profile' (project or global) first,
  // then suna.json's activeProfileId, and failing both the SUNA house style.
  // Nothing infers a journal — an export is house style until someone says
  // otherwise, and the picker below is the last word for this one export.
  const { value: settingsProfileId } = useResolved('previewProfileId')
  const defaultProfileId = resolvePreviewProfileId(
    settingsProfileId ?? undefined,
    manifest?.activeProfileId ?? null
  )

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
  /**
   * Compress the embedded figures? The user's call, always — never inferred
   * from how big the file turned out. Off by default, because the export a
   * journal receives has to keep the profile's stated resolution.
   */
  const [compressFigures, setCompressFigures] = useState(false)

  const [diagnostics, setDiagnostics] = useState<Diagnostic[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [resultBytes, setResultBytes] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Size of the last export before it was compressed — drives the "8.4 MB → 1.2 MB" line. */
  const [compressedFrom, setCompressedFrom] = useState<number | null>(null)
  /** Whether the file now on disk was written with compressed figures. */
  const [resultCompressed, setResultCompressed] = useState(false)
  const [compressing, setCompressing] = useState(false)
  /** Which panel owns the right-hand column. Preview first — it is the reason to look. */
  const [rightTab, setRightTab] = useState<'preview' | 'requirements'>('preview')

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

  // manifest and settings both load asynchronously after mount — seed the
  // profile picker once, the moment the resolution first has real inputs to
  // work with, rather than being stuck on the house-style fallback for the
  // rest of the panel's life. Only once: after that the picker is the user's.
  const profileSeeded = useRef(false)
  useEffect(() => {
    if (!profileSeeded.current && manifest !== null) {
      profileSeeded.current = true
      setProfileId(defaultProfileId)
    }
  }, [manifest, defaultProfileId])

  // Default output names per document target: manuscript_<version> for the
  // manuscript, manuscript_<version>-supplement for the supplement, where the
  // version is the one the working copy currently carries (the number a log
  // would freeze). Switching targets swaps the default in place, and a newly
  // loaded version list re-seeds it — but neither ever clobbers a name the
  // user typed themselves.
  // The export panel can be the first thing opened in a session, before any
  // view has pulled the registry in — ask for it once so the version in the
  // default name is the real one.
  useEffect(() => {
    refreshDocuments()
  }, [rootDir])

  const workingId = formatVersionId(workingVersion(versions))
  const defaultNameFor = (t: ExportTarget): string =>
    t === 'supplement' ? `manuscript_${workingId}-supplement` : `manuscript_${workingId}`
  const lastDefault = useRef('')
  useEffect(() => {
    if (manuscript === null) return
    const next = defaultNameFor(target)
    if (outputName === '' || outputName === lastDefault.current) {
      lastDefault.current = next
      setOutputName(next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- defaultNameFor is derived from manuscript/versions
  }, [manuscript, target, outputName, workingId])

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
    const statedPages = profile.manuscript.submissionFormat.pageNumbers ?? null
    if (statedPages !== null) setPageNumbers(statedPages)
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
  // SUNA style states these as our own house conventions; a journal profile
  // reports what that journal requires. Same tri-state, different sentence.
  const house = profileId === HOUSE_PROFILE_ID
  const doubleSpacingTag = stanceTag(journalName, doubleSpacingStated, house)
  const lineNumbersTag = stanceTag(journalName, lineNumbersStated, house)
  const pageNumbersTag = stanceTag(journalName, profile?.manuscript.submissionFormat.pageNumbers ?? null, house)

  const ready = rootDir !== '' && manuscript !== null && profile !== null && outputName.trim() !== '' && !busy

  /**
   * One export pass. `compress` re-embeds the figures at COMPRESSED_DPI as
   * JPEG (rasterizeFigures.ts) instead of at the profile's minimum dpi as
   * PNG, and writes over the same output file — the uncompressed document is
   * always one more Export click away.
   */
  const exportOnce = async (compress: boolean): Promise<{ path: string; detail?: string }> => {
    if (manuscript === null || profile === null) throw new Error('nothing to export')
    const figurePngPaths = await rasterizeManuscriptFigures(rootDir, manuscript, profile, { compress })
    const request = {
      dir: rootDir,
      profileId,
      outputName: outputName.trim(),
      figurePngPaths,
      // The active editor theme rides along so the PDF / web page render in
      // the look the project is being written in (DOCX ignores it).
      options: { doubleSpacing, lineNumbers, pageNumbers, theme: editorTheme },
      target
    }
    const channel = format === 'docx' ? ('export:docx' as const) : format === 'pdf' ? ('export:pdf' as const) : ('export:html' as const)
    const res = await window.suna.invoke(channel, request)
    // Only the PDF writer measures the printed page, so only it can report a
    // block that overran it. The same overrun applies to a DOCX of the same
    // document (both writers resolve export-style.ts), which is why the live
    // preview — which renders DOCX as its own page geometry — reports it for
    // both; a Word export alone has nothing to measure with.
    const detail = 'oversized' in res ? oversizedToastDetail(res.oversized) : undefined
    return { path: res.path, detail }
  }

  const runExport = async (): Promise<void> => {
    if (!ready) return
    setBusy(true)
    setError(null)
    setResult(null)
    setResultBytes(null)
    setCompressedFrom(null)
    setResultCompressed(false)
    try {
      const { path, detail } = await exportOnce(compressFigures)
      setResult(path)
      const bytes = await fileSizeOf(path)
      setResultBytes(bytes)
      setResultCompressed(compressFigures)
      const size = bytes !== null ? fileSizeLabel(bytes) : undefined
      notifyExported(path, [size, detail].filter((part) => part !== undefined).join(' · ') || undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const runCompress = async (): Promise<void> => {
    if (result === null || compressing || busy) return
    const before = resultBytes
    setCompressing(true)
    setError(null)
    try {
      const { path } = await exportOnce(true)
      setResult(path)
      const bytes = await fileSizeOf(path)
      setResultBytes(bytes)
      setCompressedFrom(before)
      setResultCompressed(true)
      setCompressFigures(true)
      notifyExported(
        path,
        before !== null && bytes !== null
          ? `compressed ${fileSizeLabel(before)} → ${fileSizeLabel(bytes)}`
          : 'figures compressed'
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCompressing(false)
    }
  }

  /**
   * Compression applies to the two formats that EMBED the figures (the DOCX
   * writer wants real PNGs), and only when there are figures to compress.
   */
  const compressionApplies = format !== 'docx' && (manuscript?.figures.length ?? 0) > 0
  /** The after-the-fact offer: exported at full resolution, now sees the size. */
  const canCompressResult = compressionApplies && result !== null && !resultCompressed

  return (
    <div className="export-dialog">
      <div className="export-dialog__columns">
        <div className="export-dialog__form">
          <div className="export-dialog__header">Export manuscript</div>

          {rootDir === '' || manuscript === null ? (
            <p className="export-dialog__hint">No manuscript to export in this project yet.</p>
          ) : (
            <>
              {supplementAvailable === true && (
                <label className="export-dialog__field export-dialog__field--wide">
                  <span>Document</span>
                  <select value={target} onChange={(e) => setTarget(e.target.value as ExportTarget)}>
                    <option value="manuscript">Manuscript</option>
                    <option value="supplement">Supplementary Information</option>
                  </select>
                </label>
              )}

              {/* One field per row: the form column is ~350 px and a journal
                  name shares it with nothing without being cut in half. */}
              <label className="export-dialog__field export-dialog__field--wide">
                <span>Format</span>
                <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
                  <option value="docx">Word (.docx)</option>
                  <option value="pdf">PDF</option>
                  <option value="html">Web page (.html)</option>
                </select>
              </label>
              <label className="export-dialog__field export-dialog__field--wide">
                <span>Profile</span>
                <select value={profileId} onChange={(e) => setProfileId(e.target.value as BundledProfileId)}>
                  {pickerIds.map((id) => (
                    <option key={id} value={id}>
                      {getBundledProfile(id)?.journalName ?? id}
                    </option>
                  ))}
                </select>
              </label>

              {profile !== null && profile.manuscript.articleTypes.length > 0 && (
                <label className="export-dialog__field export-dialog__field--wide">
                  <span>Article type</span>
                  <select value={articleTypeId} onChange={(e) => setArticleTypeId(e.target.value)}>
                    <option value="">None — generic overview</option>
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
                {pageNumbersTag !== null && <span className="export-dialog__stance">{pageNumbersTag}</span>}
              </label>
              <div className="export-dialog__title">Figures</div>
              {!compressionApplies ? (
                <p className="export-dialog__hint">
                  {format === 'docx'
                    ? 'A Word export embeds the figures at the profile\u2019s resolution \u2014 compression is offered for PDF and web-page exports.'
                    : 'This manuscript has no figures to compress.'}
                </p>
              ) : (
                <>
                  <label className="export-dialog__checkbox">
                    <input
                      type="checkbox"
                      checked={compressFigures}
                      onChange={(e) => setCompressFigures(e.target.checked)}
                    />
                    Compress embedded figures
                    <span className="export-dialog__stance">{COMPRESSED_DPI} dpi JPEG</span>
                  </label>
                  <p className="export-dialog__hint">
                    {compressFigures
                      ? `Figures go in at ${COMPRESSED_DPI} dpi as JPEG \u2014 a much smaller file for sharing and review. Turn this off for a submission that must meet ${profile?.figures.formats.minDpi ?? 300} dpi.`
                      : `Figures go in at full resolution (${profile?.figures.formats.minDpi ?? 300} dpi PNG) \u2014 what a submission needs, and what makes the file large.`}
                  </p>
                </>
              )}

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

              {result !== null && (
                <p className="export-dialog__result">
                  Exported → {result}
                  {resultBytes !== null && ` (${fileSizeLabel(resultBytes)})`}
                  {resultCompressed && (
                    <span className="export-dialog__compressed-note">
                      {compressedFrom !== null && resultBytes !== null
                        ? `Compressed ${fileSizeLabel(compressedFrom)} → ${fileSizeLabel(resultBytes)} — figures re-embedded at ${COMPRESSED_DPI} dpi JPEG.`
                        : `Figures embedded at ${COMPRESSED_DPI} dpi JPEG.`}
                    </span>
                  )}
                </p>
              )}
              {canCompressResult && (
                <div className="export-dialog__compress">
                  <button
                    className="export-dialog__compress-btn"
                    disabled={compressing}
                    onClick={() => void runCompress()}
                  >
                    {compressing ? 'Compressing…' : 'Compress figures'}
                  </button>
                  <span className="export-dialog__hint">
                    Rewrites this {FORMAT_LABEL[format]} with its figures at {COMPRESSED_DPI} dpi JPEG. The
                    full-resolution file is one Export click away.
                  </span>
                </div>
              )}
              {error !== null && <p className="export-dialog__error">{error}</p>}
            </>
          )}
        </div>

        {profile !== null && (
          <aside className="export-dialog__right">
            <div className="export-dialog__tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={rightTab === 'preview'}
                className={rightTab === 'preview' ? 'is-active' : ''}
                onClick={() => setRightTab('preview')}
              >
                Preview
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={rightTab === 'requirements'}
                className={rightTab === 'requirements' ? 'is-active' : ''}
                onClick={() => setRightTab('requirements')}
              >
                {house ? 'House style' : 'Journal requirements'}
              </button>
            </div>
            {/* Both stay MOUNTED: switching tabs must not throw away a
                rendered preview and pay for it again on the way back. */}
            <div hidden={rightTab !== 'preview'} className="export-dialog__tabpanel">
              {rootDir !== '' && manuscript !== null && (
                <ExportPreview
                  rootDir={rootDir}
                  manuscript={manuscript}
                  profile={profile}
                  profileId={profileId}
                  format={format}
                  target={target}
                  doubleSpacing={doubleSpacing}
                  lineNumbers={lineNumbers}
                  pageNumbers={pageNumbers}
                  theme={editorTheme}
                />
              )}
            </div>
            <div hidden={rightTab !== 'requirements'} className="export-dialog__tabpanel export-dialog__tabpanel--scroll">
              <RequirementsPanel profile={profile} articleTypeId={articleTypeId || null} />
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
