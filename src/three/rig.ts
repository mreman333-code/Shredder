import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { CharacterSpec, PartImage, ProjectDoc, SceneObject } from '../blend/doc'
import type { MeshAsset } from '../blend/mesh'
import { decodePaintColors } from '../blend/paint'
import { boneForPart, characterSkeleton, type SkeletonDef } from '../blend/skeleton'
import { meshGeometry, primitiveGeometry } from './geometry'
import { sculptGeometryFromAsset } from './sculptBuild'
import { textureInstance } from './textures'

export interface BoneRig {
  root: THREE.Bone
  bones: THREE.Bone[]
}

/** Bone and node names have to survive three's animation-track name parsing. */
export function sanitizeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned || 'Rig'
}

export function rigPrefix(groupName: string): string {
  return `Rig_${sanitizeName(groupName)}`
}

function applyObjectTransform(object: SceneObject, node: THREE.Object3D) {
  node.position.set(object.position[0], object.position[1], object.position[2])
  node.rotation.set(object.rotation[0], object.rotation[1], object.rotation[2])
  node.scale.set(object.scale[0], object.scale[1], object.scale[2])
}

function objectMatrix(object: SceneObject): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(object.position[0], object.position[1], object.position[2]),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(object.rotation[0], object.rotation[1], object.rotation[2]),
    ),
    new THREE.Vector3(object.scale[0], object.scale[1], object.scale[2]),
  )
}

/** Painted vertex colours replace a part's base colour and texture on export. */
function applyPaintedColors(
  object: SceneObject,
  geometry: THREE.BufferGeometry,
  material: THREE.MeshStandardMaterial,
) {
  const position = geometry.getAttribute('position')
  const paint =
    object.paint && position ? decodePaintColors(object.paint, position.count) : null
  if (paint) {
    geometry.setAttribute('color', new THREE.Uint8BufferAttribute(paint, 3, true))
    material.color.set('#ffffff')
    material.map = null
  }
  material.vertexColors = Boolean(geometry.getAttribute('color'))
}

function materialFor(
  object: SceneObject,
  map?: THREE.Texture,
  picture?: PartImage,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    name: object.name,
    color: picture ? '#ffffff' : object.color,
    roughness: object.roughness,
    metalness: object.metalness,
    map: map ?? null,
    transparent: Boolean(picture),
    opacity: picture?.opacity ?? 1,
    depthWrite: (picture?.opacity ?? 1) >= 0.999,
  })
}

/** Resolves a packed base-colour image to a decoded texture for export. */
export type TextureResolver = (asset: MeshAsset) => THREE.Texture | undefined

function buildBoneRig(def: SkeletonDef, prefix: string): BoneRig {
  const byKey = new Map<string, THREE.Bone>()
  const worldPosition = new Map<string, THREE.Vector3>()
  const bones: THREE.Bone[] = []

  for (const boneDef of def.bones) {
    const bone = new THREE.Bone()
    bone.name = `${prefix}_${boneDef.key}`
    const position = new THREE.Vector3(
      boneDef.position[0],
      boneDef.position[1],
      boneDef.position[2],
    )
    const parent = boneDef.parent ? byKey.get(boneDef.parent) : undefined
    const parentPosition = boneDef.parent
      ? (worldPosition.get(boneDef.parent) ?? new THREE.Vector3())
      : new THREE.Vector3()
    bone.position.copy(position).sub(parentPosition)
    if (parent) parent.add(bone)
    byKey.set(boneDef.key, bone)
    worldPosition.set(boneDef.key, position)
    bones.push(bone)
  }

  return { root: bones[0], bones }
}

/** Live skeleton for the viewport: bones only, no geometry. */
export function createBoneRig(spec: CharacterSpec, prefix: string): BoneRig {
  return buildBoneRig(characterSkeleton(spec), prefix)
}

function addSkinAttributes(geometry: THREE.BufferGeometry, jointIndex: number) {
  const count = geometry.attributes.position.count
  const joints = new Uint16Array(count * 4)
  const weights = new Float32Array(count * 4)
  for (let i = 0; i < count; i += 1) {
    joints[i * 4] = jointIndex
    weights[i * 4] = 1
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4))
}

/**
 * Merges a character's primitive parts into one skinned mesh: every part keeps
 * its own material through geometry groups, and every vertex is weighted to the
 * bone that drives that part. Binding at rest height keeps the bind pose equal
 * to what the editor shows.
 */
