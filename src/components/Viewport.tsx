import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { ProjectDoc } from '../blend/doc'
import type { AnimationClipData } from '../blend/animation'
import type { SculptBrushId, SculptSymmetry } from '../blend/sculpt'
import {
  SceneManager,
  type ShadingMode,
  type ToolMode,
  type ViewName,
  type ViewportCallbacks,
} from '../three/SceneManager'

interface ViewportProps {
  doc: ProjectDoc
  selectionId: string | null
  transformId: string | null
  tool: ToolMode
  snap: boolean
  shading: ShadingMode
  showBones: boolean
  viewLabel: string
  mode: 'object' | 'pose' | 'sculpt'
  loadToken: number
  callbacks: ViewportCallbacks
  onReady: (manager: SceneManager | null) => void
  onSetView: (view: ViewName) => void
  onFrameSelected: () => void
  onFrameAll: () => void
  /** Optional content drawn over the 3D scene, such as the first-run card. */
  overlay?: ReactNode
  /** Clip shown in the viewport; seekToken marks an explicit scrub. */
  animation?: {
    clip: AnimationClipData | null
    playing: boolean
    speed: number
    loop: boolean
    seekTime: number
    seekToken: number
  }
  /** Brush setup while the app is in sculpt mode. */
  sculpt?: {
    enabled: boolean
    brush: SculptBrushId
    radius: number
    strength: number
    symmetry: SculptSymmetry
  }
}

