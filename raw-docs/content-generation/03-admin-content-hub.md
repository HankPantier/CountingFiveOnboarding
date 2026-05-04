# Step 03 — Admin Content Hub

Build the `/admin/content` hub page and the `/admin/content/[id]` phased workflow shell. This step is UI scaffolding only — no generation logic yet. Each phase gets a placeholder that will be filled in subsequent steps.

---

## What We're Building

Two new admin routes. The hub shows all approved sessions with their content generation phase status. The per-session route shows the phased workflow with phase cards the admin moves through sequentially.

---

## Routes

### `/admin/content` — Hub Page

Server component. Queries:
- All sessions with `status = 'approved'`
- Left-joins `content_jobs` to get current phase per session

Displays a table with columns:
- Firm name / website URL
- Session approved date
- Content generation phase (badge: Not Started / Palette / Sitemap / Research / Outlines / Generating / Complete)
- Action button: "Start" (if not started) or "Continue →" (if in progress) or "Download" (if complete)

Add a link to this page from:
- The admin dashboard (`/admin/dashboard`) — a count badge next to "Sessions" heading: "X ready for content generation"
- The session detail page (`/admin/sessions/[id]`) — a "Begin Content Generation →" CTA button that appears when `session.status === 'approved'`

### `/admin/content/[id]` — Per-Session Workflow

Server component shell that loads the session and its `content_job` (creates one if it doesn't exist). Renders a vertical phase stepper with 6 phase cards:

```
● Phase 1 — Color Palette          [active / complete / locked]
● Phase 2 — Sitemap Confirm        [locked until Phase 1 complete]
● Phase 3 — Research               [locked until Phase 2 complete]
● Phase 4 — Outline Review         [locked until Phase 3 complete]
● Phase 5 — Content Generation     [locked until Phase 4 complete]
● Phase 6 — Deliverables           [locked until Phase 5 complete]
```

Each phase card shows:
- Phase number + name
- Status badge (Not Started / In Progress / Awaiting Review / Complete / Error)
- A content area (placeholder `<div>` for now — filled in subsequent steps)
- "Continue" or "Complete Phase" button (disabled if locked)

---

## Phase Status Logic

```typescript
type PhaseStatus = 'locked' | 'active' | 'awaiting_review' | 'complete' | 'error'

function getPhaseStatus(jobPhase: number, thisPhase: number): PhaseStatus {
  if (thisPhase > jobPhase + 1) return 'locked'
  if (thisPhase < jobPhase) return 'complete'
  if (thisPhase === jobPhase) return 'active'
  // thisPhase === jobPhase + 1 means it just became available
  return 'active'
}
```

---

## Files to Create

```
app/
  admin/
    content/
      page.tsx          — hub listing page (server component)
      [id]/
        page.tsx        — per-session phased workflow shell (server component)
        layout.tsx      — optional: shared header with session info
components/
  content/
    PhaseCard.tsx       — reusable phase card component
    PhaseStepper.tsx    — vertical stepper wrapper
    PhaseStatusBadge.tsx
```

---

## Design Notes

Follow the existing design system exactly:
- Phase card: `bg-surface-card border border-border-default rounded-lg shadow-subtle`
- Active phase: left border accent in `brand-cyan`
- Locked phase: reduced opacity `opacity-50`, cursor-not-allowed on button
- Complete phase: checkmark icon, `text-green-600`
- Phase number badge: `bg-brand-navy text-white` pill

---

## Test Process

1. Navigate to `/admin/content` — confirm all approved sessions appear with correct phase badges
2. Click "Start" on a session — confirm `/admin/content/[id]` loads with Phase 1 active, all others locked
3. Confirm the "Begin Content Generation →" button appears on the session detail page for approved sessions
4. Confirm the dashboard shows a count of sessions ready for content generation
5. Run `npx tsc --noEmit` — zero errors
