---
name: build-verify
description: Use for ANY request to build, implement, create, add, fix, refactor, or modify code in the CountingFive Onboarding project — no matter how small. Enforces a pre-build integration audit, a review→test→fix loop (max 5 iterations) before declaring anything done, and a system integration check before advancing to a new dev step. If there is even a 1% chance this skill applies, invoke it.
---

# CountingFive Build & Verify Workflow

You are a senior developer on the CountingFive Onboarding Agent. Every task must be correct, secure, typed, and well-integrated. No shortcuts, no patches, no sloppy code.

---

## Phase 1 — Understand Before You Touch Anything

Do not write a single line of code until all four of these are done:

**1. Read the relevant dev step file.**
Find the matching file in `raw-docs/dev-steps/` for the work being requested. Read it fully — understand the scope, declared dependencies, expected file structure, and the complete "Test Process" section. The test process is your acceptance criteria.

**2. Audit existing code.**
Explore the actual files in the repo. Do not assume the file structure matches the plan. Find every file your work will create, modify, or depend on. If a file already exists and differs from what the dev step expects, surface this before proceeding.

**3. Cross-reference CLAUDE.md.**
Identify every rule in CLAUDE.md that applies to what you're about to build. Key sections to check based on the domain:
- Building an API route → API Route Patterns, Critical Security Rules
- Writing Supabase queries → Database Access, security rules 1 & 4
- Working on the chat endpoint → Claude/AI Integration Rules, Processing Flag Safety
- Building UI → Design System Rules (and read `raw-docs/design.md`)
- File uploads → security rule 3 (magic byte validation)
- Cron routes → security rule 2 (CRON_SECRET validation)
- Phase logic → Phase Logic Rules (never confuse dev phases with agent phases)
- PDF generation → PDF Generation Rules (Node.js runtime only)
- Basecamp → Basecamp Integration Rules

**4. Map all integration points.**
List every file, route, exported type, and DB column your work touches or produces that other parts of the system will consume. This is your integration contract — verify it matches what dependent steps expect.

---

## Phase 2 — Build

Implement the feature. Hold yourself to these standards on every line:

**TypeScript**
- `strict: true` is enforced. Never use `as any` or suppress type errors.
- Use types from `types/database.ts`, `types/session-schema.ts`, `types/gap-item.ts` — never inline object types for Supabase results or schema data.
- If a needed type doesn't exist yet, define it properly before using it.

**Security (non-negotiable)**
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. If you're in a file that could be bundled client-side, use the anon key.
- Every `/api/cron/*` route validates `Authorization: Bearer {CRON_SECRET}` as the very first thing it does.
- File upload handlers must use magic byte validation via the `file-type` package server-side.
- Session IDs are UUIDs only — never expose or accept sequential integers.

**Conservative choices on ambiguity**
When something is genuinely unclear and multiple valid approaches exist, take the safer, more secure option. Document every such choice using this exact format before moving to the verify phase:

```
CONSERVATIVE CHOICE: [what you chose]
ALTERNATIVE: [the other option you considered]
REASON: [the security or correctness constraint that guided your choice]
CONFIRM? [yes/no question for the user]
```

Do not proceed past a conservative choice until the user has confirmed it — ask explicitly.

**Code quality**
- Default to no comments. Add one only when the WHY is non-obvious: a hidden constraint, a security invariant, a framework gotcha.
- No `console.log` left in production paths. Use structured log calls only (e.g., `console.warn` for non-fatal WHOIS failures as specified in the dev step).
- No backwards-compatibility shims, unused exports, or placeholder code.

---

## Phase 3 — Verify Loop

After completing the build, run all four checks below in order. If any check fails, fix the root cause and restart from Check 1. Repeat up to **5 iterations**.

If after 5 full iterations any check still fails, **stop immediately**. Do not attempt a sixth fix. Surface the problem to the user with:
- The exact error output
- A plain-language explanation of the root cause
- Two or more concrete approaches to resolve it, with trade-offs
- A recommendation for which approach to take and why

### Check 1 — TypeScript
```bash
npx tsc --noEmit
```
Zero errors required. Every error must be resolved — do not suppress with type assertions unless the suppression is justified and documented.

### Check 2 — Dev Step Test Process
Work through every numbered test in the "Test Process" section of the relevant `raw-docs/dev-steps/` file. For each test, record:
- `✓ T[n] — [test name]` if it passes
- `✗ T[n] — [test name]: [actual result vs expected]` if it fails

All tests must pass before proceeding. A test that "mostly passes" is a failing test.

### Check 3 — Build
```bash
npm run build
```
Clean build required. No new errors or warnings introduced. If the build wasn't clean before your changes, note the pre-existing issues separately and do not conflate them with your own.

### Check 4 — Security Grep
```bash
grep -r "SUPABASE_SERVICE_ROLE_KEY" ./app --include="*.tsx" --include="*.ts"
```
Zero results required. If any match appears, fix it immediately — this is a critical security violation and blocks everything else.

---

## Phase 4 — Integration Check (Before Advancing to the Next Step)

Before declaring a dev step complete, verify that the system as a whole is still coherent:

**1. Downstream contract.**
Look at the `raw-docs/dev-steps/` file for the next step (or the step that declares "Depends on: this step"). Do your exported types, API routes, and DB columns match what it expects? If not, fix the mismatch now — don't leave it for the next step to discover.

**2. Upstream contract.**
Does your code correctly consume every dependency declared in the "Depends on" section of the current step? If a dependency doesn't exist yet, surface this — don't stub it silently.

**3. CLAUDE.md compliance sweep.**
Re-read the CLAUDE.md sections that govern adjacent steps. Are there any rules you implemented correctly but that will constrain how the next step interacts with your code? Flag these proactively so they're understood before work begins.

**4. Database state.**
If your work creates or modifies DB tables, columns, or RLS policies, verify the live state in Supabase matches what you implemented. Run the generated TypeScript types check:
```bash
npx tsc --noEmit
```
If `types/database.ts` is stale relative to the schema, regenerate it before declaring complete:
```bash
npx supabase gen types typescript --project-id PROJECT_ID > types/database.ts
```

Only when all four checks pass, declare the step complete and summarize:
- What was built
- Every conservative choice made and its confirmation status
- The integration contract produced (types, routes, columns) for the next step to consume
