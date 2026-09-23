import { describe, expect, it } from 'vitest'
import { toDottedPath } from './apply-update'

describe('toDottedPath', () => {
  it('normalizes bracket indices to the dotted form the MBP page keys on', () => {
    expect(toDottedPath('niches[3].description')).toBe('niches.3.description')
    expect(toDottedPath('team[0].certifications[2]')).toBe('team.0.certifications.2')
    expect(toDottedPath('business.tagline')).toBe('business.tagline')
  })
})

// In-memory sessions row honoring the CAS contract: an update carrying a
// schema_version filter only lands if the version still matches, and a landed
// write bumps it (what migration 077's trigger does).
function fakeSessions(schema: Record<string, unknown>, beforeFirstWrite?: (bump: (s: Record<string, unknown>) => void) => void) {
  const row = { id: 's1', status: 'approved', current_phase: 7, website_url: 'x', schema_data: schema, gap_list: [] as unknown[], schema_version: 1 }
  let fired = false
  const bump = (s: Record<string, unknown>) => { row.schema_data = s; row.schema_version += 1 }
  const client = {
    from: () => {
      const filters: Record<string, unknown> = {}
      let patch: Record<string, unknown> | null = null
      const b = {
        select: () => {
          if (!patch) return b
          if (!fired) { fired = true; beforeFirstWrite?.(bump) }
          if (filters.schema_version !== row.schema_version) return Promise.resolve({ data: [], error: null })
          row.schema_data = patch.schema_data as Record<string, unknown>
          row.schema_version += 1
          return Promise.resolve({ data: [{ id: row.id }], error: null })
        },
        update: (p: Record<string, unknown>) => { patch = p; return b },
        eq: (c: string, v: unknown) => { filters[c] = v; return b },
        maybeSingle: () => Promise.resolve({ data: structuredClone(row), error: null }),
      }
      return b
    },
  }
  return { client, row }
}

describe('applyMbpUpdate appends', () => {
  it('appends onto the fresh array so a concurrent approval is not lost', async () => {
    const { applyMbpUpdate } = await import('./apply-update')
    const db = fakeSessions({ team: [{ name: 'A' }] }, bump =>
      // Another approval lands between our read and our write.
      bump({ team: [{ name: 'A' }, { name: 'B' }] })
    )
    const res = await applyMbpUpdate(
      db.client as unknown as Parameters<typeof applyMbpUpdate>[0],
      's1',
      {},
      undefined,
      { appends: { team: { name: 'C' } } }
    )
    expect(res.success).toBe(true)
    const schema = db.row.schema_data as { team: Array<{ name: string }>; _meta: { recently_applied: Record<string, string> } }
    expect(schema.team.map(t => t.name)).toEqual(['A', 'B', 'C'])
    expect(Object.keys(schema._meta.recently_applied)).toEqual(['team.2'])
  })
})
