// Pure + client-safe validation for Design Studio inputs. URLs are only
// VALIDATED here — nothing fetches them until the capture route, which runs
// isUrlPubliclyFetchable (SSRF) first.
import { MAX_INPUT_URL_LENGTH, URL_INPUT_KINDS, type UrlInputKind } from './studio-types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// A scheme followed by something other than a port digit ("acme.com:8080" has
// no scheme; "javascript:alert" does).
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:(?!\d)/i
// C0/C1 control characters, excluding newline and tab — a NUL byte in
// particular makes Postgres reject the insert with an opaque 500.
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g

export function isUuid(v: string): boolean {
  return UUID_RE.test(v)
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function parseUrlInputKind(v: unknown): UrlInputKind | null {
  return typeof v === 'string' && (URL_INPUT_KINDS as readonly string[]).includes(v) ? (v as UrlInputKind) : null
}

export function normalizeInputUrl(raw: unknown): { ok: true; url: string } | { ok: false; reason: string } {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'A URL is required.' }
  const trimmed = raw.trim()
  if (trimmed.length > MAX_INPUT_URL_LENGTH) return { ok: false, reason: 'That URL is too long.' }
  const withScheme = SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`
  let u: URL
  try {
    u = new URL(withScheme)
  } catch {
    return { ok: false, reason: 'That is not a valid URL.' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'Only http(s) URLs are allowed.' }
  if (u.username || u.password) return { ok: false, reason: 'URLs with credentials are not allowed.' }
  if (!u.hostname.includes('.')) return { ok: false, reason: 'Enter a full site address, like https://example.com.' }
  const url = u.toString()
  if (url.length > MAX_INPUT_URL_LENGTH) return { ok: false, reason: 'That URL is too long.' }
  return { ok: true, url }
}

export function parseOptionalText(
  value: unknown,
  max: number,
  field: string
): { ok: true; value: string | null } | { ok: false; reason: string } {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, reason: `${field} must be text.` }
  const cleaned = value.replace(CONTROL_CHARS_RE, '').trim()
  if (cleaned.length > max) return { ok: false, reason: `${field} must be ${max} characters or fewer.` }
  return { ok: true, value: cleaned || null }
}

export function displayHost(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}
