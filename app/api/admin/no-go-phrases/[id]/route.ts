import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { readJsonBody } from '@/app/api/_json'
import { normalizeNoGo, clearNoGoCache } from '@/lib/content/no-go-phrases'
import type { UpdateNoGoPhraseRequest } from '@/types/no-go-phrases'

export const runtime = 'nodejs'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const body = await readJsonBody<UpdateNoGoPhraseRequest>(req)
  if (body instanceof NextResponse) return body

  const patch: {
    phrase?: string
    phrase_normalized?: string
    note?: string | null
    updated_at: string
  } = { updated_at: new Date().toISOString() }

  if (typeof body.phrase === 'string') {
    const phrase = body.phrase.trim()
    const normalized = normalizeNoGo(phrase)
    if (!normalized) return NextResponse.json({ error: 'Phrase cannot be empty.' }, { status: 400 })
    patch.phrase = phrase
    patch.phrase_normalized = normalized
  }
  if (body.note !== undefined) {
    patch.note = typeof body.note === 'string' ? body.note.trim() || null : null
  }

  const supabase = createServerClient()
  const { error } = await supabase.from('no_go_phrases').update(patch).eq('id', id)
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'That phrase is already on the list.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  clearNoGoCache()
  return NextResponse.json({ success: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const supabase = createServerClient()
  const { error } = await supabase.from('no_go_phrases').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  clearNoGoCache()
  return NextResponse.json({ success: true })
}
