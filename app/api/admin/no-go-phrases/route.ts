import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { readJsonBody } from '@/app/api/_json'
import { normalizeNoGo, clearNoGoCache } from '@/lib/content/no-go-phrases'
import type {
  ListNoGoPhrasesResponse,
  CreateNoGoPhraseRequest,
  CreateNoGoPhraseResponse,
} from '@/types/no-go-phrases'

export const runtime = 'nodejs'

export async function GET() {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('no_go_phrases')
    .select('id, phrase, note, created_at')
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json<ListNoGoPhrasesResponse>({ phrases: data ?? [] })
}

export async function POST(req: Request) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const body = await readJsonBody<Partial<CreateNoGoPhraseRequest>>(req)
  if (body instanceof NextResponse) return body

  const phrase = (body.phrase ?? '').trim()
  const note = (body.note ?? '').trim() || null
  const normalized = normalizeNoGo(phrase)
  if (!normalized) {
    return NextResponse.json({ error: 'Enter a phrase.' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('no_go_phrases')
    .insert({ phrase, phrase_normalized: normalized, note, created_by: auth.user.id })
    .select('id, phrase, note, created_at')
    .single()

  if (error) {
    // 23505 = unique_violation on phrase_normalized.
    if (error.code === '23505') {
      return NextResponse.json({ error: 'That phrase is already on the list.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  clearNoGoCache()
  return NextResponse.json<CreateNoGoPhraseResponse>({ phrase: data })
}
