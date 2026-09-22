import { describe, expect, it } from 'vitest'
import { activeServices } from './active-services'
import type { SessionSchema } from '@/types/session-schema'

const service = (name: string, status?: 'kept' | 'dropped') =>
  ({ name, description: '', offerings: [] as string[], ...(status ? { status } : {}) })

describe('activeServices', () => {
  it('treats a missing status as active (legacy sessions)', () => {
    const schema = { services: [service('Bookkeeping'), service('Tax Prep')] } as SessionSchema
    expect(activeServices(schema).map(s => s.name)).toEqual(['Bookkeeping', 'Tax Prep'])
  })

  it('excludes dropped services, keeps kept + unmarked', () => {
    const schema = {
      services: [service('Bookkeeping', 'kept'), service('Tax Prep', 'dropped'), service('Payroll')],
    } as SessionSchema
    expect(activeServices(schema).map(s => s.name)).toEqual(['Bookkeeping', 'Payroll'])
  })

  it('keeps content-block services (pageTreatment is a separate dimension from status)', () => {
    const schema = {
      services: [{ name: 'Audit Protection', description: '', offerings: [], status: 'kept', pageTreatment: 'block' }],
    } as SessionSchema
    expect(activeServices(schema).map(s => s.name)).toEqual(['Audit Protection'])
  })

  it('returns [] for a missing or non-array services field', () => {
    expect(activeServices({} as SessionSchema)).toEqual([])
    expect(activeServices({ services: 'oops' as unknown as SessionSchema['services'] } as SessionSchema)).toEqual([])
  })
})

describe('activeServices — nameless orphan rows', () => {
  it('drops a row that carries content but no name (stale-index orphan)', () => {
    const input = { services: [{ name: 'Tax' }, { description: 'orphan fragment' }] } as unknown as SessionSchema
    expect(activeServices(input).map((r) => r.name)).toEqual(['Tax'])
  })
})
