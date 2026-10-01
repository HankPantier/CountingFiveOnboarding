import { describe, expect, it } from 'vitest'
import { operatorPagesNote, verbatimGuardNote } from './verbatim-guard'
import type { SessionSchema } from '@/types/session-schema'

const SNAP = { path: 'snapshots/11111111-2222-4333-8444-555555555555/0f0f0f0f-1111-4222-8333-444444444444.md', capturedAt: '', words: 1, links: 1 }
const schema: SessionSchema = {
  team: [{ name: 'John Smith', title: '', certifications: [], bio: 'Exact.', specializations: [], bioVerbatim: true }],
  operator_directives: [
    { id: 'a', kind: 'bring_page', sourceText: 'Bring the forms page over verbatim', status: 'resolved', sourceUrl: '/forms', verbatim: true, snapshot: SNAP, createdAt: '' },
    { id: 'b', kind: 'bring_page', sourceText: 'Keep careers', status: 'resolved', sourceUrl: '/careers', createdAt: '' },
  ],
}

describe('verbatimGuardNote', () => {
  it('flags verbatim pages and verbatim bios present in the file', () => {
    const note = verbatimGuardNote(schema, '/forms/', '### John Smith, CPA\nExact.')
    expect(note).toContain('brought over word-for-word')
    expect(note).toContain('The bios of John Smith')
  })
  it('is empty for an ordinary page', () => {
    expect(verbatimGuardNote(schema, '/about', 'About us')).toBe('')
  })
})

describe('operatorPagesNote', () => {
  it('lists every page kept by instruction', () => {
    const note = operatorPagesNote(schema)
    expect(note).toContain('/forms (verbatim client content)')
    expect(note).toContain('/careers: "Keep careers"')
    expect(operatorPagesNote({})).toBe('')
  })
})
