import { NextResponse } from 'next/server'
import { resolveEditContext } from '../_helpers'
import { denySiteOwnerConfig } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { getPricingPlans, savePricingPlans } from '@/lib/content/pricing-plans-config'
import { readPricingPlansFromRepo, syncPricingPlansToRepo } from '@/lib/content/pricing-plans-repo-sync'
import { seedPricingPlans } from '@/lib/content/pricing-plans-seed'
import { PRICING_PLANS_URL } from '@/lib/content/pricing-plans-json-builder'
import { getPricingCalculator, savePricingCalculator } from '@/lib/content/pricing-calculator-config'
import { readPricingCalculatorFromRepo, syncPricingCalculatorToRepo } from '@/lib/content/pricing-calculator-repo-sync'
import { seedPricingCalculator } from '@/lib/content/pricing-calculator-seed'
import { PRICING_CALCULATOR_URL } from '@/lib/content/pricing-calculator-json-builder'
import type { SessionSchema } from '@/types/session-schema'

export const runtime = 'nodejs'
// A single Haiku seed call plus a few GitHub writes — 60s is ample.
export const maxDuration = 60

interface Body {
  kind?: 'plans' | 'calculator'
}

// Create a config-driven pricing page (/pricing or /pricing-calculator) from the
// editor's "New page" dialog. Unlike a standard markdown page, this enables the
// pricing config and pushes the JSON + host page + nav entry to the draft branch;
// the operator then refines the numbers in the pricing editor and publishes.
// An existing config (DB row or repo file) is reused as-is (never re-seeded); a
// brand-new one is drafted from the firm's pricing + audit-captured pricing.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx
  // Pricing config is a staff-only config surface (CLAUDE.md rule 6).
  const denied = denySiteOwnerConfig(ctx.user)
  if (denied) return denied

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const kind = body.kind === 'calculator' ? 'calculator' : body.kind === 'plans' ? 'plans' : null
  if (!kind) {
    return NextResponse.json({ error: 'kind must be "plans" or "calculator"' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', ctx.sessionId)
    .single()
  const schema = (session?.schema_data ?? {}) as SessionSchema
  const firmName = schema.business?.name ?? 'the firm'
  const actor = { name: ctx.adminName, email: ctx.adminEmail }

  try {
    if (kind === 'plans') {
      const db = await getPricingPlans(ctx.sessionId)
      const config = db.exists
        ? db.config
        : (await readPricingPlansFromRepo(ctx.githubRepo)) ??
          (await seedPricingPlans({ schema, sessionId: ctx.sessionId, contentJobId: ctx.jobId }))
      await savePricingPlans(ctx.sessionId, config, true, ctx.user.id)
      const sync = await syncPricingPlansToRepo({ githubRepo: ctx.githubRepo, config, enabled: true, firmName, actor })
      if (!sync.ok) return NextResponse.json({ error: sync.error ?? 'Failed to add the pricing page' }, { status: 502 })
      return NextResponse.json({ url: PRICING_PLANS_URL, editorPath: `/admin/content/${id}/plans` })
    }

    const db = await getPricingCalculator(ctx.sessionId)
    const config = db.exists
      ? db.config
      : (await readPricingCalculatorFromRepo(ctx.githubRepo)) ??
        (await seedPricingCalculator({ schema, sessionId: ctx.sessionId, contentJobId: ctx.jobId }))
    await savePricingCalculator(ctx.sessionId, config, true, ctx.user.id)
    const sync = await syncPricingCalculatorToRepo({ githubRepo: ctx.githubRepo, config, enabled: true, firmName, actor })
    if (!sync.ok) return NextResponse.json({ error: sync.error ?? 'Failed to add the calculator page' }, { status: 502 })
    return NextResponse.json({ url: PRICING_CALCULATOR_URL, editorPath: `/admin/content/${id}/pricing-calculator` })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
