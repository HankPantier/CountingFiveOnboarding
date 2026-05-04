# Step 01 — MFP Parser Extension

Extend the existing MFP parser to capture Sections 8, 9, 10A, and 10B at session creation time. This data is stored in `schema_data` and is the foundation for the entire content generation workflow.

---

## What We're Building

Four new section parsers added to `lib/mfp-parser/index.ts`, each following the existing try/catch pattern. New fields added to `types/session-schema.ts`. No changes to the session creation API — the parser runs at the same point it always has.

---

## New Schema Fields

Add to `types/session-schema.ts`:

```typescript
proposed_sitemap?: Array<{
  url: string            // e.g. /services/virtual-cfo-advisory
  title: string          // e.g. Advisory & Virtual CFO
  status: 'new' | 'update' | 'existing'  // 🆕 / 📈 / ✅
  parent?: string        // parent URL if nested
  notes?: string         // any annotation from the MFP
}>

current_sitemap?: Array<{
  url: string
  title: string
  action: 'keep' | 'redirect' | 'consolidate' | 'new'
  new_url?: string       // redirect target if applicable
  live: boolean
}>

reputation?: {
  googleRating?: string
  yelpRating?: string
  reviewSummary?: string
  trustSignalGaps: string[]
  pressAndMedia: string[]
}

content_gaps?: {
  nicheGaps: string[]
  authorityGaps: string[]
  conversionGaps: string[]
  teamExpertiseGaps: string[]
}
```

---

## Parser Functions to Add

### `parseSection8` — Reputation & Trust Signals
- Extract overall sentiment, Google rating, Yelp rating
- Extract bulleted trust signal gaps as a string array
- Extract press/media mentions as a string array

### `parseSection9` — Content Gap Analysis
- Extract niche gaps, authority gaps, conversion gaps, team expertise gaps
- Each as a string array from the bulleted lists under each subsection heading

### `parseSection10A` — Current Site Map
- Extract the redirect planning table rows
- For each row: current URL, page title, action (301 Redirect / Consolidate / No Change / New Page), new URL
- Mark `live: false` for any row noted as redirecting to homepage or JS-rendered

### `parseSection10B` — Proposed Site Map
- Parse the text tree (not the mermaid block — the text tree is more reliable to parse)
- Extract each page: URL, title, status (🆕 = new, 📈 = update, ✅ = existing)
- Infer parent from indentation level
- Store as a flat array with parent URL reference

---

## Files to Modify

- `lib/mfp-parser/index.ts` — add four new parser functions, call them in the sections array
- `types/session-schema.ts` — add four new top-level fields

---

## Test Process

1. Run the existing test script against the Korbey Lague fixture:
   ```bash
   npx tsx scripts/test-parser.ts
   ```
2. Verify `proposed_sitemap` contains all pages from the Section 10B text tree with correct status flags
3. Verify `current_sitemap` contains redirect plan rows with correct actions
4. Verify `reputation.trustSignalGaps` is a non-empty array
5. Verify `content_gaps` has all four gap arrays populated
6. Confirm all four new fields are stripped by `serializeSchema()` — they must NOT appear in the Claude system prompt (add to the `_meta`-style strip list or ensure they're excluded from the prompt builder)

---

## Notes

- Parser must never throw — maintain the existing try/catch per section pattern
- The mermaid block in Section 10B should be skipped; parse the text tree that follows it instead
- Section 10A rows with "New Page" action have no current URL — handle gracefully
- After this step, the admin session detail page can optionally surface the proposed sitemap as a read-only preview — a small UX win that costs nothing extra
