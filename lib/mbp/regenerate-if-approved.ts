import type { createServerClient } from '@/lib/supabase/server'

type Supabase = ReturnType<typeof createServerClient>

// Keeps the persisted MBP deliverable (pdfs/{id}/mbp.pdf + .md) in sync after a
// post-approval schema_data edit. No-op before approval — no deliverable exists
// until then. Best-effort and non-blocking: call inside after() so an edit
// response isn't delayed by the PDF render. The generator is lazy-imported so
// @react-pdf isn't pulled into the edit routes' main bundle.
export async function regenerateMbpIfApproved(supabase: Supabase, sessionId: string): Promise<void> {
  const { data } = await supabase.from('sessions').select('status').eq('id', sessionId).single()
  if (data?.status !== 'approved') return
  try {
    const { generateAndStoreMbp } = await import('./generate-deliverable')
    await generateAndStoreMbp(supabase, sessionId)
  } catch (err) {
    console.error('[mbp-regen] post-edit regeneration failed:', err)
  }
}
