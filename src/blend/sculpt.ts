/**
 * Sculpt engine: dense mesh data, subdivision and the brush kernels.
 *
 * Everything here is plain typed arrays with no three.js and no DOM, so the
 * viewport can run a stroke on a buffer and the same code can be reasoned about
 * (and tested) on its own.
 */

export type SculptBrushId =
  | 'draw'
  | 'clay'
  | 'smooth'
  | 'flatten'
  | 'inflate'
  | 'pinch'
  | 'crease'
  | 'grab'

export const SCULPT_BRUSHES: { id: SculptBrushId; label: string; hint: string }[] = [
  { id: 'draw', label: 'Draw', hint: 'Push the surface out along the cursor normal' },
  { id: 'clay', label: 'Clay', hint: 'Build up material, then level it into the brush plane' },
  { id: 'smooth', label: 'Smooth', hint: 'Relax vertices towards their neighbours' },
  { id: 'flatten', label: 'Flatten', hint: 'Pull the surface flat onto the brush plane' },
  { id: 'inflate', label: 'Inflate', hint: 'Grow the surface along each vertex normal' },
  { id: 'pinch', label: 'Pinch', hint: 'Squeeze the surface together towards the cursor' },
  { id: 'crease', label: 'Crease', hint: 'Pinch and press in to cut a sharp ridge' },
  { id: 'grab', label: 'Grab', hint: 'Drag the surface along with the cursor' },
]

export interface SculptSymmetry {
  /** Master switch, like Blender's Symmetry tick box: off means no mirroring. */
  enabled: boolean
  x: boolean
  y: boolean
  z: boolean
}

export interface SculptMeshData {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  uvs: Float32Array | null
}

/** One ring of neighbour vertices per vertex, in compressed row form. */
export interface NeighborTable {
  offsets: Uint32Array
  list: Uint32Array
}

/** A part denser than this stops subdividing: a stroke has to stay interactive. */
export const MAX_SCULPT_VERTICES = 60000

/** Triangles a freshly converted part is subdivided towards before sculpting. */
export const SCULPT_TARGET_TRIANGLES = 6000

/** Smoothstep: soft brush edge, hard centre, like Blender's default falloff. */
export function falloff(t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t
  return x * x * (3 - 2 * x)
}

/**
 * Merges vertices that share a position. Primitive geometry duplicates vertices
 * along UV and normal seams; sculpting those separately would tear the surface
 * apart, so the seams are welded before a part becomes sculptable.
 */
export function weldMesh(
  positions: Float32Array,
  uvs: Float32Array | null,
  indices: Uint32Array,
): { positions: Float32Array; uvs: Float32Array | null; indices: Uint32Array } {
  const count = positions.length / 3
  const remap = new Uint32Array(count)
  const lookup = new Map<string, number>()
  const outPositions: number[] = []
  const outUvs: number[] = []

  for (let i = 0; i < count; i += 1) {
    const x = positions[i * 3]
    const y = positions[i * 3 + 1]
    const z = positions[i * 3 + 2]
    const key = `${Math.round(x * 100000)},${Math.round(y * 100000)},${Math.round(z * 100000)}`
    let index = lookup.get(key)
    if (index === undefined) {
      index = outPositions.length / 3
      lookup.set(key, index)
      outPositions.push(x, y, z)
      if (uvs) outUvs.push(uvs[i * 2], uvs[i * 2 + 1])
    }
    remap[i] = index
  }

  const outIndices = new Uint32Array(indices.length)
  for (let i = 0; i < indices.length; i += 1) outIndices[i] = remap[indices[i]]

  return {
    positions: Float32Array.from(outPositions),
    uvs: uvs ? Float32Array.from(outUvs) : null,
    indices: outIndices,
  }
}

/**
 * Splits every triangle into four, sharing midpoints between neighbours so the
 * surface stays welded. UVs are interpolated, which keeps a mapped picture on a
 * body part roughly in place after the part becomes sculptable.
 */
