import { describe, expect, it } from 'vitest'
import { parseTeamGridBlock, setTeamMemberField, addTeamMember } from './team-grid'

const TEAM = [
  '<!-- block: team-grid | variant: 3-col -->',
  '## Our Team',
  '',
  '### Ron Lague, CPA, PFS',
  'photo: ron.jpg',
  'Managing Partner',
  'Ron leads the firm and holds a CPA license.',
  '',
  '### Jackie Estes, MBA',
  'Jackie brings two decades of tax strategy experience to every engagement.',
].join('\n')

describe('parseTeamGridBlock', () => {
  it('splits name, job title, photo, and bio', () => {
    const model = parseTeamGridBlock(TEAM)
    expect(model.heading).toBe('Our Team')
    expect(model.members).toHaveLength(2)
    expect(model.members[0]).toMatchObject({
      name: 'Ron Lague, CPA, PFS',
      title: 'Managing Partner',
      photo: 'ron.jpg',
      bio: 'Ron leads the firm and holds a CPA license.',
    })
    expect(model.members[1]).toMatchObject({
      name: 'Jackie Estes, MBA',
      title: null,
      photo: null,
      bio: 'Jackie brings two decades of tax strategy experience to every engagement.',
    })
  })
})

describe('setTeamMemberField', () => {
  it('rewrites the name heading only', () => {
    const next = setTeamMemberField(TEAM, 1, 'name', 'Jackie Estes, CPA')
    expect(next).toContain('### Jackie Estes, CPA')
    expect(next).toContain('### Ron Lague, CPA, PFS')
  })

  it('replaces the bio region without touching photo or title', () => {
    const next = setTeamMemberField(TEAM, 0, 'bio', 'Ron founded the practice in 1998.')
    expect(next).toContain('photo: ron.jpg\nManaging Partner\nRon founded the practice in 1998.')
  })

  it('inserts a job title when one is absent, and removes it when cleared', () => {
    const added = setTeamMemberField(TEAM, 1, 'title', 'Senior Advisor')
    expect(added).toContain('### Jackie Estes, MBA\nSenior Advisor\nJackie brings')
    const removed = setTeamMemberField(added, 1, 'title', '')
    expect(removed).toContain('### Jackie Estes, MBA\nJackie brings')
  })

  it('returns input unchanged on drift', () => {
    expect(setTeamMemberField(TEAM, 99, 'name', 'x')).toBe(TEAM)
  })
})

describe('addTeamMember', () => {
  it('appends a new member card', () => {
    const next = addTeamMember(TEAM)
    expect(next).toContain('### New Member\nDescribe this team member.')
    expect(parseTeamGridBlock(next).members).toHaveLength(3)
  })
})
