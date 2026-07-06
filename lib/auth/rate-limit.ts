import { createServerClient } from '@/lib/supabase/server'

// DB-backed fixed-window rate limiter for public/unauthenticated endpoints
// (forgot-password, client review PATCH, presign, audit creation). Serverless
// instances share no memory, so the window lives in rate_limit_events
// (migration 044); the sweep cron prunes rows older than 24h.
//
// Returns true when the call is allowed (and records it), false when the key
// is over its limit. Fails OPEN on DB errors: these endpoints must not break
// for legitimate users because the limiter table hiccuped — the abuse cap is
// defense-in-depth, not a correctness gate.
export async function checkRateLimit(
  key: string,
  max: number,
  windowMs: number
): Promise<boolean> {
  const supabase = createServerClient()
  const windowStart = new Date(Date.now() - windowMs).toISOString()

  const { count, error } = await supabase
    .from('rate_limit_events')
    .select('id', { count: 'exact', head: true })
    .eq('key', key)
    .gte('created_at', windowStart)

  if (error) {
    console.error('[rate-limit] count failed for', key, error.message)
    return true
  }
  if ((count ?? 0) >= max) return false

  const { error: insertErr } = await supabase.from('rate_limit_events').insert({ key })
  if (insertErr) console.error('[rate-limit] record failed for', key, insertErr.message)
  return true
}

// Best-effort client IP for per-IP keys. On Vercel, x-forwarded-for's first
// hop is set by the platform and trustworthy enough for abuse throttling.
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  return fwd?.split(',')[0]?.trim() || 'unknown'
}