export function buildSkinnedCharacter(
  group: SceneObject,
  spec: CharacterSpec,
  parts: SceneObject[],
  parent: THREE.Object3D,
): { mesh: THREE.SkinnedMesh; rig: BoneRig } {
  const prefix = rigPrefix(group.name)
  const skeletonDef = characterSkeleton(spec)
  const rig = buildBoneRig(skeletonDef, prefix)
  const jointIndex = new Map(rig.bones.map((bone, index) => [bone.name, index]))

  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.MeshStandardMaterial[] = []

  for (const part of parts) {
    if (part.kind === 'group') continue
    const geometry = part.sculpt
      ? sculptGeometryFromAsset(part.sculpt)
      : primitiveGeometry(part.kind).clone()
    geometry.applyMatrix4(objectMatrix(part))
    const jointName = `${prefix}_${boneForPart(skeletonDef, part.name)}`
    const index = jointIndex.get(jointName)
    if (index === undefined) throw new Error(`No bone drives ${part.name}`)
    addSkinAttributes(geometry, index)

    // Bake the picture's size into the UVs, so the exported model shows the
    // same crop scaled into its geometry as the viewport does.
    const picture = spec.images?.[part.name]
    if (picture) {
      const uv = geometry.getAttribute('uv')
      if (uv) {
        const size = Math.min(3, Math.max(0.25, picture.size))
        const repeat = 1 / size
        const offset = (1 - repeat) / 2
        for (let i = 0; i < uv.count; i += 1) {
          uv.setXY(i, uv.getX(i) * repeat + offset, uv.getY(i) * repeat + offset)
        }
        uv.needsUpdate = true
      }
    }

    geometries.push(geometry)
    materials.push(
      materialFor(part, picture ? textureInstance(picture.url) : undefined, picture),
    )
  }

  if (geometries.length === 0) throw new Error(`${group.name} has no parts to skin`)

  const merged = mergeGeometries(geometries, true)
  for (const geometry of geometries) geometry.dispose()
  if (!merged) throw new Error(`Could not merge the parts of ${group.name}`)
  merged.computeBoundingSphere()

  const mesh = new THREE.SkinnedMesh(merged, materials)
  mesh.name = group.name
  mesh.add(rig.root)
  parent.add(mesh)
  mesh.bind(new THREE.Skeleton(rig.bones))
  return { mesh, rig }
}

type Rotation = [number, number, number]

const e = (x = 0, y = 0, z = 0): Rotation => [x, y, z]

function quaternionTrack(name: string, times: number[], rotations: Rotation[]) {
  const values: number[] = []
  const euler = new THREE.Euler()
  let previous: THREE.Quaternion | null = null
  for (const rotation of rotations) {
    euler.set(rotation[0], rotation[1], rotation[2])
    const quaternion = new THREE.Quaternion().setFromEuler(euler)
    // Keep neighbouring keys on the same hemisphere, or interpolation spins.
    if (previous && previous.dot(quaternion) < 0) {
      quaternion.set(-quaternion.x, -quaternion.y, -quaternion.z, -quaternion.w)
    }
    values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
    previous = quaternion
  }
  return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values)
}

function hipsPositionTrack(
  name: string,
  times: number[],
  rest: THREE.Vector3,
  bobs: Array<[number, number, number]>,
) {
  const values: number[] = []
  for (const bob of bobs) {
    values.push(rest.x + bob[0], rest.y + bob[1], rest.z + bob[2])
  }
  return new THREE.VectorKeyframeTrack(`${name}.position`, times, values)
}

/**
 * Two looping clips authored on the rest skeleton. Channel targets are the
 * exported bone node names, so an engine gets clips that drive the same rig it
 * imports alongside the mesh.
 */
