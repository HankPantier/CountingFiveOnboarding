import { after, NextResponse } from 'next/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import {
  resetFailedLibrarySelections,
  runLibrarySelectionsForJob,
  getLibrarySelectionStatus,
} from '@/lib/content/library-inclusion'
import { isCronBearer } from '@/lib/auth/cron-bearer'

export const runtime = 'nodejs'
export const maxDuration = 600

// Retry the job's FAILED included-library articles. Unlike /library/run (which is
// skipped once the job is terminal), this resets error rows back to pending first,
// so a genuinely-failed draft — API usage limit, timeout, or unparseable output —
// can be re-attempted on demand. Manager-gated (spends generation budget, commits
// to the repo draft branch); the sweep cron may also call it with CRON_SECRET.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const isInternalChain = isCronBearer(req)
  if (!isInternalChain) {
    const ctx = await requireContentJobAccess(id)
    if (ctx instanceof NextResponse) return ctx
  }

  // Refuse while a runner is in flight — resetting + starting another would put
  // two runners on the same repo draft branch.
  const current = await getLibrarySelectionStatus(id)
  if (current.drafting > 0) {
    return NextResponse.json({ retried: 0, alreadyRunning: true, status: current })
  }

  // A human retry resets the attempt counters too; the cron/self-chain only
  // resets rows still under the auto-retry cap.
  const reset = await resetFailedLibrarySelections(id, { manual: !isInternalChain })
  if (reset === 0) {
    return NextResponse.json({ retried: 0, status: await getLibrarySelectionStatus(id) })
  }

  after(async () => {
    try {
      await runLibrarySelectionsForJob(id)
    } catch (err) {
      console.error('[library-retry] Failed:', err)
    }
  })

  return NextResponse.json({ retried: reset, status: await getLibrarySelectionStatus(id) })
}
