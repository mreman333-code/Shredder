import { base64ToBytes, bytesToBase64 } from './mesh'
import { falloff } from './sculpt'

/**
 * Surface painting: a model's colours live in one 8-bit RGB triple per vertex,
 * and a "surface part" is one connected piece of the mesh. Selecting a part and
 * filling it is the equivalent of Blender's face-island select plus fill.
 *
 * Colours are stored linearly, which is what three's vertex-colour attribute
 * and glTF's COLOR_0 both expect, so a painted model looks the same in the
 * viewport and after export.
 */

export type PaintTool = 'part' | 'brush'

export interface PaintLayer {
  /** base64: one linear RGB triple per vertex. */
  colors: string
  vertices: number
}

export interface SurfacePart {
  /** Triangles in this connected piece of surface. */
  triangles: number
  /** First triangle of the part, in index order. */
  first: number
}

export interface SurfaceParts {
  /** Part index per triangle. */
  facePart: Uint32Array
  parts: SurfacePart[]
}

/** One project can hold a lot of paint, but not without bound. */
export const MAX_PAINT_VERTICES = 150000

const srgbToLinear = (value: number): number =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4

/** A `#rrggbb` colour as the linear 0–255 triple a vertex buffer wants. */
export function hexColorBytes(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return [255, 255, 255]
  const value = Number.parseInt(match[1], 16)
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255]
  return channels.map((channel) =>
    Math.round(srgbToLinear(channel / 255) * 255),
  ) as [number, number, number]
}

export function packPaintColors(colors: Uint8Array): string {
  return bytesToBase64(colors)
}

/** The stored bytes for a layer, or null when they do not fit this mesh. */
export function decodePaintColors(
  layer: PaintLayer | undefined,
  vertices: number,
): Uint8Array | null {
  if (!layer || layer.vertices !== vertices || vertices <= 0) return null
  try {
    const bytes = base64ToBytes(layer.colors)
    if (bytes.length !== vertices * 3) return null
    return new Uint8Array(bytes)
  } catch {
    return null
  }
}

export function solidColors(vertices: number, rgb: [number, number, number]): Uint8Array {
  const colors = new Uint8Array(vertices * 3)
  for (let i = 0; i < vertices; i += 1) {
    colors[i * 3] = rgb[0]
    colors[i * 3 + 1] = rgb[1]
    colors[i * 3 + 2] = rgb[2]
  }
  return colors
}

/**
 * Splits a mesh into connected surface parts. Vertices are joined by position,
 * so UV and normal seams do not cut a surface into pieces: a cube stays one
 * part, while two cubes that touch nowhere stay two.
 */
export function surfaceParts(positions: Float32Array, indices: Uint32Array): SurfaceParts {
  const vertices = Math.floor(positions.length / 3)
  const triangles = Math.floor(indices.length / 3)
  const parent = new Int32Array(vertices)
  for (let i = 0; i < vertices; i += 1) parent[i] = i

  const find = (start: number): number => {
    let current = start
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]]
      current = parent[current]
    }
    return current
  }
  const union = (a: number, b: number) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent[rootB] = rootA
  }

  const seen = new Map<string, number>()
  for (let i = 0; i < vertices; i += 1) {
    const key = `${Math.round(positions[i * 3] * 100000)},${Math.round(
      positions[i * 3 + 1] * 100000,
    )},${Math.round(positions[i * 3 + 2] * 100000)}`
    const first = seen.get(key)
    if (first === undefined) seen.set(key, i)
    else if (first !== i) union(first, i)
  }

  // Join the vertices of every triangle first: two triangles that share an
  // edge belong to the same surface, even when their corners are different
  // vertex indices (UV seams are welded by position above).
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const a = indices[triangle * 3]
    const b = indices[triangle * 3 + 1]
    const c = indices[triangle * 3 + 2]
    union(a, b)
    union(b, c)
  }

  const facePart = new Uint32Array(triangles)
  const partOfRoot = new Map<number, number>()
  const parts: SurfacePart[] = []
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const root = find(indices[triangle * 3])
    let part = partOfRoot.get(root)
    if (part === undefined) {
      part = parts.length
      partOfRoot.set(root, part)
      parts.push({ triangles: 0, first: triangle })
    }
    facePart[triangle] = part
    parts[part].triangles += 1
  }
  return { facePart, parts }
}

/** Paints every triangle of one surface part and returns how many it filled. */
export function fillSurfacePart(
  indices: Uint32Array,
  surface: SurfaceParts,
  part: number,
  colors: Uint8Array,
  rgb: [number, number, number],
): number {
  const triangles = surface.facePart.length
  let filled = 0
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    if (surface.facePart[triangle] !== part) continue
    filled += 1
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = indices[triangle * 3 + corner]
      const offset = vertex * 3
      colors[offset] = rgb[0]
      colors[offset + 1] = rgb[1]
      colors[offset + 2] = rgb[2]
    }
  }
  return filled
}

/** Soft round dab, the paint counterpart of a sculpt stroke. */
export function paintDab(
  colors: Uint8Array,
  positions: Float32Array,
  center: [number, number, number],
  radius: number,
  rgb: [number, number, number],
  strength: number,
): number {
  const safeRadius = Math.max(1e-4, radius)
  const limit = safeRadius * safeRadius
  const amount = Math.min(1, Math.max(0, strength))
  const [cx, cy, cz] = center
  const vertices = Math.floor(colors.length / 3)
  let painted = 0
  for (let i = 0; i < vertices; i += 1) {
    const i3 = i * 3
    const dx = positions[i3] - cx
    const dy = positions[i3 + 1] - cy
    const dz = positions[i3 + 2] - cz
    const distance = dx * dx + dy * dy + dz * dz
    if (distance > limit) continue
    const weight = falloff(1 - Math.sqrt(distance) / safeRadius) * amount
    if (weight <= 0.002) continue
    colors[i3] = Math.round(colors[i3] + (rgb[0] - colors[i3]) * weight)
    colors[i3 + 1] = Math.round(colors[i3 + 1] + (rgb[1] - colors[i3 + 1]) * weight)
    colors[i3 + 2] = Math.round(colors[i3 + 2] + (rgb[2] - colors[i3 + 2]) * weight)
    painted += 1
  }
  return painted
}
