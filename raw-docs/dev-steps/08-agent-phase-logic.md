# Step 08 — Agent Phase Logic & WHOIS

**Depends on:** Steps 06, 07
**Unlocks:** Step 09 (file uploads need phase detection)
**Estimated time:** Day 8–11

---

## What This Step Accomplishes

The agent correctly progresses through all 8 phases (0–7), presents MFP data for confirmation, fills gaps in priority-tier order, applies the time budget guardrails, and handles WHOIS lookup automatically at Phase 2. The full 5–7 minute session target is achievable after this step.

---

## Implementation Tasks

### 1. Build the WHOIS API route

Phase 2 is not an interactive Claude conversation — it's a server-side lookup triggered automatically when the session advances from Phase 1 → 2.

`app/api/whois/route.ts`:
```typescript
import whoiser from 'whoiser'
import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { sessionId, domain } = await req.json()
  const supabase = createServerClient()

  let technicalData: Record<string, any> = {}

  try {
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0]
    const result = await whoiser(cleanDomain, { timeout: 8000 })

    // Extract from first WHOIS result
    const firstResult = Object.values(result)[0] as any
    technicalData = {
      registrar: firstResult?.Registrar ?? '',
      registrationDate: firstResult?.['Created Date'] ?? firstResult?.['Creation Date'] ?? '',
      expiryDate: firstResult?.['Expiry Date'] ?? firstResult?.['Registry Expiry Date'] ?? '',
      nameservers: firstResult?.['Name Server'] ?? [],
    }
  } catch (err) {
    // WHOIS failure is non-fatal — log it, advance with empty technical fields
    console.warn('[WHOIS] Lookup failed for domain:', domain, err)
  }

  // Merge technical data into schema_data and advance to Phase 3
  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', sessionId)
    .single()

  const updatedSchema = {
    ...(session?.schema_data ?? {}),
    technical: {
      ...(session?.schema_data?.technical ?? {}),
      ...technicalData,
    },
  }

  await supabase.from('sessions').update({
    schema_data: updatedSchema,
    current_phase: 3,
  }).eq('id', sessionId)

  return NextResponse.json({ success: true, technicalData })
}
```

### 2. Trigger WHOIS automatically on Phase 1 → 2 advance

In `updateSessionSchema` (from Step 06), detect when the phase advances to 2 and call the WHOIS route:

```typescript
async function updateSessionSchema(supabase, sessionId, session, updates, resolvedGaps, advancePhase) {
  // ... (existing merge logic)

  const newPhase = advancePhase ? Math.min(session.current_phase + 1, 7) : session.current_phase

  await supabase.from('sessions').update({
    schema_data: mergedSchema,
    gap_list: updatedGaps,
    current_phase: newPhase,
  }).eq('id', sessionId)

  // Trigger WHOIS automatically when advancing to Phase 2
  if (newPhase === 2) {
    const domain = mergedSchema.websiteUrl ?? session.schema_data?.websiteUrl
    if (domain) {
      // Fire and forget — WHOIS advances to Phase 3 when done
      fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/whois`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, domain }),
      }).catch(err => console.error('[WHOIS trigger]', err))
    }
  }
}
```

### 3. Sub-phase tracking for Phase 3

Phase 3 has 2 chunks. Track progress using `_meta` inside `schema_data`:

The `_meta` key is initialized at session creation (or populated when Phase 3 begins):
```typescript
// Initial _meta structure (add to parseMFP output or session creation)
const initialMeta = {
  phase3_completed_chunks: [],
  phase4_resolved_tiers: { tier1_done: false, tier2_done: false },
  phase4_flagged_for_followup: [],
  admin_overrides: {},
}
```

When the agent completes Chunk 1, it calls `update_session_data` with:
```json
{
  "updates": {
    "_meta": {
      "phase3_completed_chunks": ["chunk1"]
    }
  }
}
```

The Phase 3 instructions in `phase-instructions.ts` (Step 07) check this flag to determine whether to show Chunk 1 or Chunk 2 content.

> **Important:** `_meta` must always be stripped from the schema before it's passed to Claude. Verify `serializeSchema` in `system-prompt.ts` removes the `_meta` key — it should already do this per Step 06.

### 4. Sub-phase tracking for Phase 4

Track which tiers are complete:
```typescript
// When all Tier 1 gaps are resolved:
updates["_meta.phase4_resolved_tiers.tier1_done"] = true

