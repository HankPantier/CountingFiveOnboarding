// Minimal chainable Supabase fake for QA Desk orchestrator tests. This is NOT a
// relational engine: `select()` filters the configured rows by the `.eq()`
// predicates applied so far (good enough for the single-row-per-table fixtures
// these tests use); `update()` does NOT re-filter stored rows against the
// fencing predicates (a flat fixture array has no mutable "current state" to
// match 'running' against) — instead it recognizes the SHAPE of the payload
// (the claim write sets qa_status:'running'; the final write carries
// qa_review) and returns [] for that call when the matching
// claimReturnsEmpty / finalWriteReturnsEmpty option is set, modeling a lost
// claim or a human edit that won the race. Every `.update()` payload AND the
// filter chain applied to it is recorded, so tests can assert on both via
// `updates(table)` / `updateFilters(table)` — otherwise deleting a fencing
// `.eq()`/`.in()`/`.lt()` call from the real code would never fail a test.
// `selectErrors` makes a `.single()`/`.maybeSingle()` read on a given table
// resolve with `{ data: null, error }` instead, to exercise read-failure paths.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type Row = Record<string, unknown>
type UpdatePayload = Record<string, unknown>
type FakeError = { message: string }
type Filter = [op: 'eq' | 'neq' | 'in' | 'lt', col: string, val: unknown]

export type FakeSupabaseOptions = {
  claimReturnsEmpty?: boolean
  finalWriteReturnsEmpty?: boolean
  selectErrors?: Partial<Record<string, FakeError>>
}

export type FakeSupabase = SupabaseClient<Database> & {
  updates: (table: string) => UpdatePayload[]
  updateFilters: (table: string) => Filter[][]
}

function matchesEq(row: Row, filters: Filter[]): boolean {
  // Only `eq` meaningfully narrows a single configured row for the plain
  // selects this fake serves; neq/in/lt are accepted (so chains don't throw)
  // but not evaluated against stored rows — see the header note on update().
  return filters.every(([op, col, val]) => (op === 'eq' ? row[col] === val : true))
}

export function makeFakeSupabase(
  tables: Record<string, Row[]>,
  opts: FakeSupabaseOptions = {},
): FakeSupabase {
  const updateLog: Record<string, UpdatePayload[]> = {}
  const updateFilterLog: Record<string, Filter[][]> = {}

  function from(table: string) {
    const rows = tables[table] ?? []
    const filters: Filter[] = []
    let updatePayload: UpdatePayload | null = null

    function resolve(): Row[] {
      if (updatePayload) {
        ;(updateLog[table] ??= []).push(updatePayload)
        ;(updateFilterLog[table] ??= []).push([...filters])
        if (updatePayload.qa_status === 'running' && opts.claimReturnsEmpty) return []
        if ('qa_review' in updatePayload && opts.finalWriteReturnsEmpty) return []
        return rows
      }
      return rows.filter(r => matchesEq(r, filters))
    }

    const builder: Record<string, unknown> = {}
    const chain = (fn: () => void) => {
      fn()
      return builder
    }
    builder.select = () => builder
    builder.update = (payload: UpdatePayload) => chain(() => { updatePayload = payload })
    builder.eq = (col: string, val: unknown) => chain(() => filters.push(['eq', col, val]))
    builder.neq = (col: string, val: unknown) => chain(() => filters.push(['neq', col, val]))
    builder.in = (col: string, val: unknown) => chain(() => filters.push(['in', col, val]))
    builder.lt = (col: string, val: unknown) => chain(() => filters.push(['lt', col, val]))
    builder.single = async () => {
      const err = opts.selectErrors?.[table]
      if (err) return { data: null, error: err }
      const matched = resolve()
      return { data: matched[0] ?? null, error: matched[0] ? null : { message: 'not found' } }
    }
    builder.maybeSingle = async () => {
      const err = opts.selectErrors?.[table]
      if (err) return { data: null, error: err }
      return { data: resolve()[0] ?? null, error: null }
    }
    builder.then = (
      onFulfilled?: (v: { data: Row[]; error: null }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve({ data: resolve(), error: null }).then(onFulfilled, onRejected)
    return builder
  }

  const client = { from } as unknown as FakeSupabase
  Object.defineProperty(client, 'updates', {
    value: (table: string) => updateLog[table] ?? [],
  })
  Object.defineProperty(client, 'updateFilters', {
    value: (table: string) => updateFilterLog[table] ?? [],
  })
  return client
}
