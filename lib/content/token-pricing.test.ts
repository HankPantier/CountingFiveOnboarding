import { describe, it, expect } from 'vitest'
import { estimateCostUsd } from './token-pricing'
import {
  CRITIC_MODEL,
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

  it('has a PRICING entry for every model the app calls', () => {
    for (const model of [CRITIC_MODEL, FAST_MODEL, INTERACTIVE_CHAT_MODEL, PUBLISHED_CONTENT_MODEL]) {
      expect(estimateCostUsd(model, M, 0)).toBeGreaterThan(0)
    }
  })
})
