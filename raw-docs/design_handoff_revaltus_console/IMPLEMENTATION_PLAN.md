# Implementation Plan — Revaltus Operator Console redesign
### For Claude Code (or any agentic coding tool)

This plan turns the `design_handoff_revaltus_console/` bundle into a merged PR.
Work the phases **in order**; each phase is independently buildable and ends with
a checkpoint + a suggested commit. Do not batch all phases into one commit.

---

## Ground rules (read first)
- **Do not touch data-fetching, queries, server actions, types, or API routes.**
  This is a presentation-only redesign. In the two REPLACE pages
  (`dashboard/page.tsx`, `home/page.tsx`) the async/Supabase code above the
  `return(...)` is copied verbatim — keep it identical; only JSX changed.
- **No new dependencies.** Everything uses existing Tailwind tokens + inline SVG.
  The change actually *removes* a call site for `recharts` (`SessionsFunnelChart`).
- **Use tokens, never hex.** Style with the `@theme` utility classes
  (`bg-brand-navy`, `text-text-secondary`, `shadow-subtle`, …). The only raw
  values are inside SVGs, via `var(--color-*)`.
- **Preserve behavior.** Auth/`requires` nav filtering, URL-param filters, the
  `signOut` action, and `SessionRowActions` must keep working unchanged.
- **Bundle paths → repo paths:** drop the `code/` prefix. e.g.
  `code/components/admin/ui/StatCard.tsx` → `components/admin/ui/StatCard.tsx`.
- Reference `README.md` in this bundle for the full spec and the file-map table.

## Prerequisites
- [ ] Branch: `git checkout -b feat/operator-console-redesign`
- [ ] Confirm stack builds clean on `master` first: `npm run build` (and
      `npm run lint` / `npm run test` if present in `package.json`).
- [ ] Note the aliases in use: `@/…` path alias, `cn()` from `lib/utils.ts`.

---

## Phase 0 — Asset + primitives (no UI wired yet)
Goal: land the leaf components and the health helper so later phases just import.

1. Add asset: copy `code/public/logo-white.png` → `public/logo-white.png`.
2. Add NEW files (verbatim from bundle):
   - [ ] `lib/admin/client-health.ts`
   - [ ] `components/admin/ui/HealthRing.tsx`
   - [ ] `components/admin/ui/PhaseStepper.tsx`
   - [ ] `components/admin/ui/StatCard.tsx`
   - [ ] `components/admin/StatusPill.tsx`
   - [ ] `components/admin/PipelineChart.tsx`
   - [ ] `components/admin/AdminTopBar.tsx`
3. **Checkpoint:** `npm run build` — these are self-contained; the app is
   unchanged visually but everything must compile and type-check.
   - `HealthRing`/`StatCard`/`PipelineChart` reference `var(--color-*)` and the
     `SessionsOverview` type — confirm the import path
     `@/lib/audit/report-aggregates` resolves.
- [ ] Commit: `feat(admin): add console UI primitives (StatCard, HealthRing, PhaseStepper, StatusPill, PipelineChart, TopBar) + health heuristic`

## Phase 1 — Shell (sidebar + top bar + layout)
Goal: the dark grouped sidebar and sticky top bar across all `/admin/*` routes.

1. [ ] REPLACE `components/admin/AdminSidebar.tsx` with the bundle version.
   - Verify the `signOut` import path `@/app/admin/dashboard/actions` is correct.
   - New prop `userName?: string` added; `requires` filtering logic is preserved.
