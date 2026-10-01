import { parseQaReview, type QaReview } from '@/types/qa-review'

export function qaStats(raw: unknown[]) {
  const reviews = raw.map(parseQaReview).filter((r): r is QaReview => r !== null)
  const n = reviews.length
  const sum = { accuracy: 0, copy: 0, seo: 0, structure: 0 }
  const kinds = new Map<string, { agent: string; kind: string; applied: number; open: number; accepted: number; dismissed: number }>()
  for (const r of reviews) {
    for (const k of Object.keys(sum) as Array<keyof typeof sum>) sum[k] += r.scores[k]
    for (const f of r.findings) {
      const key = `${f.agent}|${f.kind}`
      const row = kinds.get(key) ?? { agent: f.agent, kind: f.kind, applied: 0, open: 0, accepted: 0, dismissed: 0 }
      row[f.status] += 1
      kinds.set(key, row)
    }
  }
  const avg = (v: number) => (n ? Math.round((v / n) * 10) / 10 : 0)
  const byKind = [...kinds.values()]
    .map(k => ({ ...k, dismissRate: k.accepted + k.dismissed ? k.dismissed / (k.accepted + k.dismissed) : 0 }))
    .sort((a, b) => b.dismissRate - a.dismissRate || (b.applied + b.open + b.accepted + b.dismissed) - (a.applied + a.open + a.accepted + a.dismissed))
  return {
    pages: n,
    avgScores: { accuracy: avg(sum.accuracy), copy: avg(sum.copy), seo: avg(sum.seo), structure: avg(sum.structure) },
    passRate: n ? reviews.filter(r => r.passed).length / n : 0,
    byKind,
  }
}
