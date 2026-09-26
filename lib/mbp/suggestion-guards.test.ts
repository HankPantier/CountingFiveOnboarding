import { describe, expect, it, vi } from 'vitest'
import { isApprovableSuggestionPath, isBaseStale, jsonEqual, suggestionBaseFor } from './suggestion-guards'

describe('isApprovableSuggestionPath', () => {
  it('allows known profile sections and rejects _meta and off-schema roots', () => {
    expect(isApprovableSuggestionPath('niches[3].description')).toBe(true)
    expect(isApprovableSuggestionPath('brand.toneToAvoid')).toBe(true)
    expect(isApprovableSuggestionPath('_meta.niche_review')).toBe(false)
    expect(isApprovableSuggestionPath('_meta')).toBe(false)
    expect(isApprovableSuggestionPath('_meta.mode')).toBe(false)
    expect(isApprovableSuggestionPath('madeUpSection.x')).toBe(false)
  })
})

describe('jsonEqual', () => {
  it('ignores key order and compares arrays positionally', () => {
    expect(jsonEqual({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 })).toBe(true)
    expect(jsonEqual([1, 2], [2, 1])).toBe(false)
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })
})

describe('suggestionBaseFor / isBaseStale', () => {
  const schema = { niches: [{ name: 'Dentists', status: 'kept' }] }

  it('uses an explicit base when present', () => {
    const base = { path: 'niches[0].name', value: 'Dentists' }
    expect(suggestionBaseFor('niches[0].status', { op: 'set', proposedValue: 'dropped', rationale: '', base }, schema)).toEqual(base)
    expect(isBaseStale(base, schema)).toBe(false)
    expect(isBaseStale(base, { niches: [{ name: 'Vets' }] })).toBe(true)
  })

  it('falls back to currentValue for legacy whole-array sets', () => {
    const change = { op: 'set' as const, currentValue: [{ name: 'Dentists' }], proposedValue: [{ name: 'Vets' }], rationale: '' }
    const base = suggestionBaseFor('niches', change, schema)
    expect(base).toEqual({ path: 'niches', value: [{ name: 'Dentists' }] })
    // The live niche gained a status since the snapshot → stale.
    expect(isBaseStale(base!, schema)).toBe(true)
    expect(isBaseStale(base!, { niches: [{ name: 'Dentists' }] })).toBe(false)
  })

  it('leaves scalar sets and appends unguarded', () => {
    expect(suggestionBaseFor('business.tagline', { op: 'set', currentValue: 'a', proposedValue: 'b', rationale: '' }, {})).toBeNull()
    expect(suggestionBaseFor('team', { op: 'append', currentValue: [], proposedValue: { name: 'x' }, rationale: '' }, {})).toBeNull()
  })
})

describe('insertMbpSuggestion', () => {
  function fakeDb() {
    const inserts: Array<Record<string, unknown>> = []
    const b: Record<string, unknown> = {
      update: () => b,
      eq: () => b,
      then: (r: (v: unknown) => void) => r({ error: null }),
      insert: async (row: Record<string, unknown>) => { inserts.push(row); return { error: null } },
    }
    return { client: { from: () => b }, inserts }
  }

  it('refuses _meta paths and snapshots whole-array sets as the approval base', async () => {
    vi.resetModules()
    const { insertMbpSuggestion } = await import('./create-suggestion')
    const db = fakeDb()
    const client = db.client as unknown as Parameters<typeof insertMbpSuggestion>[0]

    const meta = await insertMbpSuggestion(client, {
      sessionId: 's1', origin: 'mbp_chat', summary: 'x',
      changes: [{ fieldPath: '_meta.niche_review', proposedValue: { done: true }, rationale: 'x' }],
    })
    expect(meta.filed).toBe(false)
    expect(db.inserts).toHaveLength(0)

    const schema = { niches: [{ name: 'Dentists' }] }
    const res = await insertMbpSuggestion(client, {
      sessionId: 's1', origin: 'site_structure', summary: 'x', schema,
      changes: [
        { fieldPath: 'niches', op: 'set', proposedValue: [{ name: 'Vets' }], rationale: 'x' },
        { fieldPath: 'business.tagline', op: 'set', proposedValue: 'Hi', rationale: 'x' },
      ],
    })
    expect(res.filed).toBe(true)
    const changes = db.inserts[0].changes as Record<string, { base?: unknown }>
    expect(changes.niches.base).toEqual({ path: 'niches', value: [{ name: 'Dentists' }] })
    expect(changes['business.tagline'].base).toBeUndefined()
  })
})
