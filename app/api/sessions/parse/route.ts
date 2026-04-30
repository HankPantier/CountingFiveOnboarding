import { parseMFP } from '@/lib/mfp-parser'
import { createAuthClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const auth = await createAuthClient()
  const {
    data: { user },
  } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: unknown = await req.json()
  const mfpContent =
    typeof body === 'object' && body !== null && 'mfpContent' in body
      ? (body as { mfpContent: unknown }).mfpContent
      : undefined

  if (typeof mfpContent !== 'string' || mfpContent.trim() === '') {
    return NextResponse.json({ error: 'No content' }, { status: 400 })
  }

  const { schema, gaps } = parseMFP(mfpContent)

  return NextResponse.json({
    websiteUrl: schema.websiteUrl ?? '',
    businessName: schema.business?.name ?? 'Unknown',
    teamCount: schema.team?.length ?? 0,
    servicesCount: schema.services?.length ?? 0,
    gapCount: gaps.length,
    schemaData: schema,
    gapList: gaps,
    rawContent: mfpContent,
  })
}
