import type { PaintTool } from '../blend/paint'

interface PaintPanelProps {
  partName: string | null
  vertices: number
  painted: boolean
  tool: PaintTool
  color: string
  radius: number
  strength: number
  selection: { index: number; count: number; triangles: number } | null
  parts: Array<{ index: number; triangles: number }>
  onSelectPart: (index: number) => void
  onTool: (tool: PaintTool) => void
  onColor: (color: string) => void
  onRadius: (radius: number) => void
  onStrength: (strength: number) => void
  onFill: () => void
  onClear: () => void
  onResetSelection: () => void
}

export function PaintPanel({
  partName,
  vertices,
  painted,
  tool,
  color,
  radius,
  strength,
  selection,
  parts,
  onSelectPart,
  onTool,
  onColor,
  onRadius,
  onStrength,
  onFill,
  onClear,
  onResetSelection,
}: PaintPanelProps) {
  // A huge mesh can have thousands of islands; the list stays responsive.
  const MAX_LISTED_PARTS = 240
  const listedParts = parts.slice(0, MAX_LISTED_PARTS)

  return (
    <div className="sculpt-panel paint-panel">
      <div className="sculpt-heading">
        <div className="section-title">PAINT</div>
        <div className="panel-hint">
          Click a surface in the viewport to select that whole piece of the model, then fill it
          with a colour. Switch to the brush to paint by hand. Your other finger can still orbit
          the view, and a fill or brush stroke undoes in one step.
        </div>
      </div>

      {!partName && (
        <div className="sculpt-empty">
          Select a model, a primitive or a character body part, then pick Paint. A primitive or
          body part gets its own dense surface first, just like sculpting does.
        </div>
      )}

      <div className="section">
        <div className="section-title">Tool</div>
        <div className="sculpt-brushes">
          <button
            type="button"
            className={`sculpt-brush ${tool === 'part' ? 'active' : ''}`}
            aria-pressed={tool === 'part'}
            onClick={() => onTool('part')}
            title="Click a piece of the surface to select every connected triangle in it"
          >
            Select part
          </button>
          <button
            type="button"
            className={`sculpt-brush ${tool === 'brush' ? 'active' : ''}`}
            aria-pressed={tool === 'brush'}
            onClick={() => onTool('brush')}
            title="Drag on the model to paint with the current colour"
          >
            Paint brush
          </button>
        </div>
        <div className="sculpt-brush-hint">
          {tool === 'part'
            ? 'Click a surface to select it. Every separate piece of the model — a door, a strap, a limb — is its own part.'
            : 'Drag on the part to paint. The colour blends along the brush edge.'}
        </div>
      </div>

      <div className="section">
        <div className="section-title">Surface parts</div>
        {parts.length > 0 ? (
          <>
            <div className="paint-parts" role="listbox" aria-label="Surface parts">
              {listedParts.map((part) => {
                const selected = selection?.index === part.index + 1
                return (
                  <button
                    key={part.index}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`paint-part ${selected ? 'selected' : ''}`}
                    onClick={() => onSelectPart(part.index)}
                  >
                    <span>Surface {part.index + 1}</span>
                    <b>{part.triangles.toLocaleString()} tris</b>
                  </button>
                )
              })}
            </div>
            <div className="sculpt-brush-hint">
              {parts.length > MAX_LISTED_PARTS
                ? `Showing the first ${MAX_LISTED_PARTS} of ${parts.length.toLocaleString()} parts.`
                : 'Pick a part here to select one hidden behind the model.'}
            </div>
          </>
        ) : (
          <div className="sculpt-empty">
            {partName
              ? 'This part has no separate surface pieces to list.'
              : 'Select a part to list its surfaces.'}
          </div>
        )}
      </div>

      <div className="section">
        <div className="section-title">Colour</div>
        <div className="paint-color">
          <input
            type="color"
            value={color}
            aria-label="Paint colour"
            onChange={(event) => onColor(event.target.value)}
          />
          <code>{color.toUpperCase()}</code>
        </div>
        <button
          type="button"
          className="btn wide"
          onClick={onFill}
          disabled={!selection}
          title="Fill the selected surface part with this colour"
        >
          Fill selected surface
        </button>
        <div className="sculpt-brush-hint">
          {selection
            ? `Surface ${selection.index} of ${selection.count} · ${selection.triangles.toLocaleString()} tris selected`
            : 'No surface selected yet. With the Select part tool, click the model.'}
        </div>
        <div className="paint-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={onResetSelection}
            disabled={!selection}
            title="Clear the surface selection"
          >
            Clear selection
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={onClear}
            disabled={!painted}
            title="Remove all paint from this part"
          >
            Clear paint
          </button>
        </div>
      </div>

      <div className="section">
        <div className="section-title">Brush</div>
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
            min={0.05}
            max={1}
            step={0.01}
            value={strength}
            onChange={(event) => onStrength(Number(event.target.value))}
          />
          <b>{strength.toFixed(2)}</b>
        </label>
        <div className="sculpt-brush-hint">
          The brush is round and soft at the edge, like Blender&apos;s vertex paint brush.
        </div>
      </div>

      <div className="section">
        <div className="section-title">Surface</div>
        <div className="sculpt-stats">
          <span className="sculpt-part">{partName ?? 'No part selected'}</span>
          <span className="sculpt-count">
            {vertices.toLocaleString()} verts · {painted ? 'painted' : 'no paint yet'}
          </span>
        </div>
        <div className="panel-hint">
          Paint is saved inside the project and goes out with the GLB. Filling a part replaces its
          texture on that part; clearing the paint brings the original colour back.
        </div>
      </div>
    </div>
  )
}
