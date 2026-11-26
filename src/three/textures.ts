import * as THREE from 'three'
import { bytesToBase64, MAX_TEXTURE_DATA_URL, type MeshAsset } from '../blend/mesh'

/**
 * Base-colour images travel inside the project as `data:` URLs, next to the
 * packed geometry, so a project stays one self-contained document and a
 * textured model does not turn white when its image file is gone.
 *
 * Two ways in:
 * - glTF/GLB: the image bytes are copied straight out of the container, so the
 *   packed copy is the authored file byte for byte (no canvas, no re-encode).
 * - FBX, Collada and friends: the decoded image is rasterized once and shared
 *   by every mesh that uses the same material.
 */
export interface PackedTexture {
  /** `data:image/...;base64,...` */
  url: string
  /** Sampling flip the source material relied on: false for glTF, true otherwise. */
  flipY: boolean
}

/** Rasterized images are capped in size; textures above this edge are rare. */
const MAX_TEXTURE_EDGE = 2048

type Json = Record<string, unknown>

const asJson = (value: unknown): Json | null =>
  value && typeof value === 'object' ? (value as Json) : null
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined
const asIndex = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined

// ------------------------------------------------------------------ glTF
interface GlbChunks {
  json: Json
  bin: ArrayBuffer | null
}

/** Splits a GLB container into its JSON and BIN chunks. */
function glbChunks(buffer: ArrayBuffer): GlbChunks | null {
  if (buffer.byteLength < 20) return null
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== 0x46546c67) return null

  let json: Json | null = null
  let bin: ArrayBuffer | null = null
  let offset = 12
  while (offset + 8 <= buffer.byteLength) {
    const length = view.getUint32(offset, true)
    const type = view.getUint32(offset + 4, true)
    const start = offset + 8
    if (start + length > buffer.byteLength) break
    if (type === 0x4e4f534a) {
      try {
        json = asJson(JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length))))
      } catch {
        return null
      }
    } else if (type === 0x004e4942) {
      bin = buffer.slice(start, start + length)
    }
    offset = start + length + ((4 - (length % 4)) % 4)
  }
  return json ? { json, bin } : null
}

function imageMime(bytes: Uint8Array, declared: unknown): string {
  if (typeof declared === 'string' && declared.startsWith('image/')) return declared
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/webp'
  return 'image/png'
}

function encodeImage(bytes: Uint8Array, declared?: unknown): string | undefined {
  if (bytes.length === 0) return undefined
  const url = `data:${imageMime(bytes, declared)};base64,${bytesToBase64(bytes)}`
  return url.length > MAX_TEXTURE_DATA_URL ? undefined : url
}

function baseColorTextureIndex(material: Json): number | undefined {
  const pbr = asJson(material.pbrMetallicRoughness)
  const baseColor = asIndex(asJson(pbr?.baseColorTexture)?.index)
  if (baseColor !== undefined) return baseColor
  const extensions = asJson(material.extensions)
  const specular = asJson(extensions?.KHR_materials_pbrSpecularGlossiness)
  return asIndex(asJson(specular?.diffuseTexture)?.index)
}

function packImage(json: Json, imageIndex: number, bin: ArrayBuffer | null): PackedTexture | null {
  const image = asJson(asArray(json.images)[imageIndex])
  if (!image) return null

  const uri = asString(image.uri)
  if (uri) {
    // A `.gltf` can carry its image inline; external paths are left alone
    // because the file next to the model was never opened.
    if (!uri.startsWith('data:image/') || uri.length > MAX_TEXTURE_DATA_URL) return null
    return { url: uri, flipY: false }
  }

  const bufferViewIndex = asIndex(image.bufferView)
  if (bufferViewIndex === undefined || !bin) return null
  const view = asJson(asArray(json.bufferViews)[bufferViewIndex])
  if (!view) return null
  const start = asIndex(view.byteOffset) ?? 0
  const length = asIndex(view.byteLength)
  if (length === undefined || length === 0 || start + length > bin.byteLength) return null
  const url = encodeImage(new Uint8Array(bin, start, length), image.mimeType)
  // glTF images are stored top-down, so they sample with flipY = false.
  return url ? { url, flipY: false } : null
}

