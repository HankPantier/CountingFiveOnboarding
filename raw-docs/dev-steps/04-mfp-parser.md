# Step 04 — MFP Parser

**Depends on:** Steps 01–02
**Unlocks:** Step 05 (Session Creation)
**Estimated time:** Day 3

---

## What This Step Accomplishes

A TypeScript module that reads a raw MFP markdown file and extracts structured data into the `SessionSchema` format, plus a gap list of everything that couldn't be parsed. This is the most brittle component in the system — build it defensively. It must never throw; it always returns a partial result.

---

## What the MFP Contains

The MFP is a markdown document with 7 sections. The parser maps each to schema fields:

| MFP Section | Schema Fields |
|---|---|
| Section 1 — Firm Identity | `business.name`, `websiteUrl`, `locations[]` |
| Section 2 — Firm Narrative | `business.tagline`, `business.positioningStatement` (3 options) |
| Section 3 — Accreditations | `business.affiliations[]` (✅ confirmed only; ❓ → gap list) |
| Section 4 — Social & Digital | `culture.socialMediaChannels[]` (✅ confirmed; ❓ → gap list) |
| Section 5 — Who They Serve | `niches[]`, `business.idealClients[]` |
| Section 6 — Services | `services[]` |
| Section 7 — Team | `team[]` (missing titles → gap list) |

---

## Gap List Item Structure

```typescript
export type GapItem = {
  field: string;      // e.g., "team[2].title"
  label: string;      // human-readable: "Kristine Ciccarelli — Title"
  phase: number;      // which agent phase addresses this (3 or 4)
  tier?: number;      // for Phase 4: priority tier (1, 2, or 3)
  topic?: string;     // for Phase 4: topic label (A–I)
  resolved: boolean;
};
```

---

## Implementation Tasks

### 1. Create the parser module

`lib/mfp-parser/index.ts`:
```typescript
import { SessionSchema } from '@/types/session-schema'
import { GapItem } from '@/types/gap-item'

export function parseMFP(markdown: string): { schema: SessionSchema; gaps: GapItem[] } {
  const gaps: GapItem[] = []
  const schema: SessionSchema = {}

  try {
    schema.business = {}
    schema.locations = []
    schema.team = []
    schema.services = []
    schema.niches = []
    schema.culture = { socialMediaChannels: [] }

    parseSection1(markdown, schema, gaps)
    parseSection2(markdown, schema, gaps)
    parseSection3(markdown, schema, gaps)
    parseSection4(markdown, schema, gaps)
    parseSection5(markdown, schema, gaps)
    parseSection6(markdown, schema, gaps)
    parseSection7(markdown, schema, gaps)
  } catch (err) {
    console.error('[MFP Parser] Unexpected error — returning partial result:', err)
  }

  return { schema, gaps }
}
```

### 2. Section parsing strategy

Each `parseSection*` function should:
1. Use a regex to locate the section header (case-insensitive, flexible whitespace)
2. Extract the section text up to the next `##` header
3. Parse within that text — never assume line numbers
4. Log a warning (not throw) if a section is missing

Example section extractor:
```typescript
function extractSection(markdown: string, headerPattern: RegExp): string | null {
  const match = markdown.match(headerPattern)
  if (!match) return null
  const start = match.index! + match[0].length
  const nextSection = markdown.indexOf('\n## ', start)
  return nextSection > -1 ? markdown.slice(start, nextSection) : markdown.slice(start)
}
```

### 3. Build all section parsers

Key parsing rules per section:

**Section 1 — Firm Identity:**
- Extract business name, website URL
- Parse location blocks (look for address patterns, phone/fax/email/hours)
- Multiple locations supported — parse each into a separate `locations[]` entry

**Section 2 — Firm Narrative:**
- Extract tagline
- Extract all 3 positioning options (Option A, B, C or similar) as an array — store all 3 for Phase 3d review

**Section 3 — Accreditations:**
- Lines with ✅ → add to `business.affiliations[]`
- Lines with ❓ → add to gap list with `phase: 3`

**Section 4 — Social & Digital:**
- Lines with ✅ and a URL → add to `culture.socialMediaChannels[]`
- Lines with ❓ → add to gap list with `phase: 3`

**Section 5 — Who They Serve:**
- Parse niche names and ICP descriptions → `niches[]`
- Extract ideal client descriptors → `business.idealClients[]`

**Section 6 — Services:**
- Parse service name, description, and any sub-offerings → `services[]`

**Section 7 — Team:**
- Parse each team member: name, title (if present), certifications
- If title is ❓ or missing → add to gap list with `{ field: "team[N].title", label: "Name — Title", phase: 3 }`

### 4. Add Phase 4 gap items

