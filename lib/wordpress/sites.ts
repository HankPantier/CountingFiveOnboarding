// ---------------------------------------------------------------------------
// Site registry + per-site bearer auth for the WordPress blog-sync bridge.
//
// Part of the self-contained, removable WordPress bridge (see ./README.md). The
// registry is a static JSON file (config/wordpress-sites.json) so the whole
// module stays decoupled from Supabase and deletes in one move. Secrets are
// NEVER stored in the JSON — it only names the env var that holds each site's
// bearer token, so rotation needs no code change.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto'
import registryJson from '@/config/wordpress-sites.json'

export type WordpressSite = {
  key: string
  github_repo: string
  enabled: boolean
  secret_env: string
}

type RawSite = { github_repo?: string; enabled?: boolean; secret_env?: string }
type Registry = Record<string, RawSite>

const registry = registryJson as Registry

// Resolve a site key to its config, or null if unknown or disabled. Callers
// return a uniform 404 for null so a disabled site is indistinguishable from a
// nonexistent one. A registry accepting-override lets tests inject fixtures.
export function resolveSite(
  key: string,
  reg: Registry = registry
): WordpressSite | null {
  const raw = reg[key]
  if (!raw) return null
  if (raw.enabled !== true) return null
  if (!raw.github_repo || !raw.secret_env) return null
  return { key, github_repo: raw.github_repo, enabled: true, secret_env: raw.secret_env }
}

// The site's bearer secret, read from the env var named by its config. Returns
// null when the var is empty/absent so verifyBearer fails closed.
export function getSiteSecret(site: WordpressSite): string | null {
  const secret = process.env[site.secret_env]
  return secret && secret.length > 0 ? secret : null
}

// Constant-time bearer check. Fails closed: an empty/absent secret rejects every
// request, so a misconfigured site can never be validated by `Bearer undefined`.
export function verifyBearer(authHeader: string | null, site: WordpressSite): boolean {
  const secret = getSiteSecret(site)
  if (!secret || !authHeader) return false
  const provided = Buffer.from(authHeader)
  const expected = Buffer.from(`Bearer ${secret}`)
  // timingSafeEqual throws on unequal lengths; the length check both guards that
  // and short-circuits obviously-wrong headers.
  if (provided.length !== expected.length) return false
  return crypto.timingSafeEqual(provided, expected)
}