/**
 * Base-colour image per glTF material index, read straight from the document.
 * Only materials that actually reference a base-colour texture appear.
 */
export function gltfBaseColorTextures(
  json: Json,
  bin: ArrayBuffer | null,
): Map<number, PackedTexture> {
  const textures = new Map<number, PackedTexture>()
  // One image is usually shared by every material of a character; encode once.
  const images = new Map<number, PackedTexture | null>()

  asArray(json.materials).forEach((raw, materialIndex) => {
    const material = asJson(raw)
    if (!material) return
    const textureIndex = baseColorTextureIndex(material)
    if (textureIndex === undefined) return
    const textureDef = asJson(asArray(json.textures)[textureIndex])
    const imageIndex = asIndex(textureDef?.source)
    if (imageIndex === undefined) return
    if (!images.has(imageIndex)) images.set(imageIndex, packImage(json, imageIndex, bin))
    const packed = images.get(imageIndex)
    if (packed) textures.set(materialIndex, packed)
  })

  return textures
}

export function glbBaseColorTextures(buffer: ArrayBuffer): Map<number, PackedTexture> {
  const chunks = glbChunks(buffer)
  return chunks ? gltfBaseColorTextures(chunks.json, chunks.bin) : new Map()
}

export function gltfTextBaseColorTextures(text: string): Map<number, PackedTexture> {
  try {
    const json = asJson(JSON.parse(text))
    return json ? gltfBaseColorTextures(json, null) : new Map()
  } catch {
    return new Map()
  }
}

// ------------------------------------------------- loaded engine textures
interface RasterImage {
  src?: string
  width?: number
  height?: number
  naturalWidth?: number
  naturalHeight?: number
}

const rasterized = new Map<string, PackedTexture | null>()

/**
 * Packs the base-colour map of a loaded material. Images that are already data
 * URLs are copied as they are; anything else is drawn once into a canvas, so an
 * FBX or Collada model keeps the texture it shipped with.
 */
export function packedTextureFromMaterial(
  texture: THREE.Texture | null | undefined,
): PackedTexture | undefined {
  if (!texture) return undefined
  const cached = rasterized.get(texture.uuid)
  if (cached !== undefined) return cached ?? undefined
  const packed = rasterize(texture)
  rasterized.set(texture.uuid, packed ?? null)
  return packed
}

function rasterize(texture: THREE.Texture): PackedTexture | undefined {
  const image = texture.image as unknown
  if (!image || typeof image !== 'object') return undefined
  const source = image as RasterImage
  const flipY = texture.flipY !== false

  if (typeof source.src === 'string' && source.src.startsWith('data:image/')) {
    if (source.src.length > MAX_TEXTURE_DATA_URL) return undefined
    return { url: source.src, flipY }
  }

  if (typeof document === 'undefined') return undefined
  const width = source.naturalWidth ?? source.width ?? 0
  const height = source.naturalHeight ?? source.height ?? 0
  if (!(width > 0) || !(height > 0)) return undefined

  try {
    const scale = Math.min(1, MAX_TEXTURE_EDGE / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) return undefined
    context.drawImage(image as CanvasImageSource, 0, 0, canvas.width, canvas.height)

    let hasAlpha = false
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] < 250) {
        hasAlpha = true
        break
      }
    }

    const url = canvas.toDataURL(hasAlpha ? 'image/png' : 'image/jpeg', 0.92)
    if (url.length > MAX_TEXTURE_DATA_URL) return undefined
    return { url, flipY }
  } catch {
    // Cross-origin or otherwise unreadable image: the mesh keeps its colour.
    return undefined
  }
}

// -------------------------------------------------------------- rendering
const flipped = new Map<string, THREE.Texture>()
const unflipped = new Map<string, THREE.Texture>()
const loading = new Map<THREE.Texture, Promise<THREE.Texture>>()
const loader = new THREE.ImageLoader()

