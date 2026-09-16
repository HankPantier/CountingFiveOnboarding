import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/access'
import { clearAiCreditExhausted } from '@/lib/ai/ai-service-status'

export const runtime = 'nodejs'

// Admin-only: clear the global credit-outage flag after topping up Claude API
// credits, so the proactive banner disappears immediately instead of waiting for
// it to self-heal.
export async function POST() {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth
  await clearAiCreditExhausted()
  return NextResponse.json({ ok: true })
}
