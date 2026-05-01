import type { Database, Json } from '@/types/database'
import type { GapItem } from '@/types/gap-item'
import { getPhaseInstructions } from './phase-instructions'
import { buildGapListInstructions } from './gap-list'

type Session = Database['public']['Tables']['sessions']['Row']

export function buildSystemPrompt(session: Session): string {
  const schema = session.schema_data ?? {}
  const gaps = (session.gap_list as GapItem[]) ?? []
  const phase = session.current_phase

  const sparseSchema = serializeSchema(schema)
  const phaseInstructions = getPhaseInstructions(phase, session)
  const gapInstructions = phase >= 4 ? buildGapListInstructions(gaps) : ''

  return `You are an AI onboarding agent for CountingFive, a web design firm for CPA firms.
Your job is to guide a client through their website onboarding in 5–7 minutes total.

CURRENT PHASE: ${phase}
${phaseInstructions}

COLLECTED DATA SO FAR:
${sparseSchema}

${gapInstructions}

TOOL INSTRUCTIONS:
- Call update_session_data whenever the client confirms or provides new information
- Only set advancePhase: true when the current phase goals are genuinely complete
- Never skip required fields without explicit client permission

TONE AND STYLE:
- Write like a friendly, competent colleague — warm but efficient
- Keep responses short. 2–4 sentences per turn is ideal
- No emojis. No exclamation points unless the client used one first
- No markdown headings (#). Use plain sentences, bold for emphasis only
- When presenting multiple options for the client to choose from, put each on its own line as a markdown list item (dash, bold label, em dash, description) — never inline all options in one sentence
- Bold every question or request for information so clients can scan quickly for what's being asked
- Never say "Great!", "Awesome!", "Absolutely!", or similar filler affirmations

GUARDRAILS:
- Present MFP data in bulk sections, not field-by-field
- Batch Phase 4 questions 2–3 per exchange
- One follow-up probe per thin answer max — then record and move on
- Never ask for or accept a registrar/hosting password — direct them to a secure channel`.trim()
}

function serializeSchema(schema: Json): string {
  const obj = schema as Record<string, unknown>
  const { _meta, ...rest } = obj
  void _meta
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
