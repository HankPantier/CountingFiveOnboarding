import { describe, expect, it } from 'vitest'
import { applyAuditEdit } from './apply-edit'

// In-memory audit_runs row whose reads and writes both yield to the event loop,
// so two unserialized read-modify-writes would interleave (read, read, write,
// write) and the second write would drop the first edit.
function fakeAuditRuns(result: Record<string, unknown>) {
  const row = { result: structuredClone(result) }
  const tick = () => new Promise(r => setTimeout(r, 5))
  const client = {
    from: () => {
      let patch: { result: Record<string, unknown> } | null = null
      const b = {
        select: () => b,
        update: (p: { result: Record<string, unknown> }) => { patch = p; return b },
        eq: () => {
          if (patch) {
            const p = patch
            return tick().then(() => { row.result = structuredClone(p.result); return { error: null } })
          }
          return b
        },
        single: async () => { const snap = structuredClone(row.result); await tick(); return { data: { result: snap }, error: null } },
      }
      return b
    },
  }
  return { client: client as unknown as Parameters<typeof applyAuditEdit>[0], row }
}

describe('applyAuditEdit', () => {
  it('lands both of two concurrent edits to the same audit', async () => {
    const db = fakeAuditRuns({ intelligence: { narrative: { summary: 'old' }, niche_services: { commentary: 'old' } } })
    const [a, b] = await Promise.all([
      applyAuditEdit(db.client, 'audit-1', { 'intelligence.narrative.summary': 'tight' }),
      applyAuditEdit(db.client, 'audit-1', { 'intelligence.niche_services.commentary': 'expanded' }),
    ])
    expect(a.success).toBe(true)
    expect(b.success).toBe(true)
    const intel = db.row.result.intelligence as { narrative: { summary: string }; niche_services: { commentary: string } }
    expect(intel.narrative.summary).toBe('tight')
    expect(intel.niche_services.commentary).toBe('expanded')
  })

  it('keeps serving later edits after one fails', async () => {
    const db = fakeAuditRuns({ intelligence: { narrative: { summary: 'old' } } })
    const [bad, good] = await Promise.all([
      applyAuditEdit(db.client, 'audit-2', { 'scores.overall': 1 }),
      applyAuditEdit(db.client, 'audit-2', { 'intelligence.narrative.summary': 'new' }),
    ])
    expect(bad.success).toBe(false)
    expect(good.success).toBe(true)
    expect((db.row.result.intelligence as { narrative: { summary: string } }).narrative.summary).toBe('new')
  })
})