export function subdivideMesh(
  mesh: SculptMeshData,
  levels: number,
  maxVertices = MAX_SCULPT_VERTICES,
): SculptMeshData {
  let positions = mesh.positions
  let uvs = mesh.uvs
  let indices = mesh.indices

  for (let level = 0; level < Math.max(0, levels); level += 1) {
    if (positions.length / 3 >= maxVertices) break
    const sourceUvs = uvs
    const midpoints = new Map<number, number>()
    const nextPositions: number[] = Array.from(positions)
    const nextUvs: number[] | null = sourceUvs ? Array.from(sourceUvs) : null
    const triangles = Math.floor(indices.length / 3)
    const nextIndices = new Uint32Array(triangles * 12)

    const midpoint = (a: number, b: number): number => {
      const lo = Math.min(a, b)
      const hi = Math.max(a, b)
      const key = lo * 4000000 + hi
      const cached = midpoints.get(key)
      if (cached !== undefined) return cached
      const index = nextPositions.length / 3
      midpoints.set(key, index)
      nextPositions.push(
        (positions[lo * 3] + positions[hi * 3]) / 2,
        (positions[lo * 3 + 1] + positions[hi * 3 + 1]) / 2,
        (positions[lo * 3 + 2] + positions[hi * 3 + 2]) / 2,
      )
      if (nextUvs && sourceUvs) {
        nextUvs.push(
          (sourceUvs[lo * 2] + sourceUvs[hi * 2]) / 2,
          (sourceUvs[lo * 2 + 1] + sourceUvs[hi * 2 + 1]) / 2,
        )
      }
      return index
    }

    let out = 0
    for (let t = 0; t < triangles; t += 1) {
      const a = indices[t * 3]
      const b = indices[t * 3 + 1]
      const c = indices[t * 3 + 2]
      const ab = midpoint(a, b)
      const bc = midpoint(b, c)
      const ca = midpoint(c, a)
      nextIndices[out++] = a
      nextIndices[out++] = ab
      nextIndices[out++] = ca
      nextIndices[out++] = ab
      nextIndices[out++] = b
      nextIndices[out++] = bc
      nextIndices[out++] = ca
      nextIndices[out++] = bc
      nextIndices[out++] = c
      nextIndices[out++] = ab
      nextIndices[out++] = bc
      nextIndices[out++] = ca
    }

    positions = Float32Array.from(nextPositions)
    uvs = nextUvs ? Float32Array.from(nextUvs) : null
    indices = nextIndices
  }

  return { positions, uvs, indices, normals: computeVertexNormals(positions, indices) }
}

/** Area-weighted smooth vertex normals, written into `target` when it fits. */
export function computeVertexNormals(
  positions: Float32Array,
  indices: Uint32Array,
  target?: Float32Array,
): Float32Array {
  const count = positions.length / 3
  const normals = target && target.length >= count * 3 ? target : new Float32Array(count * 3)
  normals.fill(0)

  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3
    const b = indices[i + 1] * 3
    const c = indices[i + 2] * 3
    const abx = positions[b] - positions[a]
    const aby = positions[b + 1] - positions[a + 1]
    const abz = positions[b + 2] - positions[a + 2]
    const acx = positions[c] - positions[a]
    const acy = positions[c + 1] - positions[a + 1]
    const acz = positions[c + 2] - positions[a + 2]
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx
    normals[a] += nx
    normals[a + 1] += ny
    normals[a + 2] += nz
    normals[b] += nx
    normals[b + 1] += ny
    normals[b + 2] += nz
    normals[c] += nx
    normals[c + 1] += ny
    normals[c + 2] += nz
  }

  for (let i = 0; i < count; i += 1) {
    const x = normals[i * 3]
    const y = normals[i * 3 + 1]
    const z = normals[i * 3 + 2]
    const length = Math.hypot(x, y, z)
    if (length > 1e-9) {
      normals[i * 3] = x / length
      normals[i * 3 + 1] = y / length
      normals[i * 3 + 2] = z / length
    } else {
      normals[i * 3] = 0
      normals[i * 3 + 1] = 1
      normals[i * 3 + 2] = 0
    }
  }
  return normals
}

/** Vertex adjacency used by Smooth; built once per mesh, then reused. */
export function buildNeighbors(indices: Uint32Array, vertexCount: number): NeighborTable {
  const degree = new Uint32Array(vertexCount)
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]
    const b = indices[i + 1]
    const c = indices[i + 2]
    degree[a] += 2
    degree[b] += 2
    degree[c] += 2
  }
  const offsets = new Uint32Array(vertexCount + 1)
  for (let i = 0; i < vertexCount; i += 1) offsets[i + 1] = offsets[i] + degree[i]
  const list = new Uint32Array(offsets[vertexCount])
  const cursor = new Uint32Array(offsets)
  const push = (from: number, to: number) => {
    list[cursor[from]] = to
    cursor[from] += 1
  }
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]
    const b = indices[i + 1]
    const c = indices[i + 2]
    push(a, b)
    push(a, c)
    push(b, a)
    push(b, c)
    push(c, a)
    push(c, b)
  }
  return { offsets, list }
}

export interface SculptStroke {
  brush: SculptBrushId
  /** Brush centre in the mesh's local space. */
  center: [number, number, number]
  /** Surface normal under the cursor, in local space. */
  normal: [number, number, number]
  /** Local-space drag for the Grab brush. */
  delta: [number, number, number]
  radius: number
  strength: number
  invert: boolean
  symmetry: SculptSymmetry
  neighbors: NeighborTable
}

interface MirrorStroke {
  center: [number, number, number]
  normal: [number, number, number]
  delta: [number, number, number]
}

