import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  if (!code) return NextResponse.json({ error: 'No code' }, { status: 400 })

  const res = await fetch('https://launchpad.37signals.com/authorization/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      type: 'web_server',
      client_id: process.env.BASECAMP_CLIENT_ID!,
      client_secret: process.env.BASECAMP_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/basecamp/callback`,
      code,
    }),
  })

  const tokens = await res.json() as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }

  if (!tokens.access_token || !tokens.refresh_token) {
    return NextResponse.json({ error: 'Token exchange failed' }, { status: 500 })
  }

  const supabase = createServerClient()
  await supabase.from('basecamp_tokens').upsert({
    id: 1,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(Date.now() + (tokens.expires_in ?? 1209600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  })

  return NextResponse.redirect(
    `${process.env.NEXT_PUBLIC_APP_URL}/admin/dashboard?basecamp=connected`
  )
}
