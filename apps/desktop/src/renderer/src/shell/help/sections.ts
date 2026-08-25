/**
 * Static data for the "?" keyboard-shortcut overlay (feature-plan-8 §1).
 * Content is the plan's Appendix inventory verbatim — it was cross-checked
 * against the code and TESTING.md; do not add bindings here that no surface
 * actually implements. The overlay renders this as tabs (one per section),
 * groups, and <kbd> rows; sections.test.ts pins ids, non-empty groups, and
 * the surface → section mapping.
 */

export interface HelpGroup {
  title: string
  /** [keys, description] rows — keys go in a <kbd>, description beside it. */
  items: ReadonlyArray<readonly [string, string]>
}

export interface HelpSection {
  id: string
  label: string
  groups: readonly HelpGroup[]
}

/** Footer legend for the modifier glyphs used throughout the tables. */
export const HELP_LEGEND = '⌘ = Cmd · ⌃ = Ctrl · ⌥ = Option · ⇧ = Shift'

/**
 * The editor groups are shared into the manuscript section below — the
 * Appendix defines manuscript as "everything in editor, plus …", and sharing
 * the arrays keeps the two from drifting apart.
 */
const EDITOR_GROUPS: readonly HelpGroup[] = [
  {
    title: 'Editing',
    items: [
      ['⌘S', 'Save'],
      ['⌘Z / ⌘⇧Z', 'Undo / redo'],
      ['⌘E', 'Source ⇄ reading view'],
      ['⌘F', 'Search'],
      ['Right-click', 'Menu: format · link · citation · figure · comment']
    ]
  },
  {
    title: 'Formatting',
    items: [
      ['⌘B / ⌘I', 'Bold / italic'],
      ['⌘⇧C', 'Code'],
      ['⌘⇧X', 'Strikethrough'],
      ['⌘K', 'Link (selection only; otherwise the palette)']
    ]
  },
  {
    title: 'Citations, figures & comments',
    items: [
      ['⌘⇧K', 'Insert citation'],
      ['⌘⇧F', 'Insert figure (↵ places it, ⇧↵ references it)'],
      ['⌘⇧M', 'Comment on selection'],
      ['⌘⌥M', 'Toggle comments rail'],
      ['✦ AI', 'On a comment card: send the comment to the agent']
    ]
  },
  // feature-plan-9 §1. The `?` row is the honest one: in NORMAL mode vim
  // consumes Shift-Slash entirely (measured — the window listener records no
  // event at all), so :help is the ONLY way into this dialog from a vim
  // buffer. Saying so beats letting the reader conclude help is broken.
  {
    title: 'Vim (when vim motions are on)',
    items: [
      [':w', 'Write — save the file'],
      [':q / :q!', 'Close the tab / close it discarding unsaved changes'],
      [':wq', 'Write, then close (refuses to close if the write did not land)'],
      [':help / :h', 'This help'],
      ['?', "vim's search-backward here, not this dialog — use :help"]
    ]
  }
]

