import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  DEFAULT_PROJECT_DIRS,
  ManuscriptSchema,
  formatVersionId,
  stageLabel,
  workingVersion,
  type CoverLetterMeta,
  type Manuscript
} from '@suna/core'
import {
  BUNDLED_PROFILE_IDS,
  checkLetter,
  getBundledProfile,
  letterRequirements,
  type BundledProfileId,
  type Diagnostic,
  type LetterRequirement
} from '@suna/formatter'
import type { DockPanelProps } from '../shell/dock/DockHost'
import { useManuscriptStore } from '../state/manuscript'
import { useProjectStore } from '../state/project'
import { refreshDocuments, useDocumentsStore } from '../state/documents'
import { HOUSE_PROFILE_ID, resolvePreviewProfileId } from '../state/renderProfile'
import { useEditorSettings } from '../editor/settings'
import { getResolved, useResolved } from '../state/settings'
import {
  COMPRESSION_PRESETS,
  DEFAULT_COMPRESSION_LEVEL,
  compressionPreset,
  rasterizeManuscriptFigures,
  type CompressionLevel
} from './rasterizeFigures'
import { runComplianceCheck } from './complianceCheck'
import { splitDiagnosticSources } from './diagSources'
import { ExportPreview, SimpleExportPreview } from './ExportPreview'
import { RequirementsPanel } from './RequirementsPanel'
import { stanceTag } from './requirements'
import { notifyExported } from './exportToast'
import { oversizedToastDetail } from './oversized'
import './export.css'

type ExportFormat = 'docx' | 'pdf' | 'html'
/** The four document kinds the one export page serves. */
type ExportKind = 'manuscript' | 'supplement' | 'letter' | 'response'

const FORMAT_LABEL: Record<ExportFormat, string> = { docx: 'Word', pdf: 'PDF', html: 'Web page' }

const KIND_LABEL: Record<ExportKind, string> = {
  manuscript: 'Manuscript',
  supplement: 'Supplementary Information',
  letter: 'Cover letter',
  response: 'Response to reviewers'
}

/** How many findings the list shows before it stops — the rest stay in review:check. */
const DIAGNOSTIC_LIMIT = 30

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

/** An archived version's manuscript content, loaded from under archive/<id>/. */
interface VersionedSource {
  /** null = the archived manuscript.json could not be read/parsed. */
  manuscript: Manuscript | null
  /** PROJECT-ROOT-RELATIVE directory the version's manuscript files live in. */
  contentRel: string
  /** rasterizeFigures svgBase, when the version archived a figures area. */
  svgBase?: string
}

/**
 * The unified export page (feature-plan-6 §5, extended): one surface for
 * everything the project exports — the manuscript, the Supplementary
 * Information, every cover letter and every response-to-reviewers round. The
 * left column holds the controls, the right column the live preview and the
 * journal's requirements. The Document selector funnels the four kinds into
 * this one page; it only exists when there is more than one thing to pick
 * (today's rule, kept).
 *
 * Per-kind behaviour:
 *  - Manuscript / supplement keep the journal pipeline: profile, article
 *    type, submission format, figure compression, compliance check, preview,
 *    and now a Version selector (any logged version exports as archived) and
 *    a Rendering control (classic black & white vs the editor colour theme).
 *  - Cover letters export through 'export:letter' — unconditionally; the
 *    venue's published letter requirements show in the right panel and the
 *    letter checker's findings in the diagnostics list, neither blocking.
 *  - Responses export through 'export:response', keeping the acknowledgment
 *    flow: a refusal over unaddressed points surfaces in-page, and "Export
 *    anyway" retries with acknowledgeUnaddressed.
 *
 * Nothing on this page ever blocks an export.
 */
