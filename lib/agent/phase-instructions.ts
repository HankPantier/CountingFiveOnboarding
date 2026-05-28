import type { Database } from '@/types/database'
import type { AgentMode } from './system-prompt'

type Session = Database['public']['Tables']['sessions']['Row']

export function getPhaseInstructions(
  phase: number,
  session: Session,
  mode: AgentMode = 'client'
): string {
  switch (phase) {
    case 0:  return phase0Instructions()
    case 1:  return phase1Instructions(mode)
    case 2:  return phase2Instructions(mode)
    case 3:  return phase3Instructions(session, mode)
    case 4:  return phase4Instructions(mode)
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

function phase1Instructions(mode: AgentMode): string {
  if (mode === 'staff') {
    return `PHASE 1 — CONTACT INFO (staff mode)
Open with a single compact message asking the staff member to provide the client's:
- First name
- Last name
- Email
- Phone
- Website URL (confirm or correct)

One message, bulleted list, no introduction, no echo-back. Accept answers in any order/format.
As soon as all five land, call update_session_data with contact.firstName, contact.lastName, contact.email, contact.phone, websiteUrl, and advancePhase: true. Do not ask the staff member to confirm — they typed it, they know.`
  }
  return `PHASE 1 — CONTACT INFO
Introduce yourself briefly: you're here to walk through a few details for their new CountingFive website. Most of it is confirming what your team already researched — it should take 5–7 minutes.
Collect in one exchange: first name, last name, email address, and phone number. Bold each ask.
Confirm back what you heard, then call update_session_data with contact.firstName, contact.lastName, contact.email, contact.phone, and advancePhase: true.`
}

function phase2Instructions(mode: AgentMode): string {
  if (mode === 'staff') {
    return `PHASE 2 — DOMAIN LOOKUP (staff mode)
One line: "WHOIS running — hold." Do not ask anything. Do not call advancePhase. The lookup completes server-side and moves the session to Phase 3 automatically.`
  }
  return `PHASE 2 — DOMAIN LOOKUP
Tell the client you're pulling some technical info on their domain and it'll just take a moment.
The WHOIS lookup runs automatically — do not ask the client for technical details and do NOT call advancePhase.`
}

function phase3Instructions(session: Session, mode: AgentMode): string {
  const schema = session.schema_data as Record<string, unknown> | null
  const meta = schema?._meta as Record<string, unknown> | undefined
  const completedChunks = (meta?.phase3_completed_chunks as string[]) ?? []
  const chunk1Done = completedChunks.includes('chunk1')
  const chunk2Done = completedChunks.includes('chunk2')
  const chunk3Done = completedChunks.includes('chunk3')

  if (!chunk1Done) {
    if (mode === 'staff') {
      return `PHASE 3 — MFP REVIEW, PART 1 (Practical info) — staff mode
Present known data as a compact bulleted list / markdown table in ONE message:
- Office location(s) — name, address, phone, fax, email, hours
- Domain & hosting info
- Social channels (URL each)
- Affiliations (✅ confirmed, ❓ unconfirmed)
- Company LinkedIn URL (or "none on file")
- Google Business Profile URL (or "none on file")

Then, in the SAME message, ask for everything outstanding:
- "Corrections? Additional locations / socials / affiliations?"
- "Registrar username + PIN (skip if N/A)"
- "Admin/technical contact name, phone, email"
- "Redirect domains"
- "LinkedIn URL (or 'none'); LinkedIn usefulness (low/med/high); LinkedIn roomForImprovement"
- "GBP URL (or 'none'); GBP usefulness (low/med/high); GBP roomForImprovement"

Accept everything in any format. As soon as it lands, call update_session_data with all populated fields, resolvedGaps including "culture.linkedIn.url" and "business.googleBusinessProfile.url", and "_meta": { "phase3_completed_chunks": ["chunk1"] }.`
    }
    return `PHASE 3 — MFP REVIEW, PART 1 (Practical info)
Present all of the following in one message:
- Office locations, domain/hosting info, social media channels, professional affiliations
- The seeded company LinkedIn (culture.linkedIn.url) and Google Business Profile (business.googleBusinessProfile.url) — show the URL if seeded, or note "we couldn't confirm one" if null.
Ask: "Does all of that look right? Any corrections?"
Then in one bundled follow-up exchange collect:
- Any missing affiliations or social handles, confirm the website URL, ask about professional memberships or partnerships not listed.
- LinkedIn: if no URL is on file, ask for it (or confirm they don't have a company page → set culture.linkedIn.url = null). If they have one, ask "Roughly how useful is your LinkedIn for attracting clients today — low, medium, or high?" → culture.linkedIn.usefulness. Then "Anything you'd want to improve about it?" → culture.linkedIn.roomForImprovement (free text; if the MFP seeded a hint, offer it back for confirmation).
- Google Business Profile: same pattern — URL or null; usefulness if they have one; roomForImprovement (always meaningful — if no GBP, "create and verify a GBP listing" is a fine note). Save to business.googleBusinessProfile.{url, usefulness, roomForImprovement}.
When part 1 is done, call update_session_data with the structured fields populated and resolvedGaps including "culture.linkedIn.url" and "business.googleBusinessProfile.url"; updates must include { "_meta": { "phase3_completed_chunks": ["chunk1"] } }.`
  }

  if (!chunk2Done) {
    if (mode === 'staff') {
      return `PHASE 3 — MFP REVIEW, PART 2 (Content) — staff mode
Present known data as compact tables / lists in ONE message:
- Team — name | title (❓ if missing) | certifications
- Services — name + one-line description
- Niches — name + one-line ICP
- Positioning options A / B / C — bold label, one-line gist each

Then ask in the same message:
- "Corrections / additions to team, services, niches?"
- "Missing team titles?"
- "Pick a positioning option (A/B/C or a blend description)"

Accept all answers. As soon as positioning is chosen, call update_session_data with business.positioningOption, business.positioningStatement (use the chosen option's statement verbatim from the MFP), team/service/niche updates, and "_meta": { "phase3_completed_chunks": ["chunk1", "chunk2"] }. DO NOT advance phase — chunk3 (team photos) runs next.`
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
Once positioning is captured, briefly close with a single sentence bridging to the next step: "Last for this section — I'll walk through your team and ask about a headshot for each. Ready?"
Then call update_session_data with "_meta": { "phase3_completed_chunks": ["chunk1", "chunk2"] }. DO NOT advance phase yet — Part 3 (team photos) runs on the next exchange.`
  }

  // Chunk 3 — team photo capture. Per-member invariant is mode-agnostic; the
  // upload UI depends on `_meta.current_team_member_name` being set before each
  // ask, so the loop structure stays identical for staff. Only the wording of
  // the per-member prompt is lightly trimmed below.
  const team = (schema?.team as Array<{ name?: string }> | undefined) ?? []
  const teamMembersList = team
    .map(m => m?.name)
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)

  if (!chunk3Done) {
    if (teamMembersList.length === 0) {
      return `PHASE 3 — MFP REVIEW, PART 3 (Team photos) — NO TEAM CAPTURED

The team[] array is empty so there's nothing to photograph. Immediately call update_session_data with advancePhase: true and "_meta.phase3_completed_chunks": ["chunk1", "chunk2", "chunk3"]. No message needed; the next agent turn will be Phase 4.`
    }

    const captured = (meta?.team_photos_captured as string[]) ?? []
    const remaining = teamMembersList.filter(n => !captured.includes(n))
    const current = (meta?.current_team_member_name as string | undefined) ?? remaining[0] ?? null

    const askLine = mode === 'staff'
      ? `Ask: "Headshot for <Name>? Upload or 'skip'."`
      : `Ask the client in plain prose: "Do you have a headshot for <Name>? Upload it now, or skip if you don't have one — we'll generate a styled initials avatar as a placeholder."`

    const ackLine = mode === 'staff'
      ? `Acknowledge briefly: "Captured <Name>." or "Skipped <Name>." then ask about the next member.`
      : `Acknowledge briefly: "Got <Name>'s headshot — moving on" or "Skipped <Name> — moving on", then ask about the NEXT member.`

    const wrapLine = mode === 'staff'
      ? `ON THE LAST MEMBER, after step 4: call update_session_data with advancePhase: true and "_meta.phase3_completed_chunks": ["chunk1", "chunk2", "chunk3"] and a null current_team_member_name. One line: "Team photos done." Stop.`
      : `ON THE LAST MEMBER, after step 4: call update_session_data with advancePhase: true and "_meta.phase3_completed_chunks": ["chunk1", "chunk2", "chunk3"] and a null current_team_member_name. Acknowledge: "Team photos done — let's wrap a few last details" and stop.`

    return `PHASE 3 — MFP REVIEW, PART 3 (Team photos)

Walk through uploading one headshot per team member, in order.

Team roster: ${teamMembersList.map(n => `"${n}"`).join(', ')}
Already captured (skipped or uploaded): ${captured.length ? captured.map(n => `"${n}"`).join(', ') : 'none yet'}
Still to ask about: ${remaining.length ? remaining.map(n => `"${n}"`).join(', ') : 'none — all done, advance now'}
Current focus: ${current ? `"${current}"` : 'n/a'}

PROCEDURE for each remaining member (one at a time, not all in one message):

1. Set the upload context by calling update_session_data with:
   _meta.current_team_member_name = "<exact member name>"

   This is REQUIRED before asking — the upload UI reads this field and tags any uploaded file with the right member name. If you don't set it first, the upload is unmapped.

2. ${askLine}

3. Wait for an upload OR a skip cue.

4. Once handled (upload landed OR skip stated), call update_session_data with:
   _meta.team_photos_captured = [<existing list>, "<this member name>"]
   _meta.current_team_member_name = "<NEXT member name, or null if last>"

   Do NOT remove names from team_photos_captured. Always append.

5. ${ackLine}

${wrapLine}

DO NOT ask about members already in team_photos_captured. Use the "Still to ask about" list above.

If multiple photos arrive in one message for one member, accept all of them; only the first is canonical but the others stay archived.`
  }

  return `PHASE 3 is complete. Call update_session_data with advancePhase: true if you haven't already.`
}

function phase4Instructions(mode: AgentMode): string {
  if (mode === 'staff') {
    return `PHASE 4 — GAP FILLING (staff mode)
Present every unresolved gap from the REMAINING GAPS section below as a single checklist in ONE message. Group by section heading:
- Firm background
- Clients
- Differentiators
- Culture
- Brand & Tone
- Per-niche pain points / value props (if listed)

Format example:
- business.foundingYear — Founding year:
- business.firmHistory — Firm history / origin:
- culture.missionVisionValues — Mission / vision / values:
- brand.primaryColors — Brand colors:
- ...

Accept the staff member's answer in any layout — line-prefixed, key-value, or a long prose dump. Parse it and call update_session_data with every captured field plus resolvedGaps for those gap field paths.

Tier 1 gaps MUST be answered before advancing (server-side enforced). If the staff member skips a Tier 1 item, ask for it again in a short follow-up. Tier 2 / Tier 3 may be skipped — for Tier 3, log into "_meta.phase4_flagged_for_followup".

When all Tier 1 gaps are resolved, call update_session_data with advancePhase: true. No closing pleasantry needed.`
  }
  return `PHASE 4 — GAP FILLING
Only ask about items still in the gap list below. Anything already in COLLECTED DATA was seeded from the MFP — DO NOT re-ask. If you need light confirmation on a seeded value (e.g. firm history paragraph), do it inline within an unrelated batch, not as a standalone exchange.

Group remaining gaps into 2–3 per exchange by topic:
- Firm background (founding year, firm history if missing)
- Client questions (age ranges, how they find the firm, client needs)
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
Save responses to brand.currentTone, brand.aspirationalTone, brand.toneAdjectives, brand.toneToAvoid, brand.primaryColors, brand.hasBrandGuide. If the client volunteers personality language ("we're more like a..."), capture it in brand.brandPersonality. If they offer a memorable phrase that captures their voice, capture it verbatim in brand.voiceExample.

Close Phase 4 with: "Is there anything else about the firm that's important for us to know?"
When all Tier 1 gaps are resolved and that question has been asked, call update_session_data with advancePhase: true.`
}

function phase5Instructions(): string {
  return `PHASE 5 — ASSETS

LOGO IS THE PRIORITY ASK — push for it specifically before moving to other assets:
"Your logo is the single most useful file you can give us — it goes in the top-left of every page on your new site. Do you have one as a file? PNG or SVG is ideal, JPG works too. Even a working draft is better than nothing."

If they say they don't have one, or don't have one handy: "Totally fine — we'll generate a styled wordmark using your firm name in your brand colors. You can swap in a real logo any time once we deliver the site." Do NOT push further; capture the answer and move on. The wordmark is generated automatically at deliverable assembly so the absence of an upload is graceful.

If they say they have one but don't have it on hand right now: encourage them to grab it ("if it's quick to find, now is the moment — otherwise we can swap it in later"). Don't block the session waiting for it.

After the logo conversation, move to other brand assets and photography:
"What about a brand guide, color palette PDF, or any other style reference? Those help us match an existing visual identity if you have one."
Then: "Last on assets — team headshots or office photos you'd like us to use? Headshots are the most impactful since they appear on every team-grid page. If you don't have them yet, we'll use styled placeholders."

Prompt for uploads via the button below. Confirm receipt of each file by name. If a client uploads a logo, acknowledge it by name explicitly so they know it landed ("Got it — drinks-logo.png saved as your primary logo.").

When done (or client confirms they have nothing more to upload), call update_session_data with advancePhase: true.`
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
