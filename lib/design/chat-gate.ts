// Pure + client-safe. Render checks for the design chat: what a preview
// reports to the model (new failures vs the turn-start draft, unmeasured
// viewports) and whether the working copy may be committed. It is P4's apply
// gate (review.ts: metricsRenderGate / metricGateFailures /
// unmeasuredViewports, baseline-diffed, same viewport names) with chat wording
// — no second implementation.
import { metricGateFailures, type RenderMetrics } from './metrics'
import { metricsRenderGate, RUN_VIEWPORT_NAME, unmeasuredViewports, type RenderGate } from './review'
import type { RunViewport } from './run-types'

export const CHAT_UNPREVIEWED_WARNING =
  'Saved without a preview of the final change, so it was not checked for contrast, mobile overflow or hidden blocks — check it in the live preview before publishing.'
export const CHAT_UNMEASURED_PREVIEW_WARNING =
  'The preview could not be measured, so contrast, mobile overflow and hidden blocks were not checked — check it in the live preview before publishing.'

export const chatUnmeasuredViewportWarning = (v: RunViewport): string =>
  `The ${RUN_VIEWPORT_NAME[v]} preview could not be checked for contrast, overflow or hidden blocks — check it in the live preview before publishing.`

const CHAT_WORDING = { unmeasured: CHAT_UNMEASURED_PREVIEW_WARNING, unmeasuredViewport: chatUnmeasuredViewportWarning }

// What render_preview reports: failures AND unmeasured-viewport warnings
// together (the model should see both, unlike the commit gate's either/or).
export function previewCheck(metrics: RenderMetrics | null, baseline: RenderMetrics | null): { gateFailures: string[]; warnings: string[] } {
  if (!metrics) return { gateFailures: [], warnings: [CHAT_UNMEASURED_PREVIEW_WARNING] }
  return {
    gateFailures: metricGateFailures(metrics, baseline).map((f) => f.message),
    warnings: unmeasuredViewports(metrics).map(chatUnmeasuredViewportWarning),
  }
}

export type ChatGate = RenderGate

// `preview` = the workspace's preview of its CURRENT revision (null when the
// change was never previewed).
export function chatCommitGate(preview: { metrics: RenderMetrics | null; baseline: RenderMetrics | null } | null): ChatGate {
  if (!preview) return { ok: true, warnings: [CHAT_UNPREVIEWED_WARNING] }
  return metricsRenderGate(preview.metrics, preview.baseline, CHAT_WORDING)
}

export function chatGateMessage(failures: string[]): string {
  const more = failures.length > 3 ? ` (+${failures.length - 3} more)` : ''
  return `Not saved — the latest preview fails the render checks: ${failures.slice(0, 3).join(' · ')}${more}. Fix these, preview again, then commit.`
}
