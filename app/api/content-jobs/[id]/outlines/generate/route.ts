import { after, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { runOutlineGeneration } from '@/lib/content/outline-generator'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const supabase = createServerClient()

  const { data: job } = await supabase
    .from('content_jobs')
    .select('session_id')
    .eq('id', id)
    .single()

  if (!job) {
    return NextResponse.json({ error: 'Content job not found' }, { status: 404 })
  }

  // after() runs the work after the response is sent and is guaranteed to
  // complete within the function's maxDuration on Vercel. Plain fire-and-
  // forget Promises do not have that guarantee — Vercel terminates pending
  // async work once the response leaves, which is why the previous retry
  // button looked like it kicked off but never actually generated anything.
  after(async () => {
    try {
      await runOutlineGeneration(id, job.session_id)
    } catch (err) {
      console.error('[outline-gen] Manual trigger failed:', err)
    }
  })

  return NextResponse.json({ success: true })
}
