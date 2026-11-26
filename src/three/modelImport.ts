import * as THREE from 'three'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'
import { baseObject, uniqueName, type SceneObject } from '../blend/doc'
import { packMesh, type MeshAsset, type MeshBone } from '../blend/mesh'
import { packPaintColors } from '../blend/paint'
import {
  glbBaseColorTextures,
  gltfTextBaseColorTextures,
  packedTextureFromMaterial,
  type PackedTexture,
} from './textures'

/**
 * Importers for every model format Unity accepts (FBX, Collada, 3DS, OBJ,
 * glTF/GLB, DXF, plus Blender .blend through Blender's own exporter).
 *
 * Everything is converted to project data: one wrapper group holds the model,
 * the file's node hierarchy becomes groups, every mesh keeps its own material
 * colour, and rigged models keep their bind skeleton so the viewport can draw
 * and animate the same bones the file ships with.
 */
export const MODEL_EXTENSIONS = [
  'glb',
  'gltf',
  'fbx',
  'obj',
  'dae',
  '3ds',
  'stl',
  'ply',
  '3mf',
  'dxf',
  'blend',
] as const

export type ModelFormat = (typeof MODEL_EXTENSIONS)[number]

export const MODEL_ACCEPT = MODEL_EXTENSIONS.map((ext) => `.${ext}`).join(',')
export const MODEL_LABEL = 'glTF/GLB, FBX, OBJ, Collada, 3DS, STL, PLY, 3MF, DXF, Blender'

/** Formats whose files are authored Z-up; everything else arrives Y-up. */
const Z_UP_FORMATS = new Set<ModelFormat>(['dae', '3ds', 'stl', 'dxf'])

export function modelFormat(fileName: string): ModelFormat | null {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)
  if (!match) return null
  return (MODEL_EXTENSIONS as readonly string[]).includes(match[1])
    ? (match[1] as ModelFormat)
    : null
}

export interface ImportedModel {
  /** Wrapper group that holds the whole model. */
  rootId: string
  objects: SceneObject[]
  summary: {
    format: string
    meshes: number
    triangles: number
    bones: number
    objects: number
    /** 1 unless the file's units were converted (for example centimetres). */
    unitScale: number
    upAxis: 'Y' | 'Z'
  }
}

function defaultMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#b6bcc6', roughness: 0.58, metalness: 0.08 })
}

interface ParsedScene {
  root: THREE.Object3D
  /** glTF material uuid → base-colour image packed out of the file. */
  textures: Map<string, PackedTexture>
}

const NO_TEXTURES = new Map<string, PackedTexture>()

/**
 * Ties the images read straight from the glTF document to the materials the
 * loader built, so each mesh can keep the texture its material points at.
 */
function materialTextures(
  gltf: Awaited<ReturnType<GLTFLoader['parseAsync']>>,
  byIndex: Map<number, PackedTexture>,
): Map<string, PackedTexture> {
  if (byIndex.size === 0) return NO_TEXTURES
  const textures = new Map<string, PackedTexture>()
  for (const [object, reference] of gltf.parser.associations) {
    if (!(object instanceof THREE.Material)) continue
    const index = (reference as { materials?: number } | undefined)?.materials
    const packed = typeof index === 'number' ? byIndex.get(index) : undefined
    if (packed) textures.set(object.uuid, packed)
  }
  return textures
}

