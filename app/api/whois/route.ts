import { runWhoisLookup } from '@/lib/whois/lookup'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { sessionId, domain } = await req.json()

  if (!sessionId || !domain) {
    return NextResponse.json({ error: 'Missing sessionId or domain' }, { status: 400 })
  }

  await runWhoisLookup(sessionId, domain)
  return NextResponse.json({ success: true })
}
