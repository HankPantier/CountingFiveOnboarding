import { describe, expect, it } from 'vitest'
import { runPushPhase, type PushItem, type PushOps } from './push-phase'
import type { DeployState } from './remote'

const item = (name: string, noDeploy = false): PushItem => ({ slug: `o/${name}`, dir: `/w/${name}`, noDeploy })

type Script = Partial<Record<string, { preflight?: 'conflict' | 'absent'; push?: 'reject'; draft?: 'conflict'; deploy?: DeployState | 'timeout'; throwAt?: 'push' }>>

function fakeOps(script: Script) {
  const pushed: string[] = []
  const reset: string[] = []
  const events: string[] = []
  const name = (x: string) => x.split('/').pop()!
  const ops: PushOps = {
    draftPreflight: (dir) => {
      const s = script[name(dir)]
      events.push(`preflight:${name(dir)}`)
      if (s?.preflight === 'conflict') return { ok: false, reason: 'main→draft would conflict (content/nav.json)' }
      return { ok: true, draft: s?.preflight === 'absent' ? 'absent' : 'present' }
    },
    pushMain: (dir) => {
      const s = script[name(dir)]
      if (s?.throwAt === 'push') throw new Error('JSON.parse boom')
      if (s?.push === 'reject') return { ok: false, sha: 'x', err: 'non-fast-forward' }
      pushed.push(name(dir))
      events.push(`push:${name(dir)}`)
      return { ok: true, sha: `sha-${name(dir)}` }
    },
    mergeDraft: (slug) => (script[name(slug)]?.draft === 'conflict' ? { result: 'conflict', detail: 'x' } : { result: 'merged', detail: 'abc1234' }),
    waitDeploy: async (slug) => {
      events.push(`deploy:${name(slug)}`)
      return { state: script[name(slug)]?.deploy ?? 'success', url: null }
    },
    resetLocal: (dir) => {
      reset.push(name(dir))
    },
  }
  return { ops, pushed, reset, events }
}

const opts = { keepGoing: false, canary: 0, deployWait: true }

describe('runPushPhase', () => {
  it('stops at the first remote failure: no later repo is pushed, and their local commits are reset', async () => {
    const f = fakeOps({ b: { push: 'reject' } })
    const r = await runPushPhase([item('a'), item('b'), item('c'), item('d')], opts, f.ops)
    expect(f.pushed).toEqual(['a'])
    expect(r.stoppedBy).toBe('o/b')
    expect(r.results.map((x) => x.status)).toEqual(['pushed', 'failed', 'skipped', 'skipped'])
    expect(f.reset).toEqual(['b', 'c', 'd'])
  })

  it('--keep-going continues past a non-canary failure', async () => {
    const f = fakeOps({ b: { deploy: 'failure' } })
    const r = await runPushPhase([item('a'), item('b'), item('c')], { ...opts, keepGoing: true }, f.ops)
    expect(f.pushed).toEqual(['a', 'b', 'c'])
    expect(r.stoppedBy).toBeNull()
    expect(r.results[1]).toMatchObject({ status: 'failed', stage: 'deploy', reason: 'Vercel failure' })
  })

  it('a draft conflict found by the pre-merge blocks the repo BEFORE main is pushed, and stops the fleet', async () => {
    const f = fakeOps({ a: { preflight: 'conflict' } })
    const r = await runPushPhase([item('a'), item('b')], opts, f.ops)
    expect(f.pushed).toEqual([])
    expect(r.results[0]).toMatchObject({ status: 'blocked', stage: 'preflight' })
    expect(r.results[1].status).toBe('skipped')
  })

  it('canary: the first repo must deploy green before any other is pushed', async () => {
    const f = fakeOps({})
    await runPushPhase([item('a'), item('b'), item('c')], { ...opts, canary: 1, deployWait: false }, f.ops)
    // canary waits even with deployWait off; the others don't
    expect(f.events).toEqual(['preflight:a', 'push:a', 'deploy:a', 'preflight:b', 'push:b', 'preflight:c', 'push:c'])
  })

  it('a failed canary stops the run even with --keep-going', async () => {
    const f = fakeOps({ a: { deploy: 'timeout' } })
    const r = await runPushPhase([item('a'), item('b')], { ...opts, canary: 1, keepGoing: true }, f.ops)
    expect(f.pushed).toEqual(['a'])
    expect(r.results[0]).toMatchObject({ status: 'failed', canary: true, reason: 'canary: Vercel timeout' })
    expect(r.stoppedBy).toBe('o/a')
  })

  it('a noDeploy repo is never the canary; its missing status is fine, anyone else’s is a failure', async () => {
    const f = fakeOps({ korbey: { deploy: 'none' }, b: { deploy: 'none' } })
    const r = await runPushPhase([item('korbey', true), item('a'), item('b')], { ...opts, canary: 1, keepGoing: true }, f.ops)
    expect(r.results.map((x) => [x.slug, x.status, x.canary])).toEqual([
      ['o/a', 'pushed', true],
      ['o/b', 'failed', false],
      ['o/korbey', 'pushed', false],
    ])
  })

  it('isolation: a throw inside one repo is that repo’s failure, never a crash of the loop', async () => {
    const f = fakeOps({ b: { throwAt: 'push' } })
    const r = await runPushPhase([item('a'), item('b'), item('c')], { ...opts, keepGoing: true }, f.ops)
    expect(r.results.map((x) => x.status)).toEqual(['pushed', 'failed', 'pushed'])
    expect(r.results[1]).toMatchObject({ stage: 'exception', reason: 'JSON.parse boom' })
  })

  it('a main→draft merge failure after the push counts as a failure (main is already live)', async () => {
    const f = fakeOps({ a: { draft: 'conflict' } })
    const r = await runPushPhase([item('a'), item('b')], opts, f.ops)
    expect(r.results[0]).toMatchObject({ status: 'failed', stage: 'draft', main: 'sha-a' })
    expect(f.pushed).toEqual(['a'])
  })

  it('no draft branch: nothing to merge', async () => {
    const f = fakeOps({ a: { preflight: 'absent' } })
    const r = await runPushPhase([item('a')], opts, f.ops)
    expect(r.results[0]).toMatchObject({ status: 'pushed', draft: { result: 'no-draft' } })
  })
})
