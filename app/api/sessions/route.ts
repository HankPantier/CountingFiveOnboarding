import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import type { Json } from '@/types/database'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const body: unknown = await req.json()
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { websiteUrl, mfpContent, schemaData, gapList } = body as {
    websiteUrl?: unknown
    mfpContent?: unknown
    schemaData?: unknown
    gapList?: unknown
  }

  if (typeof websiteUrl !== 'string' || !websiteUrl.trim()) {
    return NextResponse.json({ error: 'websiteUrl required' }, { status: 400 })
  }

  const db = createServerClient()

  const { data, error } = await db
    .from('sessions')
    .insert({
      website_url: websiteUrl,
      mfp_content: typeof mfpContent === 'string' ? mfpContent : null,
      schema_data: (schemaData ?? {}) as Json,
      gap_list: (Array.isArray(gapList) ? gapList : []) as Json,
      status: 'pending',
      current_phase: 1,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[POST /api/sessions]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ sessionId: data.id })
}
