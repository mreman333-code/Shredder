import { SCULPT_BRUSHES, type SculptBrushId, type SculptSymmetry } from '../blend/sculpt'

interface SculptPanelProps {
  partName: string | null
  vertices: number
  triangles: number
  brush: SculptBrushId
  radius: number
  strength: number
  symmetry: SculptSymmetry
  onBrush: (brush: SculptBrushId) => void
  onRadius: (radius: number) => void
  onStrength: (strength: number) => void
  onSymmetry: (axis: keyof SculptSymmetry) => void
  onReset: () => void
}

const AXES: (keyof SculptSymmetry)[] = ['x', 'y', 'z']

export function SculptPanel({
  partName,
  vertices,
  triangles,
  brush,
  radius,
  strength,
  symmetry,
  onBrush,
  onRadius,
  onStrength,
  onSymmetry,
  onReset,
}: SculptPanelProps) {
  const active = SCULPT_BRUSHES.find((entry) => entry.id === brush)

  return (
    <div className="sculpt-panel">
      <div className="sculpt-heading">
        <div className="section-title">SCULPT</div>
        <div className="panel-hint">
          Drag on the part with the left mouse button. Shift smooths, Ctrl carves inwards, the
          middle button orbits.
        </div>
      </div>

      {!partName && (
        <div className="sculpt-empty">
          Select a mesh in the viewport or the outliner, then pick Sculpt. A primitive becomes its
          own dense mesh the first time you sculpt it.
        </div>
      )}

      <div className="section">
        <div className="section-title">Brush</div>
        <div className="sculpt-brushes">
          {SCULPT_BRUSHES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`sculpt-brush ${brush === entry.id ? 'active' : ''}`}
              onClick={() => onBrush(entry.id)}
              title={entry.hint}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {active && <div className="sculpt-brush-hint">{active.hint}</div>}
      </div>

      <div className="section">
        <div className="section-title">Cursor</div>
        <label className="sculpt-slider">
          <span>Radius</span>
          <input
            type="range"
            min={0.02}
            max={0.8}
            step={0.01}
            value={radius}
            onChange={(event) => onRadius(Number(event.target.value))}
          />
          <b>{radius.toFixed(2)}</b>
        </label>
        <label className="sculpt-slider">
          <span>Strength</span>
          <input
            type="range"
            min={0.02}
            max={1}
            step={0.01}
            value={strength}
            onChange={(event) => onStrength(Number(event.target.value))}
          />
          <b>{strength.toFixed(2)}</b>
        </label>
        <div className="sculpt-sym">
          <span>Symmetry</span>
          <div className="sculpt-sym-buttons">
            {AXES.map((axis) => (
              <button
                key={axis}
                type="button"
                className={`sculpt-sym-btn ${symmetry[axis] ? 'active' : ''}`}
                onClick={() => onSymmetry(axis)}
                title={`Mirror the brush across the part's local ${axis.toUpperCase()} axis`}
              >
                {axis.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-title">Mesh</div>
        <div className="sculpt-stats">
          <span className="sculpt-part">{partName ?? 'No part selected'}</span>
          <span className="sculpt-count">
            {vertices.toLocaleString()} verts · {triangles.toLocaleString()} tris
          </span>
        </div>
        <button type="button" className="btn ghost" onClick={onReset} disabled={!partName}>
          Reset to original shape
        </button>
        <div className="panel-hint">
          Sculpting rewrites the part's geometry and keeps it in the project, so it saves, undoes
          and exports with the model.
        </div>
      </div>
    </div>
  )
}
