import { useEffect, useRef, useState } from 'react'
import type { VFS } from '../blend/storage'
import {
  IconClose,
  IconDownload,
  IconFile,
  IconFolder,
  IconPlus,
  IconTrash,
} from './Icons'

interface FileBrowserProps {
  fs: VFS
  activeFileId: string | null
  initialFolderId: string | null
  onClose: () => void
  onOpen: (id: string) => void
  onNewFile: (folderId: string | null) => void
  onNewFolder: () => void
  onSaveAs: (name: string, folderId: string | null) => void
  onImport: (file: File) => void
  onExport: (format: 'mblend' | 'glb') => void
  onAppend: (id: string) => void
  onDeleteFile: (id: string) => void
  onRenameFile: (id: string, name: string) => void
  onDeleteFolder: (id: string) => void
  onRenameFolder: (id: string, name: string) => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function FileBrowser({
  fs,
  activeFileId,
  initialFolderId,
  onClose,
  onOpen,
  onNewFile,
  onNewFolder,
  onSaveAs,
  onImport,
  onExport,
  onAppend,
  onDeleteFile,
  onRenameFile,
  onDeleteFolder,
  onRenameFolder,
}: FileBrowserProps) {
  const [folderId, setFolderId] = useState<string | null>(
    initialFolderId ?? fs.folders[0]?.id ?? null,
  )
  const [selectedFileId, setSelectedFileId] = useState<string | null>(activeFileId)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [copyName, setCopyName] = useState('')
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (folderId && !fs.folders.some((f) => f.id === folderId)) {
      setFolderId(fs.folders[0]?.id ?? null)
    }
  }, [fs.folders, folderId])

  const folder = fs.folders.find((f) => f.id === folderId) ?? null
  const files = fs.files
    .filter((f) => f.folderId === folderId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const selected = fs.files.find((f) => f.id === selectedFileId) ?? null
  const active = fs.files.find((f) => f.id === activeFileId) ?? null

  const beginRename = (id: string, currentName: string) => {
    setEditingId(id)
    setEditValue(currentName.replace(/\.blend$/i, ''))
  }

  const commitRename = (kind: 'file' | 'folder') => {
    if (!editingId) return
    const value = editValue.trim()
    if (value) {
      if (kind === 'file') onRenameFile(editingId, value)
      else onRenameFolder(editingId, value)
    }
    setEditingId(null)
  }

  const defaultCopyName = (active?.name ?? 'Untitled.blend').replace(/\.blend$/i, '') + ' copy'

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="file-browser" onMouseDown={(event) => event.stopPropagation()}>
        <header className="fb-header">
          <div className="fb-title">
            <IconFolder size={17} />
            <span>File Browser</span>
            <span className="fb-sub">Browser storage · local project files</span>
          </div>
          <div className="fb-header-actions">
            <button type="button" className="btn ghost" onClick={() => onExport('glb')}>
              <IconDownload size={14} /> Export GLB
            </button>
            <button type="button" className="icon-btn" onClick={onClose} title="Close (Esc)">
              <IconClose size={16} />
            </button>
          </div>
        </header>

        <div className="fb-body">
          <aside className="fb-sidebar">
            <div className="fb-side-title">Project</div>
            <button
              type="button"
              className={`fb-folder ${folderId === null ? 'active' : ''}`}
              onClick={() => {
                setFolderId(null)
                setSelectedFileId(null)
              }}
            >
              <IconFolder size={14} />
              <span>Root</span>
              <em>{fs.files.filter((f) => f.folderId === null).length}</em>
            </button>
            {fs.folders.map((item) => (
              <div key={item.id} className={`fb-folder-row ${folderId === item.id ? 'active' : ''}`}>
                <button
                  type="button"
                  className="fb-folder"
                  onClick={() => {
                    setFolderId(item.id)
                    setSelectedFileId(null)
                  }}
                >
                  <IconFolder size={14} />
                  {editingId === item.id ? (
                    <input
                      autoFocus
                      className="rename-input"
                      value={editValue}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setEditValue(event.target.value)}
                      onBlur={() => commitRename('folder')}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitRename('folder')
                        if (event.key === 'Escape') setEditingId(null)
                      }}
                    />
                  ) : (
                    <span
                      onDoubleClick={(event) => {
                        event.stopPropagation()
                        beginRename(item.id, item.name)
                      }}
                    >
                      {item.name}
                    </span>
                  )}
                  <em>{fs.files.filter((f) => f.folderId === item.id).length}</em>
                </button>
                <button
                  type="button"
                  className="mini-icon"
                  title="Delete folder"
                  onClick={() => onDeleteFolder(item.id)}
                >
                  <IconTrash size={12} />
                </button>
              </div>
            ))}
            <button type="button" className="fb-new-folder" onClick={onNewFolder}>
              <IconPlus size={13} /> New folder
            </button>

            <div className="fb-side-title spaced">Storage</div>
            <div className="fb-storage">
              <div>
                <span>Files</span>
                <b>{fs.files.length}</b>
              </div>
              <div>
                <span>Folders</span>
                <b>{fs.folders.length}</b>
              </div>
              <div>
                <span>Saved in</span>
                <b>browser</b>
              </div>
            </div>
          </aside>

          <section className="fb-main">
            <div className="fb-toolbar">
              <div className="fb-breadcrumb">
                <span>Project</span>
                <span className="crumb-sep">/</span>
                <b>{folder?.name ?? 'Root'}</b>
                <span className="fb-count">
                  {files.length} file{files.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="fb-toolbar-actions">
                <button type="button" className="btn ghost" onClick={() => onNewFile(folderId)}>
                  <IconPlus size={13} /> New file
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => importRef.current?.click()}
                >
                  Import
                </button>
                <button type="button" className="btn ghost" onClick={() => onExport('mblend')}>
                  Export .mblend
                </button>
              </div>
            </div>

            <div className="fb-list">
              <div className="fb-list-head">
                <span>Name</span>
                <span>Modified</span>
                <span>Size</span>
                <span />
              </div>
              {files.length === 0 && (
                <div className="fb-empty">
                  <IconFile size={26} />
                  <span>No project files in this folder.</span>
                  <button type="button" className="btn ghost" onClick={() => onNewFile(folderId)}>
                    Create one
                  </button>
                </div>
              )}
              {files.map((file) => (
                <div
                  key={file.id}
                  className={`fb-file ${selectedFileId === file.id ? 'selected' : ''} ${
                    activeFileId === file.id ? 'active' : ''
                  }`}
                  onClick={() => setSelectedFileId(file.id)}
                  onDoubleClick={() => onOpen(file.id)}
                >
                  <span className="fb-file-name">
                    <IconFile size={15} />
                    {editingId === file.id ? (
                      <input
                        autoFocus
                        className="rename-input"
                        value={editValue}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setEditValue(event.target.value)}
                        onBlur={() => commitRename('file')}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitRename('file')
                          if (event.key === 'Escape') setEditingId(null)
                        }}
                      />
                    ) : (
                      <>
                        <span
                          onDoubleClick={(event) => {
                            event.stopPropagation()
                            beginRename(file.id, file.name)
                          }}
                        >
                          {file.name}
                        </span>
                        {file.doc.objects.some((o) => o.character) && (
                          <span className="fb-badge">character</span>
                        )}
                        {activeFileId === file.id && <span className="fb-badge open">open</span>}
                      </>
                    )}
                  </span>
                  <span className="fb-muted">{formatDate(file.updatedAt)}</span>
                  <span className="fb-muted">
                    {formatSize(JSON.stringify(file.doc).length)}
                  </span>
                  <span className="fb-row-actions">
                    <button
                      type="button"
                      className="mini-icon"
                      title="Rename"
                      onClick={(event) => {
                        event.stopPropagation()
                        beginRename(file.id, file.name)
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="mini-icon"
                      title="Delete file"
                      onClick={(event) => {
                        event.stopPropagation()
                        onDeleteFile(file.id)
                      }}
                    >
                      <IconTrash size={13} />
                    </button>
                  </span>
                </div>
              ))}
            </div>

            <div className="fb-save-copy">
              <div>
                <span className="fb-save-label">Save a copy</span>
                <span className="fb-muted">Creates a new project file in this folder</span>
              </div>
              <input
                className="text-input"
                placeholder={defaultCopyName}
                value={copyName}
                onChange={(event) => setCopyName(event.target.value)}
              />
              <button
                type="button"
                className="btn"
                onClick={() => {
                  onSaveAs(copyName.trim() || defaultCopyName, folderId)
                  setCopyName('')
                }}
              >
                Save copy
              </button>
            </div>
          </section>
        </div>

        <footer className="fb-footer">
          <div className="fb-selection">
            {selected ? (
              <>
                <b>{selected.name}</b>
                <span className="fb-muted">
                  {selected.doc.objects.length} objects · saved {formatDate(selected.updatedAt)}
                </span>
              </>
            ) : (
              <span className="fb-muted">Select a file to open, append, or manage it</span>
            )}
          </div>
          <div className="fb-footer-actions">
            <button
              type="button"
              className="btn ghost"
              disabled={!selected || selected.id === activeFileId}
              onClick={() => selected && onAppend(selected.id)}
            >
              Append
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={!selected}
              onClick={() => selected && onExport('mblend')}
            >
              Export
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!selected}
              onClick={() => selected && onOpen(selected.id)}
            >
              Open
            </button>
          </div>
        </footer>

        <input
          ref={importRef}
          type="file"
          accept=".blend,.mblend,.json,.glb,.gltf,.fbx,.obj,.dae,.3ds,.stl,.ply,.3mf,.dxf,application/json"
          className="hidden-input"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onImport(file)
            event.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
