import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { makeProgressWriter } from './task-progress'

// Minimal fake: capture every insert payload (first write) and every update
// payload + its filters (later writes). `existing` simulates a row already
// holding the id (insert → 23505).
function fakeClient(opts: { existing?: boolean } = {}) {
  const calls: Array<Record<string, unknown>> = []
  const updates: Array<{ row: Record<string, unknown>; filters: Array<[string, unknown]> }> = []
  const client = {
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        if (opts.existing) return { error: { code: '23505', message: 'duplicate key' } }
        calls.push(row)
        return { error: null }
      },
      update: (row: Record<string, unknown>) => {
        const entry = { row, filters: [] as Array<[string, unknown]> }
        updates.push(entry)
        const chain = {
          eq(col: string, val: unknown) {
            entry.filters.push([col, val])
            return chain
          },
          then(resolve: (v: unknown) => void) {
            resolve({ error: null })
          },
        }
        return chain
      },
    }),
  } as unknown as SupabaseClient<Database>
  return { client, calls, updates }
}

const META = { kind: 'repull-images', sessionId: 'sess-1', contentJobId: 'job-1', createdBy: 'user-1' }

describe('makeProgressWriter', () => {
  it('start() writes a running row scoped to the session/job with zeroed counts', async () => {
    const { client, calls } = fakeClient()
    const w = makeProgressWriter(client, 'task-1', META)
    await w.start('Scanning pages')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      id: 'task-1',
      kind: 'repull-images',
      session_id: 'sess-1',
      content_job_id: 'job-1',
      created_by: 'user-1',
      state: 'running',
      phase: 'Scanning pages',
      current: 0,
      total: 0,
      message: null,
    })
    expect(typeof calls[0].updated_at).toBe('string')
  })

  it('tick() carries the determinate counts and stays running', async () => {
    const { client, calls } = fakeClient()
    const w = makeProgressWriter(client, 'task-1', META)
    await w.tick({ phase: 'Finding photos', current: 3, total: 10 })
    expect(calls[0]).toMatchObject({ state: 'running', phase: 'Finding photos', current: 3, total: 10, id: 'task-1' })
  })

  it('finish() marks done with a message', async () => {
    const { client, calls } = fakeClient()
    const w = makeProgressWriter(client, 'task-1', META)
    await w.finish('Pushed 12 image(s) to draft.')
    expect(calls[0]).toMatchObject({ state: 'done', message: 'Pushed 12 image(s) to draft.' })
  })

  it('error() marks error with a message', async () => {
    const { client, calls } = fakeClient()
    const w = makeProgressWriter(client, 'task-1', META)
    await w.error('boom')
    expect(calls[0]).toMatchObject({ state: 'error', message: 'boom' })
  })

  it('defaults created_by to null when not supplied', async () => {
    const { client, calls } = fakeClient()
    const w = makeProgressWriter(client, 'task-1', { kind: 'repull-images', sessionId: 's', contentJobId: 'j' })
    await w.start('x')
    expect(calls[0].created_by).toBeNull()
  })

  it('later writes are session-scoped updates, not upserts', async () => {
    const { client, calls, updates } = fakeClient()
    const w = makeProgressWriter(client, 'task-1', META)
    await w.start('a')
    await w.finish('done')
    expect(calls).toHaveLength(1)
    expect(updates).toHaveLength(1)
    expect(updates[0].filters).toEqual([['id', 'task-1'], ['session_id', 'sess-1']])
  })

  it('a colliding (existing) id never overwrites another session\'s row', async () => {
    // Regression: the old upsert on a client-supplied id replaced any row with
    // that id, including one belonging to a different session.
    const { client, calls, updates } = fakeClient({ existing: true })
    const w = makeProgressWriter(client, 'task-1', META)
    await w.start('a')
    expect(calls).toHaveLength(0)
    expect(updates[0].filters).toContainEqual(['session_id', 'sess-1'])
  })
})