// When skipping a Tier 3 item due to time:
updates["_meta.phase4_flagged_for_followup"] = [...existing, gapField]
```

Build a helper that checks if Phase 4 can advance:
```typescript
function canAdvancePhase4(gaps: GapItem[], meta: any): boolean {
  const tier1Unresolved = gaps.filter(g => g.tier === 1 && !g.resolved)
  return tier1Unresolved.length === 0
}
```

### 5. Phase advancement validation

Add server-side validation to prevent invalid phase advances. In `updateSessionSchema`:

```typescript
function validatePhaseAdvance(currentPhase: number, session: any, gaps: GapItem[]): boolean {
  switch (currentPhase) {
    case 1: // Phase 1 → 2: contact info must be collected
      const schema = session.schema_data
      return !!(schema?.contact?.email && schema?.contact?.firstName && schema?.websiteUrl)
    case 3: // Phase 3 → 4: both chunks must be complete
      const chunks = session.schema_data?._meta?.phase3_completed_chunks ?? []
      return chunks.includes('chunk1') && chunks.includes('chunk2')
    case 4: // Phase 4 → 5: all Tier 1 gaps must be resolved
      return canAdvancePhase4(gaps, session.schema_data?._meta)
    default:
      return true  // Other phases trust Claude's judgment
  }
}
```

If validation fails, do not advance and log a warning. Claude will try again on the next exchange.

### 6. Status transitions

Update session status alongside phase:

```typescript
function getStatusForPhase(phase: number): string {
  if (phase === 0) return 'pending'
  if (phase >= 1 && phase <= 6) return 'in_progress'
  if (phase === 7) return 'completed'
  return 'in_progress'
}
```

Apply in `updateSessionSchema`:
```typescript
await supabase.from('sessions').update({
  schema_data: mergedSchema,
  gap_list: updatedGaps,
  current_phase: newPhase,
  status: getStatusForPhase(newPhase),
  completed_at: newPhase === 7 ? new Date().toISOString() : undefined,
}).eq('id', sessionId)
```

---

## Test Process

### T1 — Full end-to-end conversation using Korbey Lague MFP

1. Create a test session using the Korbey Lague MFP
2. Open the client URL
3. Walk through Phase 1: provide contact info, confirm URL
4. Verify WHOIS fires and populates `technical.*` fields:
```sql
SELECT schema_data->'technical' FROM sessions WHERE id = 'YOUR_SESSION_ID';
```
5. Walk through Phase 3 Chunk 1: confirm locations, technical, social, affiliations
6. Walk through Phase 3 Chunk 2: confirm team, services, choose positioning option
7. Walk through Phase 4: answer all Tier 1 gap questions
8. Walk through Phase 5: state no headshots available, no uploads
9. Confirm Phase 6 summary
10. Verify session status is `completed`:
```sql
SELECT status, current_phase, completed_at FROM sessions WHERE id = 'YOUR_SESSION_ID';
```
Expected: `status = 'completed'`, `current_phase = 7`, `completed_at` is set.

### T2 — WHOIS populates technical fields correctly
After completing Phase 1 with URL `korbeylague.com`:
```sql
SELECT schema_data->'technical'->>'registrar' as registrar,
       schema_data->'technical'->>'registrationDate' as reg_date
FROM sessions WHERE id = 'YOUR_SESSION_ID';
```
Expected: Non-empty registrar and registration date values.

### T3 — WHOIS failure does not block the session
Run a session with an invalid domain. Verify the session still advances to Phase 3 with empty `technical.*` fields.

### T4 — Phase 3 requires both chunks before advancing to 4
After completing Chunk 1, verify the agent presents Chunk 2 (not Phase 4 questions).
Complete Chunk 2 → verify phase advances to 4, not skipping.

### T5 — Phase 4 only asks about unresolved gaps
After Phase 3 resolves some Phase 3 gaps (affiliations, social), verify those gaps are marked resolved and are not re-asked in Phase 4.
```sql
SELECT jsonb_array_elements(gap_list) FROM sessions WHERE id = 'YOUR_SESSION_ID';
```
Resolved gaps should have `"resolved": true`.

### T6 — Tier 3 gaps are flagged, not asked, if time is long
Simulate a long Phase 4 by manually setting `_meta.phase4_flagged_for_followup` and verify the agent skips Tier 3 questions.

### T7 — Session completes in under 7 minutes
Time a full walkthrough from Phase 1 → Phase 6 confirm. Should be under 7 minutes with a knowledgeable test respondent.

---

## Common Failure Points

- **WHOIS timeout on Vercel** — use `timeout: 8000` in the `whoiser` call to stay within Vercel's 10-second function limit. If it still times out, add a try/catch that advances the phase anyway with empty fields.
- **`_meta` appearing in Claude's context** — strip it from the schema before every prompt. Claude should never see internal tracking state.
- **Phase 3 Chunk order** — Chunk 1 (practical) must complete before Chunk 2 (content). If Claude skips ahead, the chunk tracker gets out of sync.
- **Phase advance too early** — the server-side validation in `validatePhaseAdvance` is a safety net. If Claude calls `advancePhase: true` before the phase goals are met, the server should reject it silently (do not advance, do not show an error to the client).
- **Session timing out mid-phase** — if the client closes the browser and comes back, the session must resume from exactly where it left off. The `messages` table and `current_phase` handle this. Test by closing and reopening the session URL mid-Phase 3.
