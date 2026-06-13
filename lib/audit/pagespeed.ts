// Google PageSpeed Insights fetcher (mobile + desktop). Ported from audit.py
// check_pagespeed. Degrades to { score: null, error } on any failure so a
// rate-limited / unavailable PSI never tanks the audit. An optional
// PAGESPEED_API_KEY raises rate limits.
import { pyRound } from './scoring'
import type { PageSpeedResult } from './types'

const PSI_API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'
const PSI_TIMEOUT_MS = 30_000

export type PageSpeedStrategy = 'mobile' | 'desktop'

interface LighthouseAudit {
  numericValue?: number
  score?: number | null
}

export async function checkPageSpeed(
  url: string,
  strategy: PageSpeedStrategy = 'mobile',
): Promise<PageSpeedResult> {
  try {
    const params = new URLSearchParams({ url, strategy })
    if (process.env.PAGESPEED_API_KEY) params.set('key', process.env.PAGESPEED_API_KEY)

    const res = await fetch(`${PSI_API}?${params.toString()}`, {
      signal: AbortSignal.timeout(PSI_TIMEOUT_MS),
    })
    if (res.status !== 200) return { score: null, error: 'PageSpeed API unavailable' }

    const data = (await res.json()) as {
      lighthouseResult?: {
        categories?: { performance?: { score?: number | null } }
        audits?: Record<string, LighthouseAudit>
      }
    }
    const cats = data.lighthouseResult?.categories ?? {}
    const audits = data.lighthouseResult?.audits ?? {}
    const perfScore = Math.trunc((cats.performance?.score ?? 0) * 100)

    const metric = (key: string): [number | undefined, number | null | undefined] => {
      const a = audits[key] ?? {}
      return [a.numericValue, a.score]
    }
    const [lcpVal, lcpScore] = metric('largest-contentful-paint')
    const [clsVal, clsScore] = metric('cumulative-layout-shift')
    const [fcpVal, fcpScore] = metric('first-contentful-paint')
    const [ttfbVal] = metric('server-response-time')
    const [inpVal] = metric('interaction-to-next-paint')

    const pass = (s: number | null | undefined): boolean | undefined =>
      s === null || s === undefined ? undefined : s >= 0.9

    return {
      score: perfScore,
      lcp: lcpVal ? pyRound(lcpVal / 1000, 2) : null,
      cls: clsVal ? pyRound(clsVal, 3) : null,
      fcp: fcpVal ? pyRound(fcpVal / 1000, 2) : null,
      ttfb: ttfbVal ? pyRound(ttfbVal / 1000, 2) : null,
      inp: inpVal ? pyRound(inpVal, 0) : null,
      lcp_pass: pass(lcpScore),
      cls_pass: pass(clsScore),
      fcp_pass: pass(fcpScore),
    }
  } catch {
    return { score: null, error: 'PageSpeed API unavailable' }
  }
}
