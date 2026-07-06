import { parseMBP } from '@/lib/mbp-parser'
import { requireAdminUser } from '@/lib/auth/access'
import { NextResponse } from 'next/server'

// Parsing feeds the admin-only session-creation flow (POST /api/sessions is
// requireAdminUser), so gate it the same way — a bare Supabase session is
// "logged in", not "authorized" (security rule 6).
export async function POST(req: Request) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const body: unknown = await req.json()
  const mbpContent =
    typeof body === 'object' && body !== null && 'mbpContent' in body
      ? (body as { mbpContent: unknown }).mbpContent
      : undefined

  if (typeof mbpContent !== 'string' || mbpContent.trim() === '') {
    return NextResponse.json({ error: 'No content' }, { status: 400 })
  }

  const { schema, gaps } = parseMBP(mbpContent)

  // Guard the footgun: parseMBP never throws and returns an empty schema when it
  // recognizes no Section 1–11 structure (e.g. a wrong file, or the admin MBP
  // *export* from build-document.ts, which is a different flat format). A real
  // MBP always has a firm name + URL in Section 1, so "nothing recognized" means
  // the upload isn't an MBP — fail loudly instead of creating a junk session.
  const recognizedNothing =
    !schema.websiteUrl &&
    !schema.business?.name &&
    (schema.team?.length ?? 0) === 0 &&
    (schema.services?.length ?? 0) === 0
  if (recognizedNothing) {
    return NextResponse.json(
      {
        error:
          "This file doesn't look like a Master Business Profile — no recognizable sections were found. Upload the analyst MBP document (Sections 1–11).",
      },
      { status: 422 },
    )
  }

  return NextResponse.json({
    websiteUrl: schema.websiteUrl ?? '',
    businessName: schema.business?.name ?? 'Unknown',
    teamCount: schema.team?.length ?? 0,
    servicesCount: schema.services?.length ?? 0,
    gapCount: gaps.length,
    schemaData: schema,
    gapList: gaps,
    rawContent: mbpContent,
  })
}
