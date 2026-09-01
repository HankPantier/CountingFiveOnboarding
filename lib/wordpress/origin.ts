// Resolve the public app origin the WP plugin will call back (feed + image
// proxy). Prefer an explicit env base; otherwise reconstruct from the forwarded
// host so URLs point at the real origin, not Vercel's internal request URL.
export function resolveOrigin(req: Request): string {
  const envBase = process.env.NEXT_PUBLIC_APP_URL
  if (envBase) return envBase.replace(/\/$/, '')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  if (host) return `${proto}://${host}`
  return new URL(req.url).origin
}

// The feed endpoint a site's WordPress plugin polls.
export function feedUrlFor(origin: string, siteKey: string): string {
  return `${origin}/api/wp-feed/${encodeURIComponent(siteKey)}`
}