export function Viewport({
  doc,
  selectionId,
  transformId,
  tool,
  snap,
  shading,
  showBones,
  viewLabel,
  mode,
  loadToken,
  callbacks,
  onReady,
  onSetView,
  onFrameSelected,
  onFrameAll,
  overlay,
  animation,
  sculpt,
}: ViewportProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const managerRef = useRef<SceneManager | null>(null)
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const [dropActive, setDropActive] = useState(false)
  const dropDepth = useRef(0)

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dropDepth.current += 1
    setDropActive(true)
  }

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDropActive(true)
  }

  const handleDragLeave = () => {
    dropDepth.current = Math.max(0, dropDepth.current - 1)
    if (dropDepth.current === 0) setDropActive(false)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    // The app routes the dropped file; this only clears the hint.
    dropDepth.current = 0
    setDropActive(false)
    if (event.dataTransfer.types.includes('Files')) event.preventDefault()
  }

  useEffect(() => {
    if (!mountRef.current) return
    const manager = new SceneManager(mountRef.current, {
      onPick: (id) => callbacksRef.current.onPick(id),
      onTransform: (id, position, rotation, scale) =>
        callbacksRef.current.onTransform(id, position, rotation, scale),
      onTransformStart: () => callbacksRef.current.onTransformStart?.(),
      onTransformEnd: () => callbacksRef.current.onTransformEnd(),
      onAnimationTime: (time, playing) =>
        callbacksRef.current.onAnimationTime?.(time, playing),
      onAnimationMatch: (bound, total) =>
        callbacksRef.current.onAnimationMatch?.(bound, total),
      onSculptCommit: (id, positions, normals) =>
        callbacksRef.current.onSculptCommit?.(id, positions, normals),
    })
    managerRef.current = manager
    onReadyRef.current(manager)
    return () => {
      onReadyRef.current(null)
      manager.dispose()
      managerRef.current = null
    }
  }, [])

  useEffect(() => {
    managerRef.current?.sync(doc)
  }, [doc])

  useEffect(() => {
    managerRef.current?.setSelection(selectionId, transformId)
  }, [selectionId, transformId, tool])

  useEffect(() => {
    managerRef.current?.setTool(tool)
  }, [tool])

  useEffect(() => {
    managerRef.current?.setSnap(snap)
  }, [snap])

  useEffect(() => {
    managerRef.current?.setShading(shading)
  }, [shading])

  useEffect(() => {
    managerRef.current?.setBonesVisible(showBones)
  }, [showBones])

  useEffect(() => {
    managerRef.current?.setSculptMode(Boolean(sculpt?.enabled))
  }, [sculpt?.enabled])

  useEffect(() => {
    if (!sculpt) return
    managerRef.current?.setSculptBrush({
      id: sculpt.brush,
      radius: sculpt.radius,
      strength: sculpt.strength,
      symmetry: sculpt.symmetry,
    })
  }, [
    sculpt?.brush,
    sculpt?.radius,
    sculpt?.strength,
    sculpt?.symmetry.x,
    sculpt?.symmetry.y,
    sculpt?.symmetry.z,
  ])

  useEffect(() => {
    managerRef.current?.setAnimation(animation?.clip ?? null)
  }, [animation?.clip])

  useEffect(() => {
    managerRef.current?.setAnimationPlaying(Boolean(animation?.playing))
  }, [animation?.playing])

  useEffect(() => {
    if (animation) managerRef.current?.setAnimationSpeed(animation.speed)
  }, [animation?.speed])

  useEffect(() => {
    if (animation) managerRef.current?.setAnimationLoop(animation.loop)
  }, [animation?.loop])

  // Explicit scrubs carry a token, so playhead reports never seek themselves.
  useEffect(() => {
    if (animation) managerRef.current?.seekAnimation(animation.seekTime)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animation?.seekToken])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      managerRef.current?.applyCamera(doc.camera)
    })
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadToken])

  const objects = doc.objects.filter((o) => o.kind !== 'group').length
  const groups = doc.objects.filter((o) => o.kind === 'group').length

  return (
    <section
      className="viewport"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="viewport-mount" ref={mountRef} />

      <div className="vp-overlay vp-top-left">
        <div className="vp-view-name">{viewLabel}</div>
        <div className="vp-sub">
          {mode === 'object' ? 'Object Mode' : mode === 'pose' ? 'Pose Mode' : 'Sculpt Mode'} ·{' '}
          {shading === 'solid' ? 'Solid' : 'Wireframe'}
        </div>
      </div>

      <div className="vp-overlay vp-top-right">
        <div className="vp-view-buttons">
          <button type="button" onClick={() => onSetView('front')} title="Front view">
            Front
          </button>
          <button type="button" onClick={() => onSetView('right')} title="Right view">
            Right
          </button>
          <button type="button" onClick={() => onSetView('top')} title="Top view">
            Top
          </button>
          <button type="button" onClick={() => onSetView('user')} title="User perspective">
            User
          </button>
          <span className="vp-sep" />
          <button type="button" onClick={onFrameSelected} title="Frame selected (F)">
            Frame
          </button>
          <button type="button" onClick={onFrameAll} title="Frame all">
            All
          </button>
        </div>
      </div>

      <div className="vp-overlay vp-bottom-left">
        <span className="vp-hint">
          <b>Click</b> select
        </span>
        <span className="vp-hint">
          <b>MMB</b> orbit
        </span>
        <span className="vp-hint">
          <b>Wheel</b> zoom
        </span>
        <span className="vp-hint">
          <b>{mode === 'sculpt' ? 'LMB' : 'G / R / S'}</b> {mode === 'sculpt' ? 'sculpt' : 'transform'}
        </span>
        {mode === 'sculpt' && (
          <>
            <span className="vp-hint">
              <b>Shift</b> smooth
            </span>
            <span className="vp-hint">
              <b>Ctrl</b> invert
            </span>
          </>
        )}
      </div>

      <div className="vp-overlay vp-stats">
        {objects} mesh{objects === 1 ? '' : 'es'} · {groups} group{groups === 1 ? '' : 's'}
      </div>

      {dropActive && (
        <div className="vp-drop">
          <strong>Drop a picture on a body part — or a model to import it</strong>
          <span>A picture wraps the part; a model or an .anim clip is imported into the project.</span>
        </div>
      )}

      {overlay}
    </section>
  )
}