async function parseScene(buffer: ArrayBuffer, format: ModelFormat): Promise<ParsedScene> {
  const text = () => new TextDecoder().decode(buffer)
  switch (format) {
    case 'glb':
    case 'gltf': {
      const source = format === 'gltf' ? text() : ''
      const gltf = await new GLTFLoader().parseAsync(format === 'glb' ? buffer : source, '')
      const byIndex =
        format === 'glb' ? glbBaseColorTextures(buffer) : gltfTextBaseColorTextures(source)
      return { root: gltf.scene, textures: materialTextures(gltf, byIndex) }
    }
    case 'fbx':
      return { root: new FBXLoader().parse(buffer, ''), textures: NO_TEXTURES }
    case 'obj':
      return { root: new OBJLoader().parse(text()), textures: NO_TEXTURES }
    case 'dae':
      return { root: new ColladaLoader().parse(text(), '').scene, textures: NO_TEXTURES }
    case '3ds':
      return { root: new TDSLoader().parse(buffer, ''), textures: NO_TEXTURES }
    case 'stl': {
      const geometry = new STLLoader().parse(buffer)
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
      return { root: new THREE.Mesh(geometry, defaultMaterial()), textures: NO_TEXTURES }
    }
    case 'ply': {
      const geometry = new PLYLoader().parse(buffer)
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
      return { root: new THREE.Mesh(geometry, defaultMaterial()), textures: NO_TEXTURES }
    }
    case '3mf':
      return { root: new ThreeMFLoader().parse(buffer), textures: NO_TEXTURES }
    case 'dxf':
      return { root: parseDxf(text()), textures: NO_TEXTURES }
    case 'blend':
      throw new Error(
        'Blender .blend archives need Blender installed. Shredder opens them through Blender in the desktop app; in the browser preview export GLB, FBX or OBJ from Blender instead.',
      )
    default:
      throw new Error(`Unsupported model format: ${String(format)}`)
  }
}

// ------------------------------------------------------------------ DXF
interface DxfEntity {
  type: string
  values: Map<number, string[]>
}

function dxfPoint(entity: DxfEntity, base: number): THREE.Vector3 {
  const read = (code: number) => Number(entity.values.get(code)?.[0] ?? 0)
  return new THREE.Vector3(read(base), read(base + 10), read(base + 20))
}

/**
 * Minimal DXF reader: 3DFACE entities and polyface meshes (POLYLINE / VERTEX /
 * SEQEND). That covers the solid geometry Unity imports from CAD exports.
 */
function parseDxf(text: string): THREE.Object3D {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  const entities: DxfEntity[] = []
  let current: DxfEntity | null = null
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim())
    const value = lines[i + 1]
    if (!Number.isFinite(code)) continue
    if (code === 0) {
      current = { type: value.trim().toUpperCase(), values: new Map() }
      entities.push(current)
      continue
    }
    if (!current) continue
    const bucket = current.values.get(code) ?? []
    bucket.push(value.trim())
    current.values.set(code, bucket)
  }

  const positions: number[] = []
  const pushTriangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
  }

  const polyVerts: THREE.Vector3[] = []
  const polyFaces: number[][] = []
  for (const entity of entities) {
    if (entity.type === '3DFACE') {
      const a = dxfPoint(entity, 10)
      const b = dxfPoint(entity, 11)
      const c = dxfPoint(entity, 12)
      const d = dxfPoint(entity, 13)
      pushTriangle(a, b, c)
      if (!d.equals(c)) pushTriangle(a, c, d)
      continue
    }
    if (entity.type === 'VERTEX') {
      polyVerts.push(dxfPoint(entity, 10))
      const flag = Number(entity.values.get(70)?.[0] ?? 0)
      if (flag & 128) {
        const face = [71, 72, 73, 74]
          .map((code) => Number(entity.values.get(code)?.[0] ?? 0))
          .filter((index) => index !== 0)
          .map((index) => Math.abs(index) - 1)
        if (face.length >= 3) polyFaces.push(face)
      } else if (flag & 64) {
        polyFaces.push([])
      }
    }
  }

  for (const face of polyFaces) {
    for (let i = 1; i + 1 < face.length; i += 1) {
      const a = polyVerts[face[0]]
      const b = polyVerts[face[i]]
      const c = polyVerts[face[i + 1]]
      if (a && b && c) pushTriangle(a, b, c)
    }
  }

  if (positions.length === 0) {
    throw new Error('that DXF file has no 3DFACE or polyface geometry to import')
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, defaultMaterial())
  mesh.name = 'DXF mesh'
  const group = new THREE.Group()
  group.name = 'DXF'
  group.add(mesh)
  return group
}

// -------------------------------------------------------------- conversion

function materialColor(material: THREE.Material | undefined): [number, number, number] {
  const color = (material as THREE.MeshStandardMaterial | undefined)?.color
  if (!(color instanceof THREE.Color)) return [1, 1, 1]
  return [color.r, color.g, color.b]
}

const toByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value * 255)))

/**
 * The colours the file itself authored. Two ways models carry them are read
 * here instead of being flattened to the first material:
 * - a COLOR_0 vertex attribute, which glTF multiplies with the base colour;
 * - one flat material per face group, which becomes one vertex colour per face.
 * Both are stored as vertex colours so every colour of the model survives the
 * import, visible, paintable and exported again.
 */
function bakedColors(
  mesh: THREE.Mesh,
  textureByMaterial: Map<string, PackedTexture>,
): { colors: string; flat: boolean } | undefined {
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position')
  if (!position) return undefined
  const count = position.count
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const groups = geometry.groups.filter((group) => group.count > 0)
  const multi = materials.length > 1 && groups.length > 0
  const hasTexture =
    Boolean(geometry.getAttribute('uv')) &&
    materials.some((material) => {
      const standard = material as THREE.MeshStandardMaterial
      return textureByMaterial.has(material.uuid) || Boolean(standard?.map)
    })
  const source = geometry.getAttribute('color')
  if (!source && !(multi && !hasTexture)) return undefined

  const colors = new Uint8Array(count * 3)
  colors.fill(255)
  if (source && source.count >= count) {
    for (let i = 0; i < count; i += 1) {
      colors[i * 3] = toByte(source.getX(i))
      colors[i * 3 + 1] = toByte(source.getY(i))
      colors[i * 3 + 2] = toByte(source.getZ(i))
    }
  }

  // A textured multi-material mesh keeps its texture in the material, so only
  // the vertex attribute is carried there; flat-coloured models get every
  // material's colour painted onto its faces.
  if (multi && !hasTexture) {
    const index = geometry.getIndex()
    for (const group of groups) {
      const [r, g, b] = materialColor(materials[group.materialIndex ?? 0])
      const end = Math.min(group.start + group.count, index ? index.count : count)
      for (let cursor = group.start; cursor < end; cursor += 1) {
        const vertex = index ? index.getX(cursor) : cursor
        if (vertex < 0 || vertex >= count) continue
        colors[vertex * 3] = Math.round(colors[vertex * 3] * r)
        colors[vertex * 3 + 1] = Math.round(colors[vertex * 3 + 1] * g)
        colors[vertex * 3 + 2] = Math.round(colors[vertex * 3 + 2] * b)
      }
    }
  }

  return { colors: packPaintColors(colors), flat: multi && !hasTexture }
}

function materialLook(
  mesh: THREE.Mesh,
  textureByMaterial: Map<string, PackedTexture>,
): {
  color: string
  roughness: number
  metalness: number
  texture?: PackedTexture
  colors?: string
} {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  const standard = material as THREE.MeshStandardMaterial | undefined
  const baked = bakedColors(mesh, textureByMaterial)
  const color = baked?.flat
    ? '#ffffff'
    : standard?.color instanceof THREE.Color
      ? `#${standard.color.getHexString()}`
      : '#9aa4b0'
  // glTF images come out of the file itself; other formats are rasterized once.
  const texture =
    (standard ? textureByMaterial.get(standard.uuid) : undefined) ??
    packedTextureFromMaterial(standard?.map)
  return {
    color,
    colors: baked?.colors,
    texture,
    roughness:
      typeof standard?.roughness === 'number' && Number.isFinite(standard.roughness)
        ? Math.min(1, Math.max(0, standard.roughness))
        : 0.58,
    metalness:
      typeof standard?.metalness === 'number' && Number.isFinite(standard.metalness)
        ? Math.min(1, Math.max(0, standard.metalness))
        : 0.08,
  }
}

