import type { JSX } from 'react'
import type { ProjectDirKey } from '@suna/core'
import type { SidebarView } from '../state/ui'
import type { FileIconKind } from './explorer-rows'

interface IconProps {
  children: JSX.Element | JSX.Element[]
}

function Icon({ children }: IconProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function ExplorerIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M4 5.5C4 4.7 4.7 4 5.5 4H10l2 2.5h6.5c.8 0 1.5.7 1.5 1.5v10c0 .8-.7 1.5-1.5 1.5h-13c-.8 0-1.5-.7-1.5-1.5v-12z" />
    </Icon>
  )
}

export function ManuscriptIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M6 3.5h12v17H6z" />
      <path d="M9 8h6M9 11.5h6M9 15h4" />
    </Icon>
  )
}

export function FiguresIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M4 4v16h16" />
      <path d="M7.5 14.5l3.5-4 3 2.5 4.5-6" />
    </Icon>
  )
}

export function ReferencesIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M5 4.5c0-.6.4-1 1-1h5v17H6c-.6 0-1-.4-1-1v-15z" />
      <path d="M11 3.5h7c.6 0 1 .4 1 1v15c0 .6-.4 1-1 1h-7" />
      <path d="M14.5 7.5h2M14.5 10.5h2" />
    </Icon>
  )
}

export function GitIcon(): JSX.Element {
  return (
    <Icon>
      <circle cx="7" cy="6" r="2.2" />
      <circle cx="7" cy="18" r="2.2" />
      <circle cx="17" cy="9" r="2.2" />
      <path d="M7 8.2v7.6M17 11.2c0 3-3.5 3.3-7.2 3.6" />
    </Icon>
  )
}

export function AgentIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M12 4l1.7 4.6L18 10l-4.3 1.4L12 16l-1.7-4.6L6 10l4.3-1.4z" />
      <path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </Icon>
  )
}

export function NewFileIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M7 3.5h6.5L18 8v12.5H7z" />
      <path d="M13.5 3.5V8H18" />
      <path d="M12.5 11.5v5M10 14h5" />
    </Icon>
  )
}

export function NewFolderIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M4 6.5C4 5.7 4.7 5 5.5 5h4l2 2.5h7c.8 0 1.5.7 1.5 1.5V18c0 .8-.7 1.5-1.5 1.5h-13c-.8 0-1.5-.7-1.5-1.5v-11.5z" />
      <path d="M12 11v5M9.75 13.5h4.5" />
    </Icon>
  )
}

export function ChevronDownIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M6 9.5l6 6 6-6" />
    </Icon>
  )
}

/** Title-bar toggle for the whole left nav (rail + panel). */
export function PanelLeftIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M4 6.5C4 5.7 4.7 5 5.5 5h13c.8 0 1.5.7 1.5 1.5v11c0 .8-.7 1.5-1.5 1.5h-13c-.8 0-1.5-.7-1.5-1.5v-11z" />
      <path d="M9.5 5.5v13" />
    </Icon>
  )
}

/**
 * Tree disclosure. Drawn pointing right; the open state is a CSS rotation
 * (styles/app.css). The path spans 8 of the 24 viewBox units — a third wider
 * than a 6-unit arrow — because this is the tree's primary open/closed mark
 * and it renders in a 14px box, i.e. at scale 0.58.
 */
export function TreeChevronIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M8.5 5l8 7-8 7" />
    </Icon>
  )
}

export function FolderIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M4 6.5C4 5.7 4.7 5 5.5 5h4l2 2.5h7c.8 0 1.5.7 1.5 1.5V18c0 .8-.7 1.5-1.5 1.5h-13c-.8 0-1.5-.7-1.5-1.5v-11.5z" />
    </Icon>
  )
}

export function FolderOpenIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M4 18V6.5C4 5.7 4.7 5 5.5 5h4l2 2.5h7c.8 0 1.5.7 1.5 1.5v1.5" />
      <path d="M4 18l2.3-6.1c.2-.6.7-.9 1.3-.9H21l-2.3 6.1c-.2.6-.7.9-1.3.9H4z" />
    </Icon>
  )
}

/* ------------------------------------------------------------ file kinds */

/* One page silhouette (NewFileIcon's, minus its plus strokes) under every
   file icon, so a tree row's kind reads from the mark alone and the rows
   still scan as one column. */
const PAGE = <path d="M7 3.5h6.5L18 8v12.5H7z" />
const PAGE_FOLD = <path d="M13.5 3.5V8H18" />

export function FileIcon(): JSX.Element {
  return (
    <Icon>
      {PAGE}
      {PAGE_FOLD}
    </Icon>
  )
}

export function MarkdownFileIcon(): JSX.Element {
  return (
    <Icon>
      {PAGE}
      {PAGE_FOLD}
      <path d="M9.5 17.5v-5l2.25 2.75L14 12.5v5" />
    </Icon>
  )
}

export function BibFileIcon(): JSX.Element {
  return (
    <Icon>
      {PAGE}
      {PAGE_FOLD}
      <path d="M9.8 11.8h4.4v6.7l-2.2-1.5-2.2 1.5z" />
    </Icon>
  )
}

