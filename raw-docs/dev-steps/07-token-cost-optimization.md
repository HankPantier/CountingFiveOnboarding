# Step 07 — Token & Cost Optimization

**Depends on:** Step 06 (chat interface must exist first)
**Unlocks:** More reliable and cost-efficient Step 08 agent behavior
**Estimated time:** Day 7–8 (implement alongside or immediately after Step 06)

---

## What This Step Accomplishes

These optimizations are not optional polish — they prevent runaway API costs and keep Claude's context focused. A session without optimization can balloon to 8,000–12,000 input tokens per exchange. The goal is to stay well under 4,000 for a typical exchange. Build all of these before going live.

---

## Optimization 1 — Phase-Scoped System Prompt

**Problem:** Including all phase instructions in every system prompt sends 2,000+ tokens of instructions the agent doesn't need right now.

**Fix:** `lib/agent/phase-instructions.ts` returns only the instructions for the current phase.

```typescript
// lib/agent/phase-instructions.ts

export function getPhaseInstructions(phase: number, session: any): string {
  switch (phase) {
    case 0: return phase0Instructions()
    case 1: return phase1Instructions()
    case 2: return phase2Instructions()
    case 3: return phase3Instructions(session)
    case 4: return phase4Instructions(session)
    case 5: return phase5Instructions()
    case 6: return phase6Instructions()
    default: return ''
  }
}

function phase1Instructions(): string {
  return `PHASE 1 — WELCOME & IDENTIFY
Your goal: Collect the client's contact info and confirm their website URL.
Ask for: first name, last name, email, phone. Then confirm the URL from what we have on file.
Keep it warm and brief. Tell them this will go quickly — most of it is just confirming, not starting from scratch.
When all contact fields are collected and URL confirmed, call update_session_data with advancePhase: true.`
}

function phase2Instructions(): string {
  return `PHASE 2 — TECHNICAL LOOKUP
Tell the user: "Give me just a moment to pull some technical info on your domain..."
The WHOIS lookup will run automatically. Wait for it to complete, then proceed.
Do NOT ask the user for technical information yet — that happens in Phase 3.`
}

function phase3Instructions(session: any): string {
  const meta = session.schema_data?._meta ?? {}
  const completedChunks: string[] = meta.phase3_completed_chunks ?? []
  const chunk1Done = completedChunks.includes('chunk1')

  if (!chunk1Done) {
    return `PHASE 3 — MFP REVIEW, CHUNK 1 (Practical Info)
Present ALL of the following in ONE formatted message:
- Office locations (all), domain/hosting info, social media channels, professional affiliations
After presenting, ask: "Does all of that look right? Any corrections?"
Then bundle into ONE follow-up exchange: registrar username/PIN, admin contact, redirect domains, missing affiliations, social handles.
When chunk 1 is complete, call update_session_data and include "_meta.phase3_completed_chunks": ["chunk1"] in updates.`
  }

  return `PHASE 3 — MFP REVIEW, CHUNK 2 (Content)
Present ALL of the following in ONE formatted message:
- Team members (with titles or ❓ for missing), services, industry niches
After presenting, ask for corrections. Then ask for missing team titles.
Then present all 3 positioning options (A, B, C) and ask the client to choose.
When positioning is selected and chunk 2 is complete, call update_session_data with advancePhase: true.`
}

function phase4Instructions(session: any): string {
  return `PHASE 4 — GAP FILLING
Work through the gap list in tier order. Batch 2–3 related questions per exchange.
Follow the tier rules strictly:
- Tier 1: Always ask, regardless of time
- Tier 2: Ask only if the session feels under 5 minutes
- Tier 3: Skip if running long — flag with "_meta.phase4_flagged_for_followup" instead
One natural follow-up probe per thin answer. After that, record and move on.
Always close Phase 4 with: "Is there anything else about the firm that's important for us to know?"
When all Tier 1 gaps are resolved and the "anything else" question has been asked, call update_session_data with advancePhase: true.`
}

function phase5Instructions(): string {
  return `PHASE 5 — ASSETS
Ask about: which team members have headshots, whether office photos exist, testimonials.
Then prompt for file uploads: logos, photos.
Accept uploads via the file upload button. Confirm receipt of each file.
When asset questions are complete and uploads done (or client says they have nothing to upload), call update_session_data with advancePhase: true.`
}

function phase6Instructions(): string {
  return `PHASE 6 — FINAL SUMMARY & CONFIRMATION
Present a complete summary of all collected data organized by section.
Before presenting, check the schema for any required fields still empty. If found, ask about them first.
After presenting, ask: "Does everything look right? Anything you'd like to change before I submit?"
When the client confirms everything is correct, call update_session_data with advancePhase: true and set status to "completed".`
}

function phase0Instructions(): string {
  return `PHASE 0 — SESSION NOT YET STARTED
This phase runs server-side before the first message. Do not respond to the user — the system will advance to Phase 1 automatically.`
}
```

**Target savings:** ~800–1,200 tokens per exchange.

---

## Optimization 2 — Sparse Schema Serialization

**Problem:** The full schema has ~50 fields. Sending empty fields wastes tokens and adds noise.

**Fix:** Strip `_meta` and all null/empty-string/empty-array values before injecting into the prompt (already implemented in `buildSystemPrompt` from Step 06).

Key function in `lib/agent/system-prompt.ts`:
```typescript
function deepOmitEmpty(obj: any): any {
  // Already implemented in Step 06 — verify it's stripping empty arrays and strings
  // Test: early in a session, the serialized schema should be < 200 characters
}
```

**Target savings:** 300–600 tokens per exchange (biggest gain early in the session).

---

## Optimization 3 — Gap List Instead of Full Schema Diff

