import { describe, expect, it } from 'vitest'
import {
  coerceDirective,
  crawledPages,
  isValidSnapshotPath,
  isVerbatimSubstring,
  notesWithoutDirectives,
  resolveDirectiveStatus,
} from './directives'
import type { OperatorDirective, SessionSchema } from '@/types/session-schema'

const SID = '11111111-2222-4333-8444-555555555555'
const DID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const SNAP = `snapshots/${SID}/0f0f0f0f-1111-4222-8333-444444444444.md`

const schema = (): SessionSchema => ({
  current_sitemap: [
    { url: 'https://acme.com/forms-documents-links/', title: 'Forms, Documents & Links', action: 'keep', live: true },
    { url: '/about', title: 'About', action: 'keep', live: true },
    { url: '/old', title: '/old', action: 'redirect', new_url: '', live: false },
    { url: '/our-history', title: 'Our History', action: 'redirect', new_url: '/', live: true, directiveId: DID },
  ],
})

const d = (patch: Partial<OperatorDirective>): OperatorDirective => ({
  id: DID,
  kind: 'other',
  sourceText: 'x',
  status: 'unresolved',
  createdAt: '2026-10-01T00:00:00.000Z',
  ...patch,
})

describe('crawledPages', () => {
  it('normalizes to paths, skips worklist redirects but keeps operator-set ones', () => {
    expect(crawledPages(schema()).map((p) => p.url)).toEqual(['/forms-documents-links', '/about', '/our-history'])
  })
})

describe('isValidSnapshotPath', () => {
  it('accepts only this session’s uuid .md objects', () => {
    expect(isValidSnapshotPath(SNAP, SID)).toBe(true)
    expect(isValidSnapshotPath(SNAP.replace(SID, '99999999-2222-4333-8444-555555555555'), SID)).toBe(false)
    expect(isValidSnapshotPath(`snapshots/${SID}/..%2F..%2Fsecret.md`, SID)).toBe(false)
    expect(isValidSnapshotPath(`snapshots/${SID}/../x/0f0f0f0f-1111-4222-8333-444444444444.md`, SID)).toBe(false)
  })
})

describe('isVerbatimSubstring', () => {
  it('ignores whitespace differences but not wording', () => {
    const src = 'John Smith, CPA,\nhas served   clients since 1998.'
    expect(isVerbatimSubstring('has served clients since 1998.', src)).toBe(true)
    expect(isVerbatimSubstring('has proudly served clients since 1998.', src)).toBe(false)
    expect(isVerbatimSubstring('   ', src)).toBe(false)
  })
})

describe('coerceDirective', () => {
  it('rejects bad kinds/ids and never trusts status', () => {
    expect(coerceDirective({ id: DID, kind: 'nuke', sourceText: 'x' }, SID)).toBeNull()
    expect(coerceDirective({ id: '1', kind: 'other', sourceText: 'x' }, SID)).toBeNull()
    const c = coerceDirective({ id: DID, kind: 'other', sourceText: 'Be brief', status: 'resolved' }, SID)
    expect(c?.status).toBe('unresolved')
  })
  it('drops snapshots outside the session folder', () => {
    const c = coerceDirective({ id: DID, kind: 'bring_page', sourceText: 'x', snapshot: { path: 'pdfs/x/intake-summary.pdf', words: 1, links: 1 } }, SID)
    expect(c?.snapshot).toBeUndefined()
  })
})

describe('resolveDirectiveStatus', () => {
  const pages = crawledPages(schema())
  it('requires a real page, and a snapshot when verbatim', () => {
    expect(resolveDirectiveStatus(d({ kind: 'bring_page', sourceUrl: '/forms-documents-links' }), pages, [])).toBe('resolved')
    expect(resolveDirectiveStatus(d({ kind: 'bring_page', sourceUrl: '/nope' }), pages, [])).toBe('unresolved')
    expect(resolveDirectiveStatus(d({ kind: 'bring_page', sourceUrl: '/about', verbatim: true }), pages, [])).toBe('unresolved')
  })
  it('requires a known team member and a captured passage for bios', () => {
    const snapshot = { path: SNAP, capturedAt: '', words: 10, links: 0 }
    const bio = d({ kind: 'verbatim_content', teamMember: 'John Smith', verbatimText: 'Bio', snapshot })
    expect(resolveDirectiveStatus(bio, pages, ['John Smith'])).toBe('resolved')
    expect(resolveDirectiveStatus(bio, pages, ['Jane Doe'])).toBe('unresolved')
    expect(resolveDirectiveStatus({ ...bio, verbatimText: undefined }, pages, ['John Smith'])).toBe('unresolved')
  })
  it('rejects a merge into itself', () => {
    expect(resolveDirectiveStatus(d({ kind: 'merge_page', sourceUrl: '/about', targetUrl: '/about/' }), pages, [])).toBe('unresolved')
  })
})

describe('notesWithoutDirectives', () => {
  it('removes instruction sentences and keeps facts', () => {
    const notes = 'Founded in 1998. Please bring over the Forms page with all links. They love QuickBooks.'
    const out = notesWithoutDirectives(notes, [d({ sourceText: 'Please bring over the Forms page with all links.' })])
    expect(out).toBe('Founded in 1998. They love QuickBooks.')
  })
})
