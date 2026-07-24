import { describe, it, expect } from 'vitest'
import {
  fuzzyIncludes,
  pickBestPerson,
  summarizePages,
  type PersonSessionRow,
  type PageStatusRow,
} from './assistant-tools'
import type { SessionSchema } from '@/types/session-schema'

function session(id: string, url: string, team: Array<{ name: string; bio?: string }>): PersonSessionRow {
  return { id, website_url: url, schema_data: { team } as unknown as SessionSchema }
}

describe('fuzzyIncludes', () => {
  it('requires every token to appear, order-independent', () => {
    expect(fuzzyIncludes('David L. Lattimore', 'lattimore david')).toBe(true)
    expect(fuzzyIncludes('David L. Lattimore', 'smith')).toBe(false)
    expect(fuzzyIncludes('Korbey Lague', 'korbey')).toBe(true)
  })
})

describe('pickBestPerson', () => {
  const sessions = [
    session('s1', 'https://acme.com', [
      { name: 'Jane Smith', bio: 'Partner.' },
      { name: 'David L. Lattimore', bio: '' },
    ]),
    session('s2', 'https://beta.com', [{ name: 'Dave Other' }]),
  ]

  it('finds a member by fuzzy name and returns the right index + empty-bio flag', () => {
    const m = pickBestPerson(sessions, 'lattimore')
    expect(m).not.toBeNull()
    expect(m?.sessionId).toBe('s1')
    expect(m?.teamIndex).toBe(1)
    expect(m?.displayName).toBe('David L. Lattimore')
    expect(m?.bioEmpty).toBe(true)
  })

  it('prefers an exact/substring match over a scattered-token match', () => {
    // "dave" substring-hits "Dave Other"; "david" would token-hit nothing else.
    const m = pickBestPerson(sessions, 'Dave Other')
    expect(m?.displayName).toBe('Dave Other')
  })

  it('returns null when nothing matches', () => {
    expect(pickBestPerson(sessions, 'nonexistent person')).toBeNull()
    expect(pickBestPerson(sessions, '')).toBeNull()
  })

  it('ignores members with no name', () => {
    const s = [session('s3', 'https://x.com', [{ name: '' }, { name: 'Real Name' }])]
    expect(pickBestPerson(s, 'real')?.teamIndex).toBe(1)
  })
})

describe('summarizePages', () => {
  function page(over: Partial<PageStatusRow>): PageStatusRow {
    return {
      page_title: 'Page',
      generation_status: 'complete',
      admin_approved_content: false,
      client_approved_content: false,
      needs_client_review: false,
      ...over,
    }
  }

  it('counts generated/approved and derives unpublished from client approval', () => {
    const pages = [
      page({ page_title: 'Home', generation_status: 'complete', admin_approved_content: true, client_approved_content: true }),
      page({ page_title: 'About', generation_status: 'complete', admin_approved_content: true, client_approved_content: false }),
      page({ page_title: 'Services', generation_status: 'pending' }),
    ]
    const r = summarizePages(pages)
    expect(r.totalPages).toBe(3)
    expect(r.generated).toBe(2)
    expect(r.adminApproved).toBe(2)
    expect(r.clientApproved).toBe(1)
    expect(r.unpublished).toBe(2)
    expect(r.unpublishedTitles).toEqual(['About', 'Services'])
  })

  it('caps unpublished titles at 8', () => {
    const pages = Array.from({ length: 12 }, (_, i) => page({ page_title: `P${i}`, client_approved_content: false }))
    const r = summarizePages(pages)
    expect(r.unpublished).toBe(12)
    expect(r.unpublishedTitles).toHaveLength(8)
  })
})
