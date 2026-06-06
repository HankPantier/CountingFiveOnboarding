import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { assembleContentPackage } from '@/lib/content/package-assembler'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const result = await assembleContentPackage(id, {
    name: 'CountingFive Admin',
    email: auth.user.email ?? null,
  })

  if (!result.ok) {
    const { ok: _ok, status, ...body } = result
    return NextResponse.json(body, { status })
  }

  const { ok: _ok, ...body } = result
  return NextResponse.json({ success: true, ...body })
}
