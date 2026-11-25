import { useState } from 'react'
import type { ProjectDoc, SceneObject } from '../blend/doc'
import { IconChevron, IconCopy, IconEye, IconEyeOff, IconTrash, KindIcon } from './Icons'

interface OutlinerProps {
  doc: ProjectDoc
  selectionId: string | null
  onSelect: (id: string) => void
  onRename: (id: string, name: string) => void
  onToggleVisible: (id: string) => void
  onDelete: () => void
  onDuplicate: () => void
}

export function Outliner({
  doc,
  selectionId,
  onSelect,
  onRename,
  onToggleVisible,
  onDelete,
  onDuplicate,
}: OutlinerProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const childrenOf = (parentId: string | null) =>
    doc.objects.filter((o) => (parentId === null ? !o.parentId : o.parentId === parentId))

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const startRename = (obj: SceneObject) => {
    setRenaming(obj.id)
    setRenameValue(obj.name)
  }

  const commitRename = () => {
    if (renaming) {
      const trimmed = renameValue.trim()
      if (trimmed) onRename(renaming, trimmed)
    }
    setRenaming(null)
  }

  const renderRow = (obj: SceneObject, depth: number) => {
    const children = childrenOf(obj.id)
    const isCollapsed = collapsed.has(obj.id)
    return (
      <div key={obj.id}>
        <div
          className={`outliner-row ${selectionId === obj.id ? 'selected' : ''} ${
            obj.visible ? '' : 'hidden'
          }`}
          style={{ paddingLeft: 6 + depth * 14 }}
          onClick={() => onSelect(obj.id)}
        >
          {children.length > 0 ? (
            <button
              type="button"
              className={`ol-chevron ${isCollapsed ? '' : 'open'}`}
              onClick={(event) => {
                event.stopPropagation()
                toggleCollapsed(obj.id)
              }}
              aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            >
              <IconChevron size={12} />
            </button>
          ) : (
            <span className="ol-chevron spacer" />
          )}
          <span className="ol-kind">
            <KindIcon kind={obj.kind} size={13} />
          </span>
          {renaming === obj.id ? (
            <input
              className="ol-rename"
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRename()
                if (event.key === 'Escape') setRenaming(null)
              }}
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <span
              className="ol-name"
              onDoubleClick={(event) => {
                event.stopPropagation()
                startRename(obj)
              }}
              title="Double-click to rename"
            >
              {obj.name}
            </span>
          )}
          {obj.character && <span className="ol-badge">rig</span>}
          <button
            type="button"
            className="ol-eye"
            title={obj.visible ? 'Hide' : 'Show'}
            onClick={(event) => {
              event.stopPropagation()
              onToggleVisible(obj.id)
            }}
          >
            {obj.visible ? <IconEye size={13} /> : <IconEyeOff size={13} />}
          </button>
        </div>
        {!isCollapsed && children.map((child) => renderRow(child, depth + 1))}
      </div>
    )
  }

  const tops = childrenOf(null)
  const selectedExists = doc.objects.some((o) => o.id === selectionId)

  return (
    <div className="outliner">
      <div className="outliner-head">
        <span>Scene Collection</span>
        <span className="count">{doc.objects.length}</span>
      </div>
      <div className="outliner-list">
        {tops.length === 0 && <div className="panel-hint">Scene is empty. Use Add to create geometry.</div>}
        {tops.map((obj) => renderRow(obj, 0))}
      </div>
      <div className="outliner-actions">
        <button type="button" onClick={onDuplicate} disabled={!selectedExists} title="Duplicate (Shift+D)">
          <IconCopy size={14} /> Duplicate
        </button>
        <button type="button" onClick={onDelete} disabled={!selectedExists} title="Delete (X)">
          <IconTrash size={14} /> Delete
        </button>
      </div>
    </div>
  )
}
