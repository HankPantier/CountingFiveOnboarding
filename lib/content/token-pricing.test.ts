import { describe, it, expect } from 'vitest'
import { estimateCostUsd } from './token-pricing'
import * as tuning from './generation-tuning'
import {
  CRITIC_MODEL,
  DESIGN_AB_CHALLENGER_MODEL,
  DESIGN_CRITIC_MODEL,
  DESIGN_MODEL,
  FAST_MODEL,
  INTERACTIVE_CHAT_MODEL,
  PUBLISHED_CONTENT_MODEL,
} from './generation-tuning'

const M = 1_000_000

describe('estimateCostUsd', () => {
  it('prices Sonnet 5 at the $2/$10 standard rate', () => {
    expect(estimateCostUsd('claude-sonnet-5', M, M)).toBeCloseTo(12)
  })

  it('applies the standard 0.1x cache-read multiplier by default', () => {
    // 1M input of which 1M is cache read on Sonnet 5 → 1M × $2 × 0.1
    expect(estimateCostUsd('claude-sonnet-5', M, 0, M, 0)).toBeCloseTo(0.2)
  })

  it('prices cache writes at 1.25x for the 5m TTL and 2x for the 1h TTL', () => {
    expect(estimateCostUsd('claude-sonnet-5', M, 0, 0, M)).toBeCloseTo(2.5)
    expect(estimateCostUsd('claude-sonnet-5', M, 0, 0, M, '1h')).toBeCloseTo(4)
  })

  it('applies the Opus 5.5 0.05x cache-read multiplier', () => {
    expect(estimateCostUsd('claude-opus-5-5', M, M)).toBeCloseTo(24)
    expect(estimateCostUsd('claude-opus-5-5', M, 0, M, 0)).toBeCloseTo(0.2)
  })

  it('still prices legacy models so historical rows keep their cost', () => {
    expect(estimateCostUsd('claude-sonnet-4-6', M, M)).toBeCloseTo(18)
    expect(estimateCostUsd('claude-opus-4-8', M, M)).toBeCloseTo(30)
  })

  it('has a PRICING entry for every model constant in generation-tuning', () => {
    const models = Object.values(tuning as Record<string, unknown>).filter((v): v is string => typeof v === 'string' && v.startsWith('claude-'))
    expect(models).toEqual(expect.arrayContaining([CRITIC_MODEL, FAST_MODEL, INTERACTIVE_CHAT_MODEL, PUBLISHED_CONTENT_MODEL]))
    for (const model of models) {
      expect(estimateCostUsd(model, M, 0), model).toBeGreaterThan(0)
    }
  })

  it('prices Sonnet 5.5 at the same $2/$10 as Sonnet 5', () => {
    expect(estimateCostUsd('claude-sonnet-5-5', M, M)).toBeCloseTo(12)
  })
})

describe('design studio model pricing', () => {
  it('prices DESIGN_MODEL (Sonnet 5.5) at $2/$10 and DESIGN_CRITIC_MODEL (Opus 5.5) at $4/$20', () => {
    expect(DESIGN_MODEL).toBe('claude-sonnet-5-5')
    expect(estimateCostUsd(DESIGN_MODEL, M, M)).toBeCloseTo(12)
    expect(DESIGN_CRITIC_MODEL).toBe('claude-opus-5-5')
    expect(estimateCostUsd(DESIGN_CRITIC_MODEL, M, M)).toBeCloseTo(24)
  })

  it('prices the A/B challenger (Fable 5.1) at 5x Sonnet 5 ($10/$50)', () => {
    expect(DESIGN_AB_CHALLENGER_MODEL).toBe('claude-fable-5-1')
    expect(estimateCostUsd(DESIGN_AB_CHALLENGER_MODEL, M, M)).toBeCloseTo(60)
  })
})