export function createCharacterClips(
  prefix: string,
  spec: CharacterSpec,
  groupName: string,
): THREE.AnimationClip[] {
  const def = characterSkeleton(spec)
  const bone = (key: string) => `${prefix}_${key}`
  const hipsRest = new THREE.Vector3(
    ...(def.bones.find((entry) => entry.key === 'Hips')?.position ?? [0, 1, 0]),
  )

  const idleTimes = [0, 1.2, 2.4]
  const idle = new THREE.AnimationClip(`${groupName} Idle`, 2.4, [
    quaternionTrack(bone('Chest'), idleTimes, [e(0.01), e(0.045), e(0.01)]),
    quaternionTrack(bone('Head'), idleTimes, [
      e(0, 0.03, 0.01),
      e(0.03, -0.02, -0.01),
      e(0, 0.03, 0.01),
    ]),
    quaternionTrack(bone('UpperArm_L'), idleTimes, [e(0, 0, 0.05), e(0, 0, 0.09), e(0, 0, 0.05)]),
    quaternionTrack(bone('UpperArm_R'), idleTimes, [
      e(0, 0, -0.05),
      e(0, 0, -0.09),
      e(0, 0, -0.05),
    ]),
    quaternionTrack(bone('Forearm_L'), idleTimes, [e(0.12), e(0.16), e(0.12)]),
    quaternionTrack(bone('Forearm_R'), idleTimes, [e(0.12), e(0.16), e(0.12)]),
    hipsPositionTrack(bone('Hips'), idleTimes, hipsRest, [
      [0, 0, 0],
      [0, 0.008, 0],
      [0, 0, 0],
    ]),
  ])

  const walkTimes = [0, 0.25, 0.5, 0.75, 1]
  const walk = new THREE.AnimationClip(`${groupName} Walk`, 1, [
    quaternionTrack(bone('Thigh_L'), walkTimes, [e(0.55), e(0), e(-0.5), e(0), e(0.55)]),
    quaternionTrack(bone('Thigh_R'), walkTimes, [e(-0.5), e(0), e(0.55), e(0), e(-0.5)]),
    quaternionTrack(bone('Shin_L'), walkTimes, [e(0.08), e(0.6), e(0.12), e(0.35), e(0.08)]),
    quaternionTrack(bone('Shin_R'), walkTimes, [e(0.35), e(0.12), e(0.08), e(0.6), e(0.08)]),
    quaternionTrack(bone('Foot_L'), walkTimes, [e(-0.1), e(0.05), e(-0.03), e(-0.2), e(-0.1)]),
    quaternionTrack(bone('Foot_R'), walkTimes, [e(-0.03), e(-0.2), e(-0.1), e(0.05), e(-0.03)]),
    quaternionTrack(bone('UpperArm_L'), walkTimes, [
      e(-0.4, 0, 0.08),
      e(0, 0, 0.08),
      e(0.4, 0, 0.08),
      e(0, 0, 0.08),
      e(-0.4, 0, 0.08),
    ]),
    quaternionTrack(bone('UpperArm_R'), walkTimes, [
      e(0.4, 0, -0.08),
      e(0, 0, -0.08),
      e(-0.4, 0, -0.08),
      e(0, 0, -0.08),
      e(0.4, 0, -0.08),
    ]),
    quaternionTrack(bone('Forearm_L'), walkTimes, [e(0.3), e(0.2), e(0.3), e(0.45), e(0.3)]),
    quaternionTrack(bone('Forearm_R'), walkTimes, [e(0.3), e(0.45), e(0.3), e(0.2), e(0.3)]),
    quaternionTrack(bone('Chest'), walkTimes, [
      e(0, 0.05, 0),
      e(0, 0, 0),
      e(0, -0.05, 0),
      e(0, 0, 0),
      e(0, 0.05, 0),
    ]),
    hipsPositionTrack(bone('Hips'), walkTimes, hipsRest, [
      [0, 0.012, 0],
      [0, 0.03, 0],
      [0, 0.012, 0],
      [0, 0.03, 0],
      [0, 0.012, 0],
    ]),
  ])

  return [idle, walk]
}

export interface ExportBundle {
  scene: THREE.Scene
  animations: THREE.AnimationClip[]
}

/**
 * Builds a clean export scene from the document: regular objects become plain
 * meshes, character groups become one skinned mesh plus its bone hierarchy.
 * Clips are returned for `GLTFExporter.parseAsync(scene, { animations })`.
 */
export function buildExportScene(
  doc: ProjectDoc,
  resolveTexture?: TextureResolver,
): ExportBundle {
  const scene = new THREE.Scene()
  const animations: THREE.AnimationClip[] = []

  const byParent = new Map<string | null, SceneObject[]>()
  const ids = new Set(doc.objects.map((object) => object.id))
  for (const object of doc.objects) {
    const key = object.parentId && ids.has(object.parentId) ? object.parentId : null
    const list = byParent.get(key) ?? []
    list.push(object)
    byParent.set(key, list)
  }

  const walk = (parentId: string | null, parentNode: THREE.Object3D) => {
    for (const object of byParent.get(parentId) ?? []) {
      if (object.kind === 'group') {
        const node = new THREE.Group()
        node.name = object.name
        applyObjectTransform(object, node)
        parentNode.add(node)
        node.updateWorldMatrix(true, false)

        if (object.character) {
          const parts = (byParent.get(object.id) ?? []).filter((part) => part.kind !== 'group')
          if (parts.length > 0) {
            buildSkinnedCharacter(object, object.character, parts, node)
            animations.push(
              ...createCharacterClips(rigPrefix(node.name), object.character, object.name),
            )
          }
        } else {
          walk(object.id, node)
        }
      } else if (object.kind === 'mesh' && object.mesh) {
        // Imported models export as their bind-pose geometry: the same shape
        // and base-colour texture the viewport shows, ready for Unity or any
        // other glTF tool.
        const texture = object.mesh.hasUv ? resolveTexture?.(object.mesh) : undefined
        const geometry = object.sculpt
          ? sculptGeometryFromAsset(object.sculpt)
          : meshGeometry(object.mesh)
        const material = materialFor(object, texture)
        applyPaintedColors(object, geometry, material)
        const mesh = new THREE.Mesh(geometry, material)
        mesh.name = object.name
        applyObjectTransform(object, mesh)
        parentNode.add(mesh)
      } else {
        // A painted primitive gets its own geometry: the primitive cache is
        // shared by every cube in the scene.
        const geometry = object.sculpt
          ? sculptGeometryFromAsset(object.sculpt)
          : object.paint
            ? primitiveGeometry(object.kind).clone()
            : primitiveGeometry(object.kind)
        const material = materialFor(object)
        applyPaintedColors(object, geometry, material)
        const mesh = new THREE.Mesh(geometry, material)
        mesh.name = object.name
        applyObjectTransform(object, mesh)
        parentNode.add(mesh)
      }
    }
  }

  walk(null, scene)
  scene.updateMatrixWorld(true)
  return { scene, animations }
}
