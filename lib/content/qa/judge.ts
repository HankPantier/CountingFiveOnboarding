import { randomUUID } from 'node:crypto'
import { criticFailsThreshold, type CriticReview } from '@/lib/content/critic-review'
import type { Finding, QaReview } from '@/types/qa-review'

export function judgeFindings(review: CriticReview | null): Finding[] {
  if (!review) return []
  const flag = (kind: string, quote: string, message: string): Finding => ({
    id: randomUUID(), agent: 'judge', severity: 'high', kind, quote, message, safety: 'flag', status: 'open',
  })
  return [
    ...review.unsupported_claims.map(q => flag('unsupported_claim', q, 'The senior editor could not find this in the firm profile — verify or remove it.')),
    ...(review.missing_sections ?? []).map(s => flag('missing_section', s, `The approved outline section "${s}" is missing or thin.`)),
  ]
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

export function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>()
  return findings.filter(f => {
    if (!f.quote) return true
    const key = `${f.kind}|${norm(f.quote)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function qaPasses(review: CriticReview | null, findings: Finding[]): boolean {
  if (review && criticFailsThreshold(review)) return false
  return !findings.some(f => f.status === 'open' && f.severity === 'high' && (f.agent === 'copy' || f.agent === 'seo'))
}

type ScoreKey = keyof QaReview['scores']

function bucket(f: Finding): ScoreKey {
  if (f.agent === 'accuracy') return 'accuracy'
  if (f.agent === 'copy') return 'copy'
  if (f.agent === 'seo') return 'seo'
  if (f.agent === 'structure') return 'structure'
  if (f.agent === 'judge') return f.kind === 'missing_section' ? 'structure' : 'accuracy'
  // rules
  if (f.kind === 'media_side') return 'structure'
  if (f.kind.startsWith('meta_') || f.kind.startsWith('heading_')) return 'seo'
  return 'copy'
}

const PENALTY = { high: 3, med: 1, low: 0.25 } as const

export function agentScores(findings: Finding[]): QaReview['scores'] {
  const s: QaReview['scores'] = { accuracy: 10, copy: 10, seo: 10, structure: 10 }
  for (const f of findings) {
    if (f.status !== 'open') continue
    s[bucket(f)] -= PENALTY[f.severity]
  }
  for (const k of Object.keys(s) as ScoreKey[]) s[k] = Math.max(0, Math.round(s[k] * 10) / 10)
  return s
}
