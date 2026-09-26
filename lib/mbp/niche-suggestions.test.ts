import { describe, expect, it } from 'vitest'
import { buildNicheSuggestions } from './niche-suggestions'
import type { SessionSchema } from '@/types/session-schema'

const schema = {
  niches: [
    { name: 'Dentists', status: 'kept' },
    { name: 'Restaurants' },
    { name: 'Churches', status: 'dropped' },
  ],
} as unknown as Pick<SessionSchema, 'niches'>

describe('buildNicheSuggestions', () => {
  it('drops by element path guarded on the name, never a whole-array set', () => {
    const { suggestions, skipped } = buildNicheSuggestions(schema, new Set(['restaurants', 'plumbers']), [])
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].changes).toEqual([
      expect.objectContaining({ fieldPath: 'niches[1].status', op: 'set', proposedValue: 'dropped', basePath: 'niches[1].name' }),
    ])
    expect(skipped).toEqual(['"plumbers" is not in the profile'])
    expect(suggestions.flatMap(s => s.changes).some(c => c.fieldPath === 'niches' && c.op === 'set')).toBe(false)
  })

  it('files one append per added niche with status/origin, restores a dropped one, skips active', () => {
    const { suggestions, skipped } = buildNicheSuggestions(schema, new Set(), [
      { name: 'Veterinarians', description: 'Vet clinics' },
      { name: 'Law Firms' },
      { name: 'churches' },
      { name: 'Dentists' },
    ])
    const appends = suggestions.filter(s => s.changes[0].op === 'append')
    expect(appends.map(s => (s.changes[0].proposedValue as { name: string }).name)).toEqual(['Veterinarians', 'Law Firms'])
    expect(appends[0].changes[0].proposedValue).toMatchObject({ status: 'kept', origin: 'site', description: 'Vet clinics' })
    const restore = suggestions.find(s => s.changes[0].fieldPath === 'niches[2].status')
    expect(restore?.changes[0]).toMatchObject({ proposedValue: 'kept', basePath: 'niches[2].name' })
    expect(skipped).toEqual(['"Dentists" is already an active niche'])
  })
})
