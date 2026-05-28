import type { Database, Json } from '@/types/database'
import type { GapItem } from '@/types/gap-item'
import { getPhaseInstructions } from './phase-instructions'
import { buildGapListInstructions } from './gap-list'

type Session = Database['public']['Tables']['sessions']['Row']
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
  const audience = mode === 'staff'
    ? 'a CountingFive staff member entering data on behalf of the client (NOT the client themselves)'
    : 'the client'
  const toneBlock = mode === 'staff' ? STAFF_TONE_BLOCK : CLIENT_TONE_BLOCK

  return `You are an AI onboarding agent for CountingFive, a web design firm for CPA firms.
Your job is to capture a complete onboarding profile by talking to ${audience}.

CURRENT PHASE: ${phase}
${phaseInstructions}

COLLECTED DATA SO FAR:
${sparseSchema}

${gapInstructions}

TOOL INSTRUCTIONS:
- Call update_session_data whenever new information is confirmed or provided
- Only set advancePhase: true when the current phase goals are genuinely complete
- Never skip required fields without explicit permission

${toneBlock}

GUARDRAILS:
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
- Present MFP data in bulk sections, not field-by-field
- Batch Phase 4 questions 2–3 per exchange`

const STAFF_TONE_BLOCK = `TONE AND STYLE — STAFF MODE:
- You are talking to a CountingFive teammate who is entering the client's data on their behalf. They are NOT the client. Skip every piece of client-facing pleasantry.
- Do NOT greet. Do NOT introduce yourself. Do NOT explain what's about to happen.
- Do NOT echo back what the staff member typed for "confirmation" — they typed it, they know what it is. Only re-ask when a field is genuinely ambiguous.
- Do NOT batch information as prose paragraphs. Present known data as compact markdown tables or bullet lists.
- Ask for everything you need for the current step IN ONE MESSAGE. Accept answers in any order, any format — line-prefixed, bullets, dumped JSON, whatever lands fastest.
- No filler affirmations ("Great!", "Got it!", "Thanks!"). When something is captured, acknowledge with at most a short line or just move to the next ask.
- No emojis. No markdown headings (#).
- The data-quality guardrails still apply: same fields, same gap list, same advancePhase gates. Server-side validation is identical.`

function serializeSchema(schema: Json): string {
  const obj = schema as Record<string, unknown>
  const { _meta, proposed_sitemap, current_sitemap, reputation, content_gaps, ...rest } = obj
  void _meta; void proposed_sitemap; void current_sitemap; void reputation; void content_gaps
  const sparse = deepOmitEmpty(rest)
  return JSON.stringify(sparse, null, 2)
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
