import { describe, it, expect } from 'vitest'
import { parseRenderMetrics, type RenderMetrics } from './metrics'
import { CHAT_UNMEASURED_PREVIEW_WARNING, CHAT_UNPREVIEWED_WARNING, chatCommitGate, chatGateMessage, chatUnmeasuredViewportWarning, previewCheck } from './chat-gate'

const metrics = (v: unknown): RenderMetrics => {
  const m = parseRenderMetrics(v)
  if (!m) throw new Error('fixture')
  return m
}
const DESKTOP = { viewport: 'desktop', textChecked: 1, textUnverified: 0, contrast: [], overflow: null, hidden: [] }
const MOBILE_OK = { viewport: 'mobile', textChecked: 1, textUnverified: 0, contrast: [], overflow: null, hidden: [] }
const MOBILE_OVERFLOW = { ...MOBILE_OK, overflow: { scrollWidth: 430, viewportWidth: 390, offenders: [] } }
const CLEAN = metrics({ v: 1, viewports: [DESKTOP, MOBILE_OK] })
const OVERFLOW = metrics({ v: 1, viewports: [DESKTOP, MOBILE_OVERFLOW] })

describe('previewCheck', () => {
  it('reports new failures (baseline-diffed) and unmeasured viewports', () => {
    expect(previewCheck(OVERFLOW, CLEAN).gateFailures[0]).toContain('wider than the screen')
    expect(previewCheck(OVERFLOW, OVERFLOW).gateFailures).toEqual([])
    expect(previewCheck(metrics({ v: 1, viewports: [DESKTOP] }), null).warnings[0]).toMatch(/mobile \(390\) preview/)
    expect(previewCheck(null, CLEAN)).toEqual({ gateFailures: [], warnings: [CHAT_UNMEASURED_PREVIEW_WARNING] })
  })
})

describe('chatCommitGate', () => {
  it('no preview of the current change → allowed with a warning', () => {
    expect(chatCommitGate(null)).toEqual({ ok: true, warnings: [CHAT_UNPREVIEWED_WARNING] })
  })
  it('a failing preview blocks; a clean one passes silently', () => {
    const g = chatCommitGate({ metrics: OVERFLOW, baseline: CLEAN })
    expect(g.ok).toBe(false)
    expect(!g.ok && chatGateMessage(g.failures)).toMatch(/^Not saved — the latest preview fails the render checks: /)
    expect(chatCommitGate({ metrics: CLEAN, baseline: CLEAN })).toEqual({ ok: true, warnings: [] })
  })
  it('an unmeasured preview (or viewport) is allowed with the chat-worded warning', () => {
    expect(chatCommitGate({ metrics: null, baseline: CLEAN })).toEqual({ ok: true, warnings: [CHAT_UNMEASURED_PREVIEW_WARNING] })
    expect(chatCommitGate({ metrics: metrics({ v: 1, viewports: [DESKTOP] }), baseline: CLEAN })).toEqual({ ok: true, warnings: [chatUnmeasuredViewportWarning('mobile')] })
  })
  it('caps the message at three failures', () => {
    expect(chatGateMessage(['a', 'b', 'c', 'd', 'e'])).toContain('a · b · c (+2 more)')
  })
})
