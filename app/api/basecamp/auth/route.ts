import { NextResponse } from 'next/server'

export async function GET() {
  const params = new URLSearchParams({
    type: 'web_server',
    client_id: process.env.BASECAMP_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/basecamp/callback`,
  })

  return NextResponse.redirect(
    `https://launchpad.37signals.com/authorization/new?${params.toString()}`
  )
}
