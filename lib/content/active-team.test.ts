import { describe, expect, it } from 'vitest'
import { activeTeam } from './active-team'
import type { SessionSchema } from '@/types/session-schema'

const m = (name: string, teamDecision?: 'keep' | 'remove') => ({
  name, title: '', certifications: [], bio: '', specializations: [],
  ...(teamDecision ? { teamDecision } : {}),
})

describe('activeTeam', () => {
  it('filters removed members, keeps kept + missing-decision (legacy)', () => {
    const schema = { team: [m('Ann'), m('Bob', 'remove'), m('Cara', 'keep')] } as SessionSchema
    expect(activeTeam(schema).map((t) => t.name)).toEqual(['Ann', 'Cara'])
  })

  it('drops null holes and tolerates a non-array', () => {
    const dirty = { team: [null, m('Ann')] } as unknown as SessionSchema
    expect(activeTeam(dirty).map((t) => t.name)).toEqual(['Ann'])
    expect(activeTeam({} as SessionSchema)).toEqual([])
  })
})

describe('activeTeam — nameless orphan rows', () => {
  it('drops a row that carries content but no name (stale-index orphan)', () => {
    const input = { team: [{ name: 'Ada' }, { bio: 'orphan fragment' }] } as unknown as SessionSchema
    expect(activeTeam(input).map((r) => r.name)).toEqual(['Ada'])
  })
})
