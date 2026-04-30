import { createServerClient } from '@/lib/supabase/server'

const BC_BASE = `https://3.basecampapi.com/${process.env.BASECAMP_ACCOUNT_ID}`
const USER_AGENT = 'CountingFive Onboarding (webhank@gmail.com)'

export async function getValidToken(): Promise<string> {
  const supabase = createServerClient()
  const { data: tokenRow } = await supabase
    .from('basecamp_tokens')
    .select('*')
    .eq('id', 1)
    .single()

  if (!tokenRow) throw new Error('Basecamp not connected — complete OAuth first')

  const expiresAt = new Date(tokenRow.expires_at)
  const bufferMs = 5 * 60 * 1000

  if (expiresAt.getTime() - Date.now() < bufferMs) {
    const res = await fetch('https://launchpad.37signals.com/authorization/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        type: 'refresh',
        refresh_token: tokenRow.refresh_token,
        client_id: process.env.BASECAMP_CLIENT_ID!,
        client_secret: process.env.BASECAMP_CLIENT_SECRET!,
        redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/basecamp/callback`,
      }),
    })
    const refreshed = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number }
    if (!refreshed.access_token || !refreshed.refresh_token) {
      throw new Error('Token refresh failed')
    }

    await supabase.from('basecamp_tokens').update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: new Date(Date.now() + (refreshed.expires_in ?? 1209600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', 1)

    return refreshed.access_token
  }

  return tokenRow.access_token
}

export async function basecampFetch(
  path: string,
  options: RequestInit = {}
): Promise<unknown> {
  const token = await getValidToken()

  const defaultHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'User-Agent': USER_AGENT,
  }

  // Only set application/json default if no Content-Type provided (binary uploads override this)
  const incomingHeaders = options.headers as Record<string, string> | undefined
  if (!incomingHeaders?.['Content-Type']) {
    defaultHeaders['Content-Type'] = 'application/json'
  }

  const res = await fetch(`${BC_BASE}${path}`, {
    ...options,
    headers: { ...defaultHeaders, ...(incomingHeaders ?? {}) },
  })

  if (res.status === 429) {
    await new Promise(r => setTimeout(r, 10000))
    return basecampFetch(path, options)
  }

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Basecamp API ${res.status}: ${body}`)
  }

  return res.status === 204 ? null : res.json()
}
