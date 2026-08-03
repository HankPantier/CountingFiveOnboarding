// ---------------------------------------------------------------------------
// Pricing-calculator config validation + persistence helpers.
//
// The admin editor and API routes go through here so a malformed PUT body can
// never reach the DB or the emitted content/pricing-calculator.json. zod
// coerces/strips unknown keys and enforces the PricingCalculatorConfig shape;
// anything invalid falls back field-by-field to DEFAULT_CALCULATOR_CONFIG.
// ---------------------------------------------------------------------------
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import {
  DEFAULT_CALCULATOR_CONFIG,
  type PricingCalculatorConfig,
} from '@/types/pricing-calculator'

const idSchema = z.string().trim().min(1).max(64)
const label = z.string().trim().min(1).max(200)
// Money/multipliers are non-negative and bounded to keep the calculator honest
// and to defend the client-side math against absurd inputs.
const rate = z.number().finite().min(0).max(1_000_000)
const multiplier = z.number().finite().min(0).max(100)

const serviceLine = z.object({
  id: idSchema,
  label,
  baseRate: rate,
  enabledByDefault: z.boolean(),
  description: z.string().trim().max(400).optional(),
})

const multiplierOption = z.object({
  id: idSchema,
  label,
  multiplier,
})

const addOn = z.discriminatedUnion('type', [
  z.object({
    id: idSchema,
    label,
    type: z.literal('flat'),
    flatRate: rate,
    description: z.string().trim().max(400).optional(),
  }),
  z.object({
    id: idSchema,
    label,
    type: z.literal('per-unit'),
    unitRate: rate,
    unitLabel: z.string().trim().min(1).max(60),
    description: z.string().trim().max(400).optional(),
  }),
])

export const PricingCalculatorConfigSchema = z.object({
  version: z.literal(1).default(1),
  currency: z.string().trim().length(3).default('USD'),
  billingPeriod: z.enum(['month', 'year']).default('month'),
  intro: z.string().trim().max(600).default(DEFAULT_CALCULATOR_CONFIG.intro),
  implementationFee: z
    .object({
      amount: rate,
      label,
      weeks: z.string().trim().max(40).optional(),
    })
    .nullable()
    .default(null),
  serviceLines: z.array(serviceLine).max(20).default([]),
  sizeTiers: z.array(multiplierOption).max(12).default([]),
  complexityLevels: z.array(multiplierOption).max(12).default([]),
  addOns: z.array(addOn).max(20).default([]),
  estimateBandPct: z.number().finite().min(0).max(50).default(15),
  disclaimer: z.string().trim().max(600).default(DEFAULT_CALCULATOR_CONFIG.disclaimer),
  cta: z
    .object({ label, url: z.string().trim().min(1).max(300) })
    .default(DEFAULT_CALCULATOR_CONFIG.cta),
})

// Parse-or-fallback: returns a valid config no matter what. On a hard failure
// (non-object input) the caller gets the default so the editor stays usable.
export function normalizePricingConfig(raw: unknown): PricingCalculatorConfig {
  const result = PricingCalculatorConfigSchema.safeParse(raw)
  if (result.success) return result.data as PricingCalculatorConfig
  return DEFAULT_CALCULATOR_CONFIG
}

export type PricingCalculatorRecord = {
  config: PricingCalculatorConfig
  enabled: boolean
  exists: boolean
}

// Load a session's calculator, defaulting to DEFAULT_CALCULATOR_CONFIG (and
// enabled=true) when no row exists yet. Service-role client — RLS-bypassing,
// so callers MUST gate with requireSessionAccess first.
export async function getPricingCalculator(sessionId: string): Promise<PricingCalculatorRecord> {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('pricing_calculators')
    .select('config, enabled')
    .eq('session_id', sessionId)
    .maybeSingle()

  if (!data) {
    return { config: DEFAULT_CALCULATOR_CONFIG, enabled: true, exists: false }
  }
  return {
    config: normalizePricingConfig(data.config),
    enabled: data.enabled,
    exists: true,
  }
}

// Upsert a session's calculator config. Returns the stored (normalized) config.
export async function savePricingCalculator(
  sessionId: string,
  rawConfig: unknown,
  enabled: boolean,
  updatedBy: string | null
): Promise<PricingCalculatorConfig> {
  const config = normalizePricingConfig(rawConfig)
  const supabase = createServerClient()
  const { error } = await supabase.from('pricing_calculators').upsert(
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
