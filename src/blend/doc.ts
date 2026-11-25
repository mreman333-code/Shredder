import { MAX_TEXTURE_DATA_URL, type MeshAsset, type MeshBone } from './mesh'
import { MAX_SCULPT_VERTICES } from './sculpt'
import {
  MAX_ANIMATION_CLIPS,
  normalizeAnimationClip,
  type AnimationClipData,
} from './animation'

export type PrimitiveKind =
  | 'box'
  | 'sphere'
  | 'cylinder'
  | 'capsule'
  | 'cone'
  | 'torus'
  | 'plane'
  | 'group'
  /** Geometry imported from a model file (FBX, OBJ, glTF, STL, …). */
  | 'mesh'

export type Vec3 = [number, number, number]

export interface CharacterColors {
  suit: string
  accent: string
  skin: string
  boots: string
  visor: string
}

/** Size multipliers for one generated body part. [1, 1, 1] is the preset shape. */
export interface PartAdjustment {
  scale: Vec3
}

/** A picture mapped onto one generated body part, packed into the project. */
export interface PartImage {
  /** `data:image/...;base64,...` copy of the picture. */
  url: string
  /** Picture scale on the part: 1 fits it once, larger zooms in. */
  size: number
  /** Material opacity, 0–1. */
  opacity: number
}

export interface CharacterSpec {
  preset: string
  height: number
  build: number
  headSize: number
  legLength: number
  colors: CharacterColors
  /** Per-part size multipliers, keyed by the stable part name ("Hand L"). */
  adjustments?: Record<string, PartAdjustment>
  /** Pictures mapped onto body parts, keyed by the stable part name ("Face"). */
  images?: Record<string, PartImage>
}

export interface SceneObject {
  id: string
  name: string
  kind: PrimitiveKind
  parentId: string | null
  position: Vec3
  rotation: Vec3
  scale: Vec3
  color: string
  roughness: number
  metalness: number
  visible: boolean
  character?: CharacterSpec
  /** Packed geometry, only on objects with kind 'mesh'. */
  mesh?: MeshAsset
  /**
   * Sculpted geometry for a primitive part. When present it replaces the
   * primitive's shared shape, and the object keeps its normal transform, rig
   * binding and material.
   */
  sculpt?: MeshAsset
}

export interface ProjectDoc {
  format: 'shredder'
  version: 1
  name: string
  objects: SceneObject[]
  camera: { position: Vec3; target: Vec3 }
  createdAt: number
  updatedAt: number
  /** Keyed animation clips, authored here or imported from Unity / Blender. */
  animations?: AnimationClipData[]
}

let counter = 0

