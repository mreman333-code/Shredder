import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { PartImage, PrimitiveKind, ProjectDoc, SceneObject, Vec3 } from '../blend/doc'
import {
  clipLength,
  sampleTrack,
  type AnimationClipData,
  type AnimationKey,
  type AnimationTrack,
} from '../blend/animation'
import { boneForPart, characterSkeleton } from '../blend/skeleton'
import { decodeMesh, type MeshAsset } from '../blend/mesh'
import {
  applyStroke,
  buildNeighbors,
  computeVertexNormals,
  type NeighborTable,
  type SculptBrushId,
  type SculptMeshData,
  type SculptSymmetry,
} from '../blend/sculpt'
import {
  decodePaintColors,
  fillSurfacePart,
  hexColorBytes,
  paintDab,
  solidColors,
  surfaceParts,
  type PaintTool,
  type SurfaceParts,
} from '../blend/paint'
import { meshGeometry, primitiveGeometry } from './geometry'
import { sculptGeometryFromAsset } from './sculptBuild'
import { poseBones } from './pose'
import { buildExportScene, createBoneRig, rigPrefix } from './rig'
import {
  disposeTextures,
  preloadAssetTextures,
  preloadPictures,
  textureFor,
  textureForAsset,
  textureInstance,
} from './textures'

export type ToolMode = 'select' | 'translate' | 'rotate' | 'scale'

/** One connected piece of a mesh, listed in the Paint panel. */
export interface PaintPartInfo {
  index: number
  triangles: number
}
export type ShadingMode = 'solid' | 'wire'
export type ViewName = 'user' | 'front' | 'back' | 'left' | 'right' | 'top'

export interface ViewportCallbacks {
  onPick: (objId: string | null) => void
  onTransform: (id: string, position: Vec3, rotation: Vec3, scale: Vec3) => void
  onTransformStart?: () => void
  onTransformEnd: () => void
  /** Playhead reports while an animation runs (throttled, not every frame). */
  onAnimationTime?: (time: number, playing: boolean) => void
  /** How many clip tracks found a node (bound) out of the clip's track count. */
  onAnimationMatch?: (bound: number, total: number) => void
  /** A sculpt stroke finished; these positions belong in the document. */
  onSculptCommit?: (id: string, positions: Float32Array, normals: Float32Array) => void
  /** A surface part was selected for painting. */
  onPaintPart?: (id: string, part: number, parts: number, triangles: number) => void
  /** A fill or brush stroke changed these vertex colours. */
  onPaintCommit?: (id: string, colors: Uint8Array) => void
}

export interface SculptBrushState {
  id: SculptBrushId
  radius: number
  strength: number
  symmetry: SculptSymmetry
  /** Latched on-screen modifiers, so touch strokes get Shift and Ctrl too. */
  smooth: boolean
  invert: boolean
}

export interface PaintBrushState {
  tool: PaintTool
  color: string
  radius: number
  strength: number
}

interface PaintStrokeState {
  id: string
  mesh: THREE.Mesh
  colors: Uint8Array
  last: THREE.Vector3
  changed: boolean
}

interface SculptStrokeState {
  id: string
  mesh: THREE.Mesh
  indices: Uint32Array
  neighbors: NeighborTable
  lastLocal: THREE.Vector3
  lastWorld: THREE.Vector3
  normalLocal: THREE.Vector3
  radiusLocal: number
  moved: boolean
}

interface TransformSnapshot {
  position: Vec3
  rotation: Vec3
  scale: Vec3
}

interface DirectTarget {
  node: THREE.Object3D
  track: AnimationTrack
  base: TransformSnapshot
}

interface PartBinding {
  node: THREE.Object3D
  base: THREE.Matrix4
}

interface RigBoneEntry {
  bone: THREE.Bone
  parent: number
  restLocal: THREE.Matrix4
  restWorld: THREE.Matrix4
  restWorldInverse: THREE.Matrix4
  track: AnimationTrack | null
  reference: AnimationKey | null
  parts: PartBinding[]
}

interface RigPlan {
  bones: RigBoneEntry[]
}

interface AnimationPlan {
  rigs: RigPlan[]
  direct: DirectTarget[]
}

/** Source bone names (Unity humanoid, Mixamo, generic) mapped to rig keys. */
const BONE_ALIASES: Record<string, string> = {
  hips: 'hips',
  pelvis: 'hips',
  root: 'hips',
  spine: 'spine',
  spine_0: 'spine',
  spine_1: 'chest',
  spine_2: 'chest',
  spine1: 'chest',
  spine2: 'chest',
  chest: 'chest',
  upperchest: 'chest',
  neck: 'neck',
  head: 'head',
  leftshoulder: 'shoulder_l',
  rightshoulder: 'shoulder_r',
  leftarm: 'upperarm_l',
  leftupperarm: 'upperarm_l',
  rightarm: 'upperarm_r',
  rightupperarm: 'upperarm_r',
  leftforearm: 'forearm_l',
  leftlowerarm: 'forearm_l',
  rightforearm: 'forearm_r',
  rightlowerarm: 'forearm_r',
  lefthand: 'hand_l',
  righthand: 'hand_r',
  leftupleg: 'thigh_l',
  leftthigh: 'thigh_l',
  rightupleg: 'thigh_r',
  rightthigh: 'thigh_r',
  leftleg: 'shin_l',
  leftshin: 'shin_l',
  rightleg: 'shin_r',
  rightshin: 'shin_r',
  leftfoot: 'foot_l',
  rightfoot: 'foot_r',
  lefttoebase: 'foot_l',
  righttoebase: 'foot_r',
}

/** Normalized lookup key for a node or a track target. */
function animationKey(name: string): string {
  return name
    .replace(/^mixamorig[:_]?/i, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

function snapshotOf(node: THREE.Object3D): TransformSnapshot {
  const euler = new THREE.Euler().setFromQuaternion(node.quaternion)
  return {
    position: [node.position.x, node.position.y, node.position.z],
    rotation: [euler.x, euler.y, euler.z],
    scale: [node.scale.x, node.scale.y, node.scale.z],
  }
}

function matrixOf(object: SceneObject): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(object.position[0], object.position[1], object.position[2]),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(object.rotation[0], object.rotation[1], object.rotation[2]),
    ),
    new THREE.Vector3(object.scale[0], object.scale[1], object.scale[2]),
  )
}


/** The ring cursor is built facing +Z, then turned to the surface normal. */
const CURSOR_FACING = new THREE.Vector3(0, 0, 1)

const VIEW_LABELS: Record<ViewName, string> = {
  user: 'User Perspective',
  front: 'Front View',
  back: 'Back View',
  left: 'Left View',
  right: 'Right View',
  top: 'Top View',
}

export class SceneManager {
  private container: HTMLElement
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private transform: TransformControls
  private content = new THREE.Group()
  private outline: THREE.BoxHelper
  private nodes = new Map<string, THREE.Object3D>()
  private nodeKinds = new Map<string, PrimitiveKind>()
  private rigs = new Map<
    string,
    { key: string; root?: THREE.Object3D; helper: THREE.SkeletonHelper }
  >()
  private bonesVisible = false
  private doc: ProjectDoc | null = null
  private tool: ToolMode = 'translate'
  private shading: ShadingMode = 'solid'
  private selectionId: string | null = null
  private targetId: string | null = null
  private callbacks: ViewportCallbacks
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private downPos = { x: 0, y: 0 }
  private activePointers = new Set<number>()
  private resizeObserver: ResizeObserver
  private environment: THREE.Texture
  private disposed = false
  private animationClip: AnimationClipData | null = null
  private animationPlan: AnimationPlan | null = null
  private animationPlaying = false
  private animationLoop = true
  private animationSpeed = 1
  private animationTime = 0
  private animationLastFrame = 0
  private animationReported = 0
  private sculptMode = false
  private sculptBrush: SculptBrushState = {
    id: 'draw',
    radius: 0.12,
    strength: 0.5,
    symmetry: { enabled: true, x: true, y: false, z: false },
    smooth: false,
    invert: false,
  }
  private stroke: SculptStrokeState | null = null
  private paintMode = false
  private paintBrush: PaintBrushState = {
    tool: 'part',
    color: '#e0703c',
    radius: 0.12,
    strength: 0.6,
  }
  private paintStroke: PaintStrokeState | null = null
  private paintSelection: { id: string; part: number; parts: number } | null = null
  private paintHighlight: THREE.Mesh | null = null
  private surfaceCache = new WeakMap<THREE.BufferGeometry, SurfaceParts>()
  private sculptCursor: THREE.Mesh

