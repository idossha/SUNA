import { useState, type JSX } from 'react'
import type { FsNode } from '@suna/core'
import { useProjectStore } from '../state/project'
import { openFileTab } from '../state/dock'

function TreeEntry({ node, depth }: { node: FsNode; depth: number }): JSX.Element {
  const [open, setOpen] = useState(depth < 2)
  const indent = { paddingLeft: `${8 + depth * 14}px` }

  if (node.kind === 'file') {
    return (
      <button className="tree__row" style={indent} onClick={() => openFileTab(node.path)}>
        <span className="tree__name">{node.name}</span>
      </button>
    )
  }
  return (
    <div>
      <button className="tree__row tree__row--dir" style={indent} onClick={() => setOpen(!open)}>
        <span className="tree__chevron">{open ? '▾' : '▸'}</span>
        <span className="tree__name">{node.name}</span>
      </button>
      {open &&
        node.children.map((child) => (
          <TreeEntry key={child.path} node={child} depth={depth + 1} />
        ))}
    </div>
  )
}

export function ExplorerView(): JSX.Element {
  const tree = useProjectStore((s) => s.tree)

  if (!tree || tree.kind !== 'dir') {
    return <p className="sidebar__empty">Open a project to browse its files.</p>
  }
  return (
    <div className="tree">
      {tree.children.map((child) => (
        <TreeEntry key={child.path} node={child} depth={0} />
      ))}
    </div>
  )
}
