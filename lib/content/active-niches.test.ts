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

  it('drops null / non-object holes so generators never see corrupt rows', () => {
    // A bracket-path write (niches[10].x) to a shorter array leaves undefined
    // slots that serialize to null in JSONB. The stored array keeps its indices
    // (gap-path stability), but no generator should ever receive a null.
    const schema = {
      niches: [niche('Dental'), null, 'oops', niche('Legal', 'dropped'), niche('Nonprofit')],
    } as unknown as SessionSchema
    expect(activeNiches(schema).map(n => n.name)).toEqual(['Dental', 'Nonprofit'])
  })
})
