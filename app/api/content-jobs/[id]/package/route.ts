import { NextResponse } from 'next/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { assembleContentPackage } from '@/lib/content/package-assembler'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: _jobId } = await params
  const auth = await requireContentJobAccess(_jobId)
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  // Surface real failures. Without this, a thrown exception becomes a bodyless
  // 500 and the client can only show its generic "Failed to assemble package"
  // — undiagnosable. This route is admin-gated, so returning the message is
  // safe and expected. (A hard Vercel maxDuration timeout still can't be caught
  // here — that's addressed by bounding the assembler's I/O.)
  let result
  try {
    result = await assembleContentPackage(id, {
      name: 'CountingFive Admin',
      email: auth.user.email ?? null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Package assembly failed'
    console.error('[package] Unhandled assembly error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  if (!result.ok) {
    const { ok: _ok, status, ...body } = result
    return NextResponse.json(body, { status })
  }

  const { ok: _ok, ...body } = result
  return NextResponse.json({ success: true, ...body })
}
