// ---------------------------------------------------------------------------
// Pricing-plans config validation + persistence helpers.
//
// The admin editor and API routes go through here so a malformed PUT body can
// never reach the DB or the emitted content/pricing-plans.json. zod coerces /
// strips unknown keys and enforces the PricingPlansConfig shape; anything
// invalid falls back to DEFAULT_PLANS_CONFIG. A superRefine keeps at most one
// tier flagged most-popular (extras are coerced to false, never rejected).
// ---------------------------------------------------------------------------
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import {
  DEFAULT_PLANS_CONFIG,
  type PricingPlansConfig,
} from '@/types/pricing-plans'

const idSchema = z.string().trim().min(1).max(64)
const label = z.string().trim().min(1).max(200)
// Money is non-negative and bounded to keep the page honest and defend the
// display against absurd inputs.
const money = z.number().finite().min(0).max(1_000_000)

const planFeature = z.object({
  id: idSchema,
  label,
  included: z.boolean(),
})

const planTier = z.object({
  id: idSchema,
  name: label,
  description: z.string().trim().max(400).optional(),
  monthlyPrice: money,
  annualPrice: money,
  priceSuffix: z.string().trim().max(40).optional(),
  isMostPopular: z.boolean().default(false),
  features: z.array(planFeature).max(20).default([]),
  cta: z.object({ label, url: z.string().trim().min(1).max(300) }),
})

const addOn = z.discriminatedUnion('type', [
  z.object({
    id: idSchema,
    label,
    type: z.literal('flat'),
    price: money,
    cadence: z.enum(['month', 'year', 'once']),
    description: z.string().trim().max(400).optional(),
  }),
  z.object({
    id: idSchema,
    label,
    type: z.literal('per-unit'),
    unitPrice: money,
    unitLabel: z.string().trim().min(1).max(60),
    description: z.string().trim().max(400).optional(),
  }),
])

const billing = z.object({
  showToggle: z.boolean().default(true),
  defaultCadence: z.enum(['monthly', 'annual']).default('monthly'),
  annualDiscountPct: z.number().finite().min(0).max(90).default(15),
  monthlyLabel: z.string().trim().min(1).max(40).default('Monthly'),
  annualLabel: z.string().trim().min(1).max(40).default('Annual'),
})

export const PricingPlansConfigSchema = z
  .object({
    version: z.literal(1).default(1),
    currency: z.string().trim().length(3).default('USD'),
    intro: z.string().trim().max(600).default(DEFAULT_PLANS_CONFIG.intro),
    billing: billing.default(DEFAULT_PLANS_CONFIG.billing),
    tiers: z.array(planTier).max(6).default([]),
    sharedFeatures: z
      .object({
        heading: z.string().trim().max(120).default(DEFAULT_PLANS_CONFIG.sharedFeatures.heading),
        items: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
      })
      .default(DEFAULT_PLANS_CONFIG.sharedFeatures),
    addOns: z.array(addOn).max(20).default([]),
    disclaimer: z.string().trim().max(600).default(DEFAULT_PLANS_CONFIG.disclaimer),
    cta: z
      .object({ label, url: z.string().trim().min(1).max(300) })
      .default(DEFAULT_PLANS_CONFIG.cta),
  })
  // Enforce at most one most-popular tier — the first flagged wins, the rest are
  // demoted so the template never highlights two cards.
  .transform((cfg) => {
    let seenPopular = false
    cfg.tiers = cfg.tiers.map((t) => {
      if (t.isMostPopular && !seenPopular) {
        seenPopular = true
        return t
      }
      return t.isMostPopular ? { ...t, isMostPopular: false } : t
    })
    return cfg
  })

// Parse-or-fallback: returns a valid config no matter what. On a hard failure
// (non-object input) the caller gets the default so the editor stays usable.
export function normalizePricingPlansConfig(raw: unknown): PricingPlansConfig {
  const result = PricingPlansConfigSchema.safeParse(raw)
  if (result.success) return result.data as PricingPlansConfig
  return DEFAULT_PLANS_CONFIG
}

export type PricingPlansRecord = {
  config: PricingPlansConfig
  enabled: boolean
  exists: boolean
}

// Load a session's plans config, defaulting to DEFAULT_PLANS_CONFIG (and
// enabled=true) when no row exists yet. Service-role client — RLS-bypassing, so
// callers MUST gate with requireSessionAccess first.
export async function getPricingPlans(sessionId: string): Promise<PricingPlansRecord> {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('pricing_plans')
    .select('config, enabled')
    .eq('session_id', sessionId)
    .maybeSingle()

  if (!data) {
    return { config: DEFAULT_PLANS_CONFIG, enabled: true, exists: false }
  }
  return {
    config: normalizePricingPlansConfig(data.config),
    enabled: data.enabled,
    exists: true,
  }
}

// Upsert a session's plans config. Returns the stored (normalized) config.
export async function savePricingPlans(
  sessionId: string,
  rawConfig: unknown,
  enabled: boolean,
  updatedBy: string | null
): Promise<PricingPlansConfig> {
  const config = normalizePricingPlansConfig(rawConfig)
  const supabase = createServerClient()
  const { error } = await supabase.from('pricing_plans').upsert(
    {
      session_id: sessionId,
      config: asJson(config),
      enabled,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'session_id' }
  )
  if (error) throw new Error(error.message)
  return config
}
