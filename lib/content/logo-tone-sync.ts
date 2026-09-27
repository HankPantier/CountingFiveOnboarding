import type { BrandJson } from '@/types/brand-json'

// Keeps brand.json `logo.tone` honest when a live site's logo file is replaced.
// The package assembler derives the tone once, at first deploy (logo-preflight
// applyLogoTone). After that, replacing the logo in the editor's media library
// only swapped the image, so a dark replacement kept `tone: "light"` (no plate,
// invisible on a light nav) and a light replacement never got it. The editor's
// asset route now re-runs the light-logo detection and uses these pure helpers
// to set or clear the key in the same commit as the new image.

export const BRAND_JSON_PATH = 'content/brand.json'
const ASSET_ROOT = 'public/content-assets/'

/**
 * The repo path brand.json's `logo.primary` points at, or null when there is
 * none (empty, an absolute URL, or anything that is not a plain asset name).
 * The assembler ships the logo at public/content-assets/{filename}; a value
 * written as `/content-assets/x.png` or `content-assets/x.png` means the same.
 */
export function brandLogoAssetPath(logoPrimary: unknown): string | null {
  if (typeof logoPrimary !== 'string') return null
  let name = logoPrimary.trim()
  if (!name || /^[a-z][a-z0-9+.-]*:/i.test(name) || name.startsWith('//')) return null
  name = name.replace(/^\/+/, '')
  if (name.startsWith('public/')) name = name.slice('public/'.length)
  if (name.startsWith('content-assets/')) name = name.slice('content-assets/'.length)
  if (!name || name.split('/').some((s) => s === '' || s === '.' || s === '..')) return null
  return `${ASSET_ROOT}${name}`
}

/**
 * Whether `assetPath` (an already-normalized public/content-assets/ path) is
 * the logo that brand.json references. Case-sensitive, like the repo.
 */
export function isBrandLogoPath(brandText: string, assetPath: string): boolean {
  const brand = parseBrand(brandText)
  if (!brand) return false
  return brandLogoAssetPath(brand.logo?.primary) === assetPath
}

/**
 * brand.json text with `logo.tone` set to "light" (a light logo) or removed (a
 * dark one), or null when nothing changes or the file can't be edited safely.
 *
 * The edit is MINIMAL and format-preserving (like add-action-text-vars edits
 * theme.css lines): only the `"tone": …` member is inserted, rewritten or
 * removed, copying the file's own indentation and colon spacing — every other
 * byte (key order, spacing, line endings, trailing newline) is kept, so the
 * commit diff is one line. The result is re-parsed and must equal the intended
 * object; anything else returns null rather than guess.
 *
 * An explicit `tone: "dark"` (an operator's choice) is kept unless the new logo
 * is conclusively light. Callers only get here with a conclusive detection
 * (logo-preflight `toneConclusive`); an inconclusive one never retones.
 */
export function retoneBrandJson(brandText: string, lightLogo: boolean): string | null {
  const brand = parseBrand(brandText)
  if (!brand || !brand.logo || typeof brand.logo !== 'object' || Array.isArray(brand.logo)) return null
  const current = brand.logo.tone
  if (lightLogo ? current === 'light' : current === undefined || current === 'dark') return null

  const expected: BrandJson = { ...brand, logo: { ...brand.logo } }
  if (lightLogo) expected.logo.tone = 'light'
  else delete expected.logo.tone

  let out: string | null
  try {
    out = editToneMember(brandText, lightLogo)
  } catch {
    out = null
  }
  if (out === null) return null
  const reparsed = parseBrand(out)
  return reparsed && canonical(reparsed) === canonical(expected) ? out : null
}

// ---- Minimal JSON text editing (only what retoneBrandJson needs) ----------

type Member = { key: string; keyStart: number; keyEnd: number; valueStart: number; valueEnd: number }

function skipWs(t: string, i: number): number {
  while (i < t.length && /\s/.test(t[i])) i++
  return i
}

function skipString(t: string, i: number): number {
  if (t[i] !== '"') throw new Error('expected string')
  for (i++; i < t.length; i++) {
    if (t[i] === '\\') i++
    else if (t[i] === '"') return i + 1
  }
  throw new Error('unterminated string')
}

function skipValue(t: string, i: number): number {
  if (t[i] === '"') return skipString(t, i)
  if (t[i] === '{' || t[i] === '[') {
    let depth = 0
    for (; i < t.length; i++) {
      const c = t[i]
      if (c === '"') i = skipString(t, i) - 1
      else if (c === '{' || c === '[') depth++
      else if (c === '}' || c === ']') {
        depth--
        if (depth === 0) return i + 1
      }
    }
    throw new Error('unterminated value')
  }
  while (i < t.length && !/[\s,}\]]/.test(t[i])) i++
  return i
}

// The members of the object whose '{' is at `open`, and the index of its '}'.
function objectMembers(t: string, open: number): { members: Member[]; close: number } {
  if (t[open] !== '{') throw new Error('expected object')
  const members: Member[] = []
  let i = skipWs(t, open + 1)
  if (t[i] === '}') return { members, close: i }
  for (;;) {
    const keyStart = i
    const keyEnd = skipString(t, i)
    const key = JSON.parse(t.slice(keyStart, keyEnd)) as string
    i = skipWs(t, keyEnd)
    if (t[i] !== ':') throw new Error('expected colon')
    const valueStart = skipWs(t, i + 1)
    const valueEnd = skipValue(t, valueStart)
    members.push({ key, keyStart, keyEnd, valueStart, valueEnd })
    i = skipWs(t, valueEnd)
    if (t[i] === ',') {
      i = skipWs(t, i + 1)
      continue
    }
    if (t[i] === '}') return { members, close: i }
    throw new Error('expected , or }')
  }
}

function editToneMember(t: string, light: boolean): string | null {
  const root = skipWs(t, 0)
  const logo = objectMembers(t, root).members.find((m) => m.key === 'logo')
  if (!logo || t[logo.valueStart] !== '{') return null
  const { members } = objectMembers(t, logo.valueStart)
  const k = members.findIndex((m) => m.key === 'tone')
  const tone = k === -1 ? null : members[k]

  if (light && tone) return t.slice(0, tone.valueStart) + '"light"' + t.slice(tone.valueEnd)
  if (light) {
    const last = members[members.length - 1]
    if (!last) return null
    // Copy the separator the file uses before its last member (e.g. "\n    ")
    // and its colon spacing, so the new line looks like its neighbours.
    const before = members.length >= 2 ? t.slice(members[members.length - 2].valueEnd, last.keyStart) : t.slice(logo.valueStart + 1, last.keyStart)
    const sep = before.replace(/^\s*,/, '') || ' '
    const colon = t.slice(last.keyEnd, last.valueStart)
    return t.slice(0, last.valueEnd) + ',' + sep + '"tone"' + colon + '"light"' + t.slice(last.valueEnd)
  }
  if (!tone) return null
  if (k > 0) return t.slice(0, members[k - 1].valueEnd) + t.slice(tone.valueEnd)
  if (members.length > 1) return t.slice(0, tone.keyStart) + t.slice(members[1].keyStart)
  return t.slice(0, logo.valueStart + 1) + t.slice(skipWs(t, tone.valueEnd))
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

function parseBrand(text: string): BrandJson | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as BrandJson) : null
  } catch {
    return null
  }
}
