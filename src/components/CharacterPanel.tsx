import { useEffect, useRef, useState } from 'react'
import type {
  CharacterColors,
  CharacterSpec,
  PartAdjustment,
  PartImage,
  SceneObject,
  Vec3,
} from '../blend/doc'
import { CHARACTER_PRESETS, characterParts, mirrorPartName, presetSpec } from '../blend/doc'
import { characterSkeleton } from '../blend/skeleton'
import { isPictureFile, PICTURE_ACCEPT, readPicture } from '../blend/pictures'
import { IconPlus } from './Icons'

interface CharacterPanelProps {
  spec: CharacterSpec
  editingName: string | null
  editingId: string | null
  /** Generated body parts of the character being edited (empty for a draft). */
  parts: SceneObject[]
  /** Part selected in the scene, so the panel can follow Pose-mode selection. */
  selectedPartId: string | null
  onChange: (spec: CharacterSpec) => void
  onAdd: (spec: CharacterSpec) => void
  onSelectPart: (id: string) => void
  onAdjustPart: (names: string[], adjustment: PartAdjustment, coalesce: string) => void
  onSetImage: (names: string[], image: PartImage | null, coalesce?: string) => void
}

const PARTS_PER_RIG = characterParts(presetSpec('Hero'), 'preview').length
const BONES_PER_RIG = characterSkeleton(presetSpec('Hero')).bones.length

const COLOR_FIELDS: { key: keyof CharacterColors; label: string }[] = [
  { key: 'suit', label: 'Suit' },
  { key: 'accent', label: 'Accent' },
  { key: 'skin', label: 'Skin' },
  { key: 'boots', label: 'Boots' },
  { key: 'visor', label: 'Visor' },
]

// Body order, with mirrored limbs next to each other.
const PART_ORDER = [
  'Head',
  'Face',
  'Helmet',
  'Visor',
  'Neck',
  'Torso',
  'Chest Plate',
  'Belt',
  'Pelvis',
  'Shoulder L',
  'Shoulder R',
  'Upper Arm L',
  'Upper Arm R',
  'Forearm L',
  'Forearm R',
  'Hand L',
  'Hand R',
  'Thigh L',
  'Thigh R',
  'Shin L',
  'Shin R',
  'Foot L',
  'Foot R',
]

const identity: Vec3 = [1, 1, 1]

function scaleFor(spec: CharacterSpec, name: string): Vec3 {
  const scale = spec.adjustments?.[name]?.scale
  return scale ? [scale[0], scale[1], scale[2]] : [1, 1, 1]
}

