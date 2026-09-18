# Audit Review — AI-suggested treatments (improvement #1)

## Context

The Audit Review onboarding step (`components/admin/onboarding/AuditReview.tsx`) forces the operator to decide **Own page / Content block / Exclude** per service, industry/niche, and sub-service (plus keep/remove for team and a scope for geography). Today the operator decides **blind** — existing-site items default to "Own page," audit-recommended items default to "Exclude," and nothing explains *why* any choice is right.

This change makes the AI **pre-select a suggested treatment per item with a one-line rationale**, so the task shifts from *decide* to *confirm*. The audit already holds the signals to reason well (niche `signal`, `content_gaps`, `competitive` keyword/search data, the audit narrative). The suggestion is computed once at audit→seed time and persisted, so the review opens instantly with everything pre-filled.

Scope: all four areas — services, industries/niches, sub-services (the 3-way page/block/exclude), **plus** geography (suggested scope) and team (suggested keep/remove).

## Decisions (from brainstorm)

- **Generation:** extend the existing audit→seed pass (`draftSessionFromAudit`), a second AI call **after** `enrichSchemaFromIntelligence` (needs the enriched `signal`/`content_gaps`/`competitive`). Persisted; no per-open cost. Non-fatal on failure.
- **Data model:** a single `_meta.audit_suggestions` block **keyed by item name** — separate from the human's `pageTreatment`, so AI-vs-human-vs-override is always distinguishable and the content-facing arrays stay clean. Works for audit-recommended items not yet in `niches[]`.
- **Exclude:** the AI **may** pre-select Exclude, but only with cited evidence in the rationale (no real content, off-strategy, superseded).
- **Block parent:** a block suggestion also names a suggested **parent** page (pre-fills the dropdown; prevents orphaned blocks).

## Data model — `types/session-schema.ts` (no migration)

