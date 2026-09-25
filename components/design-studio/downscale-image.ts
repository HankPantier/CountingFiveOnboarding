// Client-side pre-upload downscale for large inspiration images. Runs in the
// browser only (no server imports) so InputsPanel can shrink an oversized
// image BEFORE it ever leaves the browser, keeping it under the platform's
// request-body limit. The route still re-validates size and magic bytes —
// this is a UX improvement, not a security boundary.
import { fitWithinMaxEdge } from '@/lib/design/downscale-math'

// Above either threshold, downscale + re-encode. Below both, upload as-is.
const SOURCE_MAX_BYTES = 3.5 * 1024 * 1024
const SOURCE_MAX_EDGE = 2400
// If the re-encoded result is still over this, give up — the route's own
// cap (4 MB) would reject it anyway.
export const DOWNSCALE_OUTPUT_MAX_BYTES = 4 * 1024 * 1024
const DOWNSCALABLE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const EXT_BY_MIME: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' }

export class ImageTooLargeError extends Error {
  constructor() {
    super('That image is too large to upload — try a smaller file.')
    this.name = 'ImageTooLargeError'
  }
}

type Decoded = { width: number; height: number; source: ImageBitmap | HTMLImageElement }

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file)
    return { width: bitmap.width, height: bitmap.height, source: bitmap }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Could not decode image'))
      img.src = url
    })
    return { width: img.naturalWidth, height: img.naturalHeight, source: img }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

// Re-encodes to WebP quality 0.9; falls back to JPEG quality 0.9 if the
// browser's canvas encoder doesn't actually support WebP (some UAs return a
// non-null blob of a different type — e.g. PNG — instead of failing).
async function encodeDownscaled(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const webp = await canvasToBlob(canvas, 'image/webp', 0.9)
  if (webp && webp.type === 'image/webp') return webp
  return canvasToBlob(canvas, 'image/jpeg', 0.9)
}

// Downscales + re-encodes an oversized inspiration image in the browser.
// Returns the original file untouched when it's already small enough, not a
// downscalable type (the server rejects those on its own), or can't be
// decoded in-browser (the server's own decode is the final judge). Throws
// ImageTooLargeError if the re-encoded result is still over the cap.
export async function downscaleImageIfNeeded(file: File): Promise<File> {
  if (!DOWNSCALABLE_TYPES.has(file.type)) return file

  let decoded: Decoded
  try {
    decoded = await decode(file)
  } catch {
    return file
  }
  const { width, height, source } = decoded
  const closeSource = () => {
    if (source instanceof ImageBitmap) source.close()
  }

  const longEdge = Math.max(width, height)
  if (file.size <= SOURCE_MAX_BYTES && longEdge <= SOURCE_MAX_EDGE) {
    closeSource()
    return file
  }

  const target = fitWithinMaxEdge(width, height, SOURCE_MAX_EDGE)
  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    closeSource()
    return file
  }
  ctx.drawImage(source, 0, 0, target.width, target.height)
  closeSource()

  const blob = await encodeDownscaled(canvas)
  if (!blob) return file

  if (blob.size > DOWNSCALE_OUTPUT_MAX_BYTES) throw new ImageTooLargeError()

  const baseName = file.name.replace(/\.[^./\\]+$/, '') || 'image'
  const ext = EXT_BY_MIME[blob.type] ?? 'jpg'
  return new File([blob], `${baseName}.${ext}`, { type: blob.type })
}