function packGeometry(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position')
  if (!position || position.count < 3) return null
  const count = position.count
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
  const normal = geometry.getAttribute('normal')
  const uv = geometry.getAttribute('uv')
  const skinIndex = geometry.getAttribute('skinIndex')
  const skinWeight = geometry.getAttribute('skinWeight')

  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const uvs = uv ? new Float32Array(count * 2) : null
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = position.getX(i)
    positions[i * 3 + 1] = position.getY(i)
    positions[i * 3 + 2] = position.getZ(i)
    if (normal) {
      normals[i * 3] = normal.getX(i)
      normals[i * 3 + 1] = normal.getY(i)
      normals[i * 3 + 2] = normal.getZ(i)
    }
    if (uvs && uv) {
      uvs[i * 2] = uv.getX(i)
      uvs[i * 2 + 1] = uv.getY(i)
    }
  }

  const index = geometry.getIndex()
  const indices = index
    ? Uint32Array.from(index.array as ArrayLike<number>)
    : Uint32Array.from({ length: count }, (_, i) => i)

  let joints: Uint16Array | null = null
  let weights: Float32Array | null = null
  if (skinIndex && skinWeight) {
    joints = new Uint16Array(count * 4)
    weights = new Float32Array(count * 4)
    for (let i = 0; i < count * 4; i += 1) {
      joints[i] = skinIndex.getX(i)
      weights[i] = skinWeight.getX(i)
    }
  }

  const valid = indices.length - (indices.length % 3)
  return {
    positions,
    normals,
    uvs,
    indices: valid === indices.length ? indices : indices.subarray(0, valid),
    joints,
    weights,
  }
}

function eulerOf(object: THREE.Object3D): [number, number, number] {
  const euler = new THREE.Euler().setFromQuaternion(object.quaternion)
  return [euler.x, euler.y, euler.z]
}

function transformOf(object: THREE.Object3D) {
  return {
    position: [object.position.x, object.position.y, object.position.z] as [number, number, number],
    rotation: eulerOf(object),
    scale: [object.scale.x, object.scale.y, object.scale.z] as [number, number, number],
  }
}

/**
 * Turns a loaded file into project objects:
 * - one wrapper group carries the unit conversion, up-axis fix and ground snap
 * - every file node becomes a group, so its pivot and hierarchy survive
 * - every mesh stores its packed geometry and its material
 * - rigged meshes keep their bind skeleton (bones become children of the mesh)
 */
