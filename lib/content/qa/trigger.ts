import { qaMode } from './mode'

// Fire one page's QA in its own function invocation (own time budget, never
// shares the generator's). Fails soft: the sweep cron re-triggers queued rows.
export async function triggerQa(contentJobId: string, pageId: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
  const secret = process.env.CRON_SECRET
  if (!base || !secret) {
    // In 'on' mode a trigger that can never fire holds phase 6 until the
    // sweep's 30-min queued time-box — that's a misconfiguration, not noise.
    const msg = '[qa] trigger skipped — NEXT_PUBLIC_APP_URL or CRON_SECRET missing'
    if (qaMode() === 'on') console.error(msg)
    else console.warn(msg)
    return false
  }
  const url = `${base.startsWith('http') ? base : `https://${base}`}/api/content-jobs/${contentJobId}/qa/run`
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId }),
    })
    return res.ok
  } catch (err) {
    console.error('[qa] trigger failed:', err)
    return false
  }
}
