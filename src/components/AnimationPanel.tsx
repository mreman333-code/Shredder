import { useEffect, useRef, useState } from 'react'
import {
  ANIMATION_SOURCE_LABELS,
  clipLength,
  type AnimationClipData,
} from '../blend/animation'
import type { SceneObject } from '../blend/doc'
import { ANIMATION_ACCEPT, ANIMATION_LABEL } from '../three/animationImport'
import { IconPlus, IconTrash } from './Icons'

interface AnimationPanelProps {
  clips: AnimationClipData[]
  activeClipId: string | null
  time: number
  playing: boolean
  speed: number
  loop: boolean
  /** Tracks that found a bone or object, reported by the viewport. */
  match: { bound: number; total: number } | null
  /** Name of the object the active clip drives, when it is bound. */
  boundName: string | null
  /** Selected object or part, so keying can say what it will capture. */
  selectionName: string | null
  /** Top-level scene objects the clip can be bound to. */
  objects: SceneObject[]
  onSelectClip: (id: string | null) => void
  onNewClip: () => void
  onRenameClip: (id: string, name: string) => void
  onDeleteClip: (id: string) => void
  onDuration: (seconds: number) => void
  onBind: (targetId: string | null) => void
  onPlay: (playing: boolean) => void
  onSeek: (time: number) => void
  onSpeed: (speed: number) => void
  onLoop: (loop: boolean) => void
  onAddKey: (scope: 'selection' | 'character') => void
  onDeleteTrack: (target: string) => void
  onImport: (file: File) => void
}

const SPEEDS = [0.25, 0.5, 1, 1.5, 2]

