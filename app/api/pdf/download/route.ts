import { createAuthClient, createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const auth = await createAuthClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const storagePath = searchParams.get('path')
  if (!storagePath) return NextResponse.json({ error: 'Missing path' }, { status: 400 })

  const supabase = createServerClient()
  const { data, error } = await supabase.storage
    .from('session-assets')
    .createSignedUrl(storagePath, 300) // 5-minute signed URL

  if (error || !data) return NextResponse.json({ error: 'Could not generate download link' }, { status: 500 })

  return NextResponse.redirect(data.signedUrl)
}
