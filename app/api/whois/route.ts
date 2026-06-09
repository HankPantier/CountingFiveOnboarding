import { runWhoisLookup } from '@/lib/whois/lookup'
import { NextResponse } from 'next/server'
import { requireSessionAccess } from '@/lib/auth/access'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const { sessionId, domain } = await req.json()

  if (!sessionId || !domain) {
    return NextResponse.json({ error: 'Missing sessionId or domain' }, { status: 400 })
  }

  const auth = await requireSessionAccess(sessionId)
  if (auth instanceof NextResponse) return auth

  await runWhoisLookup(sessionId, domain)
  return NextResponse.json({ success: true })
}