export const SECTIONS: readonly HelpSection[] = [
  {
    id: 'global',
    label: 'Global',
    groups: [
      {
        title: 'Command palette',
        items: [
          ['⌘K', 'Palette — files'],
          ['⌘⇧P', 'Palette — commands'],
          ['> · $ · ?', 'Palette prefixes: > commands, $ terminal, ? ask agent']
        ]
      },
      {
        title: 'Layout',
        items: [
          ['⌘\\', 'Split right'],
          ['⌘⇧\\', 'Split down'],
          ['⌘⇧B', 'Toggle sidebar'],
          ['⌘⌥B', 'Toggle left nav bar'],
          ['⌃`', 'Toggle terminal']
        ]
      },
      {
        title: 'App',
        items: [
          ['?', 'This help (:help inside a vim buffer, where vim owns "?")'],
          ['Esc', 'Close overlays'],
          ['Title bar', 'Project switcher']
        ]
      }
    ]
  },
  {
    id: 'editor',
    label: 'Editor',
    groups: EDITOR_GROUPS
  },
  {
    id: 'manuscript',
    label: 'Manuscript',
    groups: [
      ...EDITOR_GROUPS,
      {
        title: 'Manuscript',
        items: [
          ['Click outline', 'Scroll to the section'],
          ['Click title / abstract / authors', 'Edit in place — Esc cancels, ⌘⏎ commits'],
          ['Gear', 'Appearance for the whole document']
        ]
      }
    ]
  },
  {
    id: 'canvas',
    label: 'Canvas',
    groups: [
      {
        title: 'Tools',
        items: [
          ['V / R / O / L / A / T', 'Select / rectangle / ellipse / line / arrow / text'],
          ['Esc', 'Cancel / deselect']
        ]
      },
      {
        title: 'Editing',
        items: [
          ['⌘S', 'Save'],
          ['⌘Z / ⌘⇧Z', 'Undo / redo'],
          ['⌘D', 'Duplicate'],
          ['⌘⇧I', 'Import SVG/PNG'],
          ['Arrows', 'Nudge (⇧ = ×10)'],
          ['Delete', 'Remove selection'],
          ['⌘[ / ⌘]', 'Back / forward (⌥ = to end)'],
          ['⌘G / ⌘⇧G', 'Group / ungroup'],
          ['⇧-click', 'Add to selection']
        ]
      },
      {
        title: 'Navigation',
        items: [
          ['Scroll', 'Pan'],
          ['⌘-scroll', 'Zoom']
        ]
      },
      {
        title: 'Agent',
        items: [['Agent section', 'Right rail: send the selection + a prompt to the agent']]
      }
    ]
  },
  {
    id: 'notebook',
    label: 'Notebook',
    groups: [
      {
        title: 'Running',
        items: [
          ['⇧⏎', 'Run the cell, select the next (adds one at the end)'],
          ['⌘⏎ / ⌃⏎', 'Run the cell, stay on it'],
          ['⌥⏎', 'Run the cell, insert one below'],
          ['⌘S', 'Save the notebook']
        ]
      },
      // The modal pair. Command mode is where the single letters below are
      // safe to be single letters at all, so it leads the group.
      {
        title: 'Selecting',
        items: [
          ['Esc', 'Leave the editor — command mode'],
          ['⏎', 'Edit the selected cell'],
          ['↑ / ↓ · k / j', 'Select up / down (command mode)'],
          ['Double-click', 'Edit a rendered markdown cell']
        ]
      },
      {
        title: 'Cells (command mode)',
        items: [
          ['a / b', 'Insert a cell above / below'],
          ['m / y / r', 'Make it markdown / code / raw'],
          ['d d', 'Delete the cell'],
          ['z', 'Undo that delete'],
          ['⇧D', 'Duplicate the cell'],
          ['⌘⇧↑ / ⌘⇧↓', 'Move the cell up / down (works while editing too)']
        ]
      }
    ]
  },
  {
    id: 'explorer',
    label: 'Explorer',
    groups: [
      {
        title: 'Navigate',
        items: [
          ['↑ / ↓', 'Move (⇧ extends)'],
          ['→ / ←', 'Expand / collapse'],
          ['Home / End', 'First / last row'],
          ['Enter', 'Open'],
          ['Esc', 'Clear selection']
        ]
      },
      // feature-plan-9 §3: ExplorerView renders both context-menu items and
      // binds both chords on the focused row, so they belong here. The menu's
      // label follows the platform (Reveal in Finder / Show in Explorer / Show
      // in File Manager); this overlay is static, so it names the neutral pair
      // rather than pretending to know which OS is reading it.
      {
        title: 'Manage',
        items: [
          ['F2', 'Rename'],
          ['⌘A', 'Select all'],
          ['Delete', 'Delete (two-step confirm)'],
          ['⌘⌥R', 'Reveal in Finder / file manager (focused row)'],
          ['⌘⌥O', 'Open with the default app (focused row)'],
          ['Right-click', 'Context menu']
        ]
      },
      {
        title: 'Mouse',
        items: [
          ['⌘-click', 'Toggle row'],
          ['⇧-click', 'Select range'],
          ['⌥-click', 'Open beside']
        ]
      }
    ]
  },
  {
    id: 'viewers',
    label: 'Viewers',
    groups: [
      {
        title: 'PDF & images',
        items: [
          ['⌘+ / ⌘− / ⌘0', 'Zoom in / out / reset'],
          ['Fit width', 'Fit the page width'],
          ['Page box', 'PDF: jump to a page']
        ]
      },
      {
        title: 'Data & figures',
        items: [
          ['Text / Grid', 'CSV: toggle raw text and grid'],
          ['⌘-click', 'Figures view: open beside']
        ]
      },
      {
        title: 'References',
        items: [
          ['Click row', 'Open its PDF beside'],
          ['Attach PDF…', 'Link a PDF to a reference']
        ]
      }
    ]
  }
]

/**
 * Which section the overlay opens on, from the active dock panel's component
 * kind plus whether keyboard focus sits inside the explorer tree. Explorer
 * focus wins: the dock's active panel is unchanged while the user works the
 * tree, so the panel kind alone would answer for the wrong surface. Unknown
 * kinds (welcome, settings, export, …) and the no-panel case land on
 * 'global' — every id returned here must exist in SECTIONS.
 */
export function sectionForSurface(surface: string | null, explorerFocused: boolean): string {
  if (explorerFocused) return 'explorer'
  switch (surface) {
    case 'canvas':
      return 'canvas'
    case 'manuscript':
      return 'manuscript'
    case 'editor':
      return 'editor'
    case 'notebook':
      return 'notebook'
    case 'pdf':
    case 'image':
    case 'dataview':
    case 'html':
    case 'docx':
      return 'viewers'
    default:
      return 'global'
  }
}
