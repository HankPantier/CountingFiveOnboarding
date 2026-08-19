import type { Database, Json } from '@/types/database'
import type { GapItem } from '@/types/gap-item'
import type { SessionSchema } from '@/types/session-schema'

type AuditContext = NonNullable<NonNullable<SessionSchema['_meta']>['audit_context']>
import { getPhaseInstructions } from './phase-instructions'
import { buildGapListInstructions } from './gap-list'

// Only the columns the prompt builder reads — lets callers fetch a narrow
// select instead of the full row (mbp_content is large and must never be here).
type Session = Pick<
  Database['public']['Tables']['sessions']['Row'],
  'schema_data' | 'gap_list' | 'current_phase'
>
export type AgentMode = 'client' | 'staff'

export function getMode(session: Session): AgentMode {
  const meta = (session.schema_data as { _meta?: { mode?: string } } | null)?._meta
  return meta?.mode === 'staff' ? 'staff' : 'client'
}

export function buildSystemPrompt(session: Session): string {
  const schema = session.schema_data ?? {}
  const gaps = (session.gap_list as GapItem[]) ?? []
  const phase = session.current_phase
  const mode = getMode(session)

  const sparseSchema = serializeSchema(schema)
  const phaseInstructions = getPhaseInstructions(phase, session, mode)
  const gapInstructions = phase >= 4 ? buildGapListInstructions(gaps) : ''
  // Audit intelligence (narrative/tech/competitive) is reference context for the
  // confirmation phases — surface it from phase 3 onward so the agent confirms
  // it rather than asking blind. Kept out of phases 1–2 to protect token budget.
  const auditContextBlock = phase >= 3 ? buildAuditContextBlock(schema) : ''
  const audience = mode === 'staff'
    ? 'a Revaltus staff member entering data on behalf of the client (NOT the client themselves)'
    : 'the client'
  const toneBlock = mode === 'staff' ? STAFF_TONE_BLOCK : CLIENT_TONE_BLOCK

  return `You are an AI onboarding agent for Revaltus, a web design firm for CPA firms.
Your job is to capture a complete onboarding profile by talking to ${audience}.

CURRENT PHASE: ${phase}
${phaseInstructions}

COLLECTED DATA SO FAR:
${sparseSchema}
${auditContextBlock}
${gapInstructions}

TOOL INSTRUCTIONS:
- Call update_session_data whenever new information is confirmed or provided
- Only set advancePhase: true when the current phase goals are genuinely complete
- Never skip required fields without explicit permission
- The tool result reports phaseAdvanced (true/false). If it returns a "blocked" reason, the phase did NOT advance — that reason is an INTERNAL diagnostic for you only. Never repeat, quote, or paraphrase it to the user. Silently do what it says (collect the named field, or re-present the current step's questions in plain language), then retry. Do not claim you've moved on.

PHASE TRANSITIONS:
- Never wait for the client to confirm they're ready to continue. Do not say "let me know when you're ready" or "we'll move into the next section." Advance and flow straight into the next topic in the same message.
- Don't narrate the mechanics ("moving to the next phase"). Just acknowledge what you captured in a few words and continue.

${toneBlock}

GUARDRAILS:
- NEVER expose internal mechanics to the user. Do not mention phase numbers, step or "chunk" names (e.g. chunk1 / chunk2a / chunk2b), "gates", "markers", tool names (update_session_data), an "analyst doc", or any validation/blocked message. The user only ever sees natural questions and confirmations.
- If something is not advancing on your end, do NOT tell the user, apologize for an internal error, or ask them for internal artifacts (there is no document or file the user needs to "pull up" that they weren't already given). Just re-present the current step's actual questions in plain language and keep going.
- Never ask for or accept a registrar/hosting password — direct to a secure channel
- One follow-up probe per thin answer max — then record and move on`.trim()
}

const CLIENT_TONE_BLOCK = `TONE AND STYLE:
- Write like a friendly, competent colleague — warm but efficient
- Keep responses short. 2–4 sentences per turn is ideal
- No emojis. No exclamation points unless the client used one first
- No markdown headings (#). Use plain sentences, bold for emphasis only
- When presenting multiple options for the client to choose from, put each on its own line as a markdown list item (dash, bold label, em dash, description) — never inline all options in one sentence
- Bold every question or request for information so clients can scan quickly for what's being asked
- Never say "Great!", "Awesome!", "Absolutely!", or similar filler affirmations

EXTRA GUARDRAILS:
- Present MBP data in bulk sections, not field-by-field
- Batch Phase 4 questions 2–3 per exchange`

const STAFF_TONE_BLOCK = `TONE AND STYLE — STAFF MODE:
- You are talking to a Revaltus rep on a live onboarding call, entering the client's data on their behalf. They are NOT the client. Skip every piece of client-facing pleasantry.
- The profile below was pre-filled from the rep's call notes and the site audit. Confirm and extend it — do NOT re-ask anything already populated. Focus your questions on the remaining gaps.
- There is no tight time limit: good information matters more than speed. Still, aim to wrap the whole conversation within about 15 minutes — keep asks tight and don't belabor a point.
- Do NOT greet. Do NOT introduce yourself. Do NOT explain what's about to happen.
- Do NOT echo back what the staff member typed for "confirmation" — they typed it, they know what it is. Only re-ask when a field is genuinely ambiguous.
- Do NOT batch information as prose paragraphs. Present known data as compact markdown tables or bullet lists.
- Ask for everything you need for the current step IN ONE MESSAGE. Accept answers in any order, any format — line-prefixed, bullets, dumped JSON, whatever lands fastest.
- No filler affirmations ("Great!", "Got it!", "Thanks!"). When something is captured, acknowledge with at most a short line or just move to the next ask.
- No emojis. No markdown headings (#).
- The data-quality guardrails still apply: same fields, same gap list, same advancePhase gates. Server-side validation is identical.`

