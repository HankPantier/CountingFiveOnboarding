import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createServerClient } from '@/lib/supabase/server'
import { resumePlan } from '@/lib/content/resume-targets'
import { runWhoisLookup } from '@/lib/whois/lookup'
import { selectResumableContentJobs, ORPHAN_RECLAIM_MS } from '@/lib/content/content-generator'

export const runtime = 'nodejs'
export const maxDuration = 300

// One 15-minute threshold used to cover every table, which meant a page whose
// worker died sat unworkable for up to 15 minutes — and since the UI warns at 4
// minutes, the operator was the only thing that could act in the 11-minute gap.
// Now that every model call carries a hard abort, each pipeline has a knowable
// ceiling for a single in-flight attempt, so each table gets its own threshold
// derived from that ceiling rather than one worst-case number for all of them.
const STUCK_THRESHOLD_MS = 15 * 60 * 1000

// Page generation: bounded by ORPHAN_RECLAIM_MS (per-call cap x the 2-rung JSON
// retry, plus slack). Past it the worker is provably gone. The chained runner
// also reclaims its own orphans now, so this is the backstop for a job whose
// chain died entirely rather than the primary recovery path.
const PAGE_STUCK_THRESHOLD_MS = ORPHAN_RECLAIM_MS

// Per-item drafting (library articles, article imports): a smaller unit of work
// than a page body (measured output p50 3,468 tokens vs 8,424), but the runner
// walks several items per invocation, so allow a full function's worth.
const DRAFT_STUCK_THRESHOLD_MS = 10 * 60 * 1000

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
  const pageCutoff = new Date(Date.now() - PAGE_STUCK_THRESHOLD_MS).toISOString()
  const draftCutoff = new Date(Date.now() - DRAFT_STUCK_THRESHOLD_MS).toISOString()

  // research_results uses `created_at` (no updated_at column); we treat a
  // row stuck in 'running' for >15 min as orphaned. generated_pages sweeps on
  // `generation_started_at` (stamped when the page is claimed) — NOT created_at,
  // which is set at sitemap-confirm and made long jobs falsely error their
  // healthy in-flight pages every cron tick.
  // resource_ideas sweeps on updated_at: the draft lock bumps it when claimed,
  // so it reflects when the in-flight run actually started (rows are created
  // at brainstorm time, long before drafting).
  // audit_runs: a row stuck in a running state with started_at older than the
  // cutoff means the worker died mid-run. Reset it to 'error' so the UI stops
  // polling and the admin can re-run.
  // 'researching' is the AI-intelligence stage — the longest one and the most
  // likely place for a worker to die; omitting it stranded audits forever.
  const RUNNING_AUDIT_STATES = ['crawling', 'analyzing', 'researching', 'scoring', 'rendering']
  // Supabase queries resolve {data,error} rather than rejecting, so this only
  // rejects on a network-level throw — but if it does, we must still reach the
  // WHOIS retry + content/batch/audit auto-resume below (the important self-
  // heal). Swallow to null and default every swept count to 0.
  const sweep = await (async () => {
    try {
      return await Promise.all([
        supabase
          .from('research_results')
          .update({ research_status: 'error' })
          .eq('research_status', 'running')
          .lt('created_at', cutoff)
          .select('id'),
        supabase
          .from('generated_pages')
          .update({ generation_status: 'error', generation_error: '[timeout] Generation worker stopped mid-run (swept by cron)' })
          .eq('generation_status', 'running')
          // Primary key is generation_started_at (stamped on claim). Also catch
          // rows with a NULL start (never stamped) that are old by created_at —
          // `.lt` alone never matches NULL, so those would otherwise orphan.
          .or(`generation_started_at.lt.${pageCutoff},and(generation_started_at.is.null,created_at.lt.${pageCutoff})`)
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
        supabase
          .from('audit_runs')
          .update({ audit_status: 'error', error_message: 'Audit timed out (swept by cron)' })
          .in('audit_status', RUNNING_AUDIT_STATES)
          .lt('started_at', cutoff)
          .select('id'),
        // blog_batch_targets stuck at 'generating' (worker died between claim and
        // terminal write) are invisible to future chained runs, which only select
        // 'pending' — so the parent batch never completes. Reset them to 'pending'
        // for the next chain to re-attempt.
        supabase
          .from('blog_batch_targets')
          .update({ status: 'pending' })
          .eq('status', 'generating')
          .lt('updated_at', cutoff)
          .select('id'),
        // new_page_generations: same 'pending'-never-claimed risk as oneoffs.
        // generateNewPage writes a terminal 'error' on any throw, so the only
        // way a row stays non-terminal is the after() worker never firing.
        supabase
          .from('new_page_generations')
          .update({ status: 'error', error: 'Generation timed out (swept by cron)' })
          .in('status', ['pending', 'running'])
          .lt('updated_at', cutoff)
          .select('id'),
      ])
    } catch (err) {
      console.error('[sweep-stuck-jobs] sweep queries failed:', err)
      return null
    }
  })()
  const [research, pages, ideas, socials, oneoffs, audits, batchTargets, newPages] =
    sweep ?? [null, null, null, null, null, null, null, null]

  // content_job_library_selections stuck at 'drafting' (worker died mid-draft —
  // the resource_ideas sweep above already reset the underlying idea to error)
  // hold the publish gate at 409 forever. Reset them to 'error' so the library
  // auto-resume below re-drafts them; a still-live idea is re-claimed idempotently.
  const { data: libSelections } = await supabase
    .from('content_job_library_selections')
    .update({ status: 'error', error: '[timeout] Draft worker stopped mid-run (swept by cron)', updated_at: new Date().toISOString() })
    .eq('status', 'drafting')
    .lt('updated_at', draftCutoff)
    .select('id')
  const librarySelectionsSwept = libSelections?.length ?? 0
  if (librarySelectionsSwept) {
    console.warn(`[sweep-stuck-jobs] library-selections reset to error=${librarySelectionsSwept}`)
  }

  // content_job_article_imports stuck at 'drafting' (worker died mid-import) hold
  // the publish gate at 409 forever. Reset to 'error' so the imports auto-resume
  // below re-runs them; importArticleAsIs re-claims idempotently.
  const { data: articleImports } = await supabase
    .from('content_job_article_imports')
    .update({ status: 'error', error: '[timeout] Import worker stopped mid-run (swept by cron)', updated_at: new Date().toISOString() })
    .eq('status', 'drafting')
    .lt('updated_at', draftCutoff)
    .select('id')
  const articleImportsSwept = articleImports?.length ?? 0
  if (articleImportsSwept) {
    console.warn(`[sweep-stuck-jobs] article-imports reset to error=${articleImportsSwept}`)
  }

  // Prune rate-limiter events older than 24h (largest window is 1h; 24h keeps
  // the table tiny without racing any active window).
  await supabase
    .from('rate_limit_events')
    .delete()
    .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

  // Sessions stranded at Phase 2: the WHOIS after()-task never completed (cold
  // kill, network drop). Re-run the lookup — it advances them to Phase 3 (and is
  // a no-op for any that have since moved on). Bounded to keep the cron quick.
  const { data: stuckSessions } = await supabase
    .from('sessions')
    .select('id, website_url')
    .eq('current_phase', 2)
    .in('status', ['pending', 'in_progress'])
    .lt('last_activity_at', cutoff)
    .limit(10)

  let whoisRetried = 0
  for (const s of stuckSessions ?? []) {
    if (!s.website_url) continue
    try {
      await runWhoisLookup(s.id, s.website_url)
      whoisRetried++
    } catch (err) {
      console.error('[sweep-stuck-jobs] WHOIS retry failed for', s.id, err)
    }
  }

  // Auto-resume content generation that stalled (Vercel killed the function
  // before the self-chain fired, or the chain's progress-guard stopped it).
  // Mirror the WHOIS retry: re-trigger /generate for any job with resumable work
  // (never-attempted `pending` pages, OR `error` pages still under the attempt
  // cap) and nothing currently running. Crucially this includes the page THIS
  // sweep just flipped `running → error` a few lines above — without it, a job
  // whose worker died mid-run strands forever at phase 5 (all pages terminal
  // except one retriable error, which the old `pending`-only filter ignored),
  // and Deliverables never unlocks. Capped-out errors are excluded so the loop
  // stays finite. The atomic per-page claim + complete-skip keep re-triggers
  // idempotent for healthy runs.
  const { data: liveGen } = await supabase
    .from('generated_pages')
    .select('content_job_id, generation_status, generation_attempts')
    .in('generation_status', ['pending', 'running', 'error'])

  const resumableJobs = selectResumableContentJobs(liveGen ?? []).slice(0, 5)

  let generationResumed = 0
  const resumeBase = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
  if (resumeBase && resumableJobs.length) {
    const url = resumeBase.startsWith('http') ? resumeBase : `https://${resumeBase}`
    for (const jobId of resumableJobs) {
      try {
        const res = await fetch(`${url}/api/content-jobs/${jobId}/generate`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cronSecret}` },
        })
        if (res.ok) generationResumed++
      } catch (err) {
        console.error('[sweep-stuck-jobs] content auto-resume failed for', jobId, err)
      }
    }
    if (generationResumed) {
      console.warn(`[sweep-stuck-jobs] content-generation auto-resumed jobs=${generationResumed}`)
    }
  }

  // Library selections: a job with non-terminal selections (pending/error) and
  // none currently drafting has no worker coming back for it — re-trigger
  // /library/run (idempotent: it reconciles in-flight rows and retries the rest).
  // Without this a stalled library draft blocks publish permanently.
  const { data: liveSelections } = await supabase
    .from('content_job_library_selections')
    .select('content_job_id, status')
    .in('status', ['pending', 'drafting', 'error'])

  // Route each job to /retry when it has failed items (the only path that can
  // reset them) and /run when it only has fresh work. See resume-targets.ts —
  // always calling /run made this whole block a silent no-op for all-error jobs.
  const libraryPlan = resumePlan(liveSelections ?? [])

  let librarySelectionsResumed = 0
  if (resumeBase && libraryPlan.length) {
    const url = resumeBase.startsWith('http') ? resumeBase : `https://${resumeBase}`
    for (const { jobId, endpoint } of libraryPlan) {
      try {
        const res = await fetch(`${url}/api/content-jobs/${jobId}/library/${endpoint}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cronSecret}` },
        })
        if (res.ok) librarySelectionsResumed += 1
      } catch (err) {
        console.error('[sweep-stuck-jobs] library auto-resume failed for', jobId, err)
      }
    }
    if (librarySelectionsResumed) {
      console.warn(`[sweep-stuck-jobs] library-selections auto-resumed jobs=${librarySelectionsResumed}`)
    }
  }

  // Article imports: same recovery as library selections — a job with open
  // (pending/error) imports and none drafting has no worker; re-trigger
  // /imports/run (idempotent). Without this a stalled import blocks publish.
  const { data: liveImports } = await supabase
    .from('content_job_article_imports')
    .select('content_job_id, status')
    .in('status', ['pending', 'drafting', 'error'])

  const importPlan = resumePlan(liveImports ?? [])

  let articleImportsResumed = 0
  if (resumeBase && importPlan.length) {
    const url = resumeBase.startsWith('http') ? resumeBase : `https://${resumeBase}`
    for (const { jobId, endpoint } of importPlan) {
      try {
        const res = await fetch(`${url}/api/content-jobs/${jobId}/imports/${endpoint}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cronSecret}` },
        })
        if (res.ok) articleImportsResumed += 1
      } catch (err) {
        console.error('[sweep-stuck-jobs] article-import auto-resume failed for', jobId, err)
      }
    }
    if (articleImportsResumed) {
      console.warn(`[sweep-stuck-jobs] article-imports auto-resumed jobs=${articleImportsResumed}`)
    }
  }

  // Blog batches: a target reset to 'pending' above (or a chain that died
  // before firing) has no worker coming back for it — re-trigger the batch
  // runner the same way content generation is auto-resumed.
  const { data: liveBatchTargets } = await supabase
    .from('blog_batch_targets')
    .select('batch_id, status')
    .in('status', ['pending', 'generating'])

  const batchCounts = new Map<string, { pending: number; generating: number }>()
  for (const t of liveBatchTargets ?? []) {
    const c = batchCounts.get(t.batch_id) ?? { pending: 0, generating: 0 }
    if (t.status === 'generating') c.generating++
    else c.pending++
    batchCounts.set(t.batch_id, c)
  }
  const resumableBatches = [...batchCounts.entries()]
    .filter(([, c]) => c.pending > 0 && c.generating === 0)
    .map(([batchId]) => batchId)
    .slice(0, 5)

  let batchesResumed = 0
  if (resumeBase && resumableBatches.length) {
    const url = resumeBase.startsWith('http') ? resumeBase : `https://${resumeBase}`
    for (const batchId of resumableBatches) {
      try {
        const res = await fetch(`${url}/api/blog-batches/${batchId}/generate`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cronSecret}` },
        })
        if (res.ok) batchesResumed++
      } catch (err) {
        console.error('[sweep-stuck-jobs] blog-batch auto-resume failed for', batchId, err)
      }
    }
    if (batchesResumed) {
      console.warn(`[sweep-stuck-jobs] blog-batches auto-resumed=${batchesResumed}`)
    }
  }

  // Audit batches: the runner self-chains via after(), which Vercel may kill
  // before the next hop fires. The audit_runs sweep above already reset any
  // >15-min-stuck run to 'error', so a stalled batch now shows queued rows and
  // nothing running — re-trigger its sequential runner the same way.
  const { data: runningBatches } = await supabase
    .from('audit_batches')
    .select('id')
    .eq('status', 'running')

  let auditBatchesResumed = 0
  if (resumeBase && runningBatches?.length) {
    const batchIds = runningBatches.map((b) => b.id)
    const { data: batchRuns } = await supabase
      .from('audit_runs')
      .select('audit_batch_id, audit_status')
      .in('audit_batch_id', batchIds)

    const RUNNING_AUDIT = new Set(RUNNING_AUDIT_STATES)
    const auditBatchCounts = new Map<string, { queued: number; running: number }>()
    for (const r of batchRuns ?? []) {
      if (!r.audit_batch_id) continue
      const c = auditBatchCounts.get(r.audit_batch_id) ?? { queued: 0, running: 0 }
      if (r.audit_status === 'queued') c.queued += 1
      else if (RUNNING_AUDIT.has(r.audit_status)) c.running += 1
      auditBatchCounts.set(r.audit_batch_id, c)
    }
    const resumableAuditBatches = [...auditBatchCounts.entries()]
      .filter(([, c]) => c.queued > 0 && c.running === 0)
      .map(([batchId]) => batchId)
      .slice(0, 5)

    const url = resumeBase.startsWith('http') ? resumeBase : `https://${resumeBase}`
    for (const batchId of resumableAuditBatches) {
      try {
        const res = await fetch(`${url}/api/audit-batches/${batchId}/run`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cronSecret}` },
        })
        if (res.ok) auditBatchesResumed += 1
      } catch (err) {
        console.error('[sweep-stuck-jobs] audit-batch auto-resume failed for', batchId, err)
      }
    }
    if (auditBatchesResumed) {
      console.warn(`[sweep-stuck-jobs] audit-batches auto-resumed=${auditBatchesResumed}`)
    }
  }

  const researchSwept = research?.data?.length ?? 0
  const pagesSwept = pages?.data?.length ?? 0
  const ideasSwept = ideas?.data?.length ?? 0
  const socialsSwept = socials?.data?.length ?? 0
  const oneoffsSwept = oneoffs?.data?.length ?? 0
  const auditsSwept = audits?.data?.length ?? 0
  const batchTargetsSwept = batchTargets?.data?.length ?? 0
  const newPagesSwept = newPages?.data?.length ?? 0
  if (batchTargetsSwept) {
    console.warn(`[sweep-stuck-jobs] blog-batch-targets reset to pending=${batchTargetsSwept}`)
  }

  if (whoisRetried) {
    console.warn(`[sweep-stuck-jobs] whois-retried=${whoisRetried} cutoff=${cutoff}`)
  }

  if (researchSwept || pagesSwept || ideasSwept || socialsSwept || oneoffsSwept || auditsSwept || newPagesSwept) {
    console.warn(
      `[sweep-stuck-jobs] research=${researchSwept} pages=${pagesSwept} ideas=${ideasSwept} socials=${socialsSwept} oneoffs=${oneoffsSwept} audits=${auditsSwept} newPages=${newPagesSwept} cutoff=${cutoff}`
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
          auditsSwept && `${auditsSwept} site audit(s)`,
          newPagesSwept && `${newPagesSwept} new-page draft(s)`,
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

  return NextResponse.json({ researchSwept, pagesSwept, ideasSwept, socialsSwept, oneoffsSwept, auditsSwept, batchTargetsSwept, newPagesSwept, librarySelectionsSwept, articleImportsSwept, whoisRetried, generationResumed, batchesResumed, auditBatchesResumed, librarySelectionsResumed, articleImportsResumed, cutoff })
}
