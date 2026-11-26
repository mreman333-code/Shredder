import type { Vec3 } from './doc'

/**
 * Imported geometry as it is stored inside a project file.
 *
 * Everything a file-born mesh needs is packed into one base64 buffer so a
 * project stays a single JSON document: positions, normals, optional UVs and
 * triangle indices. Skinning is kept in a second buffer (joints + weights) and
 * the bone rest skeleton stays as plain data, which is enough to rebuild the
 * model, its hierarchy and its rig when the project is opened again.
 */
export interface MeshBone {
  name: string
  /** Index of the parent bone in the same array, or -1 for a root bone. */
  parent: number
  /** Rest transform relative to the parent bone (mesh space for roots). */
  position: Vec3
  quaternion: [number, number, number, number]
  scale: Vec3
}

/**
 * Largest packed base-colour image we accept, as data-URL characters. Keeps one
 * texture from turning a project into something no editor can save.
 */
export const MAX_TEXTURE_DATA_URL = 16 * 1024 * 1024

export interface MeshAsset {
  vertices: number
  triangles: number
  hasUv: boolean
  /** base64: positions f32x3, normals f32x3, [UVs f32x2], indices u32x3 */
  data: string
  /** base64: joints u16x4 followed by weights f32x4, one entry per vertex. */
  skin?: string
  /** Bind skeleton, in the mesh's own space. Empty for static meshes. */
  bones?: MeshBone[]
  /**
   * Vertex colours read from the file, as base64 RGB bytes per vertex. The
   * model's own colours (flat per-material colours and glTF COLOR_0) travel
   * with the geometry instead of collapsing to one material colour.
   */
  colors?: string
  /**
   * Base-colour image packed as a `data:image/...` URL, so the model keeps its
   * texture without any file next to the project.
   */
  baseColor?: string
  /** Sampling flip the packed image needs; false for glTF, true (default) otherwise. */
  baseColorFlipY?: boolean
  /** Source format, for the outliner and the AI bridge. */
  format?: string
  /** Original file name. */
  source?: string
}

export interface PackedMesh {
  positions: Float32Array
  normals: Float32Array
  uvs?: Float32Array | null
  indices: Uint32Array
  joints?: Uint16Array | null
  weights?: Float32Array | null
}

export interface DecodedMesh {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array | null
  indices: Uint32Array
  joints: Uint16Array | null
  weights: Float32Array | null
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function base64ToArrayBuffer(text: string): ArrayBuffer {
  const bytes = base64ToBytes(text)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function isTypedArray(value: unknown): value is Float32Array {
  return value instanceof Float32Array
}

/**
 * Packs geometry into the project format. Normals are required so the viewport
 * can light an imported model without recomputing them every sync.
 */
export function packMesh(mesh: PackedMesh): {
  data: string
  skin?: string
  vertices: number
  triangles: number
  hasUv: boolean
} {
  const vertices = mesh.positions.length / 3
  const triangles = Math.floor(mesh.indices.length / 3)
  const hasUv = Boolean(mesh.uvs && isTypedArray(mesh.uvs) && mesh.uvs.length >= vertices * 2)
  if (vertices === 0 || triangles === 0) throw new Error('the model has no triangles')

  const floatCount = vertices * 3 + vertices * 3 + (hasUv ? vertices * 2 : 0)
  const buffer = new ArrayBuffer(floatCount * 4 + mesh.indices.length * 4)
  const view = new DataView(buffer)
  let offset = 0
  const write = (source: Float32Array, count: number) => {
    for (let i = 0; i < count; i += 1) {
      view.setFloat32(offset, source[i] ?? 0, true)
      offset += 4
    }
  }

  write(mesh.positions, vertices * 3)
  write(mesh.normals.length === vertices * 3 ? mesh.normals : new Float32Array(vertices * 3), vertices * 3)
  if (hasUv) write(mesh.uvs as Float32Array, vertices * 2)
  for (let i = 0; i < mesh.indices.length; i += 1) {
    view.setUint32(offset, mesh.indices[i], true)
    offset += 4
  }

  let skin: string | undefined
  if (mesh.joints && mesh.weights && mesh.joints.length >= vertices * 4) {
    const skinBuffer = new ArrayBuffer(vertices * 4 * 2 + vertices * 4 * 4)
    const skinView = new DataView(skinBuffer)
    let skinOffset = 0
    for (let i = 0; i < vertices * 4; i += 1) {
      skinView.setUint16(skinOffset, mesh.joints[i] ?? 0, true)
      skinOffset += 2
    }
    for (let i = 0; i < vertices * 4; i += 1) {
      skinView.setFloat32(skinOffset, mesh.weights[i] ?? 0, true)
      skinOffset += 4
    }
    skin = bytesToBase64(new Uint8Array(skinBuffer))
  }

  return {
    data: bytesToBase64(new Uint8Array(buffer)),
    skin,
    vertices,
    triangles,
    hasUv,
  }
}

export function decodeMesh(asset: MeshAsset): DecodedMesh {
  const vertices = Math.max(0, Math.floor(asset.vertices))
  const triangles = Math.max(0, Math.floor(asset.triangles))
  if (vertices === 0 || triangles === 0) throw new Error('the mesh has no triangles')

  const bytes = base64ToBytes(asset.data)
  const floatCount = vertices * 3 + vertices * 3 + (asset.hasUv ? vertices * 2 : 0)
  const expected = floatCount * 4 + triangles * 3 * 4
  if (bytes.length < expected) throw new Error('the mesh data is truncated')

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0
  const read = (target: Float32Array, count: number) => {
    for (let i = 0; i < count; i += 1) {
      target[i] = view.getFloat32(offset, true)
      offset += 4
    }
  }

  const positions = new Float32Array(vertices * 3)
  const normals = new Float32Array(vertices * 3)
  const uvs = asset.hasUv ? new Float32Array(vertices * 2) : null
  read(positions, vertices * 3)
  read(normals, vertices * 3)
  if (uvs) read(uvs, vertices * 2)

  const indices = new Uint32Array(triangles * 3)
  for (let i = 0; i < indices.length; i += 1) {
    indices[i] = view.getUint32(offset, true)
    offset += 4
  }

  let joints: Uint16Array | null = null
  let weights: Float32Array | null = null
  if (asset.skin) {
    const skinBytes = base64ToBytes(asset.skin)
    if (skinBytes.length >= vertices * 4 * 2 + vertices * 4 * 4) {
      const skinView = new DataView(skinBytes.buffer, skinBytes.byteOffset, skinBytes.byteLength)
      joints = new Uint16Array(vertices * 4)
      weights = new Float32Array(vertices * 4)
      let skinOffset = 0
      for (let i = 0; i < joints.length; i += 1) {
        joints[i] = skinView.getUint16(skinOffset, true)
        skinOffset += 2
      }
      for (let i = 0; i < weights.length; i += 1) {
        weights[i] = skinView.getFloat32(skinOffset, true)
        skinOffset += 4
      }
    }
  }

  return { positions, normals, uvs, indices, joints, weights }
}

export function meshAssetSummary(asset: MeshAsset | undefined): string {
  if (!asset) return ''
  const parts = [`${asset.triangles.toLocaleString()} tris`]
  if (asset.bones?.length) parts.push(`${asset.bones.length} bones`)
  if (asset.baseColor) parts.push('texture')
  if (asset.colors) parts.push('vertex colours')
  if (asset.format) parts.push(asset.format.toUpperCase())
  return parts.join(' · ')
}
