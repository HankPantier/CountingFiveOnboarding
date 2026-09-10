import { describe, expect, it } from 'vitest'
import { activeNiches } from './active-niches'
import type { SessionSchema } from '@/types/session-schema'

const niche = (name: string, status?: 'kept' | 'dropped') =>
  ({ name, description: '', icp: '', painPoints: '', valueProp: '', ...(status ? { status } : {}) })

describe('activeNiches', () => {
  it('treats a missing status as active (legacy sessions)', () => {
    const schema = { niches: [niche('Dental'), niche('Legal')] } as SessionSchema
    expect(activeNiches(schema).map(n => n.name)).toEqual(['Dental', 'Legal'])
  })

  it('excludes dropped niches, keeps kept + unmarked', () => {
    const schema = {
      niches: [niche('Dental', 'kept'), niche('Legal', 'dropped'), niche('Nonprofit')],
    } as SessionSchema
    expect(activeNiches(schema).map(n => n.name)).toEqual(['Dental', 'Nonprofit'])
  })

  it('returns [] for a missing or non-array niches field', () => {
    expect(activeNiches({} as SessionSchema)).toEqual([])
    expect(activeNiches({ niches: 'oops' as unknown as SessionSchema['niches'] } as SessionSchema)).toEqual([])
  })
})