**Problem:** Having Claude infer what's missing by reasoning over the full schema is unreliable.

**Fix:** Pass the explicit gap list with tier labels (already implemented in `buildGapListInstructions` from Step 06). Only inject it when `phase >= 4`.

Verify the system prompt builder only adds gap instructions in Phase 4:
```typescript
const gapInstructions = phase >= 4 ? buildGapListInstructions(gaps) : ''
```

**Target savings:** Eliminates schema reasoning overhead in Phase 4.

---

## Optimization 4 — Message History Trimming

**Problem:** A 30-exchange session sends thousands of tokens of redundant context.

**Fix:** Already implemented in `trimMessages` from Step 06. Verify the trim is happening in the chat route before the `streamText` call:
```typescript
const trimmedMessages = trimMessages(messages)
// This should go to streamText, not the raw messages array
```

**Target savings:** 500–2,000 tokens per exchange in Phase 4+.

---

## Optimization 5 — MFP Content Never Goes to Claude

**Problem:** The MFP is ~3,000 words. Sending it to Claude on every request is expensive.

**Fix:** Parse once at session creation (Step 04), write to `schema_data`. The MFP raw text goes into `sessions.mfp_content` for admin reference only and never appears in the system prompt.

Verify this in `buildSystemPrompt` — it should use `session.schema_data`, not `session.mfp_content`.

**Target savings:** ~800–1,500 tokens per exchange. This is the single biggest source of unnecessary spend if not handled correctly.

---

## Optimization 6 — Lean Tool Definition

**Problem:** Verbose tool parameter descriptions add up across 15–20 exchanges.

**Fix:** Keep the `update_session_data` tool description concise (already in Step 06). Review the Zod schema descriptions — use `.describe()` only for non-obvious fields.

```typescript
// Good — concise
parameters: z.object({
  updates: z.record(z.string(), z.unknown()).describe('Field path → value pairs'),
  resolvedGaps: z.array(z.string()).optional().describe('Gap field paths now resolved'),
  advancePhase: z.boolean().optional(),
})

// Bad — verbose
parameters: z.object({
  updates: z.record(z.string(), z.unknown()).describe(
    'A record containing the field paths as keys and the new values as values. Field paths use dot notation. These will be deeply merged into the existing schema_data object in the database...'
  ),
})
```

**Target savings:** ~100–200 tokens per request.

---

## Optimization 7 — Model Selection by Phase

**Problem:** All phases using Sonnet is expensive; simple phases don't need it.

**Fix:** Already implemented in Step 06. Verify the model selection logic:

```typescript
const model = [3, 4].includes(session.current_phase)
  ? anthropic('claude-sonnet-4-6')      // Sonnet for nuanced MFP review & gap filling
  : anthropic('claude-haiku-4-5-20251001')  // Haiku for simple collection phases
```

| Phase | Model | Reason |
|---|---|---|
| 0–2 | Haiku | Simple structured collection |
| 3–4 | Sonnet | Nuanced MFP review, adaptive gap filling |
| 5–6 | Haiku | Simple checklist and read-back |

---

## Token Budget Targets

| Phase | Target input tokens | Model |
|---|---|---|
| Phase 1 | < 1,000 | Haiku |
| Phase 3 | < 3,500 | Sonnet |
| Phase 4 (early) | < 3,000 | Sonnet |
| Phase 4 (late) | < 2,500 | Sonnet (history trimmed) |
| Phase 5–6 | < 1,500 | Haiku |

---

## Test Process

### T1 — Log token usage for every exchange
Verify the `onFinish` callback in the chat route is logging token counts:
```typescript
onFinish: async ({ text, usage }) => {
  console.log(`[tokens] session=${sessionId} prompt=${usage.promptTokens} completion=${usage.completionTokens}`)
  // ...
}
```
Run a full test session and check Vercel Function logs. No Phase 1 exchange should exceed 1,000 prompt tokens. No exchange should exceed 5,000.

### T2 — Sparse schema is genuinely sparse early in a session
Add a log in `serializeSchema`:
```typescript
console.log(`[schema-size] chars=${JSON.stringify(sparse).length}`)
```
At Phase 1 start, the schema should serialize to under 200 characters.
At Phase 6, it should serialize to under 2,000 characters.

### T3 — MFP content never appears in the system prompt
```typescript
console.log(`[system-prompt-length] chars=${systemPrompt.length}`)
```
The system prompt should never approach the length of the raw MFP (~10,000+ characters).

### T4 — Haiku is used for Phase 1 and Phase 6
Add a log before the `streamText` call:
```typescript
console.log(`[model] phase=${session.current_phase} model=${[3,4].includes(session.current_phase) ? 'sonnet' : 'haiku'}`)
```
Verify Phase 1 and Phase 6 both use Haiku.

### T5 — Message trimming kicks in after 20 messages
Add a log:
```typescript
console.log(`[messages] raw=${messages.length} trimmed=${trimmedMessages.length}`)
```
For sessions with fewer than 20 messages, raw === trimmed. After 20, trimmed should stay at 20.

### T6 — Phase instructions are phase-specific
Compare the system prompts for Phase 1 and Phase 4. Phase 1 should not include gap list instructions. Phase 4 should not include Phase 1 welcome instructions.

---

## Common Failure Points

- **Building optimizations in after launch** — these are much harder to retrofit. Build all 7 from the start.
- **Sparse serialization stripping too aggressively** — `false` (boolean) should not be stripped even though it's falsy. Be careful with `deepOmitEmpty` — only strip `null`, `undefined`, `''`, and `[]`.
- **Model not selected correctly for edge phases** — Phase 2 has no Claude call (WHOIS only). Phase 0 is server-side only. Verify the `current_phase` check handles these correctly without sending an unnecessary model call.
