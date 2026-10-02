import { fileTypeFromBuffer } from 'file-type'

// Server-side check for an uploaded client logo, shared by the onboarding logo
// confirm route and the editor's Theme Studio logo upload. Raster formats are
// verified by magic bytes; SVG has none, so it is accepted only after
// sanitization (scripts, handlers and external refs stripped).

export const LOGO_MAX_BYTES = 10 * 1024 * 1024

const RASTER: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export type ValidatedLogo = {
  /** The bytes to store — the sanitized markup for an SVG. */
  buffer: Buffer
  mime: string
  ext: string
  /** True when the bytes differ from the upload (a sanitized SVG). */
  rewritten: boolean
}

export type LogoValidation =
  | { ok: true; logo: ValidatedLogo }
  | { ok: false; status: 413 | 415; error: string }

export async function validateLogoUpload(buffer: Buffer): Promise<LogoValidation> {
  if (buffer.length === 0 || buffer.length > LOGO_MAX_BYTES) {
    return { ok: false, status: 413, error: 'Logo must be under 10MB' }
  }
  const detected = await fileTypeFromBuffer(buffer)
  if (detected) {
    const ext = RASTER[detected.mime]
    if (!ext) return { ok: false, status: 415, error: 'Unsupported image format — use PNG, JPG, WebP, or SVG' }
    return { ok: true, logo: { buffer, mime: detected.mime, ext, rewritten: false } }
  }
  // Imported lazily (jsdom-backed) so raster uploads never load it.
  const { sanitizeSvg } = await import('@/lib/assets/sanitize-svg')
  const clean = sanitizeSvg(buffer.toString('utf-8'))
  if (!clean) return { ok: false, status: 415, error: 'Unsupported file — use PNG, JPG, WebP, or SVG' }
  const out = Buffer.from(clean, 'utf-8')
  return { ok: true, logo: { buffer: out, mime: 'image/svg+xml', ext: 'svg', rewritten: !out.equals(buffer) } }
}