2. [ ] REPLACE `app/admin/layout.tsx` with the bundle version (renders
   `AdminTopBar` + passes `userName={user.name ?? undefined}` to both).
   - Confirm `CurrentUser` exposes `name` (it's used on the home page already).
3. **Checkpoint / manual QA:**
   - Sidebar is near-black with white logo; groups **Workspace / Operations /
     Admin** render; active route shows teal fill + left bar; user chip shows
     initials + role; sign-out works.
   - Top bar sticky; breadcrumb title matches the route; nav filtering by
     capability still hides items for non-admins (test with a manager/auditor
     account or by temporarily forcing `isAdmin=false`).
   - Every existing `/admin/*` page still loads (they now sit under the top bar).
- [ ] Commit: `feat(admin): dark grouped sidebar + sticky top bar shell`

## Phase 2 — Onboarding dashboard
Goal: KPI cards, pipeline bar chart, segmented filters, refined table.

1. [ ] REPLACE `app/admin/dashboard/page.tsx` with the bundle version.
   - **Diff-check the data block**: everything from `const supabase =` down to the
     `contentJobBySession` map must be byte-identical to current `master`. Only
     the `return(...)` and the small derived `byStatus`/`inOnboarding` lines are new.
   - The old inline `StatusBadge` helper and the `SessionsFunnelChart` import are
     intentionally gone (replaced by `StatusPill` + `PipelineChart`).
2. [ ] Optional cleanup: if nothing else imports `SessionsFunnelChart`, you may
   delete `components/admin/SessionsFunnelChart.tsx`. Grep first:
   `grep -r SessionsFunnelChart app components`. Leave it if referenced elsewhere.
3. **Checkpoint / manual QA:**
   - KPI values are real (Active = pipeline total, In onboarding = pending+in_progress,
     Ready = approvedCount, AI spend = spend.recent for admins).
   - Pipeline bars decrease left→right; "Approved" bar is near-black.
   - Status filter pills navigate (URL `?status=`), search posts `?q=`.
   - Table: avatar initials, `StatusPill`, `PhaseStepper`, `HealthRing`, inactivity
     flag ≥3d, and `SessionRowActions` all render; row → session detail link works.
   - Pagination unchanged.
- [ ] Commit: `feat(admin): redesign onboarding dashboard (KPIs, pipeline, health table)`

## Phase 3 — Operator home
1. [ ] REPLACE `components/admin/home/StatCards.tsx` (now uses shared `StatCard`).
2. [ ] REPLACE `app/admin/home/page.tsx` (elevated layout; `HomeGreeting` and
   `CommandBox` are reused unchanged; "jump back in" cards use `StatusPill`).
3. **Checkpoint / QA:** greeting + command box work; three workspace cards link
   correctly; recent-client cards hover-lift and link to `/admin/sessions/{id}`.
- [ ] Commit: `feat(admin): elevate operator home (stat cards, jump back in)`

## Phase 4 — Onboarding chat polish (in place, optional)
Do **not** replace `components/chat/ChatInterface.tsx` (stateful AI-SDK wiring).
Apply the class tweaks from README §"Onboarding chat preview" directly:
- [ ] Confirm agent/user bubble + progress-bar classes match the spec
      (most already do via `MessageBubble.tsx`); adjust only if drifted.
- [ ] Commit: `style(chat): align onboarding chat with console tokens` (skip if no diff)

## Phase 5 — Verify & open PR
- [ ] `npm run build` clean; `npm run lint`; `npm run test` (all green).
- [ ] Visual pass at desktop widths; check KPI grid reflow at `md`/`lg`.
- [ ] Accessibility quick pass: keyboard-focus outlines visible (teal), nav is
      reachable, `aria-label`s on icon-only buttons present.
- [ ] Screens to smoke-test: `/admin/home`, `/admin/dashboard` (each status
      filter + a search + a pagination step), `/admin/sessions/[id]`, and one
      capability-restricted account.
- [ ] Open PR `feat/operator-console-redesign`; in the description link the
      README file-map and call out: no data-layer changes, one asset added
      (`logo-white.png`), recharts call site removed.

---

## If the build fails — likely causes
- **Tailwind class not generated**: confirm the token (`brand-navy-deeper`,
  `warning-strong`, `shadow-cyan-glow`, `rounded-badge`) exists in `globals.css`
  `@theme`. All used classes are defined there in the current repo.
- **`rounded-xl` vs `rounded-card`**: the console uses 12px `rounded-xl` (default
  Tailwind). To stay at the system's 8px, swap `rounded-xl` → `rounded-card` in
  `StatCard`, `PipelineChart`, and the dashboard/home cards (README → Design tokens).
- **`user.name` type**: if `CurrentUser.name` is `string | null`, pass
  `user.name ?? undefined` (layout already does this).
- **Logo 404**: ensure `public/logo-white.png` was added (Phase 0.1).

## Out of scope (suggest as follow-ups, don't build unprompted)
- Session-detail (`/admin/sessions/[id]`), content, audits, users pages —
  the prototype shows a detail view; porting it is a separate pass.
- Real (persisted) client-health signal to replace the heuristic.
- Mobile sidebar drawer; dark mode.
