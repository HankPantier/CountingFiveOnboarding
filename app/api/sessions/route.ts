import { createServerClient } from '@/lib/supabase/server'
import { requireAdminUser } from '@/lib/auth/access'
import { computePhase4Gaps } from '@/lib/mbp-parser'
import { asJson } from '@/lib/supabase/json-typed'
import type { SessionSchema } from '@/types/session-schema'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const body: unknown = await req.json()
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { websiteUrl, mbpContent, schemaData, gapList } = body as {
    websiteUrl?: unknown
    mbpContent?: unknown
    schemaData?: unknown
    gapList?: unknown
  }

  if (typeof websiteUrl !== 'string' || !websiteUrl.trim()) {
    return NextResponse.json({ error: 'websiteUrl required' }, { status: 400 })
  }

  const db = createServerClient()

  // If no gap list was supplied (e.g. a manually-created session with no MBP
  // upload), derive the baseline Phase-4 gaps from whatever schema we have so
  // the chat still has questions to ask. Without this, an empty gap list lets
  // Phase 4 trivially pass and collect almost nothing.
  const seededSchema = (schemaData ?? {}) as SessionSchema
  const providedGaps = Array.isArray(gapList) ? gapList : []
  const finalGaps = providedGaps.length > 0 ? providedGaps : computePhase4Gaps(seededSchema)

  const { data, error } = await db
    .from('sessions')
    .insert({
      website_url: websiteUrl,
      mbp_content: typeof mbpContent === 'string' ? mbpContent : null,
      schema_data: asJson(schemaData ?? {}),
      gap_list: asJson(finalGaps),
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
