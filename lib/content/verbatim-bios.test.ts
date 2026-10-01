import { describe, expect, it } from 'vitest'
import { enforceVerbatimBios } from './verbatim-bios'
import type { SessionSchema } from '@/types/session-schema'

const member = (name: string, bio: string, extra: Record<string, unknown> = {}) => ({
  name, title: '', certifications: [], bio, specializations: [], ...extra,
})

const PAGE = `<!-- block: content-prose -->
## Our people

We are a team of advisors.

<!-- block: team-grid | variant: 2-col -->
## Leadership

### John Smith, CPA
photo: john-smith.jpg
Managing Partner
John brings energy to every engagement — a paraphrase.

### Jane Doe, EA
Tax Director
Jane writes great AI copy.
`

describe('enforceVerbatimBios', () => {
  const schema: SessionSchema = {
    team: [
      member('John Smith', 'John Smith has served Frederick families since 1998.\n\nHe is a CPA and CFP®.', { bioVerbatim: true }),
      member('Jane Doe', 'Not verbatim'),
    ],
  }

  it('replaces only the verbatim member’s bio, exactly', () => {
    const out = enforceVerbatimBios(PAGE, schema)
    expect(out).toContain('Managing Partner\nJohn Smith has served Frederick families since 1998.\n\nHe is a CPA and CFP®.')
    expect(out).not.toContain('a paraphrase')
    expect(out).toContain('photo: john-smith.jpg')
    expect(out).toContain('Jane writes great AI copy.')
    expect(out).toContain('We are a team of advisors.')
  })

  it('is a no-op without verbatim bios or team-grid sections', () => {
    expect(enforceVerbatimBios(PAGE, { team: [member('John Smith', 'x')] })).toBe(PAGE)
    const noGrid = '<!-- block: content-prose -->\n## About\n\nText.'
    expect(enforceVerbatimBios(noGrid, schema)).toBe(noGrid)
  })

  it('ignores removed team members', () => {
    const removed: SessionSchema = { team: [member('John Smith', 'Exact', { bioVerbatim: true, teamDecision: 'remove' })] }
    expect(enforceVerbatimBios(PAGE, removed)).toBe(PAGE)
  })
})
