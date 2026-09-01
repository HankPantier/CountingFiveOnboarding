// ---------------------------------------------------------------------------
// Site registry + per-site bearer auth for the Revaltus WordPress blog-sync
// bridge (see ./README.md).
//
// The registry lives in the `wordpress_sites` table, managed from the admin UI
// (Admin → WordPress Sites). Each row carries its own app-generated bearer
// secret. The feed routes read config here via the service-role client; the
// admin CRUD routes (app/api/admin/wordpress-sites) own writes. Deleting the
// whole bridge still comes down to a few `rm`s + dropping the table.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto'
import { createServerClient } from '@/lib/supabase/server'

export type WordpressSite = {
  key: string
  github_repo: string
  secret: string
}

// Resolve a site key to its config, or null if unknown or disabled. Callers
// return a uniform 404 for null so a disabled site is indistinguishable from a
// nonexistent one. Uses the service-role client (RLS is enabled with no
// policies) — the feed route is the only non-admin reader.
export async function resolveSite(key: string): Promise<WordpressSite | null> {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('wordpress_sites')
    .select('site_key, github_repo, enabled, secret')
    .eq('site_key', key)
    .maybeSingle()

  if (!data || !data.enabled) return null
  if (!data.github_repo || !data.secret) return null
  return { key: data.site_key, github_repo: data.github_repo, secret: data.secret }
}

// Generate a bearer secret for a new/rotated site. 48 hex chars (24 bytes).
export function generateSiteSecret(): string {
  return crypto.randomBytes(24).toString('hex')
}

// Constant-time bearer check against the site's stored secret. Fails closed: an
// empty secret or missing header rejects every request, so a misconfigured site
// can never be validated by `Bearer undefined`.
export function verifyBearer(authHeader: string | null, site: WordpressSite): boolean {
  if (!site.secret || !authHeader) return false
  const provided = Buffer.from(authHeader)
  const expected = Buffer.from(`Bearer ${site.secret}`)
  // timingSafeEqual throws on unequal lengths; the length check both guards that
  // and short-circuits obviously-wrong headers.
  if (provided.length !== expected.length) return false
  return crypto.timingSafeEqual(provided, expected)
}
