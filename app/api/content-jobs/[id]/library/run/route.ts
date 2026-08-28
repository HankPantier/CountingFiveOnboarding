import { after, NextResponse } from 'next/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { runLibrarySelectionsForJob, getLibrarySelectionStatus } from '@/lib/content/library-inclusion'

export const runtime = 'nodejs'
export const maxDuration = 600

// Kick off drafting of the job's included library articles (background). The
// client polls /library/status and gates publish on `terminal`. Idempotent —
// a re-run resumes after a timeout. Manager-gated: this spends generation budget
// and commits to the repo draft branch.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Two valid auth paths (mirrors the outlines/generate route):
  //   1. Admin/manager session — when a human triggers from Deliverables.
  //   2. Bearer CRON_SECRET — when the sweep cron auto-resumes a job whose
  //      library draft stalled (otherwise publish stays blocked forever).
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('Authorization')
  const isInternalChain = !!cronSecret && authHeader === `Bearer ${cronSecret}`
  if (!isInternalChain) {
    const ctx = await requireContentJobAccess(id)
    if (ctx instanceof NextResponse) return ctx
  }

  const status = await getLibrarySelectionStatus(id)
  if (status.terminal) return NextResponse.json({ started: false, status })

  after(async () => {
    try {
      await runLibrarySelectionsForJob(id)
    } catch (err) {
      console.error('[library-run] Failed:', err)
    }
  })

  return NextResponse.json({ started: true, status })
}