export function ExportDialog({ api, params }: DockPanelProps): JSX.Element {
  const rootDir = String(params['rootDir'] ?? '')
  const manuscript = useManuscriptStore((s) => s.manuscript)
  const authorsFile = useManuscriptStore((s) => s.authors)
  const versions = useDocumentsStore((s) => s.versions)
  const documents = useDocumentsStore((s) => s.documents)
  const rounds = useDocumentsStore((s) => s.rounds)
  const manifest = useProjectStore((s) => s.manifest)
  // Reactive here, not read imperatively as the export does: the preview has
  // to repaint when the theme changes under it.
  const editorTheme = useEditorSettings((s) => s.editorTheme)

  // Which profile the page OPENS on, in the order somebody actually chose
  // it: the Settings 'Preview / render profile' (project or global) first,
  // then suna.json's activeProfileId, and failing both the SUNA house style.
  const { value: settingsProfileId } = useResolved('previewProfileId')
  const defaultProfileId = resolvePreviewProfileId(
    settingsProfileId ?? undefined,
    manifest?.activeProfileId ?? null
  )

  const [format, setFormat] = useState<ExportFormat>('docx')
  const [kind, setKind] = useState<ExportKind>('manuscript')
  /** Which cover letter, when the registry has several. */
  const [letterId, setLetterId] = useState<string>('')
  /** Which round, when the ledger has several. */
  const [roundId, setRoundId] = useState<string>('')
  /** null while the probe is in flight; the supplement option stays disabled until it lands. */
  const [supplementAvailable, setSupplementAvailable] = useState<boolean | null>(null)
  const [profileId, setProfileId] = useState<BundledProfileId>(defaultProfileId)
  /** '' = None: the requirements panel shows the generic journal overview. */
  const [articleTypeId, setArticleTypeId] = useState<string>('')
  const [outputName, setOutputName] = useState<string>('')
  const [doubleSpacing, setDoubleSpacing] = useState(
    () => getResolved('export.doubleSpacing').value
  )
  const [lineNumbers, setLineNumbers] = useState(() => getResolved('export.lineNumbers').value)
  const [pageNumbers, setPageNumbers] = useState(() => getResolved('export.pageNumbers').value)
  const [compressFigures, setCompressFigures] = useState(false)
  /** How hard the compressed pass squeezes — only meaningful while compression is on. */
  const [compressionLevel, setCompressionLevel] = useState<CompressionLevel>(DEFAULT_COMPRESSION_LEVEL)
  /**
   * Rendering: the classic black-and-white document, or the editor's colour
   * theme carried into the file. Seeded per format (html opens themed, the
   * print formats classic) until the user touches the control — after that
   * the choice is theirs across format switches.
   */
  const [rendering, setRendering] = useState<'bw' | 'theme'>('bw')
  const renderingTouched = useRef(false)
  /** '' = the current working copy; otherwise a logged version's id. */
  const [versionId, setVersionId] = useState<string>('')
  /** The archived version's content, once loaded; null while working-copy. */
  const [versioned, setVersioned] = useState<VersionedSource | null>(null)
  /** Paint the three voices of a response export; null = the settings default. */
  const [colorRolesPick, setColorRolesPick] = useState<boolean | null>(null)
  const { value: colorRolesDefault } = useResolved('response.colorRoles')
  const colorRoles = colorRolesPick ?? colorRolesDefault

  const [diagnostics, setDiagnostics] = useState<Diagnostic[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [resultBytes, setResultBytes] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Size of the last export before it was compressed — drives the "8.4 MB → 1.2 MB" line. */
  const [compressedFrom, setCompressedFrom] = useState<number | null>(null)
  const [resultCompressed, setResultCompressed] = useState(false)
  const [compressing, setCompressing] = useState(false)
  /**
   * A response export that main refused over unaddressed points: the
   * refusal's own message, held until the author cancels or exports anyway.
   */
  const [ackPending, setAckPending] = useState<string | null>(null)
  /** Which panel owns the right-hand column. Preview first — it is the reason to look. */
  const [rightTab, setRightTab] = useState<'preview' | 'requirements'>('preview')

  /** The letter's meta sidecar, loaded per selected letter. */
  const [letterMeta, setLetterMeta] = useState<CoverLetterMeta | null>(null)

  const profile = getBundledProfile(profileId)

  const manuscriptMode = kind === 'manuscript' || kind === 'supplement'

  // The letters offered include ARCHIVED ones — an archived letter is still
  // the author's file, and exporting it is how it gets circulated.
  const letters = useMemo(() => documents.filter((d) => d.kind === 'cover-letter'), [documents])
  const letterEntry = useMemo(() => letters.find((d) => d.id === letterId) ?? null, [letters, letterId])
  const round = useMemo(() => rounds.find((r) => r.id === roundId) ?? null, [rounds, roundId])

  // Seed the sub-pickers the moment their lists land, and heal a selection
  // whose entry disappeared (a deleted letter, a removed round).
  useEffect(() => {
    if (letters.length === 0) return
    if (letters.some((d) => d.id === letterId)) return
    setLetterId(letters[0]?.id ?? '')
  }, [letters, letterId])
  useEffect(() => {
    if (rounds.length === 0) return
    if (rounds.some((r) => r.id === roundId)) return
    setRoundId(rounds[0]?.id ?? '')
  }, [rounds, roundId])

  // The preselect: an Export button on a letter or round tab funnels here
  // with { kind, id } in the panel params, and re-funnels via dockview's
  // updateParameters when the panel already exists.
  useEffect(() => {
    const apply = (p: Record<string, unknown>): void => {
      const k = p['kind']
      if (k !== 'manuscript' && k !== 'supplement' && k !== 'letter' && k !== 'response') return
      setKind(k)
      const id = p['id']
      if (typeof id === 'string' && id !== '') {
        if (k === 'letter') setLetterId(id)
        if (k === 'response') setRoundId(id)
      }
    }
    apply(params)
    const disposable = api.onDidParametersChange((next) => {
      apply(next as Record<string, unknown>)
    })
    return () => disposable.dispose()
    // params is the INITIAL param object; later preselects arrive through the
    // subscription, so re-running on params identity would be redundant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  // Article-type ids are journal-specific — switching journals resets the
  // selector to None (the generic overview).
  useEffect(() => {
    setArticleTypeId('')
  }, [profileId])

  // The rendering default follows the format until the user takes the
  // control: print formats open classic, the web page opens in the theme.
  useEffect(() => {
    if (!renderingTouched.current) setRendering(format === 'html' ? 'theme' : 'bw')
  }, [format])

  // suna.json can remap the manuscript directory; fall back to the default
  // layout when the manifest is absent or leaves it unset.
  const manuscriptDir = manifest?.directories.manuscript ?? DEFAULT_PROJECT_DIRS.manuscript

  // manifest and settings both load asynchronously after mount — seed the
  // profile picker once, then it is the user's.
  const profileSeeded = useRef(false)
  useEffect(() => {
    if (!profileSeeded.current && manifest !== null) {
      profileSeeded.current = true
      setProfileId(defaultProfileId)
    }
  }, [manifest, defaultProfileId])

  // The export panel can be the first thing opened in a session — ask for
  // the registry once so letters, rounds and versions are real.
  useEffect(() => {
    refreshDocuments()
  }, [rootDir])

  // ------------------------------------------------------------------ //
  // Archived version loading (manuscript/supplement modes)             //
  // ------------------------------------------------------------------ //
  const versionRecord = useMemo(
    () => (versionId === '' ? null : (versions.find((v) => v.id === versionId) ?? null)),
    [versions, versionId]
  )
  useEffect(() => {
    if (versionId === '' || !manuscriptMode || rootDir === '') {
      setVersioned(null)
      return
    }
    // v2 archives record areas (archive/<id>/manuscript/…); v1 recorded the
    // manuscript files version-relative — the same resolution main's
    // resolveExportSource performs, mirrored for the renderer's own reads.
    const areaLayout = versionRecord === null ? true : versionRecord.schemaVersion === 2
    const contentRel = areaLayout
      ? `${manuscriptDir}/archive/${versionId}/manuscript`
      : `${manuscriptDir}/archive/${versionId}`
    const svgBase =
      versionRecord !== null && versionRecord.areas.includes('figures')
        ? `${manuscriptDir}/archive/${versionId}`
        : undefined
    let cancelled = false
    void window.suna
      .invoke('fs:read-text', { path: `${rootDir}/${contentRel}/manuscript.json` })
      .then(({ content }) => {
        if (cancelled) return
        const parsed = ManuscriptSchema.safeParse(JSON.parse(content) as unknown)
        setVersioned({
          manuscript: parsed.success ? parsed.data : null,
          contentRel,
          ...(svgBase === undefined ? {} : { svgBase })
        })
      })
      .catch(() => {
        if (!cancelled)
          setVersioned({ manuscript: null, contentRel, ...(svgBase === undefined ? {} : { svgBase }) })
      })
    return () => {
      cancelled = true
    }
  }, [versionId, manuscriptMode, rootDir, manuscriptDir, versionRecord])

  /** What this export is actually of: the archived manuscript when one is loaded. */
  const effManuscript = versionId !== '' ? (versioned?.manuscript ?? manuscript) : manuscript

  // ------------------------------------------------------------------ //
  // Default output names, per kind                                     //
  // ------------------------------------------------------------------ //
  const workingId = formatVersionId(workingVersion(versions))
  const defaultNameFor = (k: ExportKind): string => {
    const msVersion = versionId === '' ? workingId : versionId
    if (k === 'supplement') return `manuscript_${msVersion}-supplement`
    if (k === 'letter') return letterId === '' ? 'cover-letter' : letterId
    if (k === 'response') return roundId === '' ? 'response' : `response-${roundId}`
    return `manuscript_${msVersion}`
  }
  const lastDefault = useRef('')
  useEffect(() => {
    if (manuscriptMode && manuscript === null) return
    const next = defaultNameFor(kind)
    if (outputName === '' || outputName === lastDefault.current) {
      lastDefault.current = next
      setOutputName(next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- defaultNameFor is derived from the deps below
  }, [manuscript, kind, outputName, workingId, versionId, letterId, roundId])

  // Probe for manuscript/supplementary.md so the supplement target is only
  // offered when the file exists.
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
        if (!present) setKind((k) => (k === 'supplement' ? 'manuscript' : k))
      })
      .catch(() => {
        if (!cancelled) setSupplementAvailable(false)
      })
    return () => {
      cancelled = true
    }
  }, [rootDir, manuscriptDir])

  // Submission-format defaults: a profile-stated value seeds the checkbox on
  // every profile switch, but only as a DEFAULT.
  useEffect(() => {
    if (profile === null) return
    const stated = profile.manuscript.submissionFormat.doubleSpacing
    if (stated !== null) setDoubleSpacing(stated)
    const statedLines = profile.manuscript.submissionFormat.lineNumbers
    if (statedLines !== null) setLineNumbers(statedLines)
    const statedPages = profile.manuscript.submissionFormat.pageNumbers ?? null
    if (statedPages !== null) setPageNumbers(statedPages)
  }, [profile])

  // ------------------------------------------------------------------ //
  // Compliance: the manuscript checker for manuscript mode, the letter //
  // checker for letter mode. Response mode has its own gate in main.   //
  // ------------------------------------------------------------------ //
  const knownJournalNames = useMemo(
    () =>
      BUNDLED_PROFILE_IDS.map((id) => getBundledProfile(id)?.journalName).filter(
        (n): n is string => n !== undefined
      ),
    []
  )

  /** The profile a LETTER is checked against — the venue it targets, not the page's picker. */
  const letterProfile = useMemo(
    () => (letterMeta === null ? null : getBundledProfile(letterMeta.targetProfileId)),
    [letterMeta]
  )
  const letterReqs: LetterRequirement[] = useMemo(
    () => (letterProfile === null ? [] : letterRequirements(letterProfile)),
    [letterProfile]
  )

  useEffect(() => {
    if (kind !== 'manuscript' || rootDir === '' || profile === null) {
      if (kind !== 'letter') setDiagnostics(null)
      return
    }
    // Compliance rules describe the manuscript the export will contain: the
    // working copy, or the archived one in versioned mode. While the archived
    // manuscript.json is loading (or failed to load) there is nothing sound
    // to check against — the panel shows a hint instead.
    const checkedManuscript = versionId === '' ? manuscript : (versioned?.manuscript ?? null)
    const contentDir = versionId === '' ? manuscriptDir : (versioned?.contentRel ?? null)
    if (checkedManuscript === null || contentDir === null) {
      setDiagnostics(null)
      return
    }
    let cancelled = false
    setChecking(true)
    void runComplianceCheck(
      rootDir,
      contentDir,
      checkedManuscript,
      profile,
      articleTypeId || null,
      authorsFile.authors
    )
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
  }, [rootDir, manuscriptDir, manuscript, profile, kind, articleTypeId, versionId, versioned, authorsFile])

  // Letter mode: load the meta sidecar and the prose, run the letter checker.
  useEffect(() => {
    if (kind !== 'letter' || rootDir === '' || letterEntry === null) {
      setLetterMeta(null)
      return
    }
    let cancelled = false
    setChecking(true)
    void (async () => {
      let meta: CoverLetterMeta | undefined
      if (letterEntry.meta !== null) {
        try {
          const res = await window.suna.invoke('letter:read', { dir: rootDir, metaFile: letterEntry.meta })
          meta = res.meta
        } catch {
          meta = undefined
        }
      }
      if (cancelled) return
      setLetterMeta(meta ?? null)
      const target = meta === undefined ? null : getBundledProfile(meta.targetProfileId)
      if (target === null) {
        if (!cancelled) {
          setDiagnostics([])
          setChecking(false)
        }
        return
      }
      let letterText = ''
      if (letterEntry.file !== null) {
        try {
          const res = await window.suna.invoke('fs:read-text', {
            path: `${rootDir}/${manuscriptDir}/${letterEntry.file}`
          })
          letterText = res.content
        } catch {
          letterText = ''
        }
      }
      if (cancelled) return
      try {
        const diags = checkLetter({
          ...(meta === undefined ? {} : { meta }),
          letterText,
          profile: target,
          authors: authorsFile.authors,
          knownJournalNames
        })
        setDiagnostics(diags)
      } catch (err) {
        setDiagnostics([])
        console.warn('letter check failed:', err)
      }
      setChecking(false)
    })()
    return () => {
      cancelled = true
    }
  }, [kind, rootDir, letterEntry, manuscriptDir, authorsFile, knownJournalNames])

  const errorCount = useMemo(() => diagnostics?.filter((d) => d.severity === 'error').length ?? 0, [diagnostics])
  const warningCount = useMemo(
    () => diagnostics?.filter((d) => d.severity === 'warning').length ?? 0,
    [diagnostics]
  )
  const shownDiagnostics = useMemo(
    () => splitDiagnosticSources(diagnostics?.slice(0, DIAGNOSTIC_LIMIT) ?? []),
    [diagnostics]
  )

  // The journal's stated stance — informational only, never a lock.
  const doubleSpacingStated = profile?.manuscript.submissionFormat.doubleSpacing ?? null
  const lineNumbersStated = profile?.manuscript.submissionFormat.lineNumbers ?? null
  const journalName = profile?.journalName ?? ''
  const house = profileId === HOUSE_PROFILE_ID
  const doubleSpacingTag = stanceTag(journalName, doubleSpacingStated, house)
  const lineNumbersTag = stanceTag(journalName, lineNumbersStated, house)
  const pageNumbersTag = stanceTag(journalName, profile?.manuscript.submissionFormat.pageNumbers ?? null, house)

  const ready =
    rootDir !== '' &&
    outputName.trim() !== '' &&
    !busy &&
    (manuscriptMode
      ? manuscript !== null && profile !== null
      : kind === 'letter'
        ? letterEntry !== null
        : round !== null)

  /**
   * One manuscript/supplement export pass. `compress` re-embeds the figures
   * at the chosen level's dpi as JPEG instead of at the profile's minimum dpi as PNG.
   */
  const exportOnce = async (compress: boolean): Promise<{ path: string; detail?: string }> => {
    if (effManuscript === null || profile === null) throw new Error('nothing to export')
    const figurePngPaths = await rasterizeManuscriptFigures(rootDir, effManuscript, profile, {
      compress,
      compressionLevel,
      ...(versioned?.svgBase === undefined ? {} : { svgBase: versioned.svgBase })
    })
    const request = {
      dir: rootDir,
      profileId,
      outputName: outputName.trim(),
      figurePngPaths,
      // The editor theme rides along only when the user chose the themed
      // rendering; classic black & white is the absence of a theme.
      options: {
        doubleSpacing,
        lineNumbers,
        pageNumbers,
        ...(rendering === 'theme' ? { theme: editorTheme } : {})
      },
      target: kind === 'supplement' ? ('supplement' as const) : ('manuscript' as const),
      ...(versionId === '' ? {} : { versionId })
    }
    const channel = format === 'docx' ? ('export:docx' as const) : format === 'pdf' ? ('export:pdf' as const) : ('export:html' as const)
    const res = await window.suna.invoke(channel, request)
    const detail = 'oversized' in res ? oversizedToastDetail(res.oversized) : undefined
    return { path: res.path, detail }
  }

  /** A letter export: unconditional — compliance here is advisory, never a gate. */
  const exportLetter = async (): Promise<{ path: string }> => {
    if (letterEntry === null) throw new Error('no letter selected')
    return window.suna.invoke('export:letter', {
      dir: rootDir,
      documentId: letterEntry.id,
      format,
      outputName: outputName.trim()
    })
  }

  /**
   * A response export. Main refuses ONCE over unaddressed points; the refusal
   * surfaces in-page and "Export anyway" retries acknowledged.
   */
  const exportResponse = async (acknowledge: boolean): Promise<{ path: string }> => {
    if (round === null) throw new Error('no round selected')
    return window.suna.invoke('export:response', {
      dir: rootDir,
      roundId: round.id,
      format,
      outputName: outputName.trim(),
      acknowledgeUnaddressed: acknowledge,
      colorRoles
    })
  }

  const runExport = async (acknowledge = false): Promise<void> => {
    if (!ready) return
    setBusy(true)
    setError(null)
    setResult(null)
    setResultBytes(null)
    setCompressedFrom(null)
    setResultCompressed(false)
    setAckPending(null)
    try {
      let path: string
      let detail: string | undefined
      let compressed = false
      if (manuscriptMode) {
        const res = await exportOnce(compressFigures)
        path = res.path
        detail = res.detail
        compressed = compressFigures
      } else if (kind === 'letter') {
        path = (await exportLetter()).path
      } else {
        path = (await exportResponse(acknowledge)).path
      }
      setResult(path)
      const bytes = await fileSizeOf(path)
      setResultBytes(bytes)
      setResultCompressed(compressed)
      const size = bytes !== null ? fileSizeLabel(bytes) : undefined
      notifyExported(path, [size, detail].filter((part) => part !== undefined).join(' · ') || undefined)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (kind === 'response' && !acknowledge) {
        // The refusal names every unaddressed point — show it in place and
        // let the author decide whether to export the response as it stands.
        setAckPending(message)
      } else {
        setError(message)
      }
    } finally {
      setBusy(false)
    }
  }

  const runCompress = async (): Promise<void> => {
    if (result === null || compressing || busy || !manuscriptMode) return
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

  const activePreset = compressionPreset(compressionLevel)
  const compressionApplies =
    manuscriptMode && format !== 'docx' && (effManuscript?.figures.length ?? 0) > 0
  const canCompressResult = compressionApplies && result !== null && !resultCompressed

  // The Document selector exists when there is a second thing to export.
  const exportableCount =
    (manuscript !== null ? 1 : 0) +
    (supplementAvailable === true ? 1 : 0) +
    letters.length +
    rounds.length
  const showDocumentPicker = exportableCount > 1

  const versionLabel = (v: (typeof versions)[number]): string =>
    `${v.id} — ${stageLabel(v.stage)}${v.note !== '' ? ` — ${v.note}` : ''}`

  const nothingHere = rootDir === '' || (manuscriptMode && manuscript === null && letters.length === 0 && rounds.length === 0)

  return (
    <div className="export-dialog">
      <div className="export-dialog__columns">
        <div className="export-dialog__form">
          <div className="export-dialog__header">Export {KIND_LABEL[kind].toLowerCase()}</div>

          {nothingHere ? (
            <p className="export-dialog__hint">Nothing to export in this project yet.</p>
          ) : (
            <>
              {showDocumentPicker && (
                <label className="export-dialog__field export-dialog__field--wide">
                  <span>Document</span>
                  <select value={kind} onChange={(e) => setKind(e.target.value as ExportKind)}>
                    {manuscript !== null && <option value="manuscript">Manuscript</option>}
                    {supplementAvailable === true && (
                      <option value="supplement">Supplementary Information</option>
                    )}
                    {letters.length > 0 && <option value="letter">Cover letter</option>}
                    {rounds.length > 0 && <option value="response">Response to reviewers</option>}
                  </select>
                </label>
              )}

              {kind === 'letter' && letters.length > 1 && (
                <label className="export-dialog__field export-dialog__field--wide">
                  <span>Letter</span>
                  <select value={letterId} onChange={(e) => setLetterId(e.target.value)}>
                    {letters.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                        {d.archived ? ' (archived)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {kind === 'response' && rounds.length > 1 && (
                <label className="export-dialog__field export-dialog__field--wide">
                  <span>Round</span>
                  <select value={roundId} onChange={(e) => setRoundId(e.target.value)}>
                    {rounds.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="export-dialog__field export-dialog__field--wide">
                <span>Format</span>
                <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
                  <option value="docx">Word (.docx)</option>
                  <option value="pdf">PDF</option>
                  <option value="html">Web page (.html)</option>
                </select>
              </label>

              {manuscriptMode && (
                <>
                  <label className="export-dialog__field export-dialog__field--wide">
                    <span>Profile</span>
                    <select value={profileId} onChange={(e) => setProfileId(e.target.value as BundledProfileId)}>
                      {BUNDLED_PROFILE_IDS.map((id) => (
                        <option key={id} value={id}>
                          {getBundledProfile(id)?.journalName ?? id}
                        </option>
                      ))}
                    </select>
                  </label>

                  {kind === 'manuscript' && profile !== null && profile.manuscript.articleTypes.length > 0 && (
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

                  {versions.length > 0 && (
                    <label className="export-dialog__field export-dialog__field--wide">
                      <span>Version</span>
                      <select value={versionId} onChange={(e) => setVersionId(e.target.value)}>
                        <option value="">Current working copy</option>
                        {[...versions].reverse().map((v) => (
                          <option key={v.id} value={v.id}>
                            {versionLabel(v)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {versionId !== '' && versioned !== null && versioned.manuscript === null && (
                    <p className="export-dialog__hint">
                      This version's archived manuscript.json could not be read here — the export
                      still uses the archived content, but figures and the compliance check fall
                      back to the working copy.
                    </p>
                  )}

                  <label className="export-dialog__field export-dialog__field--wide">
                    <span>Rendering</span>
                    <select
                      value={rendering}
                      onChange={(e) => {
                        renderingTouched.current = true
                        setRendering(e.target.value as 'bw' | 'theme')
                      }}
                    >
                      <option value="bw">Classic black &amp; white</option>
                      <option value="theme">Editor color theme</option>
                    </select>
                  </label>
                </>
              )}

              <label className="export-dialog__field export-dialog__field--wide">
                <span>Output file name</span>
                <div className="export-dialog__filename">
                  <input
                    type="text"
                    value={outputName}
                    onChange={(e) => setOutputName(e.target.value)}
                    placeholder={kind === 'letter' ? 'cover-letter' : kind === 'response' ? 'response' : 'manuscript'}
                  />
                  <span className="export-dialog__ext">.{format}</span>
                </div>
              </label>

              {kind === 'response' && (
                <label className="export-dialog__checkbox">
                  <input
                    type="checkbox"
                    checked={colorRoles}
                    onChange={(e) => setColorRolesPick(e.target.checked)}
                  />
                  Color reviewer/author voices
                </label>
              )}

              {manuscriptMode && (
                <>
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
                        ? 'A Word export embeds the figures at the profile’s resolution — compression is offered for PDF and web-page exports.'
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
                        <span className="export-dialog__stance">{activePreset.dpi} dpi JPEG</span>
                      </label>
                      {compressFigures && (
                        <label className="export-dialog__field export-dialog__field--wide">
                          <span>Compression</span>
                          <select
                            value={compressionLevel}
                            onChange={(e) => setCompressionLevel(e.target.value as CompressionLevel)}
                          >
                            {COMPRESSION_PRESETS.map((preset) => (
                              <option key={preset.level} value={preset.level}>
                                {preset.label} — {preset.dpi} dpi
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <p className="export-dialog__hint">
                        {compressFigures
                          ? `${activePreset.hint} Figures go in at ${activePreset.dpi} dpi as JPEG. Turn this off for a submission that must meet ${profile?.figures.formats.minDpi ?? 300} dpi.`
                          : `Figures go in at full resolution (${profile?.figures.formats.minDpi ?? 300} dpi PNG) — what a submission needs, and what makes the file large.`}
                      </p>
                    </>
                  )}
                </>
              )}

              {kind !== 'response' && <div className="export-dialog__title">Compliance check</div>}
              {kind === 'supplement' && (
                <p className="export-dialog__hint">
                  Compliance checks apply to the main manuscript — they are not run for the
                  Supplementary Information document.
                </p>
              )}
              {kind === 'manuscript' && versionId !== '' && versioned?.manuscript === null && (
                <p className="export-dialog__hint">
                  Compliance is checked against a loaded version's own content — this version's
                  archive could not be read, so no check ran.
                </p>
              )}
              {kind === 'manuscript' && checking && (
                <p className="export-dialog__hint">Checking against {profile?.journalName}…</p>
              )}
              {kind === 'letter' && checking && <p className="export-dialog__hint">Checking the letter…</p>}
              {kind === 'letter' && !checking && letterProfile === null && letterMeta !== null && (
                <p className="export-dialog__hint">
                  This letter targets an unknown journal profile — nothing was checked.
                </p>
              )}
              {(kind === 'manuscript' || kind === 'letter') &&
                !checking &&
                diagnostics !== null &&
                diagnostics.length === 0 && (
                  <p className="export-dialog__hint export-dialog__hint--ok">No issues found.</p>
                )}
              {(kind === 'manuscript' || kind === 'letter') &&
                !checking &&
                diagnostics !== null &&
                diagnostics.length > 0 && (
                  <div className="export-dialog__diagnostics">
                    <p className="export-dialog__hint">
                      {errorCount > 0 && `${errorCount} error${errorCount === 1 ? '' : 's'}`}
                      {errorCount > 0 && warningCount > 0 && ', '}
                      {warningCount > 0 && `${warningCount} warning${warningCount === 1 ? '' : 's'}`} — export anyway
                      if you choose; nothing here blocks it.
                    </p>
                    {shownDiagnostics.rows.map((row, i) => (
                      <div key={`${row.diagnostic.id}-${i}`} className="export-dialog__diag-row">
                        <span className={`export-dialog__dot ${severityDot(row.diagnostic.severity)}`} />
                        <span className="export-dialog__diag-msg">{row.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              {!checking && shownDiagnostics.sources.length > 0 && (
                <div className="export-dialog__diag-sources">
                  <span className="export-dialog__diag-sources-label">
                    {shownDiagnostics.sources.length === 1 ? 'Source' : 'Sources'}
                  </span>
                  {shownDiagnostics.sources.map((url) => (
                    <a
                      key={url}
                      className="export-dialog__diag-source"
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {url}
                    </a>
                  ))}
                </div>
              )}

              {ackPending !== null && (
                <div className="export-dialog__ack" role="alertdialog" aria-label="Export with unaddressed points">
                  <p className="export-dialog__hint">{ackPending}</p>
                  <p className="export-dialog__hint">
                    The exported response will quote those points with no reply underneath — SUNA
                    never answers a reviewer for you.
                  </p>
                  <div className="export-dialog__ack-row">
                    <button onClick={() => setAckPending(null)}>Cancel</button>
                    <button className="export-dialog__export" onClick={() => void runExport(true)}>
                      Export anyway
                    </button>
                  </div>
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
                        ? `Compressed ${fileSizeLabel(compressedFrom)} → ${fileSizeLabel(resultBytes)} — figures re-embedded at ${activePreset.dpi} dpi JPEG.`
                        : `Figures embedded at ${activePreset.dpi} dpi JPEG.`}
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
                    Rewrites this {FORMAT_LABEL[format]} with its figures at {activePreset.dpi} dpi JPEG ({activePreset.label.toLowerCase()} compression). The
                    full-resolution file is one Export click away.
                  </span>
                </div>
              )}
              {error !== null && <p className="export-dialog__error">{error}</p>}
            </>
          )}
        </div>

        {manuscriptMode && profile !== null && (
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
              {rootDir !== '' && effManuscript !== null && (
                <ExportPreview
                  rootDir={rootDir}
                  manuscript={effManuscript}
                  profile={profile}
                  profileId={profileId}
                  format={format}
                  target={kind === 'supplement' ? 'supplement' : 'manuscript'}
                  doubleSpacing={doubleSpacing}
                  lineNumbers={lineNumbers}
                  pageNumbers={pageNumbers}
                  theme={rendering === 'theme' ? editorTheme : undefined}
                  versionId={versionId === '' ? undefined : versionId}
                  svgBase={versioned?.svgBase}
                />
              )}
            </div>
            <div hidden={rightTab !== 'requirements'} className="export-dialog__tabpanel export-dialog__tabpanel--scroll">
              <RequirementsPanel profile={profile} articleTypeId={articleTypeId || null} />
            </div>
          </aside>
        )}

        {kind === 'letter' && (
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
                Letter requirements
              </button>
            </div>
            {/* Both stay MOUNTED, for the manuscript aside's reason. */}
            <div hidden={rightTab !== 'preview'} className="export-dialog__tabpanel">
              {rootDir !== '' && letterEntry !== null && (
                <SimpleExportPreview rootDir={rootDir} kind="letter" docId={letterEntry.id} />
              )}
            </div>
            <div hidden={rightTab !== 'requirements'} className="export-dialog__tabpanel export-dialog__tabpanel--scroll">
              <LetterRequirementsPanel
                journalName={letterProfile?.journalName ?? letterMeta?.targetProfileId ?? '—'}
                requirements={letterReqs}
              />
            </div>
          </aside>
        )}

        {kind === 'response' && (
          <aside className="export-dialog__right">
            <div className="export-dialog__tabs" role="tablist">
              <button type="button" role="tab" aria-selected className="is-active">
                Preview
              </button>
            </div>
            <div className="export-dialog__tabpanel">
              {rootDir !== '' && round !== null && (
                <SimpleExportPreview
                  rootDir={rootDir}
                  kind="response"
                  docId={round.id}
                  colorRoles={colorRoles}
                />
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}

/**
 * The venue's published cover-letter requirements — panel material, not
 * findings (formatter's letterRequirements). Same visual conventions as the
 * RequirementsPanel: a labelled row, a stance badge, the venue's own quoted
 * sentence with its source. A journal nobody has researched shows the honest
 * empty state rather than a blank column.
 */
function LetterRequirementsPanel({
  journalName,
  requirements
}: {
  journalName: string
  requirements: readonly LetterRequirement[]
}): JSX.Element {
  if (requirements.length === 0) {
    return (
      <div className="req-panel">
        <div className="req-panel__head">
          <div className="req-panel__journal">{journalName}</div>
          <p className="req-panel__explainer">
            This journal has no published letter requirements — nothing here is checked, which is
            not the same as the letter being compliant.
          </p>
        </div>
      </div>
    )
  }
  return (
    <div className="req-panel">
      <div className="req-panel__head">
        <div className="req-panel__journal">{journalName}</div>
        <p className="req-panel__explainer">
          What this venue's author guidelines say a cover letter should carry. Informational — SUNA
          surfaces these, it never writes or blocks over them.
        </p>
      </div>
      <div className="req-panel__section">
        {requirements.map((req) => (
          <div key={req.id} className="req-panel__fact export-dialog__letter-req">
            <span className="req-panel__fact-label">
              {req.label}
              <span className={`req-panel__badge req-panel__badge--${req.stance === 'required' ? 'required' : 'not-stated'}`}>
                {req.stance}
              </span>
            </span>
            {req.quote !== null && <span className="export-dialog__letter-quote">“{req.quote}”</span>}
            {req.source !== null && (
              <a className="export-dialog__diag-source" href={req.source} target="_blank" rel="noreferrer">
                {req.source}
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
