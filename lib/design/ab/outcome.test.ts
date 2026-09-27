import { describe, it, expect } from 'vitest'
import { VALID } from '../__fixtures__/valid-bundle'
import { providerRejectionMessage } from '../model-call'
import { noUsableAnswerText, rejectionText } from './outcome'
import { buildReportHtml, type AbCallStats, type AbConcept, type AbReport } from './report'

const USAGE_LIMIT = { kind: 'usage_limit' as const, resetDate: '2026-10-01' }
const PERMISSION = { kind: 'permission' as const, resetDate: null }

describe('A/B call outcome text', () => {
  it('a provider rejection gets the Studio’s specific message (Task 9 classifier), never the generic stop reason', () => {
    const r = { stoppedReason: 'provider_rejected', rejection: USAGE_LIMIT }
    expect(noUsableAnswerText(r)).toBe(
      'The AI provider rejected the request: API usage limit reached (access returns 2026-10-01). Raise the limit in the Anthropic Console, then press Retry.'
    )
    expect(noUsableAnswerText(r)).not.toContain('provider_rejected')
    expect(rejectionText(r)).toBe(noUsableAnswerText(r))
    // Same text as production (model-call re-exports the pure helper).
    expect(rejectionText({ rejection: PERMISSION })).toBe(providerRejectionMessage(PERMISSION))
  })

  it('no rejection: the generic stop reason, as before', () => {
    expect(noUsableAnswerText({ stoppedReason: 'deadline', rejection: null })).toBe('No usable answer (deadline).')
    expect(noUsableAnswerText({ stoppedReason: null })).toBe('No usable answer (no_output).')
    expect(rejectionText({ stoppedReason: 'no_output', rejection: null })).toBeNull()
    expect(rejectionText(null)).toBeNull()
    expect(rejectionText(undefined)).toBeNull()
  })
})

// The message reaches report.json (the AbReport as data) and report.html (escaped).
const stats = (): AbCallStats => ({ latencyMs: 1, calls: 1, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, costUsd: 0, estimatedUsd: 0, apiErrors: [] })
const failed = (errors: string[], critiqueErrors: string[] = []): AbConcept => ({
  model: 'A',
  position: 0,
  status: 'failed',
  bundle: errors.length ? null : VALID,
  errors,
  notes: [],
  conceptNotes: [],
  generation: stats(),
  shots: [],
  checks: [],
  distinctness: [],
  critiqueStatus: critiqueErrors.length ? 'failed' : 'not_valid',
  critique: null,
  critiqueStats: null,
  critiqueErrors,
  revisions: [],
  loopOutcome: null,
  finalCritique: null,
  finalBundle: null,
  finalShots: [],
  finalChecks: [],
})
const report = (concepts: AbConcept[]): AbReport => ({
  sessionId: 's',
  firmName: 'Acme CPA',
  generatedAt: '2026-09-27T00:00:00.000Z',
  models: ['A'],
  criticModel: null,
  criticIsContender: false,
  pages: ['/'],
  primaryPage: '/',
  conceptsPerModel: 1,
  maxRevisions: 0,
  capUsd: 15,
  spentUsd: 0,
  capHit: false,
  paletteFreedom: 'evolve',
  capabilityLevel: 1,
  adminBrief: null,
  referenceImages: 0,
  notes: [],
  current: { shots: [], checks: [] },
  concepts,
})

describe('the specific message in report.json + report.html', () => {
  it('report.json carries it verbatim; report.html escapes it (the permission message has an apostrophe)', () => {
    const msg = noUsableAnswerText({ stoppedReason: 'provider_rejected', rejection: PERMISSION })
    const r = report([failed([msg])])
    expect(JSON.parse(JSON.stringify(r)).concepts[0].errors).toEqual([msg])
    const html = buildReportHtml(r)
    expect(html).toContain('check the API key&#39;s workspace and model access')
    expect(html).not.toContain("API key's workspace")
    expect(html).not.toContain('provider_rejected')
  })
})
