import * as THREE from 'three'
import type { PrimitiveKind } from '../blend/doc'
import { decodeMesh, type MeshAsset } from '../blend/mesh'

function capsuleGeometry(): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(0.5, 1, 8, 20)
}

const cache = new Map<PrimitiveKind, THREE.BufferGeometry>()

/**
 * Shared unit geometry per primitive kind. Callers that change a geometry (the
 * GLB exporter bakes transforms into a clone) must clone it first.
 */
export function primitiveGeometry(kind: PrimitiveKind): THREE.BufferGeometry {
  const cached = cache.get(kind)
  if (cached) return cached

  let geo: THREE.BufferGeometry
  switch (kind) {
    case 'box':
      geo = new THREE.BoxGeometry(1, 1, 1)
      break
    case 'sphere':
      geo = new THREE.SphereGeometry(0.5, 40, 28)
      break
    case 'cylinder':
      geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 36)
      break
    case 'capsule':
      geo = capsuleGeometry()
      break
    case 'cone':
      geo = new THREE.ConeGeometry(0.5, 1, 36)
      break
    case 'torus':
      geo = new THREE.TorusGeometry(0.42, 0.14, 20, 40)
      geo.rotateX(-Math.PI / 2)
      break
    case 'plane':
      geo = new THREE.PlaneGeometry(1, 1)
      geo.rotateX(-Math.PI / 2)
      break
    default:
      geo = new THREE.BoxGeometry(1, 1, 1)
  }
  cache.set(kind, geo)
  return geo
}

/** Rebuilds an imported model's geometry from the project payload. */
export function meshGeometry(asset: MeshAsset): THREE.BufferGeometry {
  const decoded = decodeMesh(asset)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(decoded.positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(decoded.normals, 3))
  if (decoded.uvs) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(decoded.uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(decoded.indices, 1))
  if (decoded.joints && decoded.weights) {
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(decoded.joints, 4))
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(decoded.weights, 4))
  }
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
