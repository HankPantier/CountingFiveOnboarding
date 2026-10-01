import type { QaSummary } from '@/types/qa-review'

// Pure — no server imports. Consumed by GenerationPhase (client component) and
// tested directly. Token classes match `criticChip` in GenerationPhase.tsx:
// text-<token> + bg-<token>/10, with warning using the AA-readable
// `warning-strong` text token (same pattern `criticChip` uses).
const CLS = {
  info: 'text-info bg-info/10',
  success: 'text-success bg-success/10',
  warning: 'text-warning-strong bg-warning/10',
  error: 'text-error bg-error/10',
} as const

export function qaChip(
  qa: QaSummary | null,
  qaStatus: string | null,
): { label: string; cls: string; title: string } | null {
  if (!qa) {
    if (qaStatus === 'queued' || qaStatus === 'running') {
      return { label: 'QA…', cls: CLS.info, title: 'The QA desk is reviewing this page.' }
    }
    if (qaStatus === 'error') {
      return { label: 'QA unavailable', cls: CLS.warning, title: 'Automated QA could not run on this page — review it as usual.' }
    }
    return null
  }
  if (qa.mode === 'shadow') {
    return {
      label: `QA (shadow) ⚑${qa.open}`,
      cls: CLS.info,
      title: `Shadow mode: QA found ${qa.open} item(s) but changed nothing. Open View to compare.`,
    }
  }
  if (qa.passed && qa.open === 0) {
    return {
      label: `QA ✓ fixed ${qa.fixed}`,
      cls: CLS.success,
      title: `QA fixed ${qa.fixed} item(s); nothing needs you.`,
    }
  }
  if (qa.highOpen > 0) {
    return {
      label: `QA: needs you ${qa.open}`,
      cls: CLS.error,
      title: `${qa.highOpen} high-priority item(s) need a human (facts or missing sections). Open View.`,
    }
  }
  return {
    label: `QA: fixed ${qa.fixed} · needs you ${qa.open}`,
    cls: CLS.warning,
    title: `QA fixed ${qa.fixed} item(s); ${qa.open} need a quick look.`,
  }
}