export function CharacterPanel({
  spec,
  editingName,
  editingId,
  parts,
  selectedPartId,
  onChange,
  onAdd,
  onSelectPart,
  onAdjustPart,
  onSetImage,
}: CharacterPanelProps) {
  const [activeName, setActiveName] = useState<string | null>(null)
  const [pair, setPair] = useState(false)
  const [pictureDrag, setPictureDrag] = useState(false)
  const [pictureError, setPictureError] = useState<string | null>(null)
  const pictureInput = useRef<HTMLInputElement>(null)

  // A different character starts with no part selected.
  useEffect(() => {
    setActiveName(null)
    setPair(false)
    setPictureError(null)
  }, [editingId])

  // Follow a part selected in the viewport or Scene tab (Pose mode).
  useEffect(() => {
    if (!selectedPartId) return
    const part = parts.find((entry) => entry.id === selectedPartId)
    if (part) {
      setActiveName(part.name)
      setPair(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPartId, editingId])

  const update = (patch: Partial<CharacterSpec>) =>
    onChange({ ...spec, ...patch, preset: patch.preset ?? 'Custom' })

  const setColor = (key: keyof CharacterColors, value: string) =>
    onChange({
      ...spec,
      colors: { ...spec.colors, [key]: value },
      preset: 'Custom',
    })

  const byName = new Map(parts.map((part) => [part.name, part]))
  const orderedParts = PART_ORDER.map((name) => byName.get(name)).filter(
    (part): part is SceneObject => Boolean(part),
  )
  for (const part of parts) {
    if (!PART_ORDER.includes(part.name)) orderedParts.push(part)
  }

  const activePart = activeName ? (byName.get(activeName) ?? null) : null
  const pairName = activePart ? mirrorPartName(activePart.name) : null
  const pairPart = pairName ? (byName.get(pairName) ?? null) : null
  const current = activePart ? scaleFor(spec, activePart.name) : identity
  const uniform = (current[0] + current[1] + current[2]) / 3
  const picture = activePart ? (spec.images?.[activePart.name] ?? null) : null
  const pictureNames = activePart
    ? pair && pairName
      ? [activePart.name, pairName]
      : [activePart.name]
    : []

  const choosePart = (part: SceneObject) => {
    setActiveName(part.name)
    setPair(false)
    onSelectPart(part.id)
  }

  const apply = (scale: Vec3, axis: string) => {
    if (!activePart || !editingId) return
    const names =
      pair && pairName ? [activePart.name, pairName] : [activePart.name]
    onAdjustPart(
      names,
      { scale },
      `part-${editingId}-${[...names].sort().join('|')}-${axis}`,
    )
  }

  const setAxis = (axis: number, value: number) => {
    const next: Vec3 = [...current]
    next[axis] = value
    apply(next, `axis${axis}`)
  }

  const applyPicture = (image: PartImage | null, coalesce?: string) => {
    if (!activePart || !editingId) return
    onSetImage(pictureNames, image, coalesce)
  }

  const usePictureFile = async (file: File | null | undefined) => {
    if (!file) return
    setPictureError(null)
    try {
      const url = await readPicture(file)
      applyPicture({
        url,
        size: picture?.size ?? 1,
        opacity: picture?.opacity ?? 1,
      })
    } catch (error) {
      setPictureError(
        error instanceof Error ? error.message : 'Could not read that picture',
      )
    }
  }

  return (
    <div className="character-panel">
      <div className="char-heading">
        <div>
          <div className="section-title">Character Builder</div>
          <div className="panel-hint tight">
            {editingName ? (
              <>
                Live editing <b>{editingName}</b>
              </>
            ) : (
              'Design a rig, then add it to the scene.'
            )}
          </div>
        </div>
      </div>

      <div className="preset-grid">
        {Object.entries(CHARACTER_PRESETS).map(([name, preset]) => (
          <button
            type="button"
            key={name}
            className={`preset-card ${spec.preset === name ? 'active' : ''}`}
            onClick={() => onChange(presetSpec(name))}
            title={`${name} preset`}
          >
            <span className="preset-swatch" style={{ background: preset.colors.suit }}>
              <i style={{ background: preset.colors.accent }} />
              <b style={{ background: preset.colors.skin }} />
            </span>
            <span className="preset-name">{name}</span>
          </button>
        ))}
      </div>

      {editingId && orderedParts.length > 0 && (
        <div className="section">
          <div className="section-title">Body parts</div>
          <div className="part-grid">
            {orderedParts.map((part) => {
              const active = activePart?.name === part.name
              const paired = pair && pairName === part.name
              return (
                <button
                  type="button"
                  key={part.name}
                  className={`part-chip ${active || paired ? 'active' : ''} ${
                    paired ? 'paired' : ''
                  }`}
                  onClick={() => choosePart(part)}
                  title={`Select ${part.name}`}
                >
                  <span>{part.name}</span>
                  {paired && <i>both</i>}
                </button>
              )
            })}
          </div>

          {activePart ? (
            <div className="part-editor">
              <div className="part-editor-head">
                <span className="part-editor-name">
                  {activePart.name}
                  {pair && pairPart ? ` + ${pairPart.name}` : ''}
                </span>
                <button
                  type="button"
                  className="mini-action"
                  onClick={() => apply(identity, 'reset')}
                  title="Restore this part to the preset size"
                >
                  Reset
                </button>
              </div>

              {pairName && pairPart && (
                <button
                  type="button"
                  className={`pair-btn ${pair ? 'on' : ''}`}
                  onClick={() => setPair((value) => !value)}
                  aria-pressed={pair}
                  title={
                    pair
                      ? 'Stop editing the mirrored side at the same time'
                      : `Apply slider changes to ${activePart.name} and ${pairName} together`
                  }
                >
                  {pair ? `Both sides selected: ${activePart.name} + ${pairName}` : 'Select both sides'}
                </button>
              )}

              <label className="slider-row">
                <span>Size</span>
                <input
                  type="range"
                  min={0.5}
                  max={1.6}
                  step={0.01}
                  value={uniform}
                  onChange={(event) => apply([Number(event.target.value), Number(event.target.value), Number(event.target.value)], 'uniform')}
                />
                <span className="val">×{uniform.toFixed(2)}</span>
              </label>
              <label className="slider-row">
                <span>Width</span>
                <input
                  type="range"
                  min={0.5}
                  max={1.6}
                  step={0.01}
                  value={current[0]}
                  onChange={(event) => setAxis(0, Number(event.target.value))}
                />
                <span className="val">×{current[0].toFixed(2)}</span>
              </label>
              <label className="slider-row">
                <span>Height</span>
                <input
                  type="range"
                  min={0.5}
                  max={1.6}
                  step={0.01}
                  value={current[1]}
                  onChange={(event) => setAxis(1, Number(event.target.value))}
                />
                <span className="val">×{current[1].toFixed(2)}</span>
              </label>
              <label className="slider-row">
                <span>Depth</span>
                <input
                  type="range"
                  min={0.5}
                  max={1.6}
                  step={0.01}
                  value={current[2]}
                  onChange={(event) => setAxis(2, Number(event.target.value))}
                />
                <span className="val">×{current[2].toFixed(2)}</span>
              </label>

              <div className="part-picture">
                <div className="part-picture-head">
                  <span>Picture</span>
                  <div className="part-picture-actions">
                    <button
                      type="button"
                      className="mini-action"
                      onClick={() => pictureInput.current?.click()}
                      title={`Choose a picture for ${activePart.name}`}
                    >
                      {picture ? 'Replace…' : 'Choose image…'}
                    </button>
                    {picture && (
                      <button
                        type="button"
                        className="mini-action"
                        onClick={() => applyPicture(null)}
                        title="Remove the picture from this part"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <div
                  className={`picture-slot ${picture ? 'has-image' : ''} ${
                    pictureDrag ? 'drag' : ''
                  }`}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes('Files')) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'copy'
                    setPictureDrag(true)
                  }}
                  onDragLeave={() => setPictureDrag(false)}
                  onDrop={(event) => {
                    const file = Array.from(event.dataTransfer.files).find(isPictureFile)
                    if (!file) return
                    event.preventDefault()
                    setPictureDrag(false)
                    void usePictureFile(file)
                  }}
                >
                  {picture ? (
                    <img src={picture.url} alt={`Picture on ${activePart.name}`} />
                  ) : (
                    <span>
                      Drop a PNG or JPEG here
                      <i>or use Choose image…</i>
                    </span>
                  )}
                </div>

                <label className="slider-row">
                  <span>Pic size</span>
                  <input
                    type="range"
                    min={0.25}
                    max={3}
                    step={0.01}
                    value={picture?.size ?? 1}
                    disabled={!picture}
                    onChange={(event) =>
                      picture &&
                      applyPicture(
                        { ...picture, size: Number(event.target.value) },
                        'size',
                      )
                    }
                  />
                  <span className="val">×{(picture?.size ?? 1).toFixed(2)}</span>
                </label>
                <label className="slider-row">
                  <span>Opacity</span>
                  <input
                    type="range"
                    min={0.05}
                    max={1}
                    step={0.01}
                    value={picture?.opacity ?? 1}
                    disabled={!picture}
                    onChange={(event) =>
                      picture &&
                      applyPicture(
                        { ...picture, opacity: Number(event.target.value) },
                        'opacity',
                      )
                    }
                  />
                  <span className="val">
                    {Math.round((picture?.opacity ?? 1) * 100)}%
                  </span>
                </label>

                {pictureError && <div className="picture-error">{pictureError}</div>}
              </div>

              <input
                ref={pictureInput}
                type="file"
                accept={PICTURE_ACCEPT}
                className="hidden-input"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void usePictureFile(file)
                  event.target.value = ''
                }}
              />

              <div className="panel-hint tight">
                {pair
                  ? 'Changes and pictures apply to both mirrored parts.'
                  : 'Select both sides resizes the mirror too. Drop a picture on a part in the 3D view to map it there.'}
              </div>
            </div>
          ) : (
            <div className="panel-hint tight">
              Pick a part above, or click a part in Pose mode (Tab), to resize it.
            </div>
          )}
        </div>
      )}

      <div className="section">
        <div className="section-title">Proportions</div>
        <label className="slider-row">
          <span>Height</span>
          <input
            type="range"
            min={1.3}
            max={2.2}
            step={0.01}
            value={spec.height}
            onChange={(event) => update({ height: Number(event.target.value) })}
          />
          <span className="val">{spec.height.toFixed(2)}</span>
        </label>
        <label className="slider-row">
          <span>Build</span>
          <input
            type="range"
            min={0.7}
            max={1.45}
            step={0.01}
            value={spec.build}
            onChange={(event) => update({ build: Number(event.target.value) })}
          />
          <span className="val">{spec.build.toFixed(2)}</span>
        </label>
        <label className="slider-row">
          <span>Head</span>
          <input
            type="range"
            min={0.75}
            max={1.35}
            step={0.01}
            value={spec.headSize}
            onChange={(event) => update({ headSize: Number(event.target.value) })}
          />
          <span className="val">{spec.headSize.toFixed(2)}</span>
        </label>
        <label className="slider-row">
          <span>Legs</span>
          <input
            type="range"
            min={0.85}
            max={1.2}
            step={0.01}
            value={spec.legLength}
            onChange={(event) => update({ legLength: Number(event.target.value) })}
          />
          <span className="val">{spec.legLength.toFixed(2)}</span>
        </label>
      </div>

      <div className="section">
        <div className="section-title">Palette</div>
        <div className="color-grid">
          {COLOR_FIELDS.map(({ key, label }) => (
            <label className="color-item" key={key}>
              <input
                type="color"
                value={spec.colors[key]}
                onChange={(event) => setColor(key, event.target.value)}
              />
              <span>{label}</span>
              <code>{spec.colors[key].toUpperCase()}</code>
            </label>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="stat-row">
          <span>Parts per rig</span>
          <b>{PARTS_PER_RIG}</b>
        </div>
        <div className="stat-row">
          <span>Skeleton</span>
          <b>{BONES_PER_RIG} bones</b>
        </div>
        <div className="stat-row">
          <span>GLB clips</span>
          <b>Idle, Walk</b>
        </div>
        <div className="stat-row">
          <span>Format</span>
          <b>Primitive humanoid</b>
        </div>
        <button type="button" className="btn primary wide" onClick={() => onAdd(spec)}>
          <IconPlus size={15} /> {editingName ? 'Add copy to scene' : 'Add character'}
        </button>
        <div className="panel-hint tight">
          Characters are procedural groups. Select the group to keep tuning it, or export a GLB for
          your engine.
        </div>
      </div>
    </div>
  )
}
