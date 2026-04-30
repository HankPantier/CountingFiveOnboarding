export const runtime = 'nodejs'
export const maxDuration = 30

import { createServerClient } from '@/lib/supabase/server'
import { generateIntakePdf } from '@/lib/pdf/generate-pdf'
import { generateIntakeMd } from '@/lib/pdf/generate-md'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { sessionId } = await req.json() as { sessionId: string }
  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })

  const supabase = createServerClient()

  const [{ data: session }, { data: uploadedAssets }] = await Promise.all([
    supabase.from('sessions').select('*').eq('id', sessionId).single(),
    supabase.from('assets').select('file_name, storage_path, asset_category').eq('session_id', sessionId),
  ])

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  try {
    const pdfStoragePath = `pdfs/${sessionId}/intake-summary.pdf`
    const mdStoragePath  = `pdfs/${sessionId}/intake-summary.md`

    const [pdfBuffer, mdContent] = await Promise.all([
      generateIntakePdf(session),
      Promise.resolve(generateIntakeMd(session, uploadedAssets ?? [])),
    ])

    const [pdfUpload, mdUpload] = await Promise.all([
      supabase.storage.from('session-assets').upload(pdfStoragePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      }),
      supabase.storage.from('session-assets').upload(
        mdStoragePath,
        Buffer.from(mdContent, 'utf-8'),
        { contentType: 'text/markdown', upsert: true }
      ),
    ])

    if (pdfUpload.error) throw pdfUpload.error
    if (mdUpload.error) throw mdUpload.error

    await supabase
      .from('sessions')
      .update({ pdf_url: pdfStoragePath })
      .eq('id', sessionId)

    return NextResponse.json({ pdfStoragePath, mdStoragePath })
  } catch (err) {
    console.error('[PDF/MD Generation]', err)
    const message = err instanceof Error ? err.message : 'Generation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
