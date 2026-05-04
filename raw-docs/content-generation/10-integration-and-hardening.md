# Step 10 — Integration, Hardening & Token Budget

Final integration pass: wire up all phases, harden the pipeline against failures, enforce token budgets, and run end-to-end tests against the Korbey Lague fixture.

---

## What We're Building

No new features. This step connects all the pieces built in Steps 01–09, adds error recovery, enforces cost controls, and validates the full workflow from start to finish.

---

## Phase Transition Wiring

Verify that every phase transition is correctly gated and triggers the next step:

| From | To | Trigger | Next Action |
|---|---|---|---|
| Phase 1 complete | Phase 2 | Admin locks palette | Load sitemap from schema_data |
| Phase 2 complete | Phase 3 | Admin confirms sitemap | Fire research pipeline |
| Phase 3 complete | Phase 4 | All research_results done | Fire outline generation |
| Phase 4 complete | Phase 5 | Admin approves all outlines | Fire content generation |
| Phase 5 complete | Phase 6 | All pages generated | Fire deliverable assembly |

Each transition must:
1. Update `content_jobs.phase` in Supabase
2. Update `content_jobs.updated_at`
3. Send the appropriate Resend notification email
4. Log the transition: `[content-job] phase {n}→{n+1} session={sessionId}`

---

## Error Recovery

### Research Phase Errors
- If a `research_results` row gets stuck in `running` for > 5 minutes, mark it `error` and continue
- The pipeline does not block on individual page research errors
- Phase 3 completes when all rows are `complete` OR `error` (not stuck in `running`)
- Admin sees error count in Phase 3 card: "21 complete · 2 errors — generation will proceed with available research"

### Outline Generation Errors
- If Claude fails to generate a valid outline JSON for a page, store a minimal fallback:
  ```typescript
  { h1: page_title, sections: [{ h2: 'Overview', description: 'Add content here', word_count: 300 }] }
  ```
- Mark the outline with a `⚠️ Auto-generated fallback` note — admin must manually edit before approving

### Content Generation Errors
- If a page generation fails twice (original + retry), mark `generation_status: 'error'`
- Phase 5 completes when all pages are `complete` OR `error`
- The deliverable package skips errored pages and includes a `ERRORS.md` file noting which pages need manual copy

### Stuck `content_jobs` Recovery
- Add a `GET /api/content-jobs/[id]/status` endpoint the Phase card can call on load
- If a job has been in `phase = 3` with no `research_results` updates for > 10 minutes, show a "Resume Research" button that re-triggers the pipeline for pending rows only

---

## Token Budget Enforcement

Log all Claude calls in the content generation pipeline. Add to each generation function's `onFinish` or response handler:

```typescript
console.log(
  `[content-gen] page="${page_url}" phase="${phase}" ` +
  `input=${inputTokens} output=${outputTokens} total=${totalTokens}`
)
```

Target budgets per page:
| Call | Model | Max Input Tokens |
|---|---|---|
| Keyword draft (Phase 3) | Haiku | 800 |
| Outline generation (Phase 4) | Sonnet | 3,000 |
| Content generation (Phase 5) | Sonnet | 5,000 |

If any call exceeds 8,000 input tokens, log a warning and investigate before continuing:
```
[content-gen] ⚠️ Token budget exceeded: page="/services/virtual-cfo-advisory" input=9,234
```

Add `truncateToTokenBudget(text: string, maxTokens: number): string` utility to `lib/content/` that truncates existing content and competitor excerpts to stay within budget.

---

## Security Checklist

- [ ] All `/api/content-jobs/*` routes verify the caller is an authenticated admin (use `createAuthClient()` pattern from `/api/sessions/[id]/approve`)
- [ ] `content_jobs.session_id` ownership is validated on every request — admin cannot access another admin's jobs (not an issue now but good hygiene)
- [ ] Supabase Storage paths for content packages use `content-packages/{sessionId}/` — private bucket, signed URLs only
- [ ] No generated content or session data appears in client-side bundles
- [ ] Run service role key grep before committing: `grep -r "SUPABASE_SERVICE_ROLE_KEY" ./app` — expected: zero matches

---

## End-to-End Test: Korbey Lague Fixture

Run the full workflow against the Korbey Lague session:

1. Ensure the session is in `approved` status with the full MFP uploaded
2. Navigate to `/admin/content` — confirm session appears with "Not Started" badge
3. Start workflow — confirm Phase 1 loads with palette extracted from uploaded logo
4. Complete all 6 phases following each step's test process
5. Download the final zip — open and verify:
   - [ ] Correct page count matches confirmed sitemap
   - [ ] llms.txt passes the llmstxt.org validator (https://llmstxt.org/validator)
   - [ ] robots.txt allows all major AI crawlers
   - [ ] Word document opens without errors and has table of contents
   - [ ] At least 3 pages pass manual anti-slop review (read them — do they sound human?)
   - [ ] Meta descriptions are within 150-160 characters for all pages
   - [ ] Internal links reference valid pages in the confirmed sitemap (no broken references)
6. Run `npx tsc --noEmit` — zero errors
7. Deploy to Vercel preview — confirm full workflow runs in production environment

---

## Vercel Configuration

Content generation involves long-running API routes (outline generation, content generation). Ensure these routes don't hit Vercel's default timeout:

Add to `vercel.json`:
```json
{
  "functions": {
    "app/api/content-jobs/[id]/generate/route.ts": { "maxDuration": 300 },
    "app/api/content-jobs/[id]/package/route.ts": { "maxDuration": 120 },
    "app/api/content-jobs/[id]/outlines/generate/route.ts": { "maxDuration": 120 }
  }
}
```

These routes use the nodejs runtime (not edge) — confirm `export const runtime = 'nodejs'` is set in each.

---

## Files to Modify

- `vercel.json` — add function timeout overrides
- `lib/content/` — add `truncateToTokenBudget.ts` utility
- All Phase card components — add error state UI and recovery buttons
- All `/api/content-jobs/` routes — add auth validation

---

## Definition of Done

The content generation workflow is complete when:
- [ ] Full workflow runs end-to-end without manual intervention after each phase gate
- [ ] All Resend notifications fire at the correct phase transitions
- [ ] Downloaded zip is well-formed and passes manual content review
- [ ] TypeScript compiles clean
- [ ] No `SUPABASE_SERVICE_ROLE_KEY` in client bundles
- [ ] Deployed and tested on Vercel preview environment
