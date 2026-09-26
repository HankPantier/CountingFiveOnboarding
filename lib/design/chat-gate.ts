// Pure + client-safe. Render checks for the design chat: what a preview
// reports to the model (new failures vs the turn-start draft, unmeasured
// viewports) and whether the working copy may be committed. It is P4's apply
// gate (review.ts: metricsRenderGate / metricGateFailures /
// unmeasuredViewports, baseline-diffed, same viewport names) with chat wording
// — no second implementation — over only the viewports the baseline measured.
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

// The chat always measures a turn-start baseline, so a viewport that baseline
// lacks (the baseline render failed or timed out part-way) can't be diffed: its
// preview metrics would report the site's EXISTING defects as new. Such a
// viewport is dropped from the comparison and so counts as unmeasured (a
// warning, never a failure). A null baseline = nothing comparable.
function comparable(metrics: RenderMetrics, baseline: RenderMetrics | null): RenderMetrics | null {
  const have = new Set((baseline?.viewports ?? []).map((v) => v.viewport))
  const viewports = metrics.viewports.filter((v) => have.has(v.viewport))
  return viewports.length > 0 ? { ...metrics, viewports } : null
}

const unmeasuredWarnings = (m: RenderMetrics | null): string[] => unmeasuredViewports(m).map(chatUnmeasuredViewportWarning)

// What render_preview reports: failures AND unmeasured-viewport warnings
// together (the model should see both, unlike the commit gate's either/or).
export function previewCheck(metrics: RenderMetrics | null, baseline: RenderMetrics | null): { gateFailures: string[]; warnings: string[] } {
  if (!metrics) return { gateFailures: [], warnings: [CHAT_UNMEASURED_PREVIEW_WARNING] }
  const m = comparable(metrics, baseline)
  return {
    gateFailures: m ? metricGateFailures(m, baseline).map((f) => f.message) : [],
    warnings: unmeasuredWarnings(m),
  }
}

export type ChatGate = RenderGate

type GatePreview = { metrics: RenderMetrics | null; baseline: RenderMetrics | null }

// `preview` = the workspace's preview of its CURRENT revision (null when the
// change was never previewed or was edited since). `latest` = the most recent
// preview of ANY revision. A failed preview is sticky: when the current
// revision is unpreviewed and the latest preview (of an earlier revision)
// failed, the commit is refused until a newer revision is previewed — an edit
// after a failed preview never slips past the gate unchecked (the sanitizer
// relies on this gate for residual hiding vectors). An unpreviewed change with
// no failed preview behind it is still allowed, with the unpreviewed warning.
export function chatCommitGate(preview: GatePreview | null, latest: GatePreview | null = null): ChatGate {
  if (!preview) {
    if (latest) {
      const last = chatCommitGate(latest)
      if (!last.ok) return last
    }
    return { ok: true, warnings: [CHAT_UNPREVIEWED_WARNING] }
  }
  if (!preview.metrics) return metricsRenderGate(null, preview.baseline, CHAT_WORDING)
  const m = comparable(preview.metrics, preview.baseline)
  if (!m) return { ok: true, warnings: unmeasuredWarnings(null) }
  return metricsRenderGate(m, preview.baseline, CHAT_WORDING)
}

export function chatGateMessage(failures: string[]): string {
  const more = failures.length > 3 ? ` (+${failures.length - 3} more)` : ''
  return `Not saved — the latest preview fails the render checks: ${failures.slice(0, 3).join(' · ')}${more}. Fix these, preview again, then commit.`
}
