// Shared `Authorization: Bearer {CRON_SECRET}` check (CLAUDE.md rule 2).
// Fails closed on an empty/unset secret, and compares in constant time so the
// secret can't be recovered byte-by-byte from response timing. Pure JS (no
// node:crypto) so it runs in route handlers and proxy.ts alike.
import { NextResponse } from 'next/server'

export type CronBearerCheck = 'ok' | 'misconfigured' | 'unauthorized'

const encoder = new TextEncoder()

// Constant-time for equal-length inputs; a length mismatch returns early,
// which only reveals the secret's length (as crypto.timingSafeEqual would).
export function timingSafeEqualString(a: string, b: string): boolean {
  const ab = encoder.encode(a)
  const bb = encoder.encode(b)
  if (ab.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i]
  return diff === 0
}

export function checkCronBearer(
  authHeader: string | null | undefined,
  secret: string | undefined = process.env.CRON_SECRET,
): CronBearerCheck {
  if (!secret) return 'misconfigured'
  if (typeof authHeader !== 'string') return 'unauthorized'
  return timingSafeEqualString(authHeader, `Bearer ${secret}`) ? 'ok' : 'unauthorized'
}

/** Dual-path routes (internal chain OR a user gate): true only when the
 * secret is configured AND the header matches. An empty secret disables the
 * chain path; it never becomes a bypass. */
export function isCronBearer(req: Request): boolean {
  return checkCronBearer(req.headers.get('authorization')) === 'ok'
}

/** Cron-only routes: null when authorized, else the fail-closed response
 * (500 when CRON_SECRET is unset, 401 on a wrong/missing bearer). */
export function requireCronBearer(req: Request): NextResponse | null {
  const result = checkCronBearer(req.headers.get('authorization'))
  if (result === 'misconfigured') return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  if (result === 'unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return null
}
