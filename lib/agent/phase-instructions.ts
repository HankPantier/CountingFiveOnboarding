import type { Database } from '@/types/database'

type Session = Database['public']['Tables']['sessions']['Row']

export function getPhaseInstructions(phase: number, session: Session): string {
  switch (phase) {
    case 0:  return phase0Instructions()
    case 1:  return phase1Instructions()
    case 2:  return phase2Instructions()
    case 3:  return phase3Instructions(session)
    case 4:  return phase4Instructions()
    case 5:  return phase5Instructions()
    case 6:  return phase6Instructions()
    case 7:  return phase7Instructions()
    default: return ''
  }
}

function phase0Instructions(): string {
  return `PHASE 0 — NOT YET STARTED
This phase is server-side only. Do not respond to the user.`
}

function phase1Instructions(): string {
  return `PHASE 1 — CONTACT INFO
Introduce yourself briefly: you're here to collect a few details for their new CountingFive website, takes about 5–7 minutes.
Collect: first name, last name, email address.
Confirm back what you heard, then call update_session_data with their contact info and advancePhase: true.`
}

function phase2Instructions(): string {
  return `PHASE 2 — DOMAIN LOOKUP
Tell the client you're pulling some technical info on their domain and it'll just take a moment.
The WHOIS lookup runs automatically — do not ask the client for technical details and do NOT call advancePhase.`
}

function phase3Instructions(session: Session): string {
  const meta = (session.schema_data as Record<string, unknown>)?._meta as Record<string, unknown> | undefined
  const completedChunks = (meta?.phase3_completed_chunks as string[]) ?? []
  const chunk1Done = completedChunks.includes('chunk1')

  if (!chunk1Done) {
    return `PHASE 3 — MFP REVIEW, PART 1 (Practical info)
Present all of the following in one message:
- Office locations, domain/hosting info, social media channels, professional affiliations
Ask: "Does all of that look right? Any corrections?"
Then in one follow-up exchange collect: any missing affiliations or social handles, confirm the website URL, and ask if there are any professional memberships or partnerships not listed.
When part 1 is done, call update_session_data with updates: { "_meta": { "phase3_completed_chunks": ["chunk1"] } }`
  }

  return `PHASE 3 — MFP REVIEW, PART 2 (Content)
Present all of the following in one message:
- Team members (note any with missing titles), services, industry niches
Ask for corrections and any missing team titles.
Then present the 3 positioning options. Format them as a markdown list, one per line — do not put all three inline in a sentence:
- **Option A** — [summary]
- **Option B** — [summary]
- **Option C** — [summary]
Ask which direction resonates most, or if they'd like to blend elements.
When positioning is confirmed and part 2 is complete, call update_session_data with advancePhase: true and include "_meta.phase3_completed_chunks": ["chunk1", "chunk2"] in updates.`
}

function phase4Instructions(): string {
  return `PHASE 4 — GAP FILLING
Work through the gap list in tier order. Group related questions together — 2–3 per exchange — by topic:
- Firm background (founding year, firm history, origin story)
- Client questions (age ranges, how they find the firm, client needs, success stories, pricing)
- Differentiators and growth goals
- Culture (mission/values, team description)
- Brand & Tone (see below — always last before the close)

- Tier 1: Always ask
- Tier 2: Ask if the session feels under 5 minutes
- Tier 3: Skip if running long — add to "_meta.phase4_flagged_for_followup" instead
One natural follow-up per thin answer, then move on.

BRAND & TONE BLOCK — ask this as the last topic, after differentiators and culture:
Ask in one exchange: "Before we wrap up, I want to capture a sense of your brand voice. How would clients describe your firm today — and how would you like them to feel after reading your new site?"
Then follow up: "Any words or phrases that feel very 'you'? Anything you'd want to avoid? And do you have existing brand colors or a style guide we should work within?"
If they say yes to a brand guide → tell them they can upload it in the next step.
Save responses to brand.currentTone, brand.aspirationalTone, brand.toneAdjectives, brand.toneToAvoid, brand.primaryColors, brand.hasBrandGuide.

Close Phase 4 with: "Is there anything else about the firm that's important for us to know?"
When all Tier 1 gaps are resolved and that question has been asked, call update_session_data with advancePhase: true.`
}

function phase5Instructions(): string {
  return `PHASE 5 — ASSETS
Start with brand assets first, then photography:
"If you have a logo file, brand guide, or color palette document — those are the most useful things to upload here, since they directly shape your new site."
Then: "Do you also have team headshots or office photos you'd like us to use?"

Prompt for uploads via the button below. Confirm receipt of each file by name.
When done (or client says nothing to upload), call update_session_data with advancePhase: true.`
}

function phase6Instructions(): string {
  return `PHASE 6 — WRAP UP
Present a concise summary of all collected data, organized by section.
Check the schema for any required fields still empty — ask about them before summarizing.
Ask: "Does everything look right? Anything to change before I submit?"
When confirmed, call update_session_data with advancePhase: true.`
}

function phase7Instructions(): string {
  return `PHASE 7 — COMPLETE
The onboarding is complete. Thank the client warmly and let them know the CountingFive team will be in touch shortly to begin the project.
Do not collect any more information. Do not call update_session_data.`
}
