import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { SID, makeVersionRow } from './__fixtures__/rows'
import { DRAFT_FILES } from './__fixtures__/theme-texts'
import { bundleFromRepoFiles } from './bundle-files'
import { DEFAULT_CAPABILITIES } from './run-types'
import { parseRenderMetrics, type RenderMetrics } from './metrics'
import { ChatWorkspace } from './chat-workspace'
import { CHAT_UNPREVIEWED_WARNING } from './chat-gate'
import { COMMIT_FAILED_ERROR, STAGED_DISCARDED_ERROR, commitWorkspace, finishTurnCommit, type CommitVersionFn } from './chat-commit'

const SHAS = { 'content/brand.json': 'a'.repeat(40), 'content/design.json': 'b'.repeat(40) }
const NEXT = { ...SHAS, 'content/brand.json': 'c'.repeat(40) }
const TARGET = { sessionId: SID, jobId: 'job-1', githubRepo: 'o/r', adminId: 'admin-1', adminEmail: 'a@x.com' }
const metrics = (v: unknown): RenderMetrics => {
  const m = parseRenderMetrics(v)
  if (!m) throw new Error('fixture')
  return m
}
const D = { viewport: 'desktop', textChecked: 1, textUnverified: 0, contrast: [], overflow: null, hidden: [] }
const M = { viewport: 'mobile', textChecked: 1, textUnverified: 0, contrast: [], overflow: null, hidden: [] }
const CLEAN = metrics({ v: 1, viewports: [D, M] })
const OVERFLOW = metrics({ v: 1, viewports: [D, { ...M, overflow: { scrollWidth: 430, viewportWidth: 390, offenders: [] } }] })

function workspace() {
  const r = bundleFromRepoFiles(DRAFT_FILES, { name: 'Harbor v3', source: 'chat' })
  if (!r.ok) throw new Error('fixture')
  return new ChatWorkspace({ current: r.bundle, draftFiles: DRAFT_FILES, draftShas: SHAS, caps: DEFAULT_CAPABILITIES, model: 'claude-sonnet-5' })
}
let commitVersion: Mock<CommitVersionFn>

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  commitVersion = vi.fn<CommitVersionFn>(async () => ({
    ok: true as const,
    version: makeVersionRow({ id: 'ver-9', version_no: 9, source: 'chat' }),
    commitSha: '1'.repeat(40),
    changedPaths: ['content/brand.json'],
    appliedBlobs: NEXT,
    css: { blocks: {} },
  }))
})

