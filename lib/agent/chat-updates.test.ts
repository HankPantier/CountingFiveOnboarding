import { describe, expect, it } from 'vitest'
import { applyChatUpdates, resolveGapsAfterUpdate, sanitizeChatUpdates } from './chat-updates'
import { validatePhaseAdvance } from './phase-validators'
import type { GapItem } from '@/types/gap-item'

const gap = (field: string, tier: 1 | 2 | 3 = 1, resolved = false): GapItem => ({
  field, label: field, phase: 4, tier, resolved,
})

describe('applyChatUpdates', () => {
  const current = {
    niches: [{ name: 'A', painPoints: '' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
    business: { name: 'Firm', tagline: 'old' },
    _meta: { mode: 'staff', phase3_completed_chunks: ['chunk1'] },
  }

  it('bracket path updates one element and preserves every sibling', () => {
    const out = applyChatUpdates(current, { 'niches[2].painPoints': 'cash flow' })
    const niches = out.niches as Array<Record<string, unknown>>
    expect(niches).toHaveLength(4)
    expect(niches.map(n => n.name)).toEqual(['A', 'B', 'C', 'D'])
    expect(niches[2].painPoints).toBe('cash flow')
  })

  it('dotted object path sets a nested field without touching its siblings', () => {
    const out = applyChatUpdates(current, { 'business.tagline': 'new' })
    expect(out.business).toEqual({ name: 'Firm', tagline: 'new' })
  })

  it('deep-merges a whole _meta object and keeps append-only markers', () => {
    const out = applyChatUpdates(current, { _meta: { phase3_completed_chunks: ['chunk2a'] } })
    const meta = out._meta as Record<string, unknown>
    expect(meta.mode).toBe('staff')
    expect(meta.phase3_completed_chunks).toEqual(['chunk1', 'chunk2a'])
  })

  it('does not mutate the input schema', () => {
    const before = JSON.stringify(current)
    applyChatUpdates(current, { 'niches[0].name': 'Z', 'business.tagline': 'x' })
    expect(JSON.stringify(current)).toBe(before)
  })
})

describe('sanitizeChatUpdates', () => {
  it('drops server-owned _meta keys from a whole-object write', () => {
    const out = sanitizeChatUpdates({
      _meta: { niche_review: { done: true }, mode: 'client', phase3_completed_chunks: ['chunk2b'] },
    })
    expect(out).toEqual({ _meta: { phase3_completed_chunks: ['chunk2b'] } })
  })

  it('drops a non-object _meta (e.g. null) entirely', () => {
    expect(sanitizeChatUpdates({ _meta: null, 'business.name': 'X' })).toEqual({ 'business.name': 'X' })
  })

  it('drops disallowed dotted _meta paths but keeps allowlisted ones', () => {
    const out = sanitizeChatUpdates({
      '_meta.geo_review': { scope: 'national' },
      '_meta.services_review.done': true,
      '_meta.opportunities_confirmed': ['x'],
    })
    expect(out).toEqual({ '_meta.opportunities_confirmed': ['x'] })
  })

  it('a sanitized review-marker write cannot bypass the phase 3 gate', () => {
    const schema = applyChatUpdates(
      {
        niches: [{ name: 'Dental' }],
        culture: { linkedIn: { url: null } },
        business: { googleBusinessProfile: { url: null } },
        _meta: {},
      },
      sanitizeChatUpdates({
        _meta: {
          phase3_completed_chunks: ['chunk1', 'chunk2a', 'chunk2b'],
          niche_review: { ok: true },
          geo_review: { ok: true },
        },
      })
    )
    expect(validatePhaseAdvance(3, schema, [])).toMatch(/industry keep\/drop review/)
  })
})

describe('resolveGapsAfterUpdate', () => {
  it('resolves a gap whose field is filled even when not listed', () => {
    const out = resolveGapsAfterUpdate([gap('business.foundingYear')], { business: { foundingYear: 1999 } }, [])
    expect(out[0].resolved).toBe(true)
  })

  it('does NOT resolve an explicitly-listed gap whose field is still empty', () => {
    const out = resolveGapsAfterUpdate([gap('brand.voiceExample')], { brand: { voiceExample: '' } }, ['brand.voiceExample'])
    expect(out[0].resolved).toBe(false)
    expect(out[0].resolvedBy).toBe('model_skip')
    expect(validatePhaseAdvance(4, {}, out)).toMatch(/Tier 1/)
  })

  it('accepts the "None" sentinel as an answer', () => {
    const out = resolveGapsAfterUpdate([gap('brand.voiceExample')], { brand: { voiceExample: 'None' } }, ['brand.voiceExample'])
    expect(out[0].resolved).toBe(true)
    expect(validatePhaseAdvance(4, {}, out)).toBeNull()
  })

  it('resolves an explicitly-listed boolean field', () => {
    const out = resolveGapsAfterUpdate([gap('brand.hasBrandGuide')], { brand: { hasBrandGuide: false } }, ['brand.hasBrandGuide'])
    expect(out[0].resolved).toBe(true)
  })

  it('leaves a boolean field unresolved when not explicitly listed', () => {
    const out = resolveGapsAfterUpdate([gap('brand.hasBrandGuide')], { brand: { hasBrandGuide: false } }, [])
    expect(out[0].resolved).toBe(false)
    expect(out[0].resolvedBy).toBeUndefined()
  })
})