Add to `_meta`:
```ts
audit_suggestions?: {
  services?:      Array<{ name: string; treatment: 'page'|'block'|'exclude'; parent?: string; rationale: string; confidence?: 'high'|'medium'|'low' }>
  niches?:        Array<{ name: string; treatment: 'page'|'block'|'exclude'; parent?: string; rationale: string; confidence?: 'high'|'medium'|'low' }>
  subCategories?: Array<{ niche: string; name: string; treatment: 'page'|'block'|'exclude'; parent?: string; rationale: string; confidence?: 'high'|'medium'|'low' }>
  team?:          Array<{ name: string; decision: 'keep'|'remove'; rationale: string; confidence?: 'high'|'medium'|'low' }>
  geoScope?:      { scope: 'local'|'regional'|'national'; primaryArea?: string; rationale: string; confidence?: 'high'|'medium'|'low' }
  generatedAt:    string
}
```
Stored in `schema_data` JSONB → **no migration**. Already stripped from generation prompts (it's under `_meta`).

## Generation — `lib/session-draft/suggest-audit-treatments.ts` (new)

```ts
export type AuditSuggestions = NonNullable<SessionSchema['_meta']>['audit_suggestions']
export async function suggestAuditTreatments(
  schema: SessionSchema,
  intel: AuditIntelligence | undefined,
  ctx?: { auditId?: string },
): Promise<AuditSuggestions | null>
```
- One `generateMbpJson` call on `PUBLISHED_CONTENT_MODEL` (Sonnet 5) + `GENERATION_PROVIDER_OPTIONS` (never Haiku — `effort` errors there), mirroring the sibling draft pass. `task:'onboarding', stage:'mbp'`.
- **Inputs:** detected services/niches/sub-services/team/service-areas from `schema`, each niche's `signal`, `schema.content_gaps`, `_meta.opportunities.highOpportunityNiches` (recommended niches), and `intel.competitive` / `intel.narrative`.
- **Prompt rules:** page = distinct standalone demand/depth; block = real but thin → a section, and MUST name a parent; **exclude only with evidence** cited in the rationale; one-line rationale + confidence per item; a geo scope call (+ suggested primary area); team keep/remove. Produce entries for existing AND recommended items (by name).
- **Validator** (`validateAuditSuggestions`): defensive coercion — drop entries missing a name (or `niche` for subs), an invalid `treatment`/`decision`/`scope` enum, or an empty `rationale`; coerce `confidence`; stamp `generatedAt = new Date().toISOString()`. Returns `null` when nothing usable (→ graceful fallback to origin defaults).

**Wiring** in `lib/session-draft/draft-from-audit.ts → draftSessionFromAudit`, after `enrichSchemaFromIntelligence(...)` and `mapAuditToContentPlan(...)`:
```ts
try {
  const suggestions = await suggestAuditTreatments(schema, result.intelligence, { auditId })
  if (suggestions) (schema._meta ??= EMPTY_META).audit_suggestions = suggestions
} catch (err) {
  console.warn('[draft-from-audit] treatment suggestions failed, using defaults:', err)
}
```

## Props builder — extract + join

Extract `buildAuditReviewProps` out of `app/admin/sessions/[id]/onboarding/page.tsx` into a pure, testable module **`lib/onboarding/audit-review-props.ts`** (exported), and extend it to join `_meta.audit_suggestions` **by name (case-insensitive)** onto each item.

Initial-treatment precedence (per item): **prior human decision (`treatmentOf` = `status`/`pageTreatment`) → AI `suggestion.treatment` → origin default (component fallback).** Parent: `item.parent ?? suggestion.parent`. Each `ReviewItem` also carries a `suggestion?: { treatment; rationale; confidence?; parent? }` for display. Team members carry `suggestion?: { decision; rationale; confidence? }`; geo carries `suggestedScope`, `suggestedPrimaryArea`, `suggestionRationale`.

`page.tsx` imports the extracted function (no behavior change beyond the join).

## UI

- **`AuditReviewItemRow`** — new `suggestion?` prop. The segmented control is pre-set to the suggestion (via the props builder). Under the item, a rationale line:
  - pick == suggestion → `✦ AI: Content block on Business Tax — <rationale>`
  - pick != suggestion → `✦ AI suggested Content block (you chose Own page) — <rationale>` (override never silent)
  - `confidence: 'low'` → a small amber "double-check" pill.
  - Block suggestions pre-fill the suggested parent in the existing dropdown.
- **`TeamReviewList`** — accept per-member suggestions; initial decision = prior `teamDecision` ?? suggestion.decision ?? 'keep'; show the `✦` rationale line + override state.
- **`GeoScopeControl`** — initial scope = prior `serviceScope` ?? suggested scope ?? existing default; highlight the suggested primary area; show the rationale by the scope buttons.
- No "accept all" button — pre-selection *is* the bulk-accept (bulk actions are improvement #4).

**Confirm-vs-override** is derivable later from `pageTreatment` (human) vs `_meta.audit_suggestions` (AI); no new storage, no metric UI in this change.

## Testing

- `lib/session-draft/suggest-audit-treatments.test.ts` — mock `generateMbpJson`; validator coerces the shape, drops malformed entries, requires non-empty rationale, keeps exclude evidence, guards enums; null model → null result.
- `lib/onboarding/audit-review-props.test.ts` — suggestion attaches by name; **prior `pageTreatment` wins over suggestion**; falls back to origin default when neither present; geo/team threaded.
- `lib/session-draft/draft-from-audit.test.ts` — extend: `_meta.audit_suggestions` populated when the suggestion model returns; draft still succeeds when it throws (non-fatal).
- Schema type addition (type-only).
- UI display is light-touch; the suite's weight stays on the pure props-builder + generation logic (repo convention).

## Build sequence

1. Schema type `_meta.audit_suggestions`.
2. `suggest-audit-treatments.ts` (+ validator) + tests.
3. Wire into `draft-from-audit.ts` (+ test extension).
4. Extract `audit-review-props.ts` (+ join + precedence) + test; update `page.tsx` import.
5. Thread `suggestion` through `AuditReview` → `AuditReviewItemRow` / `TeamReviewList` / `GeoScopeControl`.
6. Verify: `tsc`, full `vitest`, `build`, eslint, CLAUDE.md greps.

## Files

**Create:** `lib/session-draft/suggest-audit-treatments.ts`, `lib/onboarding/audit-review-props.ts`, + 2 test files.
**Modify:** `types/session-schema.ts`, `lib/session-draft/draft-from-audit.ts` (+ test), `app/admin/sessions/[id]/onboarding/page.tsx`, `components/admin/onboarding/AuditReview.tsx`, `AuditReviewItemRow.tsx`, `TeamReviewList.tsx`, `GeoScopeControl.tsx`.

## Verification (E2E)

`tsc` clean; full suite green; `build` clean; greps zero. On a fresh audit-seeded session, the Audit Review opens with each item pre-selected to the AI's suggestion + a visible rationale; overriding shows the divergence; a block's parent is pre-filled; submitting persists the human's picks (`pageTreatment`) while `_meta.audit_suggestions` retains the AI's. Suggestion-generation failure degrades to today's origin defaults.