export function AnimationPanel({
  clips,
  activeClipId,
  time,
  playing,
  speed,
  loop,
  match,
  boundName,
  selectionName,
  objects,
  onSelectClip,
  onNewClip,
  onRenameClip,
  onDeleteClip,
  onDuration,
  onBind,
  onPlay,
  onSeek,
  onSpeed,
  onLoop,
  onAddKey,
  onDeleteTrack,
  onImport,
}: AnimationPanelProps) {
  const [nameDraft, setNameDraft] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const active = clips.find((clip) => clip.id === activeClipId) ?? null
  const duration = active ? clipLength(active) : 0

  useEffect(() => {
    setNameDraft(active?.name ?? '')
  }, [active?.id, active?.name])

  const commitName = () => {
    if (!active) return
    const clean = nameDraft.trim()
    if (!clean || clean === active.name) {
      setNameDraft(active.name)
      return
    }
    onRenameClip(active.id, clean)
  }

  return (
    <div className="animation-panel">
      <div className="anim-heading">
        <div>
          <div className="section-title">Animation</div>
          <div className="panel-hint tight">
            Keyframe clips like Blender's action editor — play them on the rig in the viewport.
          </div>
        </div>
      </div>

      <div
        className={`anim-import ${dragActive ? 'drag' : ''}`}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          const file = Array.from(event.dataTransfer.files).find((entry) =>
            ANIMATION_ACCEPT.split(',').some((ext) => entry.name.toLowerCase().endsWith(ext)),
          )
          if (!file) return
          event.preventDefault()
          setDragActive(false)
          onImport(file)
        }}
      >
        <button
          type="button"
          className="btn wide"
          onClick={() => fileInput.current?.click()}
          title="Read animation clips out of a Unity or Blender file"
        >
          Import animation…
        </button>
        <span className="anim-import-hint">
          {ANIMATION_LABEL}. Drop a clip here, or onto the viewport.
        </span>
        <input
          ref={fileInput}
          type="file"
          accept={ANIMATION_ACCEPT}
          className="hidden-input"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onImport(file)
            event.target.value = ''
          }}
        />
      </div>

      <div className="section">
        <div className="section-title">
          <span>Actions</span>
          <button type="button" className="mini-action" onClick={onNewClip} title="Create an empty clip">
            <IconPlus size={10} /> New
          </button>
        </div>
        {clips.length === 0 ? (
          <div className="panel-hint tight">
            No clips yet. Import a Unity <b>.anim</b> or a Blender <b>.glb / .fbx</b>, or create an
            empty action and key the selection.
          </div>
        ) : (
          <div className="anim-clips">
            {clips.map((clip) => (
              <button
                type="button"
                key={clip.id}
                className={`anim-clip ${clip.id === activeClipId ? 'active' : ''}`}
                onClick={() => onSelectClip(clip.id)}
                title={clip.file ?? clip.name}
              >
                <span className="anim-clip-name">{clip.name}</span>
                <span className="anim-clip-meta">
                  {clipLength(clip).toFixed(2)}s · {clip.tracks.length}{' '}
                  {clip.tracks.length === 1 ? 'track' : 'tracks'}
                </span>
                <span className={`anim-badge ${clip.source}`}>
                  {ANIMATION_SOURCE_LABELS[clip.source]}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {active && (
        <>
          <div className="section">
            <div className="anim-title-row">
              <input
                className="anim-name-input"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={commitName}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                  if (event.key === 'Escape') {
                    setNameDraft(active.name)
                    event.currentTarget.blur()
                  }
                }}
                aria-label="Clip name"
              />
              <button
                type="button"
                className="mini-action"
                onClick={() => onDeleteClip(active.id)}
                title="Delete this clip"
              >
                <IconTrash size={11} />
              </button>
            </div>

            <label className="anim-field">
              <span>Drives</span>
              <select
                value={active.targetId ?? ''}
                onChange={(event) => onBind(event.target.value || null)}
              >
                <option value="">Whole scene (bind tracks by name)</option>
                {objects.map((object) => (
                  <option key={object.id} value={object.id}>
                    {object.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="panel-hint tight">
              {boundName
                ? `Tracks bind to bones and parts inside ${boundName}, then the rest of the scene.`
                : 'Tracks bind by name to bones (Hips, Thigh L) or objects.'}
            </div>
          </div>

          <div className="section">
            <div className="section-title">Playback</div>
            <div className="anim-transport">
              <button
                type="button"
                className={`anim-play ${playing ? 'on' : ''}`}
                onClick={() => onPlay(!playing)}
                title={playing ? 'Pause' : 'Play'}
              >
                {playing ? '❚❚' : '▶'}
              </button>
              <button
                type="button"
                className="anim-mini"
                onClick={() => {
                  onPlay(false)
                  onSeek(0)
                }}
                title="Back to the first frame"
              >
                ⏮
              </button>
              <span className="anim-time">
                {Math.min(time, duration).toFixed(2)} / {duration.toFixed(2)}s
              </span>
            </div>

            <input
              className="anim-scrub"
              type="range"
              min={0}
              max={Math.max(0.1, duration)}
              step={0.01}
              value={Math.min(time, duration)}
              onChange={(event) => {
                onPlay(false)
                onSeek(Number(event.target.value))
              }}
              aria-label="Playhead"
            />

            {match && match.total > 0 && match.bound < match.total && (
              <div className="anim-warn">
                {match.bound} of {match.total} tracks found a bone or object. Tracks whose names
                are missing from this rig are skipped.
              </div>
            )}
            {match && match.total > 0 && match.bound === match.total && (
              <div className="panel-hint tight">
                All {match.total} tracks are driving the rig.
              </div>
            )}

            <div className="anim-row">
              <button
                type="button"
                className={`anim-toggle ${loop ? 'on' : ''}`}
                aria-pressed={loop}
                onClick={() => onLoop(!loop)}
                title="Loop the clip"
              >
                Loop
              </button>
              <label className="anim-field compact">
                <span>Speed</span>
                <select
                  value={String(speed)}
                  onChange={(event) => onSpeed(Number(event.target.value))}
                >
                  {SPEEDS.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}×
                    </option>
                  ))}
                </select>
              </label>
              <label className="anim-field compact">
                <span>Length</span>
                <input
                  type="number"
                  min={0.1}
                  max={120}
                  step={0.1}
                  value={Number(duration.toFixed(2))}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    if (Number.isFinite(next)) onDuration(next)
                  }}
                />
              </label>
            </div>
          </div>

          <div className="section">
            <div className="section-title">Keyframes</div>
            <div className="anim-key-actions">
              <button
                type="button"
                className="btn"
                onClick={() => onAddKey('selection')}
                disabled={!selectionName}
                title={
                  selectionName
                    ? `Key ${selectionName} at the playhead`
                    : 'Select an object or body part to key it'
                }
              >
                Key selection
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => onAddKey('character')}
                title="Key every body part of the character this clip drives"
              >
                Key all parts
              </button>
            </div>
            <div className="panel-hint tight">
              {selectionName
                ? `Selected: ${selectionName}. Move it, key it, move the playhead, key again.`
                : 'Select something in the scene or in Pose mode, then key it at the playhead.'}
            </div>

            {active.tracks.length === 0 ? (
              <div className="panel-hint tight">
                No tracks yet. Key a pose, or import a clip from Unity or Blender.
              </div>
            ) : (
              <div className="anim-tracks">
                {active.tracks.map((track) => (
                  <div className="anim-track" key={track.target}>
                    <span className="anim-track-name" title={track.path ?? track.target}>
                      {track.target}
                    </span>
                    <span className="anim-track-keys">{track.keys.length}</span>
                    <button
                      type="button"
                      className="mini-action"
                      onClick={() => onDeleteTrack(track.target)}
                      title={`Remove the ${track.target} track`}
                    >
                      <IconTrash size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
