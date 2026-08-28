import { runWhoisLookup } from '@/lib/whois/lookup'
import { NextResponse } from 'next/server'
import { requireSessionAccess } from '@/lib/auth/access'
import { readJsonBody } from '@/app/api/_json'

export const runtime = 'nodejs'
// WHOIS lookup has an 8s timeout plus DB work — give headroom over the ~10s
// Vercel default so a slow registrar doesn't 504 before the phase advance.
export const maxDuration = 30

export async function POST(req: Request) {
  const body = await readJsonBody<{ sessionId?: string; domain?: string }>(req)
  if (body instanceof NextResponse) return body
  const { sessionId, domain } = body

  if (!sessionId || !domain) {
    return NextResponse.json({ error: 'Missing sessionId or domain' }, { status: 400 })
  }

  const auth = await requireSessionAccess(sessionId)
  if (auth instanceof NextResponse) return auth

  await runWhoisLookup(sessionId, domain)
  return NextResponse.json({ success: true })
}