// Renders the audit-derived reference context (no typed schema home) into a
// compact, length-bounded block. Used phase 3+ so the agent confirms what the
// audit found instead of asking blind. Returns '' when nothing was seeded.
function buildAuditContextBlock(schema: Json): string {
  const ctx = (schema as { _meta?: { audit_context?: AuditContext } } | null)?._meta?.audit_context
  if (!ctx) return ''

  const cap = (s: string | undefined, n: number): string | undefined =>
    s && s.length > n ? `${s.slice(0, n).trimEnd()}…` : s || undefined

  const lines: string[] = []
  if (ctx.narrative?.executiveSummary) lines.push(`- Audit summary: ${cap(ctx.narrative.executiveSummary, 500)}`)
  if (ctx.narrative?.recommendations?.length) {
    lines.push(`- Audit recommendations: ${ctx.narrative.recommendations.slice(0, 5).join('; ')}`)
  }
  if (ctx.techStack) {
    const t = ctx.techStack
    const parts = [t.cms && `CMS ${t.cms}`, t.pageBuilder && `builder ${t.pageBuilder}`, t.hosting && `host ${t.hosting}`]
      .filter(Boolean)
    if (parts.length) lines.push(`- Tech stack: ${parts.join(', ')}`)
  }
  if (ctx.domain?.registered || ctx.domain?.ageYears != null) {
    lines.push(`- Domain: registered ${ctx.domain.registered ?? '?'}${ctx.domain.ageYears != null ? ` (~${ctx.domain.ageYears}y old)` : ''}`)
  }
  if (ctx.contentLibrary?.totalPieces) lines.push(`- Content library: ~${ctx.contentLibrary.totalPieces} pieces`)
  if (ctx.competitive?.keywordRankings?.length) {
    const kw = ctx.competitive.keywordRankings.slice(0, 6)
      .map((k) => `${k.keyword}${k.rank != null ? ` (#${k.rank})` : ' (unranked)'}`)
    lines.push(`- Keyword positions: ${kw.join(', ')}`)
  }
  if (lines.length === 0) return ''

  return `\nAUDIT FINDINGS (reference — confirm/use as relevant, don't re-derive):\n${lines.join('\n')}\n`
}

// Complete serialization for MBP editing/review contexts (NOT the onboarding
// chat): strips only internal `_meta` and omits empties, but keeps every
// content-gen field, sitemaps, reputation, and content_gaps. The opposite of
// serializeSchema, which trims aggressively to fit the per-phase token budget.
export function serializeSchemaFull(schema: Json): string {
  const obj = schema as Record<string, unknown>
  const { _meta, ...rest } = obj
  void _meta
  const sparse = deepOmitEmpty(rest)
  return JSON.stringify(sparse, null, 2)
}

function serializeSchema(schema: Json): string {
  const obj = schema as Record<string, unknown>
  const { _meta, proposed_sitemap, current_sitemap, reputation, content_gaps, ...rest } = obj
  void _meta; void proposed_sitemap; void current_sitemap; void reputation; void content_gaps

  // Trim heavy content-gen-only fields out of the chat context. The agent
  // doesn't need them while talking to the client; content generation reads
  // them directly from schema_data later. This keeps the system prompt under
  // the per-phase token budgets in CLAUDE.md.
  const trimmed = trimContentGenFields(rest)
  const sparse = deepOmitEmpty(trimmed)
  // deepOmitEmpty returns undefined for an all-empty object; stringifying that
  // yields the literal "undefined" in the prompt. Use a readable placeholder.
  return sparse === undefined ? '(nothing captured yet)' : JSON.stringify(sparse, null, 2)
}

function trimContentGenFields(rest: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...rest }

  const business = out.business as Record<string, unknown> | undefined
  if (business) {
    // firmHistory is kept in chat context so Phase 4 can confirm the seeded
    // history paragraph; the rest are content-gen-only and trimmed.
    const {
      competitors,
      competitiveContext,
      currentPositioning,
      ...keepBusiness
    } = business
    void competitors; void competitiveContext; void currentPositioning
    out.business = keepBusiness
  }

  const niches = out.niches as Array<Record<string, unknown>> | undefined
  if (Array.isArray(niches)) {
    out.niches = niches.map(n => {
      const { subCategories, painPoints, valueProp, customerTrigger, ...keep } = n
      void subCategories; void painPoints; void valueProp; void customerTrigger
      return keep
    })
  }

  const services = out.services as Array<Record<string, unknown>> | undefined
  if (Array.isArray(services)) {
    out.services = services.map(s => {
      const { rewriteDirection, description, ...keep } = s
      void rewriteDirection; void description
      return keep
    })
  }

  // Team bios + expertise + press are content-gen payload; the agent only
  // needs names, titles, and credentials to verify the team in chat.
  const team = out.team as Array<Record<string, unknown>> | undefined
  if (Array.isArray(team)) {
    out.team = team.map(t => {
      const {
        bio, expertise, associations, press,
        previousEmployers, education, externalFootprint, specializations,
        ...keep
      } = t
      void bio; void expertise; void associations; void press
      void previousEmployers; void education; void externalFootprint; void specializations
      return keep
    })
  }

  return out
}

function deepOmitEmpty(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    const filtered = obj.map(deepOmitEmpty).filter(v => v !== null && v !== undefined && v !== '')
    return filtered.length > 0 ? filtered : undefined
  }
  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const cleaned = deepOmitEmpty(v)
      if (cleaned !== undefined && cleaned !== null && cleaned !== '') result[k] = cleaned
    }
    return Object.keys(result).length > 0 ? result : undefined
  }
  return obj === '' || obj === null ? undefined : obj
}
