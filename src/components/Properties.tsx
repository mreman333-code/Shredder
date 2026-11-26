import { useEffect, useRef, useState } from 'react'
import type { ProjectDoc, SceneObject, Vec3 } from '../blend/doc'
import { KindIcon } from './Icons'

type VecKey = 'position' | 'rotation' | 'scale'

function formatNumber(value: number, precision: number): string {
  return Number(value.toFixed(precision)).toString()
}

function NumberField({
  value,
  onChange,
  step = 0.05,
  precision = 2,
}: {
  value: number
  onChange: (value: number) => void
  step?: number
  precision?: number
}) {
  const [text, setText] = useState(formatNumber(value, precision))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setText(formatNumber(value, precision))
    }
  }, [value, precision])

  return (
    <input
      ref={inputRef}
      className="num-input"
      type="number"
      step={step}
      value={text}
      onChange={(event) => {
        const raw = event.target.value
        setText(raw)
        const parsed = Number(raw)
        if (raw.trim() !== '' && Number.isFinite(parsed)) onChange(parsed)
      }}
      onBlur={() => setText(formatNumber(value, precision))}
    />
  )
}

function VecRow({
  label,
  value,
  onChange,
  step,
  precision,
  degrees = false,
}: {
  label: string
  value: Vec3
  onChange: (axis: number, value: number) => void
  step: number
  precision: number
  degrees?: boolean
}) {
  return (
    <div className="vec-row">
      <span className="vec-label">{label}</span>
      <div className="vec-inputs">
        {(['X', 'Y', 'Z'] as const).map((axis, index) => (
          <div className={`axis-field axis-${axis.toLowerCase()}`} key={axis}>
            <span>{axis}</span>
            <NumberField
              value={degrees ? (value[index] * 180) / Math.PI : value[index]}
              step={step}
              precision={precision}
              onChange={(next) => onChange(index, degrees ? (next * Math.PI) / 180 : next)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

interface PropertiesProps {
  doc: ProjectDoc
  selectionId: string | null
  onPatch: (patch: Partial<SceneObject>, coalesce?: string) => void
  onResetTransform: () => void
  onOpenCharacter: () => void
}

export function Properties({
  doc,
  selectionId,
  onPatch,
  onResetTransform,
  onOpenCharacter,
}: PropertiesProps) {
  const obj = doc.objects.find((o) => o.id === selectionId) ?? null

  if (!obj) {
    const meshes = doc.objects.filter((o) => o.kind !== 'group').length
    const characters = doc.objects.filter((o) => o.character).length
    return (
      <div className="properties">
        <div className="section">
          <div className="section-title">Scene</div>
          <div className="stat-row">
            <span>File</span>
            <b className="truncate">{doc.name}</b>
          </div>
          <div className="stat-row">
            <span>Objects</span>
            <b>{doc.objects.length}</b>
          </div>
          <div className="stat-row">
            <span>Meshes</span>
            <b>{meshes}</b>
          </div>
          <div className="stat-row">
            <span>Characters</span>
            <b>{characters}</b>
          </div>
        </div>
        <div className="panel-hint">
          Select an object in the viewport or outliner to edit its transform and material.
        </div>
        <div className="section">
          <div className="section-title">Shortcuts</div>
          <ul className="tips">
            <li>
              <b>G / R / S</b> move, rotate, scale
            </li>
            <li>
              <b>Shift+D</b> duplicate, <b>X</b> delete
            </li>
            <li>
              <b>Tab</b> object / pose mode
            </li>
            <li>
              <b>Ctrl+S</b> save project file
            </li>
            <li>
              <b>F</b> frame selection
            </li>
          </ul>
        </div>
      </div>
    )
  }

  const vector = (key: VecKey, axis: number, value: number) => {
    const next: Vec3 = [...obj[key]]
    next[axis] = value
    onPatch(
      key === 'position' ? { position: next } : key === 'rotation' ? { rotation: next } : { scale: next },
      `${key}-${obj.id}-${axis}`,
    )
  }

  const parts = doc.objects.filter((o) => o.parentId === obj.id).length

  return (
    <div className="properties">
      <div className="prop-head">
        <span className="prop-head-icon">
          <KindIcon kind={obj.kind} size={17} />
        </span>
        <div>
          <div className="prop-head-name">{obj.name}</div>
          <div className="prop-head-type">
            {obj.kind === 'group'
              ? `Character group · ${parts} parts`
              : obj.kind === 'mesh'
                ? `Imported mesh · ${(obj.mesh?.triangles ?? 0).toLocaleString()} tris`
                : `Mesh · ${obj.kind}`}
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-title">Object</div>
        <label className="text-row">
          <span>Name</span>
          <input
            className="text-input"
            value={obj.name}
            onChange={(event) =>
              onPatch({ name: event.target.value }, `name-${obj.id}`)
            }
          />
        </label>
        <div className="text-row">
          <span>Visible</span>
          <button
            type="button"
            className={`toggle ${obj.visible ? 'on' : ''}`}
            onClick={() => onPatch({ visible: !obj.visible })}
          >
            {obj.visible ? 'Shown' : 'Hidden'}
          </button>
        </div>
      </div>

      <div className="section">
        <div className="section-title">
          Transform
          <button type="button" className="mini-action" onClick={onResetTransform}>
            Reset
          </button>
        </div>
        <VecRow
          label="Location"
          value={obj.position}
          step={0.05}
          precision={3}
          onChange={(axis, value) => vector('position', axis, value)}
        />
        <VecRow
          label="Rotation"
          value={obj.rotation}
          step={1}
          precision={1}
          degrees
          onChange={(axis, value) => vector('rotation', axis, value)}
        />
        <VecRow
          label="Scale"
          value={obj.scale}
          step={0.05}
          precision={3}
          onChange={(axis, value) => vector('scale', axis, value)}
        />
      </div>

      {obj.kind !== 'group' && (
        <div className="section">
          <div className="section-title">Material</div>
          <div className="color-row">
            <span>Base color</span>
            <div className="color-control">
              <input
                type="color"
                value={obj.color}
                onChange={(event) => onPatch({ color: event.target.value }, `color-${obj.id}`)}
              />
              <code>{obj.color.toUpperCase()}</code>
            </div>
          </div>
          <label className="slider-row">
            <span>Roughness</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={obj.roughness}
              onChange={(event) =>
                onPatch({ roughness: Number(event.target.value) }, `rough-${obj.id}`)
              }
            />
            <span className="val">{obj.roughness.toFixed(2)}</span>
          </label>
          <label className="slider-row">
            <span>Metallic</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={obj.metalness}
              onChange={(event) =>
                onPatch({ metalness: Number(event.target.value) }, `metal-${obj.id}`)
              }
            />
            <span className="val">{obj.metalness.toFixed(2)}</span>
          </label>
        </div>
      )}

      {obj.mesh && (
        <div className="section">
          <div className="section-title">Imported geometry</div>
          <div className="stat-row">
            <span>Triangles</span>
            <b>{obj.mesh.triangles.toLocaleString()}</b>
          </div>
          <div className="stat-row">
            <span>Vertices</span>
            <b>{obj.mesh.vertices.toLocaleString()}</b>
          </div>
          {obj.mesh.bones && obj.mesh.bones.length > 0 && (
            <div className="stat-row">
              <span>Bones</span>
              <b>{obj.mesh.bones.length}</b>
            </div>
          )}
          {obj.mesh.materials && obj.mesh.materials.length > 1 && (
            <div className="stat-row">
              <span>Materials</span>
              <b>{obj.mesh.materials.length}</b>
            </div>
          )}
          {(obj.mesh.baseColor ||
            obj.mesh.materials?.some((material) => material.baseColor)) && (
            <div className="stat-row">
              <span>Textures</span>
              <b>Packed</b>
            </div>
          )}
          {obj.mesh.source && (
            <div className="stat-row">
              <span>Source</span>
              <b className="truncate">{obj.mesh.source}</b>
            </div>
          )}
        </div>
      )}

      {obj.character && (
        <div className="section">
          <div className="section-title">Rig</div>
          <div className="stat-row">
            <span>Height</span>
            <b>{obj.character.height.toFixed(2)} m</b>
          </div>
          <div className="stat-row">
            <span>Build</span>
            <b>{obj.character.build.toFixed(2)}</b>
          </div>
          <div className="stat-row">
            <span>Parts</span>
            <b>{doc.objects.filter((o) => o.parentId === obj.id).length}</b>
          </div>
          <button type="button" className="btn wide" onClick={onOpenCharacter}>
            Open character builder
          </button>
        </div>
      )}
    </div>
  )
}
