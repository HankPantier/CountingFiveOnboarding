import { describe, it, expect } from 'vitest'
import { VALID } from '../__fixtures__/valid-bundle'
import { buildReportHtml, escapeHtml, safeHex, safeRelativePath, summarize, summaryText, type AbCallStats, type AbConcept, type AbCritique, type AbReport, type AbRevision } from './report'

const stats = (over: Partial<AbCallStats> = {}): AbCallStats => ({
  latencyMs: 10_000,
  calls: 1,
  usage: { inputTokens: 100, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
  costUsd: 1,
  estimatedUsd: 0,
  apiErrors: [],
  ...over,
})
const SCORES = { brandFit: 4, distinctiveness: 4, hierarchy: 4, legibility: 4, consistency: 4, craft: 4 }

function concept(over: Partial<AbConcept>): AbConcept {
  return {
    model: 'A',
    position: 0,
    status: 'valid',
    bundle: VALID,
    errors: [],
    notes: [],
    generation: stats(),
    shots: [],
    checks: [],
    distinctness: [],
    critiqueStatus: 'done',
    critique: { scores: SCORES, mean: 4, passed: true, summary: 'ok', issues: [] },
    critiqueStats: stats({ costUsd: 0.25, latencyMs: 5_000 }),
    critiqueErrors: [],
    revisions: [],
    loopOutcome: null,
    finalCritique: over.finalCritique !== undefined ? over.finalCritique : (over.critique !== undefined ? over.critique : { scores: SCORES, mean: 4, passed: true, summary: 'ok', issues: [] }),
    finalBundle: null,
    finalShots: [],
    finalChecks: [],
    ...over,
  }
}

function report(concepts: AbConcept[]): AbReport {
  return {
    sessionId: 's',
    firmName: 'Acme CPA',
    generatedAt: '2026-09-26T00:00:00.000Z',
    models: ['A', 'B'],
    criticModel: 'claude-sonnet-5',
    criticIsContender: false,
    pages: ['/'],
    primaryPage: '/',
    conceptsPerModel: 2,
    maxRevisions: 0,
    capUsd: 15,
    spentUsd: 3,
    capHit: false,
    paletteFreedom: 'evolve',
    capabilityLevel: 1,
    adminBrief: null,
    referenceImages: 0,
    notes: [],
    current: { shots: [], checks: [] },
    concepts,
  }
}

describe('summarize', () => {
  it('computes per-model valid / pass rate / mean score / latency / spend', () => {
    const rows = summarize(
      report([
        concept({ position: 0, critique: { scores: SCORES, mean: 4, passed: true, summary: '', issues: [] } }),
        concept({ position: 1, generation: stats({ latencyMs: 30_000, costUsd: 2 }), critique: { scores: SCORES, mean: 3, passed: false, summary: '', issues: [] } }),
        concept({ model: 'B', position: 0, status: 'failed', bundle: null, critique: null, critiqueStatus: 'not_valid', critiqueStats: null, generation: stats({ costUsd: 0.5 }) }),
        concept({ model: 'B', position: 1, status: 'skipped_cap', bundle: null, critique: null, critiqueStatus: 'skipped_cap', critiqueStats: null, generation: null }),
      ])
    )
    expect(rows[0]).toEqual({
      model: 'A',
      attempted: 2,
      valid: 2,
      failed: 0,
      skipped: 0,
      critiqued: 2,
      meanCriticScore: 3.5,
      firstDraftPassRate: 0.5,
      finalCritiqued: 2,
      meanFinalCriticScore: 3.5,
      finalPassRate: 0.5,
      revisionsUsed: 0,
      meanLatencyMs: 20_000,
      conceptUsd: 3,
      reviseUsd: 0,
      criticUsd: 0.5,
      totalUsd: 3.5,
    })
    expect(rows[1]).toMatchObject({ model: 'B', attempted: 1, valid: 0, failed: 1, skipped: 1, critiqued: 0, meanCriticScore: null, firstDraftPassRate: null, finalPassRate: null, meanLatencyMs: 10_000, totalUsd: 0.5 })
    const text = summaryText(rows)
    expect(text.split('\n')).toHaveLength(4)
    expect(text).toContain('50%')
    expect(text).toContain('$3.50')
  })
})

describe('escaping', () => {
  it('escapes the five HTML metacharacters', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;')
    expect(escapeHtml(null)).toBe('')
  })

  it('never emits model-provided markup raw in the report', () => {
    const evil = '<script>alert(1)</script>'
    const html = buildReportHtml(
      report([
        concept({
          bundle: { ...VALID, name: `"><img src=x onerror=alert(1)>`, tagline: evil, rationale: `it's "bold" ${evil}`, moves: [evil] },
          errors: [evil],
          notes: [evil],
          critique: { scores: SCORES, mean: 4, passed: true, summary: evil, issues: [{ area: evil, problem: evil, fix: evil }] },
          generation: stats({ apiErrors: [`HTTP 400 ${evil}`] }),
          checks: [{ page: '/', measured: ['desktop'], gateFailures: [evil], renderError: null }],
        }),
      ])
    )
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('it&#39;s &quot;bold&quot;')
  })

  it('only uses allowlisted relative image paths and hex colours', () => {
    expect(safeRelativePath('concepts/a/c1-home-desktop.webp')).toBe('concepts/a/c1-home-desktop.webp')
    for (const bad of ['/etc/passwd', '../x.webp', 'a/../b.webp', 'javascript:alert(1)', 'https://x/y.png', 'a//b.webp', 'a"b.webp', null]) {
      expect(safeRelativePath(bad)).toBeNull()
    }
    expect(safeHex('#AABBCC')).toBe('#aabbcc')
    expect(safeHex('red;background:url(x)')).toBeNull()
    const html = buildReportHtml(
      report([concept({ shots: [{ page: '/', viewport: 'desktop', file: '"><script>x</script>.webp' }, { page: '/', viewport: 'mobile', file: 'current/home-mobile.webp' }] })])
    )
    expect(html).toContain('src="current/home-mobile.webp"')
    expect(html).toContain('no / desktop render')
  })

  it('renders one column per model and the summary table', () => {
    const html = buildReportHtml(report([concept({}), concept({ model: 'B' })]))
    expect(html).toContain('--n:2')
    expect(html.match(/<section class="col">/g)).toHaveLength(2)
    expect(html).toContain('First-draft pass rate')
  })
})