/** The stroke plus one copy per enabled symmetry axis combination. */
function mirrorStrokes(stroke: SculptStroke): MirrorStroke[] {
  const axes: number[] = []
  if (stroke.symmetry.enabled) {
    if (stroke.symmetry.x) axes.push(0)
    if (stroke.symmetry.y) axes.push(1)
    if (stroke.symmetry.z) axes.push(2)
  }
  const strokes: MirrorStroke[] = []
  const combinations = 1 << axes.length
  for (let mask = 0; mask < combinations; mask += 1) {
    const center: [number, number, number] = [...stroke.center]
    const normal: [number, number, number] = [...stroke.normal]
    const delta: [number, number, number] = [...stroke.delta]
    for (let bit = 0; bit < axes.length; bit += 1) {
      if ((mask & (1 << bit)) === 0) continue
      const axis = axes[bit]
      center[axis] = -center[axis]
      normal[axis] = -normal[axis]
      delta[axis] = -delta[axis]
    }
    strokes.push({ center, normal, delta })
  }
  return strokes
}

/**
 * Applies one brush dab, mutating `mesh.positions` in place.
 * Returns how many vertices moved, so the caller can skip a normal rebuild.
 */
export function applyStroke(mesh: SculptMeshData, stroke: SculptStroke): number {
  const radius = Math.max(1e-4, stroke.radius)
  const strength = Math.min(1, Math.max(0, stroke.strength))
  if (strength <= 0) return 0

  const { positions, normals } = mesh
  const neighbors = stroke.neighbors
  const count = positions.length / 3
  const radiusSquared = radius * radius
  const sign = stroke.invert ? -1 : 1
  let moved = 0

  for (const mirror of mirrorStrokes(stroke)) {
    const [cx, cy, cz] = mirror.center
    const [nx, ny, nz] = mirror.normal
    const [dx, dy, dz] = mirror.delta

    for (let i = 0; i < count; i += 1) {
      const i3 = i * 3
      const px = positions[i3]
      const py = positions[i3 + 1]
      const pz = positions[i3 + 2]
      const ox = px - cx
      const oy = py - cy
      const oz = pz - cz
      const distanceSquared = ox * ox + oy * oy + oz * oz
      if (distanceSquared > radiusSquared) continue

      const weight = falloff(1 - Math.sqrt(distanceSquared) / radius)
      if (weight <= 0) continue
      const amount = strength * radius * weight
      // Height above the brush plane, measured along the stroke normal.
      const height = ox * nx + oy * ny + oz * nz
      let mx = 0
      let my = 0
      let mz = 0

      switch (stroke.brush) {
        case 'draw': {
          const push = amount * 0.55 * sign
          mx = nx * push
          my = ny * push
          mz = nz * push
          break
        }
        case 'clay': {
          // Build up material, then pull the bump back towards the plane so the
          // result reads as pressed clay rather than a spike.
          const push = amount * 0.4 * sign
          const level = height * weight * 0.35
          mx = nx * push - nx * level
          my = ny * push - ny * level
          mz = nz * push - nz * level
          break
        }
        case 'inflate': {
          const push = amount * 0.5 * sign
          mx = normals[i3] * push
          my = normals[i3 + 1] * push
          mz = normals[i3 + 2] * push
          break
        }
        case 'smooth': {
          const start = neighbors.offsets[i]
          const end = neighbors.offsets[i + 1]
          if (end > start) {
            let ax = 0
            let ay = 0
            let az = 0
            for (let n = start; n < end; n += 1) {
              const j = neighbors.list[n] * 3
              ax += positions[j]
              ay += positions[j + 1]
              az += positions[j + 2]
            }
            const total = end - start
            const pull = weight * strength
            mx = (ax / total - px) * pull
            my = (ay / total - py) * pull
            mz = (az / total - pz) * pull
          }
          break
        }
        case 'flatten': {
          const pull = height * weight * strength
          mx = -nx * pull
          my = -ny * pull
          mz = -nz * pull
          break
        }
        case 'pinch': {
          // Only the tangential part of the pull, so the surface does not move
          // towards the camera while it tightens.
          const pull = weight * strength * 0.65
          mx = (-ox + nx * height) * pull
          my = (-oy + ny * height) * pull
          mz = (-oz + nz * height) * pull
          break
        }
        case 'crease': {
          const pull = weight * strength * 0.6
          const press = amount * 0.3 * (stroke.invert ? 1 : -1)
          mx = (-ox + nx * height) * pull + nx * press
          my = (-oy + ny * height) * pull + ny * press
          mz = (-oz + nz * height) * pull + nz * press
          break
        }
        case 'grab': {
          mx = dx * weight
          my = dy * weight
          mz = dz * weight
          break
        }
      }

      positions[i3] = px + mx
      positions[i3 + 1] = py + my
      positions[i3 + 2] = pz + mz
      moved += 1
    }
  }

  return moved
}
