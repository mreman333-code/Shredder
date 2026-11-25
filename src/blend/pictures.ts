/** Common picture types accepted for body-part mapping. */
export const PICTURE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']

export const PICTURE_ACCEPT = `${PICTURE_EXTENSIONS.join(',')},image/*`

/**
 * Pictures are packed into the project as data URLs, so they are kept well
 * inside the texture limit the project format enforces.
 */
const MAX_PICTURE_CHARS = 8 * 1024 * 1024
const MAX_SOURCE_BYTES = 40 * 1024 * 1024
const MAX_EDGE = 2048

export function isPictureFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  const name = file.name.toLowerCase()
  return PICTURE_EXTENSIONS.some((extension) => name.endsWith(extension))
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('Could not read that picture'))
    reader.readAsDataURL(file)
  })
}

function decode(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('That file is not a readable image'))
    image.src = url
  })
}

function hasAlpha(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) return true
  }
  return false
}

/**
 * Shrinks an oversized picture until it fits the project budget. PNG and GIF
 * sources keep transparency; photos are re-encoded as JPEG.
 */
async function shrink(url: string, type: string): Promise<string> {
  const image = await decode(url)
  const keepAlpha = type === 'image/png' || type === 'image/gif' || type === 'image/webp'
  let edge = Math.max(1, Math.min(MAX_EDGE, Math.max(image.naturalWidth, image.naturalHeight)))

  while (edge >= 64) {
    const scale = edge / Math.max(image.naturalWidth, image.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) break
    context.drawImage(image, 0, 0, canvas.width, canvas.height)

    const transparent = keepAlpha
      ? hasAlpha(context.getImageData(0, 0, canvas.width, canvas.height).data)
      : false
    const encoded = canvas.toDataURL(
      transparent ? 'image/png' : 'image/jpeg',
      transparent ? undefined : 0.9,
    )
    if (encoded.length <= MAX_PICTURE_CHARS) return encoded
    edge = Math.floor(edge / 2)
  }

  throw new Error('That picture is too large to pack into the project')
}

/** Reads a picture file into a packed data URL ready for a body part. */
export async function readPicture(file: File): Promise<string> {
  if (!isPictureFile(file)) {
    throw new Error('Use a PNG, JPEG, WebP, GIF, BMP or AVIF picture')
  }
  if (file.size > MAX_SOURCE_BYTES) throw new Error('That picture is too large')

  const url = await readAsDataUrl(file)
  if (!url.startsWith('data:image/')) throw new Error('That file is not an image')
  if (url.length <= MAX_PICTURE_CHARS) return url
  return shrink(url, file.type)
}
