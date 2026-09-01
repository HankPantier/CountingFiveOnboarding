import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { readJsonBody } from '@/app/api/_json'
import type { UpdateWordpressSiteRequest } from '@/types/wordpress-sites'

export const runtime = 'nodejs'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const body = await readJsonBody<UpdateWordpressSiteRequest>(req)
  if (body instanceof NextResponse) return body

  const patch: { enabled?: boolean; github_repo?: string; updated_at: string } = {
    updated_at: new Date().toISOString(),
  }
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (typeof body.github_repo === 'string') {
    const repo = body.github_repo.trim()
    if (!repo) return NextResponse.json({ error: 'GitHub repo cannot be empty.' }, { status: 400 })
    patch.github_repo = repo
  }

  const supabase = createServerClient()
  const { error } = await supabase.from('wordpress_sites').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const supabase = createServerClient()
  const { error } = await supabase.from('wordpress_sites').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
