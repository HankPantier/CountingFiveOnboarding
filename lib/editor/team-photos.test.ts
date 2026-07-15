import { describe, expect, it } from 'vitest'
import {
  extractTeamMembers,
  setTeamMemberPhoto,
  moveTeamMember,
  removeTeamMember,
  type TeamMemberRef,
} from './team-photos'

const TEAM_BODY = [
  '<!-- block: team-grid | variant: 3-col -->',
  '## Our Team',
  '',
  '### Ron Lague, CPA, PFS',
  'photo: ron.jpg',
  'Ron holds a CPA license and leads the firm.',
  '',
  '### Jackie Estes, MBA',
  'Senior Advisor',
  'Jackie brings two decades of tax strategy.',
  '',
  '### Sam Park',
  'photo: sam-avatar.svg',
  'Sam manages client onboarding.',
].join('\n')

// A page with narrative before and another (non-team) block after, to prove the
// rewriters leave surrounding content alone.
const MIXED_BODY = [
  '<!-- block: hero -->',
  '# Welcome',
  '',
  '<!-- block: team-grid | variant: 2-col -->',
  '## Leadership',
  '',
  '### Alice',
  'Bio for Alice.',
  '',
  '### Bob',
  'photo: bob.png',
  'Bio for Bob.',
  '',
  '<!-- block: cta-banner | variant: color-bg -->',
  '## Contact us',
].join('\n')

describe('extractTeamMembers', () => {
  it('returns [] when there is no team-grid block', () => {
    expect(extractTeamMembers('<!-- block: hero -->\n# Hi\n\nSome prose.')).toEqual([])
  })

  it('parses each member with its current photo (or null)', () => {
    const members = extractTeamMembers(TEAM_BODY)
    expect(members).toHaveLength(3)
    expect(members[0]).toMatchObject({ name: 'Ron Lague, CPA, PFS', photo: 'ron.jpg', blockIndex: 0, memberIndex: 0 })
    expect(members[1]).toMatchObject({ name: 'Jackie Estes, MBA', photo: null, blockIndex: 0, memberIndex: 1 })
    expect(members[2]).toMatchObject({ name: 'Sam Park', photo: 'sam-avatar.svg', blockIndex: 0, memberIndex: 2 })
  })

  it('does not treat a non-adjacent photo: line as a member photo', () => {
    const body = [
      '<!-- block: team-grid -->',
      '### Dana',
      'Some bio.',
      'photo: not-a-photo.jpg',
    ].join('\n')
    expect(extractTeamMembers(body)[0].photo).toBeNull()
  })

  it('indexes multiple team-grid blocks independently', () => {
    const members = extractTeamMembers(MIXED_BODY)
    expect(members.map((m) => `${m.blockIndex}:${m.memberIndex}:${m.name}`)).toEqual([
      '0:0:Alice',
      '0:1:Bob',
    ])
  })
})

const ref = (body: string, i: number): TeamMemberRef => extractTeamMembers(body)[i]

describe('setTeamMemberPhoto', () => {
  it('inserts a photo line directly under a member that has none', () => {
    const out = setTeamMemberPhoto(TEAM_BODY, ref(TEAM_BODY, 1), 'jackie.png')
    expect(out).toContain('### Jackie Estes, MBA\nphoto: jackie.png\nSenior Advisor')
    // Other members untouched.
    expect(out).toContain('### Ron Lague, CPA, PFS\nphoto: ron.jpg')
  })

  it('replaces an existing photo line', () => {
    const out = setTeamMemberPhoto(TEAM_BODY, ref(TEAM_BODY, 0), 'ron-new.jpg')
    expect(out).toContain('### Ron Lague, CPA, PFS\nphoto: ron-new.jpg\nRon holds')
    expect(out).not.toContain('photo: ron.jpg')
  })

  it('removes the photo line when filename is null', () => {
    const out = setTeamMemberPhoto(TEAM_BODY, ref(TEAM_BODY, 0), null)
    expect(out).toContain('### Ron Lague, CPA, PFS\nRon holds')
    expect(out).not.toContain('photo: ron.jpg')
  })

  it('only touches the indexed member when names would otherwise collide', () => {
    const dupes = [
      '<!-- block: team-grid -->',
      '### Chris',
      'First Chris.',
      '',
      '### Chris',
      'Second Chris.',
    ].join('\n')
    const out = setTeamMemberPhoto(dupes, extractTeamMembers(dupes)[1], 'chris2.jpg')
    expect(out).toBe(
      ['<!-- block: team-grid -->', '### Chris', 'First Chris.', '', '### Chris', 'photo: chris2.jpg', 'Second Chris.'].join('\n')
    )
  })
})

describe('moveTeamMember', () => {
  it('swaps a member down with its neighbor, carrying the whole card', () => {
    const out = moveTeamMember(TEAM_BODY, ref(TEAM_BODY, 0), 'down')
    const names = extractTeamMembers(out).map((m) => m.name)
    expect(names).toEqual(['Jackie Estes, MBA', 'Ron Lague, CPA, PFS', 'Sam Park'])
    // Ron's photo travels with him.
    expect(out).toContain('### Ron Lague, CPA, PFS\nphoto: ron.jpg')
  })

  it('is a no-op moving the first member up', () => {
    expect(moveTeamMember(TEAM_BODY, ref(TEAM_BODY, 0), 'up')).toBe(TEAM_BODY)
  })

  it('is a no-op moving the last member down', () => {
    expect(moveTeamMember(TEAM_BODY, ref(TEAM_BODY, 2), 'down')).toBe(TEAM_BODY)
  })

  it('leaves surrounding blocks intact', () => {
    const out = moveTeamMember(MIXED_BODY, ref(MIXED_BODY, 1), 'up')
    expect(out.startsWith('<!-- block: hero -->\n# Welcome')).toBe(true)
    expect(out).toContain('<!-- block: cta-banner | variant: color-bg -->\n## Contact us')
    expect(extractTeamMembers(out).map((m) => m.name)).toEqual(['Bob', 'Alice'])
  })
})

describe('removeTeamMember', () => {
  it('drops only the target card and keeps the block heading + annotation', () => {
    const out = removeTeamMember(TEAM_BODY, ref(TEAM_BODY, 1))
    expect(out).toContain('<!-- block: team-grid | variant: 3-col -->\n## Our Team')
    expect(out).not.toContain('Jackie Estes')
    expect(out).not.toContain('Senior Advisor')
    expect(extractTeamMembers(out).map((m) => m.name)).toEqual(['Ron Lague, CPA, PFS', 'Sam Park'])
  })

  it('keeps the annotation and heading even when the last member is removed', () => {
    const single = ['<!-- block: team-grid -->', '## Our Team', '', '### Solo', 'Only bio.'].join('\n')
    const out = removeTeamMember(single, extractTeamMembers(single)[0])
    expect(out).toContain('<!-- block: team-grid -->')
    expect(out).toContain('## Our Team')
    expect(extractTeamMembers(out)).toEqual([])
  })
})
