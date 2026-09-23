import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import {
  updateSessionWithCas,
  SchemaConflictError,
  SessionNotFoundError,
  type CasSessionRow,
} from './schema-cas'

type Row = CasSessionRow & Record<string, unknown>

// Minimal in-memory stand-in for the sessions table. Mirrors migration 077's
// trigger: any change to schema_data/gap_list bumps schema_version.
function fakeDb(initial: Row | null, opts: { beforeWrite?: (row: Row) => void } = {}) {
  let row = initial
  const writes: Array<Record<string, unknown>> = []
  const client = {
    from() {
      const filters: Record<string, unknown> = {}
      let pendingUpdate: Record<string, unknown> | null = null
      const builder = {
        select() {
          if (pendingUpdate) {
            const patch = pendingUpdate
            opts.beforeWrite?.(row as Row)
            const matches =
              row !== null &&
              Object.entries(filters).every(([k, v]) => (row as Row)[k] === v)
            if (!matches) return Promise.resolve({ data: [], error: null })
            const changed =
              ('schema_data' in patch && patch.schema_data !== row!.schema_data) ||
              ('gap_list' in patch && patch.gap_list !== row!.gap_list)
            row = {
              ...(row as Row),
              ...patch,
              schema_version: row!.schema_version + (changed ? 1 : 0),
            }
            writes.push(patch)
            return Promise.resolve({ data: [{ id: row.id }], error: null })
          }
          return builder
        },
        update(patch: Record<string, unknown>) {
          pendingUpdate = patch
          return builder
        },
        eq(col: string, val: unknown) {
          filters[col] = val
          return builder
        },
        maybeSingle() {
          return Promise.resolve({ data: row ? { ...row } : null, error: null })
        },
      }
      return builder
    },
  }
  return {
    client: client as unknown as SupabaseClient<Database>,
    get row() {
      return row
    },
    writes,
    bump(schema: Json) {
      row = { ...(row as Row), schema_data: schema, schema_version: row!.schema_version + 1 }
    },
  }
}

const base = (): Row => ({
  id: 's1',
  status: 'in_progress',
  current_phase: 4,
  website_url: 'https://example.com',
  schema_data: { business: { name: 'A' } },
  gap_list: [],
  schema_version: 3,
})

describe('updateSessionWithCas', () => {
  it('writes when nothing changed in between', async () => {
    const db = fakeDb(base())
    const result = await updateSessionWithCas(db.client, 's1', row => ({
      update: { schema_data: { ...(row.schema_data as object), x: 1 } },
      result: 'ok',
    }))
    expect(result).toBe('ok')
    expect(db.row?.schema_data).toEqual({ business: { name: 'A' }, x: 1 })
    expect(db.row?.schema_version).toBe(4)
  })

  it('re-reads and re-applies onto a concurrent write instead of overwriting it', async () => {
    let raced = false
    const db = fakeDb(base(), {
      beforeWrite: () => {
        if (raced) return
        raced = true
        db.bump({ business: { name: 'A' }, operatorEdit: true })
      },
    })
    let calls = 0
    await updateSessionWithCas(db.client, 's1', row => {
      calls++
      return { update: { schema_data: { ...(row.schema_data as object), aiField: 'y' } }, result: null }
    })
    expect(calls).toBe(2)
    expect(db.row?.schema_data).toEqual({ business: { name: 'A' }, operatorEdit: true, aiField: 'y' })
  })

  it('gives up with SchemaConflictError when the row never settles', async () => {
    const db = fakeDb(base(), { beforeWrite: () => db.bump({ churn: Math.random() }) })
    await expect(
      updateSessionWithCas(
        db.client,
        's1',
        row => ({ update: { schema_data: row.schema_data }, result: null }),
        { attempts: 3 }
      )
    ).rejects.toBeInstanceOf(SchemaConflictError)
    expect(db.writes).toHaveLength(0)
  })

  it('returns the skip result without writing', async () => {
    const db = fakeDb(base())
    const r = await updateSessionWithCas(db.client, 's1', () => ({ skip: true, result: 'noop' }))
    expect(r).toBe('noop')
    expect(db.writes).toHaveLength(0)
  })

  it('throws SessionNotFoundError for a missing row', async () => {
    const db = fakeDb(null)
    await expect(
      updateSessionWithCas(db.client, 'nope', () => ({ skip: true, result: null }))
    ).rejects.toBeInstanceOf(SessionNotFoundError)
  })
})
