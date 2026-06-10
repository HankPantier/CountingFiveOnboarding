import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const STUCK_THRESHOLD_MS = 15 * 60 * 1000

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString()

  // research_results uses `created_at` (no updated_at column); we treat a
  // row stuck in 'running' for >15 min as orphaned. generated_pages has
  // `created_at` too; the running flag is set inside generateSinglePage
  // so the same heuristic applies.
  // resource_ideas sweeps on updated_at: the draft lock bumps it when claimed,
  // so it reflects when the in-flight run actually started (rows are created
  // at brainstorm time, long before drafting).
  const [research, pages, ideas, socials, oneoffs] = await Promise.all([
    supabase
      .from('research_results')
      .update({ research_status: 'error' })
      .eq('research_status', 'running')
      .lt('created_at', cutoff)
      .select('id'),
    supabase
      .from('generated_pages')
      .update({ generation_status: 'error' })
      .eq('generation_status', 'running')
      .lt('created_at', cutoff)
      .select('id'),
    supabase
      .from('resource_ideas')
      .update({ draft_status: 'error', draft_error: 'Draft timed out (swept by cron)' })
      .eq('draft_status', 'running')
      .lt('updated_at', cutoff)
      .select('id'),
    supabase
      .from('resource_ideas')
      .update({ social_status: 'error' })
      .eq('social_status', 'running')
      .lt('updated_at', cutoff)
      .select('id'),
    // 'pending' rows are swept too: a row stuck in pending means the
    // after() worker never ran (deploy restart, crash before claim).
    supabase
      .from('oneoff_generations')
      .update({ status: 'error', error: 'Generation timed out (swept by cron)' })
      .in('status', ['pending', 'running'])
      .lt('updated_at', cutoff)
      .select('id'),
  ])

  const researchSwept = research.data?.length ?? 0
  const pagesSwept = pages.data?.length ?? 0
  const ideasSwept = ideas.data?.length ?? 0
  const socialsSwept = socials.data?.length ?? 0
  const oneoffsSwept = oneoffs.data?.length ?? 0

  if (researchSwept || pagesSwept || ideasSwept || socialsSwept || oneoffsSwept) {
    console.warn(
      `[sweep-stuck-jobs] research=${researchSwept} pages=${pagesSwept} ideas=${ideasSwept} socials=${socialsSwept} oneoffs=${oneoffsSwept} cutoff=${cutoff}`
    )

    // Stuck rows mean a pipeline run died mid-flight — tell the admin instead
    // of resetting silently. Fail-soft: a mail hiccup must not fail the cron.
    const adminEmail = process.env.ADMIN_EMAIL
    const fromEmail = process.env.RESEND_FROM_EMAIL
    if (adminEmail && fromEmail && process.env.RESEND_API_KEY) {
      try {
        const parts = [
          researchSwept && `${researchSwept} research`,
          pagesSwept && `${pagesSwept} page generation(s)`,
          ideasSwept && `${ideasSwept} blog draft(s)`,
          socialsSwept && `${socialsSwept} social generation(s)`,
          oneoffsSwept && `${oneoffsSwept} one-off generation(s)`,
        ].filter(Boolean)
        const resend = new Resend(process.env.RESEND_API_KEY)
        await resend.emails.send({
          from: fromEmail,
          to: adminEmail,
          subject: `[Revaltus] Stuck jobs swept — ${parts.join(', ')}`,
          html: `
            <h2>Stuck Pipeline Jobs Reset</h2>
            <p>The sweep cron reset rows stuck in 'running' for over 15 minutes: ${parts.join(', ')}.</p>
            <p>They're now marked as errors — check the affected jobs and retry from the admin UI.</p>
            <p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ''}/admin/dashboard">Open dashboard →</a></p>
          `,
        })
      } catch (err) {
        console.error('[sweep-stuck-jobs] alert email failed:', err)
      }
    }
  }

  return NextResponse.json({ researchSwept, pagesSwept, ideasSwept, socialsSwept, oneoffsSwept, cutoff })
}
