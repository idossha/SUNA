import type { JSX } from 'react'
import type { SidebarView } from '../state/ui'

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

export const VIEW_ICONS: Record<SidebarView, () => JSX.Element> = {
  explorer: ExplorerIcon,
  manuscript: ManuscriptIcon,
  figures: FiguresIcon,
  references: ReferencesIcon,
  git: GitIcon,
  agent: AgentIcon
}
