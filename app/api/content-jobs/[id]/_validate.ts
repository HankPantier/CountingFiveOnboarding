// Pure validation for PATCH /api/content-jobs/[id]. Kept out of the route so it
// can be unit-tested without a Supabase stub.

export interface ContentJobPatchBody {
  palette?: unknown
  design_tokens?: unknown
  confirmed_sitemap?: unknown
  nav_config?: unknown
  phase?: number
  status?: string
  error_message?: unknown
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isSwatch = (v: unknown): boolean =>
  isPlainObject(v) && typeof v.hex === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.hex)

const PALETTE_ROLES = ['primary', 'secondary', 'complementary', 'action', 'nearBlack', 'nearWhite'] as const

function isNavItem(v: unknown, depth: number): boolean {
  if (!isPlainObject(v) || typeof v.label !== 'string' || typeof v.url !== 'string') return false
  if (v.children === undefined) return true
  return depth < 5 && Array.isArray(v.children) && v.children.every(c => isNavItem(c, depth + 1))
}

/** Returns an error message for a malformed body, or null when it is acceptable. */
export function validateContentJobPatch(body: ContentJobPatchBody): string | null {
  if (body.palette !== undefined && body.palette !== null) {
    if (!isPlainObject(body.palette)) return 'palette must be an object'
    const p = body.palette
    for (const role of PALETTE_ROLES) {
      if (p[role] !== undefined && !isSwatch(p[role])) return `palette.${role} must be { hex, name }`
    }
  }
  if (body.design_tokens !== undefined && body.design_tokens !== null && !isPlainObject(body.design_tokens)) {
    return 'design_tokens must be an object'
  }
  if (body.confirmed_sitemap !== undefined && body.confirmed_sitemap !== null) {
    if (!Array.isArray(body.confirmed_sitemap)) return 'confirmed_sitemap must be an array'
    for (const page of body.confirmed_sitemap) {
      if (!isPlainObject(page) || typeof page.url !== 'string' || typeof page.title !== 'string') {
        return 'confirmed_sitemap entries must have a string url and title'
      }
    }
  }
  if (body.nav_config !== undefined && body.nav_config !== null) {
    if (!isPlainObject(body.nav_config)) return 'nav_config must be an object'
    const nav = body.nav_config
    if (!Array.isArray(nav.primary) || !nav.primary.every(i => isNavItem(i, 1))) {
      return 'nav_config.primary must be an array of { label, url, children? }'
    }
    if (nav.cta !== undefined && !(isPlainObject(nav.cta) && typeof nav.cta.label === 'string' && typeof nav.cta.url === 'string')) {
      return 'nav_config.cta must be { label, url }'
    }
  }
  if (body.error_message !== undefined && body.error_message !== null && typeof body.error_message !== 'string') {
    return 'error_message must be a string'
  }
  return null
}

/**
 * Phase moves: forward by at most ONE step (no skipping gates), or any move
 * backward/sideways. Returns an error message or null.
 */
export function checkPhaseTransition(current: number, target: number): string | null {
  if (!Number.isInteger(target) || target < 1 || target > 6) return 'Invalid phase'
  if (target > current + 1) return `Cannot jump from phase ${current} to phase ${target} — advance one step at a time`
  return null
}

/** Crossing into generation (phase 5) from an earlier phase runs the phase-5 gates. */
export function crossesIntoGeneration(current: number, target: number): boolean {
  return target >= 5 && current < 5
}
