import { describe, expect, it } from 'vitest'
import { activeSubCategories } from './active-subcategories'
import type { SessionSchema } from '@/types/session-schema'

type Niche = NonNullable<SessionSchema['niches']>[number]
type Status = NonNullable<Niche['subCategories']>[number]['status']

const sub = (name: string, status: Status) => ({ name, status })

describe('activeSubCategories', () => {
  it('excludes dropped sub-services, keeps the rest', () => {
    const niche = {
      subCategories: [sub('Implants', 'confirmed'), sub('Orthodontics', 'dropped'), sub('Whitening', 'verify')],
    } as Pick<Niche, 'subCategories'>
    expect(activeSubCategories(niche).map(s => s.name)).toEqual(['Implants', 'Whitening'])
  })

  it('returns [] for a missing or non-array subCategories field', () => {
    expect(activeSubCategories({} as Pick<Niche, 'subCategories'>)).toEqual([])
    expect(
      activeSubCategories({ subCategories: 'oops' as unknown as Niche['subCategories'] } as Pick<Niche, 'subCategories'>)
    ).toEqual([])
  })
})

describe('activeSubCategories — nameless orphan rows', () => {
  it('drops a row that carries content but no name (stale-index orphan)', () => {
    const input = { subCategories: [{ name: 'Payroll' }, { description: 'orphan fragment' }] } as unknown as Parameters<typeof activeSubCategories>[0]
    expect(activeSubCategories(input).map((r) => r.name)).toEqual(['Payroll'])
  })
})
