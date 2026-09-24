// Every Design Studio route is admin-only (spec: "FOR NOW: ONLY ADMINS").
// resolveEditContext gives UUID validation, session access, phase ≥ 6 and a
// provisioned repo; the admin check narrows it to the admin tier.
import { NextResponse } from 'next/server'
import { resolveEditContext, type EditContext } from '../_helpers'

export async function requireDesignAdmin(id: string): Promise<EditContext | NextResponse> {
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.user.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return ctx
}