export function JsonFileIcon(): JSX.Element {
  return (
    <Icon>
      {PAGE}
      {PAGE_FOLD}
      {/* Squared off, not curly: the vertical strokes are what keeps this
          readable against CodeFileIcon's chevrons at 15px. */}
      <path d="M11.4 11.9h-.7v2.4l-.9.7.9.7v2.4h.7" />
      <path d="M13.4 11.9h.7v2.4l.9.7-.9.7v2.4h-.7" />
    </Icon>
  )
}

export function FigureFileIcon(): JSX.Element {
  return (
    <Icon>
      {PAGE}
      {PAGE_FOLD}
      <path d="M9.3 11.8v6.2h6.2" />
      <path d="M10.4 16.4l1.7-2.2 1.4 1.1 1.8-2.4" />
    </Icon>
  )
}

export function ImageFileIcon(): JSX.Element {
  return (
    <Icon>
      {PAGE}
      {PAGE_FOLD}
      <path d="M9.3 12.4h6.2v5.8H9.3z" />
      <path d="M9.3 17l2-2.1 1.6 1.4 2.6-2.5" />
    </Icon>
  )
}

export function PdfFileIcon(): JSX.Element {
  return (
    <Icon>
      {PAGE}
      {PAGE_FOLD}
      <circle cx="12.4" cy="13.8" r="2" />
      <path d="M10.9 15.4l-.6 3 2.1-1.2 2.1 1.2-.6-3" />
    </Icon>
  )
}

export function TableFileIcon(): JSX.Element {
  return (
    <Icon>
      {PAGE}
      {PAGE_FOLD}
      <path d="M9.3 12.4h6.2v5.8H9.3z" />
      <path d="M9.3 14.8h6.2M12.4 12.4v5.8" />
    </Icon>
  )
}

export function CodeFileIcon(): JSX.Element {
  return (
    <Icon>
      {PAGE}
      {PAGE_FOLD}
      <path d="M11.2 12.4l-2 2.9 2 2.9" />
      <path d="M13.6 12.4l2 2.9-2 2.9" />
    </Icon>
  )
}

/** A notebook: a page of stacked cells, one of them with a run marker. */
export function NotebookFileIcon(): JSX.Element {
  return (
    <Icon>
      {PAGE}
      {PAGE_FOLD}
      <path d="M9.4 12.6h5.2M9.4 15.1h5.2M9.4 17.6h3" />
      <path d="M7.6 12.6v5" />
    </Icon>
  )
}

export function TexFileIcon(): JSX.Element {
  return (
    <Icon>
      {PAGE}
      {PAGE_FOLD}
      <path d="M9.2 12.3h4.2M11.3 12.3v5.9" />
      <path d="M13.6 15.4l2.2 2.8M15.8 15.4l-2.2 2.8" />
    </Icon>
  )
}

/* ------------------------------------------- project (suna.json) folders */

export function CodeDirIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M9.5 7.5L4.5 12l5 4.5" />
      <path d="M14.5 7.5l5 4.5-5 4.5" />
    </Icon>
  )
}

/**
 * `analysis/`. Deliberately NOT CodeDirIcon: the two directories are different
 * things and an identical icon identifies neither. A trend line over axes —
 * code that produces a result, rather than code.
 */
export function AnalysisIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M5 4.5v15h15" />
      <path d="M8 15.5l3.5-4 3 2.5 4.5-6" />
    </Icon>
  )
}

export function DatabaseIcon(): JSX.Element {
  return (
    <Icon>
      <ellipse cx="12" cy="6.5" rx="6.5" ry="2.5" />
      <path d="M5.5 6.5v11c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-11" />
      <path d="M5.5 12c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5" />
    </Icon>
  )
}

export function ResultsIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M6.5 4.5h11v15h-11z" />
      <path d="M9.3 10.3l1.4 1.4 3.6-3.6" />
      <path d="M9.3 16.1l1.4 1.4 3.6-3.6" />
    </Icon>
  )
}

export function ExportIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M4.5 14.5V18c0 .8.7 1.5 1.5 1.5h12c.8 0 1.5-.7 1.5-1.5v-3.5" />
      <path d="M12 15V4.5" />
      <path d="M8 8.5l4-4 4 4" />
    </Icon>
  )
}

export const VIEW_ICONS: Record<SidebarView, () => JSX.Element> = {
  explorer: ExplorerIcon,
  manuscript: ManuscriptIcon,
  figures: FiguresIcon,
  references: ReferencesIcon,
  git: GitIcon,
  agent: AgentIcon
}

export const FILE_ICONS: Record<FileIconKind, () => JSX.Element> = {
  markdown: MarkdownFileIcon,
  bib: BibFileIcon,
  json: JsonFileIcon,
  figure: FigureFileIcon,
  image: ImageFileIcon,
  pdf: PdfFileIcon,
  table: TableFileIcon,
  code: CodeFileIcon,
  notebook: NotebookFileIcon,
  tex: TexFileIcon,
  file: FileIcon
}

/**
 * Manuscript and Figures deliberately reuse the activity rail's own icons:
 * the folder in the tree and the view in the rail are the same thing, so the
 * two are meant to move together if the rail is ever redrawn.
 */
export const PROJECT_DIR_ICONS: Record<ProjectDirKey, () => JSX.Element> = {
  manuscript: ManuscriptIcon,
  figures: FiguresIcon,
  code: CodeDirIcon,
  data: DatabaseIcon,
  analysis: AnalysisIcon,
  results: ResultsIcon,
  output: ExportIcon
}
