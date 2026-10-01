import { randomUUID } from 'node:crypto'
import type { Finding, QaSeverity, PatchTarget } from '@/types/qa-review'
import type { TokenStage } from '@/lib/content/token-pricing'
import type { SessionSchema } from '@/types/session-schema'
import type { Json } from '@/types/database'

export type SpecialistInput = {
  pageUrl: string
  pageTitle: string
  body: string
  metaTitle: string | null
  metaDescription: string | null
  targetKeyword: string | null
  outlineSections: Json
  sitemapUrls: string[]
  verbatim: boolean
  ruleHits: Finding[]
  schema: SessionSchema
  sessionId: string
  contentJobId: string
}

export type SpecialistDef = {
  agent: 'accuracy' | 'copy' | 'seo' | 'structure'
  stage: TokenStage
  skipWhenVerbatim: boolean
  instructions: string // job-constant: role, checklist, safety rules, output contract
  allowedAuto: string[]
}

export const MAX_FINDINGS_PER_SPECIALIST = 15

export const OUTPUT_CONTRACT = `Return ONLY JSON:
{ "findings": [ { "severity": "high|med|low", "kind": "<slug from your list>", "quote": "<verbatim text from the page, under 200 chars>", "message": "<one sentence for the editor>", "patch": { "target": "body|meta_title|meta_description", "find": "<exact text copied from the page — unique, 8+ chars, at most one paragraph>", "replace": "<the corrected text>" } or null, "safety": "auto|flag" } ] }
Rules for patches: "find" must be copied character-for-character from the page and occur exactly once. Never include a "<!-- block: … -->" line in find or replace. Keep each patch to one sentence or one paragraph. Return at most ${MAX_FINDINGS_PER_SPECIALIST} findings, most important first. Return {"findings": []} when the page is clean.`

const SEVS: readonly QaSeverity[] = ['high', 'med', 'low']
const TARGETS: readonly PatchTarget[] = ['body', 'meta_title', 'meta_description']

export function parseSpecialistFindings(raw: unknown, def: SpecialistDef): Finding[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { findings?: unknown }).findings)) return []
  const out: Finding[] = []
  for (const item of (raw as { findings: unknown[] }).findings) {
    if (out.length >= MAX_FINDINGS_PER_SPECIALIST) break
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (typeof r.kind !== 'string' || typeof r.message !== 'string') continue
    const severity = SEVS.includes(r.severity as QaSeverity) ? (r.severity as QaSeverity) : 'med'
    const p = r.patch as Record<string, unknown> | null | undefined
    const patch =
      p && typeof p === 'object' && TARGETS.includes(p.target as PatchTarget) &&
      typeof p.find === 'string' && typeof p.replace === 'string'
        ? { target: p.target as PatchTarget, find: p.find, replace: p.replace }
        : undefined
    const wantsAuto = r.safety === 'auto' && !!patch && def.allowedAuto.includes(r.kind)
    out.push({
      id: randomUUID(),
      agent: def.agent,
      severity,
      kind: r.kind,
      quote: typeof r.quote === 'string' ? r.quote.slice(0, 300) : '',
      message: r.message.slice(0, 500),
      ...(patch ? { patch } : {}),
      safety: wantsAuto ? 'auto' : 'flag',
      status: 'open',
    })
  }
  return out
}
