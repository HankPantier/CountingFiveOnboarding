import { describe, expect, it } from 'vitest'
import { buildAuditEditPrompt } from './edit-prompt'
import type { AuditResult } from '@/types/audit-result'

const result = (intel: Record<string, unknown>) =>
  ({ site_name: 'Acme CPA', domain: 'acme.com', url: 'https://acme.com', intelligence: intel }) as unknown as AuditResult

describe('buildAuditEditPrompt — cache ordering', () => {
  it('keeps instructions stable across edits and puts the intelligence JSON in the later block', () => {
    const before = buildAuditEditPrompt(result({ narrative: { summary: 'old' } }))
    const after = buildAuditEditPrompt(result({ narrative: { summary: 'new' } }))
    expect(before.stable).toBe(after.stable)
    expect(before.stable).not.toContain('"summary"')
    expect(before.stable).toContain('HARD RULES')
    expect(after.current).toContain('"summary": "new"')
  })
})
