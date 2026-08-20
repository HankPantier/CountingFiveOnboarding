import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { makeProgressWriter } from './task-progress'

// Minimal fake: capture every upsert payload the writer builds.
function fakeClient() {
  const calls: Array<Record<string, unknown>> = []
  const client = {
    from: () => ({
      upsert: async (row: Record<string, unknown>) => {
        calls.push(row)
        return { error: null }
      },
    }),
  } as unknown as SupabaseClient<Database>
  return { client, calls }
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
})