After section parsing, add standard Phase 4 gap items (these are always gaps — MFP doesn't cover them):

```typescript
function addPhase4Gaps(gaps: GapItem[]) {
  const tier1Gaps: GapItem[] = [
    { field: 'business.foundingYear', label: 'Founding Year', phase: 4, tier: 1, resolved: false },
    { field: 'business.firmHistory', label: 'Firm History / Origin Story', phase: 4, tier: 1, resolved: false },
    { field: 'culture.missionVisionValues', label: 'Mission, Vision & Values', phase: 4, tier: 1, resolved: false },
    { field: 'culture.teamDescription', label: 'Team Culture Description', phase: 4, tier: 1, resolved: false },
    { field: 'business.differentiators', label: 'Differentiators (in their own words)', phase: 4, tier: 1, resolved: false },
    { field: 'business.howClientsFind', label: 'How Clients Find the Firm', phase: 4, tier: 1, resolved: false },
    { field: 'business.customerNeeds', label: 'Client Needs & Pain Points', phase: 4, tier: 1, resolved: false },
    { field: 'business.geographicScope', label: 'Geographic Scope', phase: 4, tier: 1, resolved: false },
    { field: 'business.clientAgeRanges', label: 'Client Age Ranges', phase: 4, tier: 1, resolved: false },
  ]
  const tier2Gaps: GapItem[] = [
    { field: 'business.clientSuccessStories', label: 'Client Success Stories', phase: 4, tier: 2, resolved: false },
    { field: 'business.clientMixBreakdown', label: 'Client Mix Breakdown', phase: 4, tier: 2, resolved: false },
  ]
  const tier3Gaps: GapItem[] = [
    { field: 'technical.googleBusinessProfileUrl', label: 'Google Business Profile URL', phase: 4, tier: 3, resolved: false },
  ]
  gaps.push(...tier1Gaps, ...tier2Gaps, ...tier3Gaps)
}
```

---

## Test Process

### T1 — Parser runs without throwing on the Korbey Lague MFP

```typescript
import { parseMFP } from '@/lib/mfp-parser'
import fs from 'fs'

const mfp = fs.readFileSync('./raw-docs/mfp-korbeylague-com-2026-04-24.md', 'utf-8')
const { schema, gaps } = parseMFP(mfp)

console.log('Business name:', schema.business?.name)       // Should be: Korbey Lague PLLP (or similar)
console.log('Location count:', schema.locations?.length)   // Should be > 0
console.log('Team count:', schema.team?.length)            // Should be > 0
console.log('Services count:', schema.services?.length)    // Should be > 0
console.log('Gap count:', gaps.length)                     // Should be > 0
```

### T2 — Gap list contains Phase 4 Tier 1 fields
```typescript
const tier1Gaps = gaps.filter(g => g.tier === 1)
console.log('Tier 1 gap count:', tier1Gaps.length) // Expected: 9
```

### T3 — Team members with missing titles are flagged as gaps
```typescript
const titleGaps = gaps.filter(g => g.field.includes('.title'))
console.log('Title gaps:', titleGaps.map(g => g.label))
// Should list any team members without a confirmed title
```

### T4 — Parser handles a broken/empty MFP without throwing
```typescript
const { schema: emptySchema, gaps: emptyGaps } = parseMFP('')
// Should not throw; should return empty schema and gap list with Phase 4 items
console.log('Empty parse succeeded:', Object.keys(emptySchema).length >= 0)
```

### T5 — Parser handles missing sections gracefully
```typescript
const { schema, gaps } = parseMFP('# Section 1\nFirm: Test Co\n')
// Should parse Section 1 partially, log warnings for missing sections, not throw
```

### T6 — Confirmed affiliations are in schema, not gap list
```typescript
const confirmedAffiliations = schema.business?.affiliations ?? []
const affiliationGaps = gaps.filter(g => g.field.includes('affiliation'))
// confirmedAffiliations: ✅ items only
// affiliationGaps: ❓ items only — no overlap
```

---

## Common Failure Points

- **Line-number assumptions** — do not parse by line number. Use regex to find section headers. MFP format will vary between clients.
- **Parser throwing on edge cases** — wrap all section parsers in try/catch. A single bad MFP should not crash the session creation flow.
- **Emoji in markdown** — the ✅ and ❓ characters are literal Unicode. Make sure your regex patterns account for them correctly in strings.
- **Storing raw MFP content** — the `sessions.mfp_content` column holds the original markdown for admin debugging. If the parser produces wrong output in production, you can re-run it against the stored raw content without asking the client to re-upload.
- **Don't re-parse on every request** — the parser runs exactly once at session creation. After that, only `schema_data` is used. The raw MFP never touches the Claude system prompt.