// Decoded images are shared: a picture mapped onto several parts is fetched
// once, while each part still owns its own texture (its own repeat/offset).
const images = new Map<string, HTMLImageElement>()
const failedImages = new Set<string>()
const imageWaiters = new Map<string, Array<(image: HTMLImageElement | null) => void>>()
const imageRequests = new Map<string, Promise<HTMLImageElement | null>>()

function settleImage(url: string, image: HTMLImageElement | null) {
  if (image) images.set(url, image)
  else failedImages.add(url)
  for (const waiter of imageWaiters.get(url) ?? []) waiter(image)
  imageWaiters.delete(url)
  imageRequests.delete(url)
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  const cached = images.get(url)
  if (cached) return Promise.resolve(cached)
  const started = imageRequests.get(url)
  if (started) return started

  const request = new Promise<HTMLImageElement | null>((resolve) => {
    loader.load(
      url,
      (image) => {
        settleImage(url, image as HTMLImageElement)
        resolve(image as HTMLImageElement)
      },
      undefined,
      // A broken image leaves the material on its base colour.
      () => {
        settleImage(url, null)
        resolve(null)
      },
    )
  })
  imageRequests.set(url, request)
  return request
}

/**
 * Shared texture for a packed image, created immediately and filled in when the
 * image decodes. Every mesh using the same image shares one GPU texture.
 */
export function textureFor(url: string, flipY = true): THREE.Texture {
  const cache = flipY ? flipped : unflipped
  const cached = cache.get(url)
  if (cached) return cached

  const texture = new THREE.Texture()
  texture.name = 'Base colour'
  texture.flipY = flipY
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  cache.set(url, texture)
  loading.set(
    texture,
    loadImage(url).then((image) => {
      if (image) {
        texture.image = image
        texture.needsUpdate = true
      }
      return texture
    }),
  )
  return texture
}

/**
 * A texture owned by one body part, sharing the decoded image with every other
 * user of the same picture. Repeat and offset are per texture, so each part can
 * scale the picture independently without re-uploading it.
 */
export function textureInstance(url: string, flipY = true): THREE.Texture {
  const texture = new THREE.Texture()
  texture.name = 'Part picture'
  texture.flipY = flipY
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping

  const apply = (image: HTMLImageElement | null) => {
    if (!image) return
    texture.image = image
    texture.needsUpdate = true
  }

  const cached = images.get(url)
  if (cached) {
    apply(cached)
  } else if (!failedImages.has(url)) {
    const waiters = imageWaiters.get(url) ?? []
    waiters.push(apply)
    imageWaiters.set(url, waiters)
    void loadImage(url)
  }
  return texture
}

/** Waits for every picture the export scene will reference. */
export async function preloadPictures(urls: string[]): Promise<void> {
  await Promise.all(urls.map((url) => loadImage(url)))
}

export function textureForAsset(asset: MeshAsset | undefined): THREE.Texture | undefined {
  if (!asset?.baseColor) return undefined
  return textureFor(asset.baseColor, asset.baseColorFlipY !== false)
}

/** Waits for every packed texture the export scene will reference. */
export async function preloadAssetTextures(
  assets: Array<MeshAsset | undefined>,
): Promise<void> {
  const pending = new Set<Promise<THREE.Texture>>()
  const queue = (url: string | undefined, flipY: unknown) => {
    if (!url) return
    const texture = textureFor(url, flipY !== false)
    const promise = loading.get(texture)
    if (promise) pending.add(promise)
  }
  for (const asset of assets) {
    if (!asset) continue
    queue(asset.baseColor, asset.baseColorFlipY)
    for (const material of asset.materials ?? []) {
      queue(material.baseColor, material.baseColorFlipY)
    }
  }
  await Promise.all(pending)
}

export function disposeTextures(): void {
  for (const texture of [...flipped.values(), ...unflipped.values()]) texture.dispose()
  flipped.clear()
  unflipped.clear()
  loading.clear()
  images.clear()
  failedImages.clear()
  imageWaiters.clear()
  imageRequests.clear()
}