describe('report header', () => {
  it('names the judge, flags a contender judge, and states the spend attribution', () => {
    const plain = buildReportHtml(report([concept({})]))
    expect(plain).toContain('Judge: <b>claude-sonnet-5</b> (not one of the compared models)')
    expect(plain).toContain('design_concept / design_critique')
    const flagged = buildReportHtml({ ...report([concept({})]), criticModel: 'A', criticIsContender: true })
    expect(flagged).toContain('the judge is also a compared model')
    const off = buildReportHtml({ ...report([concept({})]), criticModel: null })
    expect(off).toContain('Judge: none (--no-critic)')
  })
})

const k = (mean: number, passed: boolean): AbCritique => ({ scores: SCORES, mean, passed, summary: '', issues: [] })
const round = (n: number, over: Partial<AbRevision> = {}): AbRevision => ({
  round: n,
  status: 'valid',
  name: `v${n}`,
  errors: [],
  notes: [],
  stats: stats({ costUsd: 0.5, latencyMs: 20_000 }),
  shots: [],
  critiqueStatus: 'done',
  critique: null,
  critiqueStats: stats({ costUsd: 0.1 }),
  ...over,
})

describe('summarize with the --revise loop', () => {
  it('reports first-draft and final pass rates, revisions used and revise / critic spend', () => {
    const rows = summarize(
      report([
        // failed first, passed after 2 revisions
        concept({ critique: k(3, false), finalCritique: k(4, true), loopOutcome: 'passed', revisions: [round(1, { critique: k(3.5, false) }), round(2, { critique: k(4, true) })] }),
        // passed first draft, no revision
        concept({ position: 1, critique: k(4.2, true), finalCritique: k(4.2, true), loopOutcome: 'passed' }),
        // failed first; its only revision could not be rendered ⇒ final uncritiqued
        concept({ position: 2, critique: k(2.5, false), finalCritique: null, loopOutcome: 'not_rendered', revisions: [round(1, { critiqueStatus: 'not_rendered', critiqueStats: null })] }),
        // failed first; the revision was invalid ⇒ final = first draft
        concept({ position: 3, critique: k(3, false), finalCritique: k(3, false), loopOutcome: 'invalid_revision', revisions: [round(1, { status: 'invalid', name: null, critiqueStatus: 'not_valid', critiqueStats: null })] }),
      ])
    )
    expect(rows[0]).toMatchObject({
      critiqued: 4,
      firstDraftPassRate: 0.25,
      meanCriticScore: 3.18, // (3 + 4.2 + 2.5 + 3) / 4 = 3.175
      finalCritiqued: 3,
      finalPassRate: 0.667,
      meanFinalCriticScore: 3.73, // (4 + 4.2 + 3) / 3
      revisionsUsed: 3, // the invalid round does not count
      reviseUsd: 2, // 4 revise calls × $0.50
      criticUsd: 1.2, // 4 first-draft × $0.25 + 2 revision critiques × $0.10
      totalUsd: 7.2, // concepts 4 × $1 + revise 2 + critic 1.2
    })
    const text = summaryText(rows)
    expect(text).toContain('first-draft pass')
    expect(text).toContain('final pass')
    expect(text).toContain('67%')
  })

  it('renders the loop per concept, escaped', () => {
    const evil = '<script>x</script>'
    const html = buildReportHtml({
      ...report([
        concept({
          critique: k(3, false),
          finalCritique: k(4, true),
          loopOutcome: 'passed',
          revisions: [round(1, { name: evil, errors: [evil], critique: { ...k(4, true), summary: evil } })],
          finalBundle: { ...VALID, name: evil },
          finalShots: [{ page: '/', viewport: 'desktop', file: 'concepts/A/c1-r1-home-desktop.webp' }],
        }),
      ]),
      maxRevisions: 2,
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('Revise loop')
    expect(html).toContain('after 1 revision')
    expect(html).toContain('revise loop up to 2 rounds')
    expect(html).toContain('Final pass rate')
    expect(html).toContain('src="concepts/A/c1-r1-home-desktop.webp"')
  })
})
