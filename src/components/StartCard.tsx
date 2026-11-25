import { IconCharacter, IconChat, IconCube, IconDownload, IconFolder } from './Icons'

interface StartCardProps {
  onImport: () => void
  onCharacter: () => void
  onAddCube: () => void
  onOpenProject: () => void
  onAsk: () => void
  onDismiss: () => void
}

/**
 * First-run helper shown over an empty viewport. Every choice maps to an
 * existing action, so the full menu-driven workflow stays available.
 */
export function StartCard({
  onImport,
  onCharacter,
  onAddCube,
  onOpenProject,
  onAsk,
  onDismiss,
}: StartCardProps) {
  return (
    <div className="start-card">
      <div className="start-card-inner">
        <div className="start-eyebrow">New project</div>
        <h1>Start with a model — or build one here</h1>
        <p>
          Bring in a file you already made, add a ready-made character, or drop in a simple
          shape. Everything can be moved, recoloured, posed and exported.
        </p>

        <div className="start-actions">
          <button type="button" className="start-action primary" onClick={onImport}>
            <IconDownload size={19} />
            <span>
              <b>Import a model</b>
              <small>GLB, glTF, FBX, OBJ, STL…</small>
            </span>
          </button>
          <button type="button" className="start-action" onClick={onCharacter}>
            <IconCharacter size={19} />
            <span>
              <b>Add a character</b>
              <small>Presets you can recolour</small>
            </span>
          </button>
          <button type="button" className="start-action" onClick={onAddCube}>
            <IconCube size={19} />
            <span>
              <b>Add a cube</b>
              <small>A simple shape to start from</small>
            </span>
          </button>
          <button type="button" className="start-action" onClick={onOpenProject}>
            <IconFolder size={19} />
            <span>
              <b>Open a project</b>
              <small>Continue saved work</small>
            </span>
          </button>
        </div>

        <div className="start-foot">
          <button type="button" className="start-link" onClick={onAsk}>
            <IconChat size={13} /> Ask the guide how anything works
          </button>
          <button type="button" className="start-link muted" onClick={onDismiss}>
            Start with an empty scene
          </button>
        </div>
      </div>
    </div>
  )
}
