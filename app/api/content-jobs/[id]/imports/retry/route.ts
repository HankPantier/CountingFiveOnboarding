import { after, NextResponse } from 'next/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import {
  resetFailedArticleImports,
  runArticleImportsForJob,
  getArticleImportStatus,
} from '@/lib/content/article-import-inclusion'

export const runtime = 'nodejs'
export const maxDuration = 600

// Retry the job's FAILED verbatim imports. Unlike /imports/run (skipped once the
// job is terminal), this resets error rows to pending first, so a genuinely-
// failed import can be re-attempted on demand. Manager-gated; the sweep cron may
// also call it with CRON_SECRET.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('Authorization')
  const isInternalChain = !!cronSecret && authHeader === `Bearer ${cronSecret}`
  if (!isInternalChain) {
    const ctx = await requireContentJobAccess(id)
    if (ctx instanceof NextResponse) return ctx
  }

  const reset = await resetFailedArticleImports(id)
  if (reset === 0) {
    return NextResponse.json({ retried: 0, status: await getArticleImportStatus(id) })
  }

  after(async () => {
    try {
      await runArticleImportsForJob(id)
    } catch (err) {
      console.error('[imports-retry] Failed:', err)
    }
  })

  return NextResponse.json({ retried: reset, status: await getArticleImportStatus(id) })
}
