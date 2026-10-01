import { after, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { isCronBearer } from '@/lib/auth/cron-bearer'
import { runQaForPage } from '@/lib/content/qa/run-qa'
import { maybeCompleteAfterQa } from '@/lib/content/content-generator'

export const runtime = 'nodejs'
export const maxDuration = 300

interface QaRunBody { pageId?: unknown }

// QA worker for ONE page. Auth: the internal Bearer CRON_SECRET (generator +
// sweep cron) or a human with content-job access (manual re-run).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isCronBearer(req)) {
    const auth = await requireContentJobAccess(id)
    if (auth instanceof NextResponse) return auth
  }
  let body: QaRunBody
  try { body = (await req.json()) as QaRunBody } catch { body = {} }
  if (typeof body.pageId !== 'string' || !body.pageId) {
    return NextResponse.json({ error: 'pageId is required' }, { status: 400 })
  }
  const pageId = body.pageId
  after(async () => {
    try {
      await runQaForPage(id, pageId)
      // The last page's QA to land finishes the job (phase 5→6 + email);
      // completeContentJob's fenced update keeps that to exactly one caller.
      await maybeCompleteAfterQa(createServerClient(), id)
    } catch (err) {
      console.error('[qa] worker failed:', err)
    }
  })
  return NextResponse.json({ queued: true }, { status: 202 })
}