describe('commitWorkspace', () => {
  it('nothing staged → unchanged, no commit', async () => {
    expect(await commitWorkspace(workspace(), { summary: 'x', target: TARGET, commitVersion })).toEqual({ ok: true, unchanged: true })
    expect(commitVersion).not.toHaveBeenCalled()
  })
  it('commits an unpreviewed change as a chat version with the stale guard, warning about the missing preview', async () => {
    const ws = workspace()
    ws.apply({ kind: 'palette', patch: { primary: '#123a5c' } })
    const out = await commitWorkspace(ws, { summary: 'Calmer navy', target: TARGET, commitVersion })
    expect(out).toEqual({ ok: true, versionId: 'ver-9', versionNo: 9, changedPaths: ['content/brand.json'], warnings: [CHAT_UNPREVIEWED_WARNING] })
    expect(commitVersion.mock.calls[0][0]).toMatchObject({
      source: 'chat',
      removeLegacy: false,
      syncMbp: false,
      skipIfUnchanged: true,
      expectedShas: SHAS,
      summary: 'Chat: Calmer navy',
      commitMessage: 'Design Studio chat: Calmer navy (a@x.com)',
      screenshots: [],
    })
    expect(ws.isStaged()).toBe(false)
    expect(ws.draftShas()).toEqual(NEXT)
    expect(ws.lastVersionId()).toBe('ver-9')
  })
  it('refuses a change whose CURRENT preview fails the render checks', async () => {
    const ws = workspace()
    ws.apply({ kind: 'palette', patch: { primary: '#123a5c' } })
    ws.recordPreview({ metrics: OVERFLOW, baseline: CLEAN, shots: [] })
    const out = await commitWorkspace(ws, { summary: 'x', target: TARGET, commitVersion })
    expect(out.ok).toBe(false)
    expect(!out.ok && out.failures?.[0]).toContain('wider than the screen')
    expect(commitVersion).not.toHaveBeenCalled()
    expect(ws.isStaged()).toBe(true)
  })
  it('passes the preview shots to the version and returns no warning for a clean preview', async () => {
    const ws = workspace()
    ws.apply({ kind: 'palette', patch: { primary: '#123a5c' } })
    const shot = { viewport: 'desktop' as const, path: `design/${SID}/renders/chat/t-p1-desktop.webp`, width: 1440, height: 900 }
    ws.recordPreview({ metrics: CLEAN, baseline: CLEAN, shots: [shot] })
    const out = await commitWorkspace(ws, { summary: '', target: TARGET, commitVersion })
    expect(out).toMatchObject({ ok: true, warnings: [] })
    expect(commitVersion.mock.calls[0][0]).toMatchObject({ screenshots: [shot], summary: 'Chat: palette (primary)' })
  })
  it('surfaces a refusal (stale / contrast) and keeps the change staged', async () => {
    commitVersion.mockResolvedValueOnce({ ok: false, status: 409, error: 'The theme changed while applying — refresh the Studio and try again.', stale: true })
    const ws = workspace()
    ws.apply({ kind: 'palette', patch: { primary: '#123a5c' } })
    expect(await commitWorkspace(ws, { summary: 'x', target: TARGET, commitVersion })).toEqual({ ok: false, error: 'The theme changed while applying — refresh the Studio and try again.' })
    expect(ws.isStaged()).toBe(true)
  })
  it('a commit that changed nothing on disk still clears the staged state', async () => {
    commitVersion.mockResolvedValueOnce({ ok: true, version: null, commitSha: null, changedPaths: [], appliedBlobs: SHAS, css: { blocks: {} } })
    const ws = workspace()
    ws.apply({ kind: 'palette', patch: { primary: '#123a5c' } })
    expect(await commitWorkspace(ws, { summary: 'x', target: TARGET, commitVersion })).toEqual({ ok: true, unchanged: true })
    expect(ws.isStaged()).toBe(false)
  })
  it('PF3: a chat commit never mirrors into schema_data (syncMbp: false)', async () => {
    const ws = workspace()
    ws.apply({ kind: 'palette', patch: { primary: '#123a5c' } })
    await commitWorkspace(ws, { summary: 'x', target: TARGET, commitVersion })
    expect(commitVersion.mock.calls[0][0].syncMbp).toBe(false)
  })
  it('PF2: two commits in one turn both succeed — the second is based on the blobs the first wrote', async () => {
    const LATER = { ...NEXT, 'content/design.json': 'd'.repeat(40) }
    commitVersion.mockResolvedValueOnce({
      ok: true,
      version: makeVersionRow({ id: 'ver-9', version_no: 9, source: 'chat' }),
      commitSha: '1'.repeat(40),
      changedPaths: ['content/brand.json'],
      appliedBlobs: NEXT,
      css: { blocks: {} },
    })
    commitVersion.mockResolvedValueOnce({
      ok: true,
      version: makeVersionRow({ id: 'ver-10', version_no: 10, source: 'chat' }),
      commitSha: '2'.repeat(40),
      changedPaths: ['content/design.json'],
      appliedBlobs: LATER,
      css: { blocks: {} },
    })
    const ws = workspace()
    ws.apply({ kind: 'palette', patch: { primary: '#123a5c' } })
    expect(await commitWorkspace(ws, { summary: 'one', target: TARGET, commitVersion })).toMatchObject({ ok: true, versionNo: 9 })
    ws.apply({ kind: 'treatments', patch: { darkSections: true } })
    expect(await commitWorkspace(ws, { summary: 'two', target: TARGET, commitVersion })).toMatchObject({ ok: true, versionNo: 10 })
    expect(commitVersion.mock.calls[0][0].expectedShas).toEqual(SHAS)
    expect(commitVersion.mock.calls[1][0].expectedShas).toEqual(NEXT)
    expect(ws.draftShas()).toEqual(LATER)
    expect(ws.lastVersionId()).toBe('ver-10')
  })
})

describe('finishTurnCommit', () => {
  const staged = () => {
    const ws = workspace()
    ws.apply({ kind: 'palette', patch: { primary: '#123a5c' } })
    return ws
  }
  it('none when nothing is staged', async () => {
    expect(await finishTurnCommit(workspace(), vi.fn(), false)).toEqual({ status: 'none' })
  })
  it('auto-commits what is staged', async () => {
    const commit = vi.fn(async () => ({ ok: true as const, versionId: 'ver-9', versionNo: 9, changedPaths: ['content/brand.json'], warnings: [] }))
    expect(await finishTurnCommit(staged(), commit, false)).toEqual({ status: 'committed', versionId: 'ver-9', versionNo: 9, changedPaths: ['content/brand.json'], warnings: [], auto: true })
    expect(commit).toHaveBeenCalledWith('palette (primary)')
  })
  it('discards (never commits) staged edits after a stream failure', async () => {
    const commit = vi.fn()
    expect(await finishTurnCommit(staged(), commit, true)).toEqual({ status: 'blocked', error: STAGED_DISCARDED_ERROR, failures: [] })
    expect(commit).not.toHaveBeenCalled()
  })
  it('reports a refused or crashed auto-commit', async () => {
    expect(await finishTurnCommit(staged(), async () => ({ ok: false as const, error: 'Not saved — x', failures: ['f'] }), false)).toEqual({ status: 'blocked', error: 'Not saved — x', failures: ['f'] })
    expect(await finishTurnCommit(staged(), async () => { throw new Error('octokit') }, false)).toEqual({ status: 'blocked', error: COMMIT_FAILED_ERROR, failures: [] })
  })
})
