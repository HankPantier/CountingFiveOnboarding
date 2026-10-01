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
): Chip | null {
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

export type Chip = { label: string; cls: string; title: string }

export type CriticChipInput = {
  overall: number
  hasFlags: boolean
  needsReview?: boolean
  regenerated?: boolean
}

// Quality-critic chip. Green ≥8, amber 6-7, red <6; a flag marker when the critic
// surfaced unsupported specifics to verify. When `needsReview` is set the page
// stayed weak after the critic's one auto-rewrite, so it's forced red and labelled
// "Review" to pull the operator's eye. Advisory only — never gates approval.
export function criticChip(critic: CriticChipInput | null | undefined): Chip | null {
  if (!critic) return null
  const cls = critic.needsReview
    ? CLS.error
    : critic.overall >= 8
      ? CLS.success
      : critic.overall >= 6
        ? CLS.warning
        : CLS.error
  const regenNote = critic.regenerated ? ' Auto-rewritten once by the critic.' : ''
  return {
    label: `${critic.needsReview ? 'Review ' : 'Q '}${critic.overall}/10${critic.hasFlags ? ' ⚑' : ''}`,
    cls,
    title: critic.needsReview
      ? `This page still looks weak (${critic.overall}/10${critic.hasFlags ? ', with unsupported claim(s)' : ''}).${regenNote} Open View and proof it closely before approving. Advisory — does not gate approval.`
      : `Advisory quality review: ${critic.overall}/10 overall.${critic.hasFlags ? ' Flagged unsupported claim(s) to verify — open View for detail.' : ''}${regenNote} This is advisory and does not gate approval.`,
  }
}

// Which chip(s) a page row shows. Only an 'on'-mode QA verdict replaces the
// legacy critic chip; in shadow the critic chip (incl. the red needs-review
// chip) stays primary and the QA chip rides along as a secondary badge. The
// review's own mode wins; with no stored review (queued/running/error) the
// server-reported live mode is used, defaulting to shadow.
export function pickPageChips(
  qa: QaSummary | null,
  qaStatus: string | null,
  critic: CriticChipInput | null | undefined,
  liveMode?: 'off' | 'shadow' | 'on' | null,
): { primary: Chip | null; secondary: Chip | null } {
  const mode = qa?.mode ?? liveMode ?? 'shadow'
  const q = qaChip(qa, qaStatus)
  const c = criticChip(critic)
  if (mode === 'on') return { primary: q ?? c, secondary: null }
  return { primary: c, secondary: q }
}

// Needs-review banner body. The QA wording only applies when at least one page
// in the list was flagged by an 'on'-mode QA review; otherwise the list comes
// from the legacy critic and keeps its original copy.
export function needsReviewBannerCopy(count: number, anyOnModeQa: boolean): string {
  if (anyOnModeQa) {
    return `Automated QA flagged ${count} page(s) with facts or sections that need a human. Proof these before approving — the rest are clean.`
  }
  const many = count !== 1
  return `The quality critic auto-rewrote ${many ? 'these' : 'this'} once and still flagged ${many ? 'them' : 'it'}. Proof ${many ? 'these' : 'this'} before approving — the rest scored clean.`
}
