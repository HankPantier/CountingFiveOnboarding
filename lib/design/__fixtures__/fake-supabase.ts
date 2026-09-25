// Test double for SupabaseClient<Database>: every chain method records its
// arguments; the terminal await/.single()/.maybeSingle() pops the next queued
// result for that table (FIFO). Storage .remove() pops 'storage.remove'
// (default: success). Throws loudly when a query has no queued result.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export type FakeError = { code?: string; message: string }
export type FakeResult = { data?: unknown; error?: FakeError | null }
export type FakeOp = [method: string, ...args: unknown[]]
export type FakeQuery = { table: string; ops: FakeOp[] }

const CHAIN_METHODS = ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'neq', 'lt', 'gt', 'in', 'is', 'or', 'order', 'limit'] as const

export function fakeSupabase(results: Record<string, FakeResult[]> = {}) {
  const queries: FakeQuery[] = []
  const storageRemovals: string[][] = []

  const take = (key: string): { data: unknown; error: FakeError | null } => {
    const next = results[key]?.shift()
    if (!next) throw new Error(`fakeSupabase: no queued result for "${key}"`)
    return { data: next.data ?? null, error: next.error ?? null }
  }

  const from = (table: string) => {
    const query: FakeQuery = { table, ops: [] }
    queries.push(query)
    const builder: Record<string, unknown> = {}
    for (const method of CHAIN_METHODS) {
      builder[method] = (...args: unknown[]) => {
        query.ops.push([method, ...args])
        return builder
      }
    }
    builder.single = async () => {
      query.ops.push(['single'])
      return take(table)
    }
    builder.maybeSingle = async () => {
      query.ops.push(['maybeSingle'])
      return take(table)
    }
    builder.then = (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      new Promise((resolve) => resolve(take(table))).then(onFulfilled, onRejected)
    return builder
  }

  const storage = {
    from: (_bucket: string) => ({
      remove: async (paths: string[]) => {
        storageRemovals.push(paths)
        const r = results['storage.remove']?.shift()
        return { data: r?.data ?? [], error: r?.error ?? null }
      },
    }),
  }

  const client: SupabaseClient<Database> = { from, storage } as never
  const opsFor = (table: string, index = 0): FakeOp[] => queries.filter((q) => q.table === table)[index]?.ops ?? []
  return { client, queries, storageRemovals, opsFor }
}