  constructor(container: HTMLElement, callbacks: ViewportCallbacks) {
    this.container = container
    this.callbacks = callbacks

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.02
    this.renderer.domElement.className = 'viewport-canvas'
    container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color('#1a1a1b')

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.02, 300)
    this.camera.position.set(3.4, 2.6, 4.4)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(0, 0.9, 0)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.09
    this.controls.minDistance = 0.35
    this.controls.maxDistance = 60
    this.controls.maxPolarAngle = Math.PI * 0.495
    // Touch: one finger orbits, two fingers pinch and pan.
    this.controls.touches.ONE = THREE.TOUCH.ROTATE
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN
    this.renderer.domElement.style.touchAction = 'none'

    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const room = new RoomEnvironment()
    this.environment = pmrem.fromScene(room, 0.04).texture
    this.scene.environment = this.environment
    ;(room as unknown as { dispose?: () => void }).dispose?.()
    pmrem.dispose()

    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x2b2b33, 0.55)
    this.scene.add(hemi)

    const key = new THREE.DirectionalLight(0xfff2e2, 2.4)
    key.position.set(4.5, 7, 4)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = 0.5
    key.shadow.camera.far = 30
    key.shadow.camera.left = -6
    key.shadow.camera.right = 6
    key.shadow.camera.top = 6
    key.shadow.camera.bottom = -6
    key.shadow.bias = -0.0008
    key.shadow.normalBias = 0.02
    this.scene.add(key)

    const rim = new THREE.DirectionalLight(0x7f9fd8, 0.85)
    rim.position.set(-5, 3.5, -4.5)
    this.scene.add(rim)

    const grid = new THREE.GridHelper(30, 60, 0x51555b, 0x303236)
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.85
    grid.position.y = 0.001
    this.scene.add(grid)

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.32 }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = -0.002
    shadow.receiveShadow = true
    this.scene.add(shadow)

    this.scene.add(this.content)

    const dummy = new THREE.Object3D()
    this.outline = new THREE.BoxHelper(dummy, 0xf2a84b)
    this.outline.visible = false
    this.outline.renderOrder = 999
    const lineMat = this.outline.material as THREE.LineBasicMaterial
    lineMat.depthTest = false
    lineMat.transparent = true
    lineMat.opacity = 0.95
    lineMat.toneMapped = false
    this.scene.add(this.outline)

    this.transform = new TransformControls(this.camera, this.renderer.domElement)
    this.transform.setSize(0.9)
    this.scene.add(this.transform)

    this.transform.addEventListener('dragging-changed', (event) => {
      const active = (event as unknown as { value: boolean }).value
      this.controls.enabled = !active
      if (active) this.callbacks.onTransformStart?.()
      else this.callbacks.onTransformEnd()
    })

    this.transform.addEventListener('objectChange', () => {
      const obj = this.transform.object
      if (!obj) return
      const id = obj.userData.objId as string | undefined
      if (!id) return
      this.callbacks.onTransform(
        id,
        [obj.position.x, obj.position.y, obj.position.z],
        [obj.rotation.x, obj.rotation.y, obj.rotation.z],
        [obj.scale.x, obj.scale.y, obj.scale.z],
      )
    })

    this.sculptCursor = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 64),
      new THREE.MeshBasicMaterial({
        color: 0xf2a84b,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    )
    this.sculptCursor.visible = false
    this.sculptCursor.renderOrder = 1000
    this.scene.add(this.sculptCursor)

    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown)
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove)
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp)
    this.renderer.domElement.addEventListener('pointercancel', this.handlePointerCancel)

    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(container)
    this.resize()

    this.renderer.setAnimationLoop(this.renderFrame)
  }

  private resize = () => {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private renderFrame = () => {
    if (this.disposed) return
    this.controls.update()
    this.stepAnimation(performance.now())
    const node = this.selectionId ? this.nodes.get(this.selectionId) : null
    if (node) {
      this.outline.visible = this.isVisible(node)
      if (this.outline.visible) this.outline.setFromObject(node)
    } else {
      this.outline.visible = false
    }
    this.renderer.render(this.scene, this.camera)
  }

  private isVisible(node: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = node
    while (current && current !== this.content) {
      if (!current.visible) return false
      current = current.parent
    }
    return true
  }

  private handlePointerDown = (event: PointerEvent) => {
    this.activePointers.add(event.pointerId)
    this.downPos = { x: event.clientX, y: event.clientY }
    // Painting owns the left button the same way sculpting does.
    if (this.paintMode && event.button === 0) {
      if (this.activePointers.size > 1) {
        this.endPaintStroke()
        return
      }
      if (this.paintBrush.tool === 'brush') this.beginPaintStroke(event)
      return
    }
    if (!this.sculptMode || event.button !== 0) return
    // A second finger turns the gesture into an orbit or pinch, not a brush stroke.
    if (this.activePointers.size > 1) {
      if (this.stroke) this.endSculptStroke()
      return
    }
    this.beginSculptStroke(event)
  }

  private handlePointerMove = (event: PointerEvent) => {
    if (this.paintMode && !this.paintStroke) {
      this.updatePaintCursor(event)
      return
    }
    // Strokes are driven by the window listener so they keep working when the
    // cursor leaves the canvas; this only moves the preview ring.
    if (!this.sculptMode || this.stroke) return
    this.updateSculptCursor(event)
  }

  private handlePointerUp = (event: PointerEvent) => {
    this.activePointers.delete(event.pointerId)
    if (this.paintMode) {
      if (this.paintStroke) {
        this.endPaintStroke()
        return
      }
      if (event.pointerType !== 'mouse') this.sculptCursor.visible = false
      if (event.button !== 0) return
      const moved = Math.hypot(event.clientX - this.downPos.x, event.clientY - this.downPos.y)
      if (moved <= 5 && this.paintBrush.tool === 'part' && !this.pickPaintPart(event)) {
        // Nothing own-geometry under the cursor: a plain body part. Picking it
        // lets the app give it a surface, so the next click can paint it.
        this.pick(event)
      }
      return
    }
    // A finger never hovers, so the brush ring is cleared when it lifts.
    if (event.pointerType !== 'mouse') this.sculptCursor.visible = false
    if (this.stroke) {
      this.endSculptStroke()
      return
    }
    if (event.button !== 0) return
    const moved = Math.hypot(event.clientX - this.downPos.x, event.clientY - this.downPos.y)
    if (moved > 5) return
    if (this.transform.dragging || this.transform.axis) return
    this.pick(event)
  }

  private handlePointerCancel = (event: PointerEvent) => {
    this.activePointers.delete(event.pointerId)
    if (this.activePointers.size === 0) {
      this.endSculptStroke()
      this.endPaintStroke()
    }
  }

  private pick(event: PointerEvent) {
    this.callbacks.onPick(this.pickAt(event.clientX, event.clientY))
  }

  /** Object under a screen position, used by click picking and picture drops. */
  pickAt(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const meshes: THREE.Object3D[] = []
    for (const [id, node] of this.nodes) {
      if (this.nodeKinds.get(id) === 'group') continue
      if (this.isVisible(node)) meshes.push(node)
    }
    const hits = this.raycaster.intersectObjects(meshes, false)
    return (hits[0]?.object.userData.objId as string | undefined) ?? null
  }

  // ---------------------------------------------------------------- sculpting

  setSculptMode(enabled: boolean) {
    if (this.sculptMode === enabled) return
    this.sculptMode = enabled
    if (enabled) {
      this.transform.detach()
      // Left drag paints, the middle button orbits: Blender's sculpt layout.
      this.controls.mouseButtons.LEFT = undefined as unknown as THREE.MOUSE
      this.controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE
      this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN
      // One finger paints, two fingers still orbit and pinch.
      this.controls.touches.ONE = undefined as unknown as THREE.TOUCH
      this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN
      this.renderer.domElement.style.cursor = 'crosshair'
      ;(this.sculptCursor.material as THREE.MeshBasicMaterial).color.set(0xf2a84b)
    } else {
      this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE
      this.controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY
      this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN
      this.controls.touches.ONE = THREE.TOUCH.ROTATE
      this.renderer.domElement.style.cursor = ''
      this.sculptCursor.visible = false
      this.endSculptStroke()
    }
  }

  setSculptBrush(brush: Partial<SculptBrushState>) {
    this.sculptBrush = {
      ...this.sculptBrush,
      ...brush,
      symmetry: brush.symmetry ? { ...brush.symmetry } : this.sculptBrush.symmetry,
    }
  }

  /**
   * The sculptable mesh the brush acts on: the selected part when it has sculpt
   * geometry, otherwise any sculpted part (a group can be selected instead).
   */
  private sculptTargets(): THREE.Mesh[] {
    const selected = this.selectionId ? this.nodes.get(this.selectionId) : null
    if (
      selected instanceof THREE.Mesh &&
      selected.userData.sculpt === true &&
      this.isVisible(selected)
    ) {
      return [selected]
    }
    const meshes: THREE.Mesh[] = []
    for (const node of this.nodes.values()) {
      if (node instanceof THREE.Mesh && node.userData.sculpt === true && this.isVisible(node)) {
        meshes.push(node)
      }
    }
    return meshes
  }

  private sculptIntersection(event: PointerEvent, only?: THREE.Mesh) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const targets = only ? [only] : this.sculptTargets()
    if (targets.length === 0) return null
    return this.raycaster.intersectObjects(targets, false)[0] ?? null
  }

  private beginSculptStroke(event: PointerEvent) {
    if (this.transform.dragging) return
    const hit = this.sculptIntersection(event)
    if (!hit || !(hit.object instanceof THREE.Mesh) || !hit.face) return
    const mesh = hit.object
    const id = mesh.userData.objId as string | undefined
    if (!id) return
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    const index = mesh.geometry.getIndex()
    if (!position || !index) return

    const indices = new Uint32Array(index.array as ArrayLike<number>)
    if (!mesh.userData.sculptNeighbors) {
      mesh.userData.sculptNeighbors = buildNeighbors(indices, position.count)
    }
    const worldScale = mesh.getWorldScale(new THREE.Vector3())
    const uniform =
      (Math.abs(worldScale.x) + Math.abs(worldScale.y) + Math.abs(worldScale.z)) / 3 || 1
    const localPoint = mesh.worldToLocal(hit.point.clone())

    this.stroke = {
      id,
      mesh,
      indices,
      neighbors: mesh.userData.sculptNeighbors as NeighborTable,
      lastLocal: localPoint.clone(),
      lastWorld: hit.point.clone(),
      normalLocal: hit.face.normal.clone(),
      radiusLocal: Math.max(1e-4, this.sculptBrush.radius / uniform),
      moved: false,
    }
    this.controls.enabled = false
    window.addEventListener('pointermove', this.strokeMove)
    window.addEventListener('pointerup', this.strokeUp)
    this.applySculptDab(localPoint, event)
  }

  private strokeMove = (event: PointerEvent) => this.moveSculptStroke(event)

  private strokeUp = () => this.endSculptStroke()

  /** Converts the pointer into a new brush position on the stroked mesh. */
  private sculptPointFor(event: PointerEvent): THREE.Vector3 | null {
    const stroke = this.stroke
    if (!stroke) return null
    const hit = this.sculptIntersection(event, stroke.mesh)
    if (hit && hit.face) {
      stroke.lastWorld.copy(hit.point)
      stroke.normalLocal.copy(hit.face.normal)
      return stroke.mesh.worldToLocal(hit.point.clone())
    }
    // Off the surface: slide along a camera-facing plane so Grab keeps moving.
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      this.camera.getWorldDirection(new THREE.Vector3()).negate(),
      stroke.lastWorld,
    )
    const point = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3())
    if (!point) return null
    stroke.lastWorld.copy(point)
    return stroke.mesh.worldToLocal(point.clone())
  }

  private applySculptDab(point: THREE.Vector3, event: PointerEvent) {
    const stroke = this.stroke
    if (!stroke) return
    const geometry = stroke.mesh.geometry
    const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
    if (!position || !normal) return

    const smooth = (event.shiftKey || this.sculptBrush.smooth) && this.sculptBrush.id !== 'smooth'
    const delta = new THREE.Vector3().subVectors(point, stroke.lastLocal)
    const data: SculptMeshData = {
      positions: position.array as Float32Array,
      normals: normal.array as Float32Array,
      indices: stroke.indices,
      uvs: null,
    }
    const moved = applyStroke(data, {
      brush: smooth ? 'smooth' : this.sculptBrush.id,
      center: [point.x, point.y, point.z],
      normal: [stroke.normalLocal.x, stroke.normalLocal.y, stroke.normalLocal.z],
      delta: [delta.x, delta.y, delta.z],
      radius: stroke.radiusLocal,
      strength: this.sculptBrush.strength,
      invert: event.ctrlKey || event.metaKey || this.sculptBrush.invert,
      symmetry: this.sculptBrush.symmetry,
      neighbors: stroke.neighbors,
    })

    stroke.lastLocal.copy(point)
    if (moved === 0) return
    position.needsUpdate = true
    computeVertexNormals(
      position.array as Float32Array,
      stroke.indices,
      normal.array as Float32Array,
    )
    normal.needsUpdate = true
    stroke.moved = true
  }

  private moveSculptStroke(event: PointerEvent) {
    if (!this.stroke) return
    const point = this.sculptPointFor(event)
    if (!point) return
    this.applySculptDab(point, event)
  }

  private endSculptStroke() {
    const stroke = this.stroke
    if (!stroke) return
    this.stroke = null
    this.controls.enabled = true
    window.removeEventListener('pointermove', this.strokeMove)
    window.removeEventListener('pointerup', this.strokeUp)
    if (!stroke.moved) return
    const geometry = stroke.mesh.geometry
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
    if (!position || !normal) return
    this.callbacks.onSculptCommit?.(
      stroke.id,
      Float32Array.from(position.array as Float32Array),
      Float32Array.from(normal.array as Float32Array),
    )
  }

  private updateSculptCursor(event: PointerEvent) {
    const hit = this.sculptIntersection(event)
    if (!hit || !hit.face) {
      this.sculptCursor.visible = false
      return
    }
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)
    const worldNormal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize()
    this.sculptCursor.visible = true
    this.sculptCursor.position.copy(hit.point).addScaledVector(worldNormal, 0.004)
    this.sculptCursor.quaternion.setFromUnitVectors(CURSOR_FACING, worldNormal)
    const radius = this.sculptBrush.radius
    this.sculptCursor.scale.set(radius, radius, radius)
  }

  /**
   * Every material the file put on a mesh, each with its own packed image.
   * A single-material mesh keeps the object's own colour and texture instead.
   */
  private importedMaterials(
    obj: SceneObject,
  ): THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[] {
    const asset = obj.mesh
    if (!asset?.materials?.length) {
      return new THREE.MeshStandardMaterial({
        color: obj.color,
        roughness: obj.roughness,
        metalness: obj.metalness,
        map: asset?.hasUv ? (textureForAsset(asset) ?? null) : null,
        vertexColors: Boolean(asset?.colors),
        wireframe: this.shading === 'wire',
      })
    }
    return asset.materials.map(
      (slot) =>
        new THREE.MeshStandardMaterial({
          color: slot.color,
          roughness: slot.roughness,
          metalness: slot.metalness,
          map:
            asset.hasUv && slot.baseColor
              ? textureFor(slot.baseColor, slot.baseColorFlipY !== false)
              : null,
          vertexColors: Boolean(asset.colors),
          wireframe: this.shading === 'wire',
        }),
    )
  }

  /** Geometry imported from a file, optionally driven by its own bind skeleton. */
  private createImportedMesh(obj: SceneObject): THREE.Mesh {
    const asset = obj.mesh
    if (!asset) throw new Error(`${obj.name} has no geometry`)
    const material = this.importedMaterials(obj)
    const geometry = meshGeometry(asset)
    const bones = asset.bones ?? []
    let mesh: THREE.Mesh

    if (bones.length > 0 && geometry.getAttribute('skinIndex')) {
      const skinned = new THREE.SkinnedMesh(geometry, material)
      const nodes = bones.map((def) => {
        const bone = new THREE.Bone()
        bone.name = def.name
        bone.position.set(def.position[0], def.position[1], def.position[2])
        bone.quaternion.set(
          def.quaternion[0],
          def.quaternion[1],
          def.quaternion[2],
          def.quaternion[3],
        )
        bone.scale.set(def.scale[0], def.scale[1], def.scale[2])
        return bone
      })
      bones.forEach((def, index) => {
        const parent = def.parent >= 0 ? nodes[def.parent] : undefined
        if (parent && parent !== nodes[index]) parent.add(nodes[index])
      })
      for (const bone of nodes) {
        // Imported skeletons play clips absolutely: the file's own clips are
        // authored against these very bones.
        bone.userData.importBone = true
        if (!bone.parent) skinned.add(bone)
      }
      // Bind while the mesh is still at the origin: the stored bones are the
      // file's bind pose, so the rest shape renders exactly as authored and the
      // whole mesh follows its parent group.
      skinned.updateMatrixWorld(true)
      skinned.bind(new THREE.Skeleton(nodes), new THREE.Matrix4())
      mesh = skinned

      const helper = new THREE.SkeletonHelper(skinned)
      helper.visible = this.bonesVisible
      const line = helper.material as THREE.LineBasicMaterial
      line.depthTest = false
      line.transparent = true
      line.opacity = 0.9
      this.scene.add(helper)
      this.rigs.set(obj.id, {
        key: `import:${asset.vertices}:${bones.length}`,
        helper,
      })
    } else {
      mesh = new THREE.Mesh(geometry, material)
    }

    mesh.name = obj.name
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.objId = obj.id
    mesh.userData.imported = true
    this.nodes.set(obj.id, mesh)
    this.nodeKinds.set(obj.id, obj.kind)
    return mesh
  }

  /** True when the object is drawn from its own sculpted geometry. */
  private usesSculptGeometry(obj: SceneObject): boolean {
    return Boolean(obj.sculpt) && !(obj.kind === 'mesh' && Boolean(obj.mesh?.bones?.length))
  }

  private createSculptNode(obj: SceneObject): THREE.Mesh {
    const asset = obj.sculpt as MeshAsset
    const geometry = sculptGeometryFromAsset(asset)
    const material = new THREE.MeshStandardMaterial({
      color: obj.color,
      roughness: obj.roughness,
      metalness: obj.metalness,
      map: obj.mesh?.hasUv ? (textureForAsset(obj.mesh) ?? null) : null,
      vertexColors: Boolean(asset.colors || obj.paint),
      wireframe: this.shading === 'wire',
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = obj.name
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.objId = obj.id
    // Own geometry: dispose it with the node, never the shared primitive cache.
    mesh.userData.imported = true
    mesh.userData.sculpt = true
    mesh.userData.sculptAsset = asset
    this.nodes.set(obj.id, mesh)
    this.nodeKinds.set(obj.id, obj.kind)
    return mesh
  }

  /** Swaps in new vertex data for an existing node, keeping its identity. */
  private refreshSculptGeometry(node: THREE.Object3D, asset: MeshAsset): boolean {
    if (!(node instanceof THREE.Mesh)) return false
    const position = node.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    const normal = node.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
    if (!position || !normal || position.count !== asset.vertices) return false
    try {
      const decoded = decodeMesh(asset)
      ;(position.array as Float32Array).set(decoded.positions)
      ;(normal.array as Float32Array).set(decoded.normals)
    } catch {
      return false
    }
    position.needsUpdate = true
    normal.needsUpdate = true
    node.geometry.computeBoundingBox()
    node.geometry.computeBoundingSphere()
    node.userData.sculptAsset = asset
    node.userData.sculptNeighbors = undefined
    return true
  }

  private discardNode(id: string, node: THREE.Object3D) {
    node.removeFromParent()
    this.disposeNode(node)
    this.nodes.delete(id)
    this.nodeKinds.delete(id)
    if (this.transform.object === node) this.transform.detach()
  }

  private createNode(obj: SceneObject): THREE.Object3D {
    if (obj.kind === 'group') {
      const group = new THREE.Group()
      group.name = obj.name
      group.userData.objId = obj.id
      this.nodes.set(obj.id, group)
      this.nodeKinds.set(obj.id, obj.kind)
      return group
    }
    if (this.usesSculptGeometry(obj)) return this.createSculptNode(obj)
    if (obj.kind === 'mesh' && obj.mesh) return this.createImportedMesh(obj)
    const material = new THREE.MeshStandardMaterial({
      color: obj.color,
      roughness: obj.roughness,
      metalness: obj.metalness,
      wireframe: this.shading === 'wire',
    })
    const mesh = new THREE.Mesh(primitiveGeometry(obj.kind), material)
    mesh.name = obj.name
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.objId = obj.id
    this.nodes.set(obj.id, mesh)
    this.nodeKinds.set(obj.id, obj.kind)
    return mesh
  }

  /**
   * Maps a picture onto one part: the image becomes the part's base colour and
   * wraps the part's own geometry, so the picture fits whatever shape it is on.
   * Size zooms the image, opacity fades it.
   */
  private applyPicture(
    material: THREE.MeshStandardMaterial,
    picture: PartImage | undefined,
    color: string,
  ) {
    const url = picture?.url ?? ''
    if ((material.userData.pictureUrl as string | undefined) !== url) {
      material.userData.pictureUrl = url
      ;(material.userData.pictureTexture as THREE.Texture | undefined)?.dispose()
      material.userData.pictureTexture = undefined
      if (picture) {
        const map = textureInstance(picture.url)
        material.map = map
        material.userData.pictureTexture = map
      } else {
        material.map = null
      }
      material.needsUpdate = true
    }

    const map = material.map
    if (picture && map) {
      const size = Math.min(3, Math.max(0.25, picture.size))
      const repeat = 1 / size
      map.repeat.set(repeat, repeat)
      map.offset.set((1 - repeat) / 2, (1 - repeat) / 2)
    }

    const opacity = picture ? Math.min(1, Math.max(0.05, picture.opacity)) : 1
    material.color.set(picture ? '#ffffff' : color)
    material.opacity = opacity
    material.transparent = Boolean(picture) || opacity < 1
    material.depthWrite = opacity >= 0.999
  }

  private applyObject(obj: SceneObject, node: THREE.Object3D) {
    if (node.name !== obj.name) node.name = obj.name
    node.position.set(obj.position[0], obj.position[1], obj.position[2])
    node.rotation.set(obj.rotation[0], obj.rotation[1], obj.rotation[2])
    node.scale.set(obj.scale[0], obj.scale[1], obj.scale[2])
    node.visible = obj.visible
    if (obj.kind !== 'group') {
      const material = (node as THREE.Mesh).material as
        | THREE.MeshStandardMaterial
        | THREE.MeshStandardMaterial[]
      if (Array.isArray(material)) {
        // Every material keeps the file's own colour and image; paint swaps
        // them all for the painted vertex colours.
        this.applyPaintColors(node as THREE.Mesh, obj)
        const list = (node as THREE.Mesh).material as
          | THREE.MeshStandardMaterial
          | THREE.MeshStandardMaterial[]
        const entries = Array.isArray(list) ? list : [list]
        if (!obj.paint) {
          const slots = obj.mesh?.materials ?? []
          entries.forEach((entry, index) => {
            const slot = slots[index]
            if (!slot) return
            entry.color.set(slot.color)
            entry.roughness = slot.roughness
            entry.metalness = slot.metalness
            entry.map =
              obj.mesh?.hasUv && slot.baseColor
                ? textureFor(slot.baseColor, slot.baseColorFlipY !== false)
                : null
          })
        }
        for (const entry of entries) entry.wireframe = this.shading === 'wire'
        return
      }
      const parent = obj.parentId
        ? this.doc?.objects.find((entry) => entry.id === obj.parentId)
        : undefined
      if (parent?.character) {
        this.applyPicture(material, parent.character.images?.[obj.name], obj.color)
      } else {
        material.color.set(obj.color)
      }
      material.roughness = obj.roughness
      material.metalness = obj.metalness
      // Imported parts keep their packed texture unless paint replaced it.
      if (obj.kind === 'mesh' && obj.mesh?.hasUv && !obj.mesh.materials?.length) {
        material.map = obj.paint ? null : (textureForAsset(obj.mesh) ?? null)
      }
      this.applyPaintColors(node as THREE.Mesh, obj)
      material.wireframe = this.shading === 'wire'
    }
  }

  sync(doc: ProjectDoc) {
    this.doc = doc
    const byParent = new Map<string | null, SceneObject[]>()
    const existing = new Set(doc.objects.map((o) => o.id))
    for (const obj of doc.objects) {
      const parentKey = obj.parentId && existing.has(obj.parentId) ? obj.parentId : null
      const list = byParent.get(parentKey) ?? []
      list.push(obj)
      byParent.set(parentKey, list)
    }

    const walk = (parentId: string | null, parentNode: THREE.Object3D) => {
      for (const obj of byParent.get(parentId) ?? []) {
        let node = this.nodes.get(obj.id)
        if (node && this.nodeKinds.get(obj.id) !== obj.kind) {
          this.discardNode(obj.id, node)
          node = undefined
        }
        if (node) {
          // A part that gained or lost its sculpted shape needs a different node;
          // one whose sculpt data was edited only needs fresh vertex buffers.
          const wanted = this.usesSculptGeometry(obj)
          if (wanted !== (node.userData.sculpt === true)) {
            this.discardNode(obj.id, node)
            node = undefined
          } else if (wanted && obj.sculpt && node.userData.sculptAsset !== obj.sculpt) {
            if (!this.refreshSculptGeometry(node, obj.sculpt)) {
              this.discardNode(obj.id, node)
              node = undefined
            }
          }
        }
        if (!node) node = this.createNode(obj)
        if (node.parent !== parentNode) parentNode.add(node)
        this.applyObject(obj, node)
        if (obj.kind === 'group') this.syncRig(obj, node)
        walk(obj.id, node)
      }
    }
    walk(null, this.content)

    if (this.paintSelection) {
      const node = this.nodes.get(this.paintSelection.id)
      if (!node || (this.paintHighlight && this.paintHighlight.parent !== node)) {
        this.clearPaintSelection()
      }
    }

    for (const [id, node] of Array.from(this.nodes.entries())) {
      if (!existing.has(id)) {
        node.removeFromParent()
        this.disposeNode(node)
        this.nodes.delete(id)
        this.nodeKinds.delete(id)
        this.removeRig(id)
        if (this.transform.object === node) this.transform.detach()
      }
    }

    const selected = this.selectionId ? this.nodes.get(this.selectionId) : null
    this.outline.visible = !!selected
    this.rebuildAnimationPlan()
  }

  // ------------------------------------------------------------- animation

  /** Clip played in the viewport; null stops playback and restores the pose. */
  setAnimation(clip: AnimationClipData | null) {
    if (!clip) {
      this.clearAnimation()
      return
    }
    const changed = this.animationClip?.id !== clip.id || this.animationClip !== clip
    this.animationClip = clip
    if (changed) {
      this.animationTime = 0
      this.animationLastFrame = 0
    }
    this.rebuildAnimationPlan()
  }

  setAnimationPlaying(playing: boolean) {
    this.animationPlaying = playing
    this.animationLastFrame = 0
  }

  setAnimationLoop(loop: boolean) {
    this.animationLoop = loop
  }

  setAnimationSpeed(speed: number) {
    this.animationSpeed = Math.min(4, Math.max(0.1, speed))
  }

  seekAnimation(time: number) {
    this.animationTime = Math.max(0, time)
    this.animationLastFrame = 0
    this.applyAnimation(this.animationTime)
  }

  getAnimationTime(): number {
    return this.animationTime
  }

  private clearAnimation() {
    const plan = this.animationPlan
    this.animationClip = null
    this.animationPlan = null
    this.animationPlaying = false
    this.animationTime = 0
    if (plan) {
      for (const target of plan.direct) {
        target.node.position.set(...target.base.position)
        target.node.rotation.set(...target.base.rotation)
        target.node.scale.set(...target.base.scale)
      }
    }
    if (this.doc) this.sync(this.doc)
  }

  private stepAnimation(now: number) {
    const clip = this.animationClip
    if (!clip) return
    const duration = clipLength(clip)
    if (this.animationPlaying && this.animationSpeed > 0) {
      if (this.animationLastFrame > 0) {
        const delta = Math.min(0.25, Math.max(0, (now - this.animationLastFrame) / 1000))
        this.animationTime += delta * this.animationSpeed
      }
      if (this.animationTime > duration) {
        if (this.animationLoop) {
          this.animationTime = duration > 0 ? this.animationTime % duration : 0
        } else {
          this.animationTime = duration
          this.animationPlaying = false
        }
      }
      if (now - this.animationReported > 70) {
        this.animationReported = now
        this.callbacks.onAnimationTime?.(this.animationTime, this.animationPlaying)
      }
    }
    this.animationLastFrame = now
    this.applyAnimation(this.animationTime)
  }

  private animationIndex(boundId: string | null): Map<string, THREE.Object3D> {
    const index = new Map<string, THREE.Object3D>()
    const register = (node: THREE.Object3D) => {
      const base = animationKey(node.name)
      if (!base) return
      if (!index.has(base)) index.set(base, node)
      // Rig bones are named `Rig_<Group>_<Bone>`; clips usually name the bone
      // alone, so every suffix is registered too.
      if (base.startsWith('rig_')) {
        const segments = base.slice(4).split('_')
        for (let i = 1; i < segments.length; i += 1) {
          const suffix = segments.slice(i).join('_')
          if (suffix && !index.has(suffix)) index.set(suffix, node)
        }
      }
    }
    const visit = (node: THREE.Object3D) => {
      register(node)
      for (const child of node.children) visit(child)
    }
    const bound = boundId ? this.nodes.get(boundId) : null
    if (bound) visit(bound)
    visit(this.content)
    return index
  }

  private resolveAnimationTarget(
    target: string,
    index: Map<string, THREE.Object3D>,
  ): THREE.Object3D | null {
    const direct = index.get(animationKey(target.split(/[|/\\]/).pop() ?? target))
    if (direct) return direct
    const alias = BONE_ALIASES[animationKey(target)]
    if (alias) {
      const viaAlias = index.get(alias)
      if (viaAlias) return viaAlias
      for (const [name, node] of index) {
        if (name.endsWith(`_${alias}`)) return node
      }
    }
    const key = animationKey(target)
    for (const [name, node] of index) {
      if (name.endsWith(`_${key}`)) return node
    }
    return null
  }

  private buildRigPlans(): RigPlan[] {
    const plans: RigPlan[] = []
    if (!this.doc) return plans
    for (const [groupId, rig] of this.rigs) {
      if (!rig.root) continue
      const group = this.doc.objects.find((object) => object.id === groupId)
      if (!group?.character) continue
      const prefix = rigPrefix(group.name)
      const bones: RigBoneEntry[] = []
      const walk = (bone: THREE.Bone, parent: number) => {
        const index = bones.length
        bones.push({
          bone,
          parent,
          restLocal: new THREE.Matrix4().compose(bone.position, bone.quaternion, bone.scale),
          restWorld: new THREE.Matrix4(),
          restWorldInverse: new THREE.Matrix4(),
          track: null,
          reference: null,
          parts: [],
        })
        for (const child of bone.children) {
          if ((child as THREE.Bone).isBone) walk(child as THREE.Bone, index)
        }
      }
      walk(rig.root as THREE.Bone, -1)
      const identity = new THREE.Matrix4()
      for (const entry of bones) {
        const parentWorld = entry.parent >= 0 ? bones[entry.parent].restWorld : identity
        entry.restWorld.multiplyMatrices(parentWorld, entry.restLocal)
        entry.restWorldInverse.copy(entry.restWorld).invert()
      }
      const skeleton = characterSkeleton(group.character)
      for (const part of this.doc.objects) {
        if (part.parentId !== groupId || part.kind === 'group') continue
        const node = this.nodes.get(part.id)
        if (!node) continue
        const boneKey = boneForPart(skeleton, part.name)
        const target = bones.find((entry) => entry.bone.name === `${prefix}_${boneKey}`)
        if (!target) continue
        target.parts.push({ node, base: matrixOf(part) })
      }
      plans.push({ bones })
    }
    return plans
  }

  private rebuildAnimationPlan() {
    const clip = this.animationClip
    if (!clip || !this.doc) {
      this.animationPlan = null
      return
    }
    const plan: AnimationPlan = { rigs: [], direct: [] }
    plan.rigs = this.buildRigPlans()
    const boneOwner = new Map<THREE.Bone, RigBoneEntry>()
    for (const rig of plan.rigs) {
      for (const entry of rig.bones) boneOwner.set(entry.bone, entry)
    }
    const index = this.animationIndex(clip.targetId ?? null)
    let bound = 0
    for (const track of clip.tracks) {
      const node = this.resolveAnimationTarget(track.target, index)
      if (!node) continue
      const bone = node as THREE.Bone
      if (bone.isBone) {
        const owner = boneOwner.get(bone)
        if (owner) {
          if (!owner.track) {
            owner.track = track
            owner.reference = sampleTrack(track, 0)
            bound += 1
          }
          continue
        }
        if (bone.userData.importBone === true) {
          plan.direct.push({ node: bone, track, base: snapshotOf(bone) })
          bound += 1
        }
        continue
      }
      if (node.userData.objId) {
        plan.direct.push({ node, track, base: snapshotOf(node) })
        bound += 1
      }
    }
    this.animationPlan = plan
    this.callbacks.onAnimationMatch?.(bound, clip.tracks.length)
  }

  private applyAnimation(time: number) {
    const plan = this.animationPlan
    if (!plan || !this.animationClip) return
    // A gizmo drag is the user's direct input; it wins over the clip.
    if (this.transform.dragging) return
    for (const rig of plan.rigs) this.applyRigPlan(rig, time)
    for (const target of plan.direct) {
      const key = sampleTrack(target.track, time)
      if (key.position) {
        target.node.position.set(key.position[0], key.position[1], key.position[2])
      }
      if (key.rotation) {
        target.node.rotation.set(key.rotation[0], key.rotation[1], key.rotation[2], 'XYZ')
      }
      if (key.scale) target.node.scale.set(key.scale[0], key.scale[1], key.scale[2])
    }
  }

  /** Moves each body part rigidly with the bone that drives it. */
  private applyRigPlan(rig: RigPlan, time: number) {
    if (!rig.bones.some((entry) => entry.track)) return
    const { deltas } = poseBones(rig.bones, time)
    for (let index = 0; index < rig.bones.length; index += 1) {
      const entry = rig.bones[index]
      if (entry.parts.length === 0) continue
      for (const part of entry.parts) {
        part.node.matrix.copy(deltas[index]).multiply(part.base)
        part.node.matrix.decompose(part.node.position, part.node.quaternion, part.node.scale)
      }
    }
  }

  private disposeNode(node: THREE.Object3D) {
    if (node instanceof THREE.Mesh) {
      // Primitive geometry is shared between objects; imported geometry is not.
      if (node.userData.imported === true) node.geometry.dispose()
      const material = node.material as THREE.Material | THREE.Material[]
      const list = Array.isArray(material) ? material : [material]
      for (const entry of list) {
        const picture = entry.userData?.pictureTexture as THREE.Texture | undefined
        picture?.dispose()
        entry.dispose()
      }
    }
  }

  setSelection(selectionId: string | null, targetId: string | null) {
    if (this.paintSelection && this.paintSelection.id !== selectionId) this.clearPaintSelection()
    this.selectionId = selectionId
    this.targetId = targetId
    this.attachTransform()
  }

  setTool(tool: ToolMode) {
    this.tool = tool
    this.attachTransform()
  }

  setShading(shading: ShadingMode) {
    this.shading = shading
    if (!this.doc) return
    for (const obj of this.doc.objects) {
      if (obj.kind === 'group') continue
      const node = this.nodes.get(obj.id)
      if (node instanceof THREE.Mesh) {
        const material = node.material as THREE.MeshStandardMaterial
        material.wireframe = shading === 'wire'
      }
    }
  }

  setSnap(enabled: boolean) {
    this.transform.setTranslationSnap(enabled ? 0.1 : null)
    this.transform.setRotationSnap(enabled ? THREE.MathUtils.degToRad(15) : null)
    this.transform.setScaleSnap(enabled ? 0.1 : null)
  }

  private attachTransform() {
    this.transform.detach()
    if (this.sculptMode) return
    if (this.tool === 'select') return
    const node = this.targetId ? this.nodes.get(this.targetId) : null
    if (!node) return
    this.transform.setMode(this.tool)
    this.transform.attach(node)
  }

  getCamera(): { position: Vec3; target: Vec3 } {
    const p = this.camera.position
    const t = this.controls.target
    return { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z] }
  }

  applyCamera(camera: { position: Vec3; target: Vec3 }) {
    this.camera.up.set(0, 1, 0)
    this.camera.position.set(camera.position[0], camera.position[1], camera.position[2])
    this.controls.target.set(camera.target[0], camera.target[1], camera.target[2])
    this.controls.update()
  }

  setView(view: ViewName) {
    const target = this.controls.target
    const distance = Math.max(3.2, this.camera.position.distanceTo(target))
    this.camera.up.set(0, 1, 0)
    switch (view) {
      case 'front':
        this.camera.position.set(target.x, target.y + 0.2, target.z + distance)
        break
      case 'back':
        this.camera.position.set(target.x, target.y + 0.2, target.z - distance)
        break
      case 'left':
        this.camera.position.set(target.x - distance, target.y + 0.2, target.z)
        break
      case 'right':
        this.camera.position.set(target.x + distance, target.y + 0.2, target.z)
        break
      case 'top':
        this.camera.up.set(0, 0, -1)
        this.camera.position.set(target.x, target.y + distance, target.z)
        break
      case 'user':
      default:
        this.camera.position.set(
          target.x + distance * 0.58,
          target.y + distance * 0.42,
          target.z + distance * 0.7,
        )
        break
    }
    this.controls.update()
  }

  frameSelection(id: string | null) {
    const node = id ? this.nodes.get(id) : null
    if (!node) return
    this.frameObject(node)
  }

  frameAll() {
    if (this.content.children.length === 0) return
    this.frameObject(this.content)
  }

  private frameObject(node: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(node)
    if (box.isEmpty()) return
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const distance = Math.max(1.4, sphere.radius * 3.1)
    const dir = this.camera.position.clone().sub(this.controls.target)
    if (dir.lengthSq() < 1e-6) dir.set(0.7, 0.5, 1)
    dir.normalize()
    this.controls.target.copy(sphere.center)
    this.camera.position.copy(sphere.center).add(dir.multiplyScalar(distance))
    this.controls.update()
  }

  private syncRig(obj: SceneObject, node: THREE.Object3D) {
    const existing = this.rigs.get(obj.id)
    if (!obj.character) {
      if (existing) this.removeRig(obj.id)
      return
    }
    const prefix = rigPrefix(node.name)
    const key = `${prefix}|${JSON.stringify(obj.character)}`
    if (existing && existing.key === key) return
    if (existing) this.removeRig(obj.id)

    const { root } = createBoneRig(obj.character, prefix)
    node.add(root)
    const helper = new THREE.SkeletonHelper(root)
    helper.visible = this.bonesVisible
    const line = helper.material as THREE.LineBasicMaterial
    line.depthTest = false
    line.transparent = true
    line.opacity = 0.9
    this.scene.add(helper)
    this.rigs.set(obj.id, { key, root, helper })
  }

  private removeRig(id: string) {
    const rig = this.rigs.get(id)
    if (!rig) return
    rig.helper.removeFromParent()
    rig.helper.geometry.dispose()
    ;(rig.helper.material as THREE.Material).dispose()
    rig.root?.removeFromParent()
    this.rigs.delete(id)
  }

  setBonesVisible(visible: boolean) {
    this.bonesVisible = visible
    for (const rig of this.rigs.values()) rig.helper.visible = visible
  }

  async exportGLB(): Promise<Blob> {
    if (!this.doc || this.doc.objects.length === 0) throw new Error('Scene is empty')
    // The exporter draws the images while writing the file, so they have to be decoded.
    const pictureUrls = this.doc.objects.flatMap((object) =>
      Object.values(object.character?.images ?? {}).map((image) => image.url),
    )
    await Promise.all([
      preloadAssetTextures(this.doc.objects.map((object) => object.mesh)),
      preloadPictures(pictureUrls),
    ])
    const { scene, animations } = buildExportScene(this.doc, (asset, material) => {
      if (!asset.hasUv) return undefined
      const texture = material?.baseColor
        ? textureFor(material.baseColor, material.baseColorFlipY !== false)
        : textureForAsset(asset)
      return texture?.image ? texture : undefined
    })
    const exporter = new GLTFExporter()
    const data = await exporter.parseAsync(scene, { binary: true, animations })
    if (!(data instanceof ArrayBuffer)) throw new Error('GLB export failed')
    return new Blob([data], { type: 'model/gltf-binary' })
  }

  viewLabel(view: ViewName): string {
    return VIEW_LABELS[view]
  }

  // ---------------------------------------------------------------- painting

  setPaintMode(enabled: boolean) {
    if (this.paintMode === enabled) return
    this.paintMode = enabled
    if (enabled) {
      this.transform.detach()
      this.controls.mouseButtons.LEFT = undefined as unknown as THREE.MOUSE
      this.controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE
      this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN
      this.controls.touches.ONE = undefined as unknown as THREE.TOUCH
      this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN
      this.renderer.domElement.style.cursor = 'crosshair'
      this.paintCursorColor()
    } else {
      this.endPaintStroke()
      this.clearPaintSelection()
      this.sculptCursor.visible = false
      if (!this.sculptMode) {
        this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE
        this.controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY
        this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN
        this.controls.touches.ONE = THREE.TOUCH.ROTATE
        this.renderer.domElement.style.cursor = ''
      }
    }
  }

  setPaintBrush(brush: Partial<PaintBrushState>) {
    this.paintBrush = { ...this.paintBrush, ...brush }
    this.paintCursorColor()
  }

  private paintCursorColor() {
    ;(this.sculptCursor.material as THREE.MeshBasicMaterial).color.set(this.paintBrush.color)
  }

  clearPaintSelection() {
    this.removePaintHighlight()
    this.paintSelection = null
  }

  /** Every connected surface of the part being painted, for the Paint panel. */
  paintPartList(targetId?: string | null): PaintPartInfo[] {
    const mesh = this.paintTargetMesh(targetId)
    if (!mesh) return []
    const parts = this.surfacePartsFor(mesh)
    if (!parts) return []
    return parts.parts.map((part, index) => ({ index, triangles: part.triangles }))
  }

  /** Selects a surface from that list, including ones hidden behind the model. */
  selectPaintPart(index: number, targetId?: string | null): boolean {
    const mesh = this.paintTargetMesh(targetId)
    if (!mesh) return false
    const id = mesh.userData.objId as string | undefined
    const parts = this.surfacePartsFor(mesh)
    if (!id || !parts || parts.parts.length === 0) return false
    const part = Math.min(parts.parts.length - 1, Math.max(0, Math.floor(index)))
    this.paintSelection = { id, part, parts: parts.parts.length }
    this.showPaintHighlight(mesh, parts, part)
    this.callbacks.onPaintPart?.(id, part, parts.parts.length, parts.parts[part].triangles)
    return true
  }

  /** The mesh the paint tools act on, preferring an explicit target from the app. */
  private paintTargetMesh(targetId?: string | null): THREE.Mesh | null {
    const id = targetId ?? this.selectionId ?? this.paintSelection?.id
    const node = id ? this.nodes.get(id) : null
    if (!(node instanceof THREE.Mesh) || !this.isVisible(node)) return null
    const objId = node.userData.objId as string | undefined
    if (!objId || !this.doc?.objects.some((entry) => entry.id === objId)) return null
    return node.userData.sculpt === true || node.userData.imported === true ? node : null
  }

  /** Which mesh the paint tools act on: the selected part, else the whole scene. */
  private paintTargets(): THREE.Mesh[] {
    // Only a part that owns its geometry can be painted: primitives share one
    // cached geometry, while imported and sculpted parts have their own mesh.
    // Character parts become sculpted on first paint, so they qualify too.
    const paintable = (node: THREE.Object3D): boolean => {
      const id = node.userData.objId as string | undefined
      return Boolean(id && this.doc?.objects.some((entry) => entry.id === id))
    }
    const ownGeometry = (node: THREE.Object3D): node is THREE.Mesh =>
      node instanceof THREE.Mesh &&
      this.isVisible(node) &&
      (node.userData.sculpt === true || node.userData.imported === true) &&
      paintable(node)
    const selected = this.selectionId ? this.nodes.get(this.selectionId) : null
    if (selected && ownGeometry(selected)) return [selected]
    const meshes: THREE.Mesh[] = []
    for (const node of this.nodes.values()) {
      if (ownGeometry(node)) meshes.push(node)
    }
    return meshes
  }

  private paintIntersection(event: PointerEvent, only?: THREE.Mesh) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const targets = only ? [only] : this.paintTargets()
    if (targets.length === 0) return null
    return this.raycaster.intersectObjects(targets, false)[0] ?? null
  }

  private surfacePartsFor(mesh: THREE.Mesh): SurfaceParts | null {
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    const index = mesh.geometry.getIndex()
    if (!position || !index) return null
    const triangles = Math.floor(index.count / 3)
    const cached = this.surfaceCache.get(mesh.geometry)
    if (cached && cached.facePart.length === triangles) return cached
    const parts = surfaceParts(
      position.array as Float32Array,
      new Uint32Array(index.array as ArrayLike<number>),
    )
    this.surfaceCache.set(mesh.geometry, parts)
    return parts
  }

  private pickPaintPart(event: PointerEvent): boolean {
    const hit = this.paintIntersection(event)
    if (!hit || !(hit.object instanceof THREE.Mesh) || !hit.face) return false
    const id = hit.object.userData.objId as string | undefined
    if (!id) return false
    const parts = this.surfacePartsFor(hit.object)
    if (!parts || parts.parts.length === 0) return false
    const face = Math.min(parts.facePart.length - 1, Math.max(0, hit.faceIndex ?? 0))
    const part = parts.facePart[face]
    this.paintSelection = { id, part, parts: parts.parts.length }
    this.showPaintHighlight(hit.object, parts, part)
    this.callbacks.onPaintPart?.(id, part, parts.parts.length, parts.parts[part].triangles)
    return true
  }

  /** A translucent copy of the selected surface, drawn over the model. */
  private showPaintHighlight(mesh: THREE.Mesh, parts: SurfaceParts, part: number) {
    this.removePaintHighlight()
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    const index = mesh.geometry.getIndex()
    if (!position || !index) return
    const points: number[] = []
    for (let triangle = 0; triangle < parts.facePart.length; triangle += 1) {
      if (parts.facePart[triangle] !== part) continue
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = index.getX(triangle * 3 + corner)
        points.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex))
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    const material = new THREE.MeshBasicMaterial({
      color: 0xf2a84b,
      transparent: true,
      // Light enough that the fill colour still reads through the selection.
      opacity: 0.2,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    const overlay = new THREE.Mesh(geometry, material)
    overlay.renderOrder = 998
    overlay.raycast = () => {}
    mesh.add(overlay)
    this.paintHighlight = overlay
  }

  private removePaintHighlight() {
    const overlay = this.paintHighlight
    if (!overlay) return
    overlay.removeFromParent()
    overlay.geometry.dispose()
    ;(overlay.material as THREE.Material).dispose()
    this.paintHighlight = null
  }

  /** Current colours for a mesh, seeded line for line from what it displays. */
  private ensurePaintColors(mesh: THREE.Mesh, obj: SceneObject): Uint8Array | null {
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!position) return null
    const count = position.count
    const attribute = mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined
    if (attribute && attribute.count === count) {
      if (attribute.array instanceof Uint8Array && obj.paint) return new Uint8Array(attribute.array)
      // The file's own colours are a COLOR_0 attribute that the material still
      // multiplies by its base-colour factor; paint is the final colour, so it
      // has to include that factor or the part changes shade when painting.
      const factor = obj.paint ? [255, 255, 255] : hexColorBytes(obj.color)
      const colors = new Uint8Array(count * 3)
      for (let i = 0; i < count; i += 1) {
        colors[i * 3] = Math.min(255, Math.round(attribute.getX(i) * factor[0]))
        colors[i * 3 + 1] = Math.min(255, Math.round(attribute.getY(i) * factor[1]))
        colors[i * 3 + 2] = Math.min(255, Math.round(attribute.getZ(i) * factor[2]))
      }
      this.paintMaterialLook(mesh)
      return colors
    }
    const colors = solidColors(count, hexColorBytes(obj.color))
    mesh.geometry.setAttribute('color', new THREE.Uint8BufferAttribute(colors, 3, true))
    mesh.geometry.userData.paint = true
    this.paintMaterialLook(mesh)
    return colors
  }

  /** Paint is the final colour: every material shows it, textures step aside. */
  private paintMaterialLook(mesh: THREE.Mesh) {
    const material = mesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[]
    for (const entry of Array.isArray(material) ? material : [material]) {
      entry.vertexColors = true
      entry.color.set('#ffffff')
      entry.map = null
      entry.needsUpdate = true
    }
  }

  private beginPaintStroke(event: PointerEvent) {
    if (this.transform.dragging) return
    const hit = this.paintIntersection(event)
    if (!hit || !(hit.object instanceof THREE.Mesh) || !hit.face) return
    const mesh = hit.object
    const id = mesh.userData.objId as string | undefined
    const obj = id ? this.doc?.objects.find((entry) => entry.id === id) : undefined
    if (!id || !obj) return
    const colors = this.ensurePaintColors(mesh, obj)
    if (!colors) return
    if (this.paintSelection?.id !== id) this.clearPaintSelection()
    this.paintStroke = {
      id,
      mesh,
      colors,
      last: mesh.worldToLocal(hit.point.clone()),
      changed: false,
    }
    this.controls.enabled = false
    window.addEventListener('pointermove', this.paintMove)
    window.addEventListener('pointerup', this.paintUp)
    this.applyPaintDab(this.paintStroke.last)
  }

  private paintMove = (event: PointerEvent) => this.movePaintStroke(event)

  private paintUp = () => this.endPaintStroke()

  private paintPointFor(event: PointerEvent): THREE.Vector3 | null {
    const stroke = this.paintStroke
    if (!stroke) return null
    const hit = this.paintIntersection(event, stroke.mesh)
    if (hit && hit.face) return stroke.mesh.worldToLocal(hit.point.clone())
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      this.camera.getWorldDirection(new THREE.Vector3()).negate(),
      stroke.last.clone().applyMatrix4(stroke.mesh.matrixWorld),
    )
    const point = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3())
    return point ? stroke.mesh.worldToLocal(point.clone()) : null
  }

  private applyPaintDab(point: THREE.Vector3) {
    const stroke = this.paintStroke
    if (!stroke) return
    const position = stroke.mesh.geometry.getAttribute('position') as
      | THREE.BufferAttribute
      | undefined
    if (!position) return
    const worldScale = stroke.mesh.getWorldScale(new THREE.Vector3())
    const uniform =
      (Math.abs(worldScale.x) + Math.abs(worldScale.y) + Math.abs(worldScale.z)) / 3 || 1
    const painted = paintDab(
      stroke.colors,
      position.array as Float32Array,
      [point.x, point.y, point.z],
      Math.max(1e-4, this.paintBrush.radius / uniform),
      hexColorBytes(this.paintBrush.color),
      this.paintBrush.strength,
    )
    stroke.last.copy(point)
    if (painted === 0) return
    const attribute = stroke.mesh.geometry.getAttribute('color') as
      | THREE.BufferAttribute
      | undefined
    if (!attribute || !(attribute.array instanceof Uint8Array)) return
    ;(attribute.array as Uint8Array).set(stroke.colors)
    attribute.needsUpdate = true
    stroke.changed = true
  }

  private movePaintStroke(event: PointerEvent) {
    if (!this.paintStroke) return
    const point = this.paintPointFor(event)
    if (!point) return
    this.applyPaintDab(point)
  }

  private endPaintStroke() {
    const stroke = this.paintStroke
    if (!stroke) return
    this.paintStroke = null
    this.controls.enabled = true
    window.removeEventListener('pointermove', this.paintMove)
    window.removeEventListener('pointerup', this.paintUp)
    if (!stroke.changed) {
      // A click with the brush that painted nothing must not leave the part
      // switched to vertex colours (and without its texture).
      const obj = this.doc?.objects.find((entry) => entry.id === stroke.id)
      if (obj) this.applyObject(obj, stroke.mesh)
      return
    }
    this.callbacks.onPaintCommit?.(stroke.id, new Uint8Array(stroke.colors))
  }

  /** Fills the selected surface part; returns the triangles it changed. */
  fillPaint(color: string): number {
    const selection = this.paintSelection
    const id = selection?.id ?? this.selectionId
    const mesh = id ? this.nodes.get(id) : null
    const obj = id ? this.doc?.objects.find((entry) => entry.id === id) : undefined
    if (!(mesh instanceof THREE.Mesh) || !obj || !selection || selection.id !== id) return 0
    const parts = this.surfacePartsFor(mesh)
    const index = mesh.geometry.getIndex()
    const colors = this.ensurePaintColors(mesh, obj)
    if (!parts || !index || !colors) return 0
    const filled = fillSurfacePart(
      new Uint32Array(index.array as ArrayLike<number>),
      parts,
      selection.part,
      colors,
      hexColorBytes(color),
    )
    if (filled === 0) return 0
    const attribute = mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined
    if (attribute && attribute.array instanceof Uint8Array) {
      ;(attribute.array as Uint8Array).set(colors)
      attribute.needsUpdate = true
    }
    this.callbacks.onPaintCommit?.(id, new Uint8Array(colors))
    return filled
  }

  private updatePaintCursor(event: PointerEvent) {
    const hit = this.paintIntersection(event)
    if (!hit || !hit.face) {
      this.sculptCursor.visible = false
      return
    }
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)
    const worldNormal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize()
    this.sculptCursor.visible = true
    this.sculptCursor.position.copy(hit.point).addScaledVector(worldNormal, 0.004)
    this.sculptCursor.quaternion.setFromUnitVectors(CURSOR_FACING, worldNormal)
    const radius = this.paintBrush.radius
    this.sculptCursor.scale.set(radius, radius, radius)
  }

  /** Swaps a part's materials between its packed colours and painted colours. */
  private applyPaintColors(node: THREE.Mesh, obj: SceneObject) {
    const geometry = node.geometry
    const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!position) return
    const current = node.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[]
    const list = Array.isArray(current) ? current : [current]
    const paint = obj.paint ? decodePaintColors(obj.paint, position.count) : null
    if (paint) {
      const existing = geometry.getAttribute('color') as THREE.BufferAttribute | undefined
      if (!existing || existing.count !== position.count || !(existing.array instanceof Uint8Array)) {
        geometry.setAttribute('color', new THREE.Uint8BufferAttribute(paint, 3, true))
      } else {
        ;(existing.array as Uint8Array).set(paint)
        existing.needsUpdate = true
      }
      geometry.userData.paint = true
      this.paintMaterialLook(node)
      return
    }
    if (geometry.userData.paint !== true) return
    // Paint was cleared: put the file's own colours back.
    geometry.userData.paint = false
    const asset = obj.sculpt ?? obj.mesh
    const base = asset?.colors
      ? decodePaintColors({ colors: asset.colors, vertices: asset.vertices }, position.count)
      : null
    const existing = geometry.getAttribute('color') as THREE.BufferAttribute | undefined
    if (base) {
      if (!existing || existing.count !== position.count || !(existing.array instanceof Uint8Array)) {
        geometry.setAttribute('color', new THREE.Uint8BufferAttribute(base, 3, true))
      } else {
        ;(existing.array as Uint8Array).set(base)
        existing.needsUpdate = true
      }
    } else if (existing) {
      geometry.deleteAttribute('color')
    }
    if (Array.isArray(current)) {
      // Multi-material meshes get their own material per draw group back.
      node.material = this.importedMaterials(obj)
      for (const entry of list) entry.dispose()
      const rebuilt = node.material as
        | THREE.MeshStandardMaterial
        | THREE.MeshStandardMaterial[]
      for (const entry of Array.isArray(rebuilt) ? rebuilt : [rebuilt]) {
        entry.wireframe = this.shading === 'wire'
      }
      return
    }
    const material = current
    material.vertexColors = Boolean(base)
    material.userData.pictureUrl = undefined
    material.needsUpdate = true
  }

  dispose() {
    this.disposed = true
    this.renderer.setAnimationLoop(null)
    this.resizeObserver.disconnect()
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown)
    this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove)
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp)
    this.renderer.domElement.removeEventListener('pointercancel', this.handlePointerCancel)
    window.removeEventListener('pointermove', this.strokeMove)
    window.removeEventListener('pointerup', this.strokeUp)
    window.removeEventListener('pointermove', this.paintMove)
    window.removeEventListener('pointerup', this.paintUp)
    this.removePaintHighlight()
    this.sculptCursor.geometry.dispose()
    ;(this.sculptCursor.material as THREE.Material).dispose()
    this.transform.dispose()
    this.controls.dispose()
    for (const [id, node] of this.nodes) {
      if (this.nodeKinds.get(id) !== 'group') this.disposeNode(node)
    }
    for (const id of Array.from(this.rigs.keys())) this.removeRig(id)
    this.environment.dispose()
    this.outline.geometry.dispose()
    ;(this.outline.material as THREE.Material).dispose()
    this.renderer.dispose()
    disposeTextures()
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
  }
}
