import { describe, expect, it } from 'vitest'
import { directiveBadgesFor, pipelineTreatmentFor } from './directive-pipeline'
import type { OperatorDirective, SessionSchema } from '@/types/session-schema'

const SNAP = { path: 'snapshots/11111111-2222-4333-8444-555555555555/0f0f0f0f-1111-4222-8333-444444444444.md', capturedAt: '', words: 10, links: 3 }
const d = (patch: Partial<OperatorDirective>): OperatorDirective => ({
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', kind: 'other', sourceText: 'say it', status: 'resolved', createdAt: '', ...patch,
})

const schema: SessionSchema = {
  operator_directives: [
    d({ kind: 'bring_page', sourceUrl: '/forms-documents-links', verbatim: true, keepLinks: true, snapshot: SNAP }),
    d({ kind: 'merge_page', sourceUrl: '/our-history', targetUrl: '/about' }),
    d({ kind: 'merge_page', sourceUrl: '/our-values', targetUrl: '/about/' }),
    d({ kind: 'add_offering', offering: { type: 'service', name: 'CFO Advisory', treatment: 'page' } }),
    d({ kind: 'bring_page', sourceUrl: '/careers', verbatim: true, status: 'unresolved' }),
  ],
}

describe('pipelineTreatmentFor', () => {
  it('marks verbatim pages with their snapshot', () => {
    expect(pipelineTreatmentFor(schema, '/Forms-Documents-Links/')).toEqual({
      generation_mode: 'verbatim', source_snapshot_path: SNAP.path, merge_source_urls: [],
    })
  })
  it('collects merge sources for the target', () => {
    expect(pipelineTreatmentFor(schema, '/about').merge_source_urls).toEqual(['/our-history', '/our-values'])
  })
  it('ignores unresolved directives and unrelated pages', () => {
    expect(pipelineTreatmentFor(schema, '/careers').generation_mode).toBe('generate')
    expect(pipelineTreatmentFor({}, '/x')).toEqual({ generation_mode: 'generate', source_snapshot_path: null, merge_source_urls: [] })
  })
})

describe('directiveBadgesFor', () => {
  it('labels verbatim, merged and added pages', () => {
    expect(directiveBadgesFor(schema, '/forms-documents-links').map((b) => b.label)).toEqual(['Verbatim · all links'])
    expect(directiveBadgesFor(schema, '/about').map((b) => b.kind)).toEqual(['merged', 'merged'])
    expect(directiveBadgesFor(schema, '/services/cfo-advisory').map((b) => b.kind)).toEqual(['added'])
  })
})