export async function importModel(buffer: ArrayBuffer, fileName: string): Promise<ImportedModel> {
  const format = modelFormat(fileName)
  if (!format) {
    throw new Error(`Shredder cannot read "${fileName}". Use ${MODEL_LABEL}.`)
  }

  const parsed = await parseScene(buffer, format)
  const root = parsed.root
  const textureByMaterial = parsed.textures
  root.updateMatrixWorld(true)

  const rotation = Z_UP_FORMATS.has(format) ? -Math.PI * 0.5 : 0
  const rawBox = new THREE.Box3().setFromObject(root)
  const rawSize = rawBox.getSize(new THREE.Vector3())
  const maxDimension = Math.max(rawSize.x, rawSize.y, rawSize.z)

  // Unit mapping: centimetre/millimetre exports are 100x off, and files that
  // arrive in kilometres are 1000x off. Everything else keeps its own scale.
  let unitScale = 1
  if (Number.isFinite(maxDimension) && maxDimension > 0) {
    if (maxDimension > 20) unitScale = 0.01
    else if (maxDimension < 0.05) unitScale = 100
  }

  const orientation = new THREE.Matrix4().compose(
    new THREE.Vector3(),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation, 0, 0)),
    new THREE.Vector3(unitScale, unitScale, unitScale),
  )
  const oriented = rawBox.clone().applyMatrix4(orientation)
  const center = oriented.getCenter(new THREE.Vector3())

  const baseName = fileName.replace(/\.[^.]+$/, '').trim() || 'Imported model'
  const objects: SceneObject[] = []
  const rootObject = baseObject({
    kind: 'group',
    name: baseName,
    position: [-center.x, -oriented.min.y, -center.z],
    rotation: [rotation, 0, 0],
    scale: [unitScale, unitScale, unitScale],
  })
  objects.push(rootObject)

  let meshes = 0
  let triangles = 0
  let bones = 0

  const addBones = (mesh: THREE.SkinnedMesh, asset: MeshAsset) => {
    const skeleton = mesh.skeleton
    if (!skeleton || skeleton.bones.length === 0) return
    const list: MeshBone[] = []
    const indexOf = new Map<THREE.Bone, number>()
    for (const bone of skeleton.bones) {
      indexOf.set(bone, list.length)
      const world = bone.matrixWorld.clone()
      const parentBone = bone.parent instanceof THREE.Bone ? bone.parent : null
      const parentWorld =
        parentBone && parentBone.matrixWorld ? parentBone.matrixWorld.clone() : new THREE.Matrix4()
      const local = new THREE.Matrix4().copy(parentWorld).invert().multiply(world)
      const position = new THREE.Vector3()
      const quaternion = new THREE.Quaternion()
      const scale = new THREE.Vector3()
      local.decompose(position, quaternion, scale)
      list.push({
        name: bone.name || `Bone ${list.length}`,
        parent: parentBone ? (indexOf.get(parentBone) ?? -1) : -1,
        position: [position.x, position.y, position.z],
        quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
        scale: [scale.x, scale.y, scale.z],
      })
    }
    asset.bones = list
    bones += list.length
  }

  const addMesh = (node: THREE.Mesh, parentId: string, skinned: boolean) => {
    const geometry = node.geometry.clone()
    // Static meshes keep their local geometry and node transform, so the file's
    // hierarchy stays editable. Rigged meshes bake the file transform instead:
    // their bones define the bind pose in that same space.
    if (skinned) geometry.applyMatrix4(node.matrixWorld)
    const packed = packGeometry(geometry)
    geometry.dispose()
    if (!packed) return
    const look = materialLook(node, textureByMaterial)
    const object = baseObject({
      kind: 'mesh',
      name: uniqueName(objects, node.name || 'Mesh'),
      // Rigged meshes are baked into model space and hang off the wrapper
      // instead of ancestors that would transform them a second time.
      parentId,
      ...(skinned ? {} : transformOf(node)),
      color: look.color,
      roughness: look.roughness,
      metalness: look.metalness,
    })
    const packedAsset = packMesh({
      positions: packed.positions,
      normals: packed.normals,
      uvs: packed.uvs,
      indices: packed.indices,
      joints: packed.joints,
      weights: packed.weights,
    })
    const asset: MeshAsset = {
      ...packedAsset,
      format,
      source: fileName,
    }
    // The file's own vertex colours ride along with the packed geometry.
    if (look.colors) asset.colors = look.colors
    // Without texture coordinates a packed image could not be sampled at all.
    if (look.texture && packedAsset.hasUv) {
      asset.baseColor = look.texture.url
      if (!look.texture.flipY) asset.baseColorFlipY = false
    }
    if (skinned) addBones(node as THREE.SkinnedMesh, asset)
    object.mesh = asset
    objects.push(object)
    meshes += 1
    triangles += asset.triangles
    if (!skinned) {
      for (const child of node.children) visit(child, object.id)
    }
  }

  const visit = (node: THREE.Object3D, parentId: string) => {
    if ((node as THREE.Bone).isBone) return
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) {
      addMesh(node as THREE.SkinnedMesh, rootObject.id, true)
      return
    }
    if ((node as THREE.Mesh).isMesh) {
      addMesh(node as THREE.Mesh, parentId, false)
      return
    }
    const group = baseObject({
      kind: 'group',
      name: uniqueName(objects, node.name || 'Node'),
      parentId,
      ...transformOf(node),
    })
    objects.push(group)
    for (const child of node.children) visit(child, group.id)
  }

  if ((root as THREE.SkinnedMesh).isSkinnedMesh || (root as THREE.Mesh).isMesh) {
    if ((root as THREE.SkinnedMesh).isSkinnedMesh) addMesh(root as THREE.SkinnedMesh, rootObject.id, true)
    else addMesh(root as THREE.Mesh, rootObject.id, false)
  } else {
    for (const child of root.children) visit(child, rootObject.id)
  }

  if (meshes === 0 || triangles === 0) {
    throw new Error(`"${fileName}" contains no mesh geometry Shredder can import`)
  }

  return {
    rootId: rootObject.id,
    objects,
    summary: {
      format,
      meshes,
      triangles,
      bones,
      objects: objects.length,
      unitScale,
      upAxis: rotation === 0 ? 'Y' : 'Z',
    },
  }
}
