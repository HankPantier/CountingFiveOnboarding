import { runWhoisLookup } from '@/lib/whois/lookup'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const { sessionId, domain } = await req.json()

  if (!sessionId || !domain) {
    return NextResponse.json({ error: 'Missing sessionId or domain' }, { status: 400 })
  }

  await runWhoisLookup(sessionId, domain)
  return NextResponse.json({ success: true })
}
