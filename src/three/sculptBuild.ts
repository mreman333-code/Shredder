import * as THREE from 'three'
import type { PrimitiveKind, SceneObject } from '../blend/doc'
import { decodeMesh, packMesh, type MeshAsset } from '../blend/mesh'
import {
  MAX_SCULPT_VERTICES,
  SCULPT_TARGET_TRIANGLES,
  computeVertexNormals,
  subdivideMesh,
  weldMesh,
  type SculptMeshData,
} from '../blend/sculpt'
import { primitiveGeometry } from './geometry'

/** Reads a three geometry into plain sculpt data. */
function dataFromGeometry(geometry: THREE.BufferGeometry): SculptMeshData {
  const position = geometry.getAttribute('position')
  if (!position) throw new Error('the mesh has no vertices')
  const positions = Float32Array.from(position.array as ArrayLike<number>)
  const uv = geometry.getAttribute('uv')
  const uvs = uv ? Float32Array.from(uv.array as ArrayLike<number>) : null
  const index = geometry.getIndex()
  let indices: Uint32Array
  if (index) {
    indices = new Uint32Array(index.array as ArrayLike<number>)
  } else {
    indices = new Uint32Array(position.count)
    for (let i = 0; i < indices.length; i += 1) indices[i] = i
  }
  return { positions, uvs, indices, normals: new Float32Array(positions.length) }
}

/**
 * Welds the seams and subdivides until the surface has enough vertices to hold
 * a brush stroke. A cube needs four levels to become an editable lump; a sphere
 * is already dense enough after one.
 */
function makeSculptable(data: SculptMeshData, target: number): SculptMeshData {
  const welded = weldMesh(data.positions, data.uvs, data.indices)
  let mesh: SculptMeshData = {
    positions: welded.positions,
    uvs: welded.uvs,
    indices: welded.indices,
    normals: new Float32Array(welded.positions.length),
  }
  let levels = 0
  while (
    mesh.indices.length / 3 < target &&
    levels < 5 &&
    mesh.positions.length / 3 < MAX_SCULPT_VERTICES
  ) {
    mesh = subdivideMesh(mesh, 1, MAX_SCULPT_VERTICES)
    levels += 1
  }
  mesh.normals = computeVertexNormals(mesh.positions, mesh.indices)
  return mesh
}

export function sculptDataForPrimitive(
  kind: PrimitiveKind,
  target = SCULPT_TARGET_TRIANGLES,
): SculptMeshData {
  const geometry = primitiveGeometry(kind)
  try {
    return makeSculptable(dataFromGeometry(geometry), target)
  } finally {
    // primitiveGeometry returns shared geometry: never dispose it here.
  }
}

export function sculptDataForAsset(
  asset: MeshAsset,
  target = SCULPT_TARGET_TRIANGLES,
): SculptMeshData {
  const decoded = decodeMesh(asset)
  // An imported model can already be dense; subdividing it would only cost
  // memory, so the target is capped by what the file already has.
  const existing = Math.floor(decoded.indices.length / 3)
  return makeSculptable(
    {
      positions: decoded.positions,
      normals: decoded.normals,
      indices: decoded.indices,
      uvs: decoded.uvs,
    },
    Math.min(target, existing),
  )
}

/** Packs sculpt data back into the project's mesh format. */
export function sculptAssetFromData(data: SculptMeshData, base?: Partial<MeshAsset>): MeshAsset {
  const packed = packMesh({
    positions: data.positions,
    normals: data.normals,
    indices: data.indices,
    uvs: data.uvs,
  })
  return {
    ...(base ?? {}),
    ...packed,
    skin: undefined,
    bones: undefined,
    format: base?.format ?? 'sculpt',
  }
}

/**
 * A part's own geometry, ready for the brush. Primitives are subdivided from
 * their unit shape; a static imported mesh is adopted as it is.
 */
export function buildSculptAsset(
  object: SceneObject,
  target = SCULPT_TARGET_TRIANGLES,
): MeshAsset {
  if (object.mesh && !object.mesh.bones?.length) {
    return sculptAssetFromData(sculptDataForAsset(object.mesh, target), object.mesh)
  }
  return sculptAssetFromData(sculptDataForPrimitive(object.kind, target), {
    format: `${object.kind}-sculpt`,
    source: object.name,
  })
}

export function sculptGeometry(data: SculptMeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
  if (data.uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export function sculptGeometryFromAsset(asset: MeshAsset): THREE.BufferGeometry {
  const decoded = decodeMesh(asset)
  return sculptGeometry({
    positions: decoded.positions,
    normals: decoded.normals,
    indices: decoded.indices,
    uvs: decoded.uvs,
  })
}