export function uid(prefix = 'id'): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`
}

export const CHARACTER_PRESETS: Record<string, CharacterSpec> = {
  Hero: {
    preset: 'Hero',
    height: 1.8,
    build: 1.05,
    headSize: 1,
    legLength: 1,
    colors: {
      suit: '#3b6ea5',
      accent: '#f0a63c',
      skin: '#d9a06b',
      boots: '#2c3440',
      visor: '#9fe8ff',
    },
  },
  Runner: {
    preset: 'Runner',
    height: 1.72,
    build: 0.88,
    headSize: 0.96,
    legLength: 1.08,
    colors: {
      suit: '#2f8f7a',
      accent: '#e8f05c',
      skin: '#c98f63',
      boots: '#20303a',
      visor: '#c7ffef',
    },
  },
  Vanguard: {
    preset: 'Vanguard',
    height: 1.9,
    build: 1.32,
    headSize: 0.94,
    legLength: 0.94,
    colors: {
      suit: '#7a3b3b',
      accent: '#d9b25c',
      skin: '#b98255',
      boots: '#2a2226',
      visor: '#ffd8a8',
    },
  },
  Scout: {
    preset: 'Scout',
    height: 1.62,
    build: 0.92,
    headSize: 1.08,
    legLength: 1.02,
    colors: {
      suit: '#5a4b8a',
      accent: '#69d2e7',
      skin: '#e0b48c',
      boots: '#241f33',
      visor: '#b2f2ff',
    },
  },
  Automaton: {
    preset: 'Automaton',
    height: 1.85,
    build: 1.12,
    headSize: 0.98,
    legLength: 1,
    colors: {
      suit: '#8a9099',
      accent: '#ff7a45',
      skin: '#adb4bd',
      boots: '#3b4048',
      visor: '#ffb27a',
    },
  },
}

export function cloneSpec(spec: CharacterSpec): CharacterSpec {
  const adjustments: Record<string, PartAdjustment> = {}
  for (const [name, adjustment] of Object.entries(spec.adjustments ?? {})) {
    if (!adjustment) continue
    adjustments[name] = { scale: [...adjustment.scale] }
  }
  const images: Record<string, PartImage> = {}
  for (const [name, image] of Object.entries(spec.images ?? {})) {
    if (!image) continue
    images[name] = { ...image }
  }
  return {
    ...spec,
    colors: { ...spec.colors },
    ...(Object.keys(adjustments).length > 0 ? { adjustments } : {}),
    ...(Object.keys(images).length > 0 ? { images } : {}),
  }
}

/** The opposite limb for a mirrored part name, or null for centre parts. */
export function mirrorPartName(name: string): string | null {
  if (name.endsWith(' L')) return `${name.slice(0, -2)} R`
  if (name.endsWith(' R')) return `${name.slice(0, -2)} L`
  return null
}

export function presetSpec(name: string): CharacterSpec {
  return cloneSpec(CHARACTER_PRESETS[name] ?? CHARACTER_PRESETS.Hero)
}

interface ObjectInit {
  kind: PrimitiveKind
  name: string
  position?: Vec3
  rotation?: Vec3
  scale?: Vec3
  color?: string
  roughness?: number
  metalness?: number
  parentId?: string | null
}

export function baseObject(init: ObjectInit): SceneObject {
  return {
    id: uid('obj'),
    name: init.name,
    kind: init.kind,
    parentId: init.parentId ?? null,
    position: init.position ?? [0, 0, 0],
    rotation: init.rotation ?? [0, 0, 0],
    scale: init.scale ?? [1, 1, 1],
    color: init.color ?? '#8f9aa8',
    roughness: init.roughness ?? 0.6,
    metalness: init.metalness ?? 0.05,
    visible: true,
  }
}

export const PRIMITIVES: { kind: PrimitiveKind; label: string; scale: Vec3; color: string }[] = [
  { kind: 'box', label: 'Cube', scale: [1, 1, 1], color: '#8fa3b8' },
  { kind: 'sphere', label: 'UV Sphere', scale: [1, 1, 1], color: '#b89a8f' },
  { kind: 'cylinder', label: 'Cylinder', scale: [0.7, 1, 0.7], color: '#8fb89a' },
  { kind: 'capsule', label: 'Capsule', scale: [0.5, 0.5, 0.5], color: '#b8b18f' },
  { kind: 'cone', label: 'Cone', scale: [0.85, 1, 0.85], color: '#9a8fb8' },
  { kind: 'torus', label: 'Torus', scale: [1, 1, 1], color: '#8fa9b8' },
  { kind: 'plane', label: 'Plane', scale: [2, 1, 2], color: '#6f7b88' },
]

export function uniqueName(objects: SceneObject[], base: string): string {
  const names = new Set(objects.map((o) => o.name))
  if (!names.has(base)) return base
  let i = 1
  while (names.has(`${base}.${String(i).padStart(3, '0')}`)) i += 1
  return `${base}.${String(i).padStart(3, '0')}`
}

const BASE_SIZES: Record<PrimitiveKind, Vec3> = {
  group: [0, 0, 0],
  box: [1, 1, 1],
  sphere: [1, 1, 1],
  cylinder: [1, 1, 1],
  capsule: [1, 2, 1],
  cone: [1, 1, 1],
  torus: [1.12, 0.28, 1.12],
  plane: [1, 1, 1],
  // Imported meshes carry their own bounds; they only contribute their pivot.
  mesh: [0, 0, 0],
}

export interface Bounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/**
 * Approximate world-space bounds of the scene meshes on the ground plane.
 * Rotations are ignored so this stays cheap: it is used for placement only.
 */
export function objectBounds(objects: SceneObject[]): Bounds {
  const byId = new Map(objects.map((o) => [o.id, o]))
  const bounds: Bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  for (const obj of objects) {
    if (obj.kind === 'group') continue
    let x = obj.position[0]
    let z = obj.position[2]
    let sx = obj.scale[0]
    let sz = obj.scale[2]
    let parent = obj.parentId ? byId.get(obj.parentId) : undefined
    let guard = 0
    while (parent && guard < 16) {
      x = parent.position[0] + x * parent.scale[0]
      z = parent.position[2] + z * parent.scale[2]
      sx *= parent.scale[0]
      sz *= parent.scale[2]
      parent = parent.parentId ? byId.get(parent.parentId) : undefined
      guard += 1
    }
    const base = BASE_SIZES[obj.kind]
    const halfX = (base[0] * sx) / 2
    const halfZ = (base[2] * sz) / 2
    bounds.minX = Math.min(bounds.minX, x - halfX)
    bounds.maxX = Math.max(bounds.maxX, x + halfX)
    bounds.minZ = Math.min(bounds.minZ, z - halfZ)
    bounds.maxZ = Math.max(bounds.maxZ, z + halfZ)
  }
  return bounds
}

export function nextSpot(doc: ProjectDoc): Vec3 {
  if (doc.objects.length === 0) return [0, 0, 0]
  const { maxX } = objectBounds(doc.objects)
  if (!Number.isFinite(maxX)) return [0, 0, 0]
  return [maxX + 1.4, 0, 0]
}

function restHeight(kind: PrimitiveKind, scale: Vec3): number {
  if (kind === 'plane') return 0
  if (kind === 'capsule') return scale[1]
  if (kind === 'torus') return 0.15 * scale[1]
  return scale[1] / 2
}

export function newProject(name: string): ProjectDoc {
  const now = Date.now()
  const cube = baseObject({
    kind: 'box',
    name: 'Cube',
    position: [0, 0.5, 0],
    scale: [1, 1, 1],
    color: '#8fa3b8',
  })
  return {
    format: 'shredder',
    version: 1,
    name,
    objects: [cube],
    camera: { position: [3.4, 2.6, 4.4], target: [0, 0.9, 0] },
    createdAt: now,
    updatedAt: now,
  }
}

export function addPrimitive(
  doc: ProjectDoc,
  kind: PrimitiveKind,
): { doc: ProjectDoc; object: SceneObject } {
  const def = PRIMITIVES.find((p) => p.kind === kind) ?? PRIMITIVES[0]
  const scale: Vec3 = [...def.scale]
  const spot = nextSpot(doc)
  const object = baseObject({
    kind,
    name: uniqueName(doc.objects, def.label),
    position: [spot[0], restHeight(kind, scale), spot[2]],
    scale,
    color: def.color,
  })
  return { doc: { ...doc, objects: [...doc.objects, object] }, object }
}

function characterPart(
  name: string,
  kind: PrimitiveKind,
  position: Vec3,
  scale: Vec3,
  color: string,
  parentId: string,
  opts: { roughness?: number; metalness?: number } = {},
): SceneObject {
  return baseObject({
    kind,
    name,
    parentId,
    position,
    scale,
    color,
    roughness: opts.roughness ?? 0.62,
    metalness: opts.metalness ?? 0.08,
  })
}

/**
 * Builds a stylized humanoid out of primitives. All proportions derive from
 * the spec so the rig can be regenerated live from the character panel.
 */
export function characterParts(spec: CharacterSpec, groupId: string): SceneObject[] {
  const s = spec.height / 1.8
  const b = spec.build
  const h = spec.headSize
  const leg = spec.legLength
  const hipBase = 0.81
  const upperShift = hipBase * (leg - 1)

  const legY = (v: number) => v * leg * s
  const upY = (v: number) => (v + upperShift) * s
  const X = (v: number) => v * b * s
  const Y = (v: number) => v * s
  const Z = (v: number) => v * b * s
  const c = spec.colors

  const parts: SceneObject[] = []
  const add = (
    name: string,
    kind: PrimitiveKind,
    position: Vec3,
    scale: Vec3,
    color: string,
    opts?: { roughness?: number; metalness?: number },
  ) => {
    const part = characterPart(name, kind, position, scale, color, groupId, opts)
    const adjustment = spec.adjustments?.[name]
    if (adjustment) {
      const [sx, sy, sz] = adjustment.scale
      part.scale = [part.scale[0] * sx, part.scale[1] * sy, part.scale[2] * sz]
    }
    parts.push(part)
  }

  for (const side of [-1, 1] as const) {
    const suffix = side < 0 ? 'L' : 'R'
    add(
      `Foot ${suffix}`,
      'box',
      [X(0.12) * side, Y(0.05), Z(0.06)],
      [X(0.16), Y(0.1), Z(0.3)],
      c.boots,
      { roughness: 0.78, metalness: 0.02 },
    )
    add(
      `Shin ${suffix}`,
      'capsule',
      [X(0.12) * side, legY(0.31), 0],
      [X(0.115), Y(0.155) * leg, Z(0.115)],
      c.boots,
      { roughness: 0.7 },
    )
    add(
      `Thigh ${suffix}`,
      'capsule',
      [X(0.12) * side, legY(0.62), 0],
      [X(0.15), Y(0.19) * leg, Z(0.15)],
      c.suit,
    )
    add(
      `Shoulder ${suffix}`,
      'sphere',
      [X(0.31) * side, upY(1.44), 0],
      [X(0.17), Y(0.16), Z(0.17)],
      c.accent,
      { roughness: 0.5, metalness: 0.18 },
    )
    add(
      `Upper Arm ${suffix}`,
      'capsule',
      [X(0.34) * side, upY(1.29), 0],
      [X(0.1), Y(0.145), Z(0.1)],
      c.suit,
    )
    add(
      `Forearm ${suffix}`,
      'capsule',
      [X(0.34) * side, upY(1.0), 0],
      [X(0.088), Y(0.13), Z(0.088)],
      c.suit,
    )
    add(
      `Hand ${suffix}`,
      'sphere',
      [X(0.34) * side, upY(0.83), 0],
      [X(0.095), Y(0.11), Z(0.095)],
      c.skin,
      { roughness: 0.6, metalness: 0 },
    )
  }

  add(
    'Pelvis',
    'box',
    [0, upY(0.9), 0],
    [X(0.36), Y(0.2), Z(0.24)],
    c.suit,
  )
  add(
    'Belt',
    'box',
    [0, upY(0.985), 0],
    [X(0.38), Y(0.07), Z(0.26)],
    c.accent,
    { roughness: 0.45, metalness: 0.3 },
  )
  add(
    'Torso',
    'capsule',
    [0, upY(1.19), 0],
    [X(0.42), Y(0.315), Z(0.26)],
    c.suit,
  )
  add(
    'Chest Plate',
    'box',
    [0, upY(1.27), Z(0.115)],
    [X(0.28), Y(0.24), Z(0.06)],
    c.accent,
    { roughness: 0.45, metalness: 0.25 },
  )
  add(
    'Neck',
    'cylinder',
    [0, upY(1.52), 0],
    [X(0.1), Y(0.09), Z(0.1)],
    c.skin,
    { roughness: 0.6, metalness: 0 },
  )
  add(
    'Head',
    'sphere',
    [0, upY(1.67), 0],
    [X(0.26) * h, Y(0.29) * h, Z(0.27) * h],
    c.skin,
    { roughness: 0.55, metalness: 0 },
  )
  // The face is its own surface so a picture can be mapped onto it, exactly
  // like any other body part.
  add(
    'Face',
    'sphere',
    [0, upY(1.655), Z(0.085) * h],
    [X(0.205) * h, Y(0.235) * h, Z(0.15) * h],
    c.skin,
    { roughness: 0.58, metalness: 0 },
  )
  add(
    'Helmet',
    'sphere',
    [0, upY(1.745), 0],
    [X(0.268) * h, Y(0.17) * h, Z(0.278) * h],
    c.accent,
    { roughness: 0.4, metalness: 0.35 },
  )
  add(
    'Visor',
    'box',
    [0, upY(1.79), Z(0.095) * h],
    [X(0.2) * h, Y(0.045) * h, Z(0.06) * h],
    c.visor,
    { roughness: 0.15, metalness: 0.7 },
  )

  return parts
}

export function createCharacter(
  doc: ProjectDoc,
  spec: CharacterSpec,
  name: string,
  position: Vec3 = [0, 0, 0],
): { group: SceneObject; parts: SceneObject[] } {
  const group = baseObject({
    kind: 'group',
    name: uniqueName(doc.objects, name),
    position,
    color: '#ffffff',
  })
  group.character = cloneSpec(spec)
  const parts = characterParts(spec, group.id)
  return { group, parts }
}

export function regenerateCharacter(
  objects: SceneObject[],
  groupId: string,
  spec: CharacterSpec,
): SceneObject[] {
  const group = objects.find((o) => o.id === groupId)
  if (!group) return objects
  const parts = characterParts(spec, groupId)
  const others = objects.filter((o) => o.parentId !== groupId)
  return others.map((o) =>
    o.id === groupId ? { ...o, character: cloneSpec(spec) } : o,
  ).concat(parts)
}

export function descendantIds(objects: SceneObject[], rootId: string): string[] {
  const ids = [rootId]
  let added = true
  while (added) {
    added = false
    for (const o of objects) {
      if (o.parentId && ids.includes(o.parentId) && !ids.includes(o.id)) {
        ids.push(o.id)
        added = true
      }
    }
  }
  return ids
}

const isVec3 = (v: unknown): v is Vec3 =>
  Array.isArray(v) &&
  v.length >= 3 &&
  v.slice(0, 3).every((n) => typeof n === 'number' && Number.isFinite(n))

const readVec = (v: unknown, fallback: Vec3): Vec3 => (isVec3(v) ? [v[0], v[1], v[2]] : fallback)

const readNumber = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

const readString = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.length > 0 ? v : fallback

function normalizeSpec(raw: unknown): CharacterSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const colorsRaw = (r.colors ?? {}) as Record<string, unknown>
  const adjustments: Record<string, PartAdjustment> = {}
  const adjustmentsRaw = r.adjustments
  if (adjustmentsRaw && typeof adjustmentsRaw === 'object') {
    for (const [name, value] of Object.entries(adjustmentsRaw).slice(0, 64)) {
      if (!name || name.length > 40 || !value || typeof value !== 'object') continue
      const scaleRaw = (value as Record<string, unknown>).scale
      if (!isVec3(scaleRaw)) continue
      const scale: Vec3 = [
        Math.min(3, Math.max(0.25, scaleRaw[0])),
        Math.min(3, Math.max(0.25, scaleRaw[1])),
        Math.min(3, Math.max(0.25, scaleRaw[2])),
      ]
      // Identity entries carry no information; drop them from saved projects.
      if (scale.every((entry) => Math.abs(entry - 1) < 0.001)) continue
      adjustments[name] = { scale }
    }
  }
  const images: Record<string, PartImage> = {}
  const imagesRaw = r.images
  if (imagesRaw && typeof imagesRaw === 'object') {
    for (const [name, value] of Object.entries(imagesRaw).slice(0, 64)) {
      if (!name || name.length > 40 || !value || typeof value !== 'object') continue
      const entry = value as Record<string, unknown>
      const url = typeof entry.url === 'string' ? entry.url : ''
      // Only an embedded picture is accepted: a project never points at a file.
      if (!url.startsWith('data:image/') || url.length > MAX_TEXTURE_DATA_URL) continue
      images[name] = {
        url,
        size: Math.min(3, Math.max(0.25, readNumber(entry.size, 1))),
        opacity: Math.min(1, Math.max(0.05, readNumber(entry.opacity, 1))),
      }
    }
  }
  return {
    preset: readString(r.preset, 'Custom'),
    height: Math.min(2.6, Math.max(1.0, readNumber(r.height, 1.8))),
    build: Math.min(1.8, Math.max(0.5, readNumber(r.build, 1.05))),
    headSize: Math.min(1.6, Math.max(0.6, readNumber(r.headSize, 1))),
    legLength: Math.min(1.4, Math.max(0.7, readNumber(r.legLength, 1))),
    colors: {
      suit: readString(colorsRaw.suit, '#3b6ea5'),
      accent: readString(colorsRaw.accent, '#f0a63c'),
      skin: readString(colorsRaw.skin, '#d9a06b'),
      boots: readString(colorsRaw.boots, '#2c3440'),
      visor: readString(colorsRaw.visor, '#9fe8ff'),
    },
    ...(Object.keys(adjustments).length > 0 ? { adjustments } : {}),
    ...(Object.keys(images).length > 0 ? { images } : {}),
  }
}

const KINDS: PrimitiveKind[] = [
  'box',
  'sphere',
  'cylinder',
  'capsule',
  'cone',
  'torus',
  'plane',
  'group',
  'mesh',
]

function normalizeBone(raw: unknown): MeshBone | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  const rawQuaternion = Array.isArray(b.quaternion) ? b.quaternion : []
  const quaternion: [number, number, number, number] = [
    readNumber(rawQuaternion[0], 0),
    readNumber(rawQuaternion[1], 0),
    readNumber(rawQuaternion[2], 0),
    readNumber(rawQuaternion[3], 1),
  ]
  return {
    name: readString(b.name, 'Bone'),
    parent: Math.floor(readNumber(b.parent, -1)),
    position: readVec(b.position, [0, 0, 0]),
    quaternion,
    scale: readVec(b.scale, [1, 1, 1]),
  }
}

function normalizeMesh(raw: unknown): MeshAsset | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const asset = raw as Record<string, unknown>
  const data = typeof asset.data === 'string' ? asset.data : ''
  const vertices = Math.floor(readNumber(asset.vertices, 0))
  const triangles = Math.floor(readNumber(asset.triangles, 0))
  if (!data || vertices <= 0 || triangles <= 0) return undefined
  const bones = Array.isArray(asset.bones)
    ? asset.bones.map(normalizeBone).filter((bone): bone is MeshBone => bone !== null)
    : undefined
  // Only an embedded image is accepted: a project never points at a file.
  const packedColor =
    typeof asset.baseColor === 'string' &&
    asset.baseColor.startsWith('data:image/') &&
    asset.baseColor.length <= MAX_TEXTURE_DATA_URL
      ? asset.baseColor
      : undefined
  return {
    vertices,
    triangles,
    hasUv: asset.hasUv === true,
    data,
    skin: typeof asset.skin === 'string' && asset.skin ? asset.skin : undefined,
    bones: bones && bones.length > 0 ? bones : undefined,
    baseColor: packedColor,
    baseColorFlipY: packedColor && asset.baseColorFlipY === false ? false : undefined,
    format: typeof asset.format === 'string' ? asset.format : undefined,
    source: typeof asset.source === 'string' ? asset.source : undefined,
  }
}

export function normalizeProject(raw: unknown): ProjectDoc | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  // `miniblend` is the pre-rename format id; both load into Shredder.
  if ((data.format !== 'shredder' && data.format !== 'miniblend') || !Array.isArray(data.objects))
    return null

  const objects: SceneObject[] = []
  for (const item of data.objects) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const kind = KINDS.includes(o.kind as PrimitiveKind) ? (o.kind as PrimitiveKind) : 'box'
    const object: SceneObject = {
      id: readString(o.id, uid('obj')),
      name: readString(o.name, 'Object'),
      kind,
      parentId: typeof o.parentId === 'string' ? o.parentId : null,
      position: readVec(o.position, [0, 0, 0]),
      rotation: readVec(o.rotation, [0, 0, 0]),
      scale: readVec(o.scale, [1, 1, 1]),
      color: readString(o.color, '#8f9aa8'),
      roughness: readNumber(o.roughness, 0.6),
      metalness: readNumber(o.metalness, 0.05),
      visible: o.visible !== false,
    }
    const spec = normalizeSpec(o.character)
    if (spec && kind === 'group') object.character = spec
    if (kind === 'mesh') {
      const mesh = normalizeMesh(o.mesh)
      if (mesh) object.mesh = mesh
      else continue
    }
    if (o.sculpt) {
      // A sculpted part is bounded so one stroke-heavy file cannot exhaust the
      // browser's memory when it is opened again.
      const sculpt = normalizeMesh(o.sculpt)
      if (sculpt && sculpt.vertices <= MAX_SCULPT_VERTICES) object.sculpt = sculpt
    }
    objects.push(object)
  }

  const ids = new Set(objects.map((o) => o.id))
  for (const o of objects) {
    if (o.parentId && !ids.has(o.parentId)) o.parentId = null
  }

  // Characters saved before the face became its own part get one, so a picture
  // can be mapped onto the face of an existing rig.
  for (const group of [...objects]) {
    if (!group.character) continue
    if (objects.some((o) => o.parentId === group.id && o.name === 'Face')) continue
    const face = characterParts(group.character, group.id).find((part) => part.name === 'Face')
    if (face) objects.push(face)
  }

  const animations: AnimationClipData[] = []
  if (Array.isArray(data.animations)) {
    for (const raw of data.animations.slice(0, MAX_ANIMATION_CLIPS)) {
      const clip = normalizeAnimationClip(raw)
      if (clip) animations.push(clip)
    }
  }

  const cam = (data.camera ?? {}) as Record<string, unknown>
  const now = Date.now()
  return {
    format: 'shredder',
    version: 1,
    name: readString(data.name, 'Untitled.blend'),
    objects,
    ...(animations.length > 0 ? { animations } : {}),
    camera: {
      position: readVec(cam.position, [3.4, 2.6, 4.4]),
      target: readVec(cam.target, [0, 0.9, 0]),
    },
    createdAt: readNumber(data.createdAt, now),
    updatedAt: readNumber(data.updatedAt, now),
  }
}
