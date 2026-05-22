import { NextResponse } from 'next/server'

export async function GET() {
  const state = crypto.randomUUID()

  const params = new URLSearchParams({
    type: 'web_server',
    client_id: process.env.BASECAMP_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/basecamp/callback`,
    state,
  })

  const response = NextResponse.redirect(
    `https://launchpad.37signals.com/authorization/new?${params.toString()}`
  )

  response.cookies.set('basecamp_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/basecamp',
    maxAge: 600,
  })

  return response
}
