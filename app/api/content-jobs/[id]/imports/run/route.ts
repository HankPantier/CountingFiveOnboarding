import { after, NextResponse } from 'next/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { runArticleImportsForJob, getArticleImportStatus } from '@/lib/content/article-import-inclusion'

export const runtime = 'nodejs'
export const maxDuration = 600

// Kick off importing the job's selected verbatim articles (background). The
// client polls /imports/status and gates publish on `terminal`. Idempotent —
// a re-run resumes after a timeout. Manager-gated: this fetches external images
// and commits to the repo draft branch. Also callable by the sweep cron via
// CRON_SECRET so a stalled import can't block publish forever.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('Authorization')
  const isInternalChain = !!cronSecret && authHeader === `Bearer ${cronSecret}`
  if (!isInternalChain) {
    const ctx = await requireContentJobAccess(id)
    if (ctx instanceof NextResponse) return ctx
  }

  const status = await getArticleImportStatus(id)
  if (status.terminal) return NextResponse.json({ started: false, status })

  after(async () => {
    try {
      await runArticleImportsForJob(id)
    } catch (err) {
      console.error('[imports-run] Failed:', err)
    }
  })

  return NextResponse.json({ started: true, status })
}
