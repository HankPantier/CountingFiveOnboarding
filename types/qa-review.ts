// Pure QA Desk types + defensive parsing. NO server-only imports here — the preview
// modal and the status route both read a stored QaReview.
import { parseCritic, criticOverall, type CriticReview } from '@/lib/content/critic-review'

export type QaStatus = 'queued' | 'running' | 'done' | 'error' | 'skipped'
export type QaAgent = 'rules' | 'accuracy' | 'copy' | 'seo' | 'structure' | 'judge'
export type QaSeverity = 'high' | 'med' | 'low'
export type QaSafety = 'auto' | 'flag'
export type FindingStatus = 'applied' | 'open' | 'dismissed' | 'accepted'
export type PatchTarget = 'body' | 'meta_title' | 'meta_description'

export type FindingPatch = { target: PatchTarget; find: string; replace: string }

export type Finding = {
  id: string
  agent: QaAgent
  severity: QaSeverity
  kind: string // short slug, e.g. 'unsupported_claim', 'media_side', 'meta_length'
  quote: string // verbatim snippet the finding is about ('' when page-level)
  message: string // one-sentence human explanation
  patch?: FindingPatch
  // Structured section-variant fix (rules only) — applied with setSectionVariant.
  variantFix?: { sectionIndex: number; variant: string }
  safety: QaSafety
  status: FindingStatus
}

export type QaReview = {
  mode: 'shadow' | 'on'
  ran_at: string
  findings: Finding[]
  scores: { accuracy: number; copy: number; seo: number; structure: number }
  judge: CriticReview | null
  passed: boolean
}

export type QaSummary = {
  fixed: number
  open: number
  highOpen: number
  passed: boolean
  judgeOverall: number | null
  mode: 'shadow' | 'on'
}

const AGENTS: readonly QaAgent[] = ['rules', 'accuracy', 'copy', 'seo', 'structure', 'judge']
const SEVERITIES: readonly QaSeverity[] = ['high', 'med', 'low']
const STATUSES: readonly FindingStatus[] = ['applied', 'open', 'dismissed', 'accepted']
const TARGETS: readonly PatchTarget[] = ['body', 'meta_title', 'meta_description']

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function parseFinding(v: unknown): Finding | null {
  if (!isObj(v)) return null
  const { id, agent, severity, kind, quote, message, safety, status, patch, variantFix } = v
  if (typeof id !== 'string' || typeof kind !== 'string' || typeof message !== 'string') return null
  if (!AGENTS.includes(agent as QaAgent) || !SEVERITIES.includes(severity as QaSeverity)) return null
  if (safety !== 'auto' && safety !== 'flag') return null
  if (!STATUSES.includes(status as FindingStatus)) return null
  const f: Finding = {
    id, kind, message,
    agent: agent as QaAgent,
    severity: severity as QaSeverity,
    quote: typeof quote === 'string' ? quote : '',
    safety,
    status: status as FindingStatus,
  }
  if (isObj(patch) && TARGETS.includes(patch.target as PatchTarget) &&
      typeof patch.find === 'string' && typeof patch.replace === 'string') {
    f.patch = { target: patch.target as PatchTarget, find: patch.find, replace: patch.replace }
  }
  if (isObj(variantFix) && typeof variantFix.sectionIndex === 'number' && typeof variantFix.variant === 'string') {
    f.variantFix = { sectionIndex: variantFix.sectionIndex, variant: variantFix.variant }
  }
  return f
}

export function parseQaReview(raw: unknown): QaReview | null {
  if (!isObj(raw)) return null
  if (raw.mode !== 'shadow' && raw.mode !== 'on') return null
  if (typeof raw.ran_at !== 'string' || !Array.isArray(raw.findings) || !isObj(raw.scores)) return null
  const s = raw.scores
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
  return {
    mode: raw.mode,
    ran_at: raw.ran_at,
    findings: raw.findings.map(parseFinding).filter((f): f is Finding => f !== null),
    scores: { accuracy: num(s.accuracy), copy: num(s.copy), seo: num(s.seo), structure: num(s.structure) },
    judge: raw.judge && parseCritic(raw.judge) ? (raw.judge as CriticReview) : null,
    passed: raw.passed === true,
  }
}

export function summarizeQa(raw: unknown): QaSummary | null {
  const r = parseQaReview(raw)
  if (!r) return null
  const open = r.findings.filter(f => f.status === 'open')
  const judge = r.judge ? parseCritic(r.judge) : null
  return {
    fixed: r.findings.filter(f => f.status === 'applied').length,
    open: open.length,
    highOpen: open.filter(f => f.severity === 'high').length,
    passed: r.passed,
    judgeOverall: judge ? criticOverall(judge) : null,
    mode: r.mode,
  }
}
