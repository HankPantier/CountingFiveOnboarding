import { describe, expect, it } from 'vitest'
import { applyTeamReview } from './team-review'
import type { SessionSchema } from '@/types/session-schema'

const member = (name: string, title = '') => ({ name, title, certifications: [], bio: '', specializations: [] })
const baseSchema = (): SessionSchema => ({ team: [member('Ann'), member('Bob'), member('Cara')] } as SessionSchema)
const AT = '2026-09-18T00:00:00.000Z'

describe('applyTeamReview', () => {
  it('marks removed/kept teamDecision', () => {
    const s = applyTeamReview(baseSchema(), { remove: ['Bob'] }, AT)
    expect(s.team?.map((t) => [t.name, t.teamDecision])).toEqual([
      ['Ann', 'keep'],
      ['Bob', 'remove'],
      ['Cara', 'keep'],
    ])
  })

  it('appends new members, skipping ones already present (case-insensitive)', () => {
    const s = applyTeamReview(baseSchema(), { add: [{ name: 'Dan', title: 'CPA' }, { name: 'ann' }] }, AT)
    const names = s.team?.map((t) => t.name)
    expect(names).toContain('Dan')
    expect(names?.filter((n) => n.toLowerCase() === 'ann')).toHaveLength(1)
    expect(s.team?.find((t) => t.name === 'Dan')?.title).toBe('CPA')
    expect(s._meta?.team_review?.added).toEqual(['Dan'])
  })

  it('records the review marker with kept/removed/added + reviewedBy', () => {
    const s = applyTeamReview(baseSchema(), { remove: ['Bob'], add: [{ name: 'Dan' }] }, AT, 'user-1')
    expect(s._meta?.team_review).toEqual({
      reviewedAt: AT,
      kept: ['Ann', 'Cara', 'Dan'],
      removed: ['Bob'],
      added: ['Dan'],
      reviewedBy: 'user-1',
    })
  })

  it('does not mutate its input and is idempotent', () => {
    const schema = baseSchema()
    const first = applyTeamReview(schema, { remove: ['Bob'] }, AT)
    expect(schema.team?.[1].teamDecision).toBeUndefined()
    const second = applyTeamReview(first, { remove: ['Bob'] }, AT)
    expect(second.team).toEqual(first.team)
  })
})
