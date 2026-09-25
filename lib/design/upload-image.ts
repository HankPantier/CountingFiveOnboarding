// Server-only. Multipart image uploads for the Design Studio (inspiration
// images, chat attachments): a cheap Content-Length rejection, the form, the
// file, the 4 MB cap (under Vercel's ~4.5 MB body limit, so our JSON 413 wins
// over the platform's opaque one), magic bytes via file-type (PNG / JPEG /
// WebP only — SVG has no magic bytes and can carry script), then a sharp
// re-encode to WebP (strips metadata, long edge ≤ 1568). Split in two so a
// caller can validate its own form fields between the steps.
import { fileTypeFromBuffer } from 'file-type'
import { toWebp } from './storage'

export const MAX_IMAGE_UPLOAD_BYTES = 4 * 1024 * 1024
const MULTIPART_OVERHEAD_BYTES = 64 * 1024
const UPLOAD_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const TOO_LARGE = 'Images must be 4 MB or smaller.'

export type UploadFailure = { ok: false; status: 400 | 413 | 415; error: string }

export async function readImageForm(req: Request): Promise<{ ok: true; form: FormData; file: Blob } | UploadFailure> {
  const contentLength = Number(req.headers.get('content-length'))
  if (contentLength > MAX_IMAGE_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) return { ok: false, status: 413, error: TOO_LARGE }
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return { ok: false, status: 400, error: 'Expected multipart/form-data.' }
  }
  const file = form.get('file')
  if (!(file instanceof Blob)) return { ok: false, status: 400, error: 'An image file is required.' }
  if (file.size === 0) return { ok: false, status: 400, error: 'The file is empty.' }
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) return { ok: false, status: 413, error: TOO_LARGE }
  return { ok: true, form, file }
}

export async function toValidatedWebp(file: Blob): Promise<{ ok: true; webp: Buffer; width: number; height: number } | UploadFailure> {
  const bytes = Buffer.from(await file.arrayBuffer())
  const type = await fileTypeFromBuffer(bytes)
  if (!type || !UPLOAD_MIMES.has(type.mime)) return { ok: false, status: 415, error: 'Upload a PNG, JPEG or WebP image.' }
  try {
    const { webp, width, height } = await toWebp(bytes)
    return { ok: true, webp, width, height }
  } catch {
    return { ok: false, status: 415, error: 'That image could not be read.' }
  }
}
