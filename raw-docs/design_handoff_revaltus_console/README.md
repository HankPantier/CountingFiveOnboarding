# Handoff: Revaltus Operator Console redesign

## Overview
A UI/UX elevation of the Revaltus admin app — the operator-facing surfaces that
manage the book of CPA-firm onboarding clients. It keeps every existing feature
and data flow; it changes **look & feel, layout, hierarchy, and at-a-glance
data-viz**. Scope of this pass:

- **Shell** — a near-black grouped sidebar + a new sticky top bar (breadcrumb,
  global client search, notifications, avatar).
- **Onboarding dashboard** (`/admin/dashboard`) — KPI cards, a flat on-brand
  pipeline bar chart (replaces the recharts funnel), a segmented status filter,
  and a refined sessions table with per-client **health rings** and **phase
  steppers**.
- **Operator home** (`/admin/home`) — elevated stat cards + "jump back in".

Everything stays inside the Revaltus design tokens (near-black `#231f20` + teal
`#098195`, Inter/Open Sans, pill CTAs, near-black-tinted shadows).

## About the design files
The single HTML file in this bundle — **`Revaltus Console (visual reference).dc.html`**
— is a **design reference prototype**, not production code. It shows the intended
look and behaviour. It renders live inside the design tool project (open it there
for the interactive version); opened standalone it won't fetch its token/asset
links, so treat it as a visual spec.

The **`code/`** folder, by contrast, **is** production code: real Next.js +
Tailwind (v4, `@theme`) React written against your existing conventions
(token utility classes like `bg-brand-navy` / `text-text-secondary`, inline-SVG
icons at `stroke-width:1.8`, server components + `'use client'`, `next/image`,
`next/link`). Files mirror their target repo paths under `code/`.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii, and states are final and map to
your live `globals.css` tokens. Recreate pixel-for-pixel; the `code/` files are
meant to drop in with minimal edits.

## File map — where each file goes
Copy each file to the same path in the repo (drop the `code/` prefix). Files
marked **REPLACE** overwrite an existing file; **NEW** are additions.

| Bundle file | Repo path | Kind |
|---|---|---|
| `code/app/admin/layout.tsx` | `app/admin/layout.tsx` | REPLACE |
| `code/app/admin/dashboard/page.tsx` | `app/admin/dashboard/page.tsx` | REPLACE |
| `code/app/admin/home/page.tsx` | `app/admin/home/page.tsx` | REPLACE |
| `code/components/admin/AdminSidebar.tsx` | `components/admin/AdminSidebar.tsx` | REPLACE |
| `code/components/admin/home/StatCards.tsx` | `components/admin/home/StatCards.tsx` | REPLACE |
| `code/components/admin/AdminTopBar.tsx` | `components/admin/AdminTopBar.tsx` | NEW |
| `code/components/admin/PipelineChart.tsx` | `components/admin/PipelineChart.tsx` | NEW |
| `code/components/admin/StatusPill.tsx` | `components/admin/StatusPill.tsx` | NEW |
| `code/components/admin/ui/StatCard.tsx` | `components/admin/ui/StatCard.tsx` | NEW |
| `code/components/admin/ui/HealthRing.tsx` | `components/admin/ui/HealthRing.tsx` | NEW |
| `code/components/admin/ui/PhaseStepper.tsx` | `components/admin/ui/PhaseStepper.tsx` | NEW |
| `code/lib/admin/client-health.ts` | `lib/admin/client-health.ts` | NEW |
| `code/public/logo-white.png` | `public/logo-white.png` | NEW asset |

**No new dependencies.** In fact this **removes** a dependency at the call site:
`SessionsFunnelChart` (recharts) is no longer used by the dashboard. You can keep
the file or delete it if nothing else imports it.

## Integration steps
1. Add `public/logo-white.png` (bundled) — the dark sidebar needs the reversed
   wordmark. The repo currently only ships the color `public/logo.png`.
2. Drop in the NEW components and `lib/admin/client-health.ts`.
3. Replace `AdminSidebar.tsx`, `app/admin/layout.tsx`, `app/admin/home/page.tsx`,
   `app/admin/dashboard/page.tsx`, and `components/admin/home/StatCards.tsx`.
4. Build. The dashboard/home data-fetching code is **unchanged** — only the
   returned JSX and the sidebar/topbar chrome differ.

## Screens / views

### 1. App shell (`layout.tsx` + `AdminSidebar` + `AdminTopBar`)
- **Sidebar**: fixed `w-64`, `bg-brand-navy-deeper` (#1A1718). White reversed
  logo top-left. Nav is grouped under uppercase labels **Workspace / Operations
  / Admin** (`text-white/35`, `text-[10px]`, `tracking-[0.11em]`). Rows:
  `rounded-[10px]`, `text-[13.5px]`, inactive `text-white/65` → hover
  `bg-white/[0.07] text-white`; active `bg-brand-cyan/15 text-white` with a 3px
  teal left bar. Bottom: user chip (teal initials avatar, name, "Admin"/"Team",
  sign-out icon-button wired to the existing `signOut` server action).
  The `requires`-based visibility filtering (`any`/`manager`/`auditor`/`admin`)
  is preserved exactly; a new `userName?: string` prop feeds the chip.
- **Top bar**: sticky, `h-16`, white, bottom border. Left: `Console › <Title>`
  breadcrumb (title derived from the route via `usePathname`). Right: a client
  search (`<form action="/admin/dashboard">`, field `name="q"` — matches the
  dashboard's existing search param), a notifications bell (teal dot) linking to
  `/admin/account`, and the avatar. Rendered once in the layout.

### 2. Onboarding dashboard (`/admin/dashboard`)
- **Header**: h1 "Onboarding" (`font-heading` 27px bold), subtitle with counts;
  admin-only teal pill **New session** CTA (hover: darker teal + `-translate-y-px`
  + `shadow-cyan-glow`).
- **KPI row**: up to 4 `StatCard`s — Active sessions, In onboarding, Ready for
  content (teal-toned, links to `/admin/content`), and AI spend · 30d (admin
  only). All values are derived from data the page already fetches (`pipeline`,
  `approvedCount`, `spend.recent`) — **no new queries, no fabricated numbers.**
- **Pipeline**: `PipelineChart` — a flat bar chart over phases 1–7 (Contact →
  Approved), teal bars with the final "Approved" bar in near-black. Consumes the
  same `SessionsOverview` from `sessionsOverview()`.
- **Filters**: segmented pill control (Active/Pending/In progress/Completed/
  Approved) — active = `bg-brand-navy text-text-inverse` — plus the existing
  search input. Uses the same `filterHref()` links as before.
- **Table**: `rounded-xl` card, neutral `#FBFCFD` header (replaces the old teal
  header), rows hover `bg-surface-subtle`. Columns:
  - **Client** — tinted-initials avatar + `website_url` (links to
    `/admin/sessions/{id}`) + short id.
  - **Status** — `StatusPill`.
  - **Phase** — "Phase N · <stage>" label + `PhaseStepper` (7 segments).
  - **Health** — `HealthRing` (see Design tokens → Client health).
  - **Last active** — `timeAgo()` (unchanged helper).
  - **Inactive** — `Nd`, `text-warning-strong` when ≥ 3 days.
  - **Actions** — the existing `SessionRowActions` component, untouched.
- **Pagination**: unchanged.

### 3. Operator home (`/admin/home`)
- Centered hero: `HomeGreeting` (unchanged) + `CommandBox` (unchanged) + quick
  actions (first = solid navy, rest = outline).
- "Your workspace": `StatCards` rewritten to use the shared `StatCard`
  (Active audits / In onboarding / Live client sites).
- "Jump back in": `rounded-xl` client cards with a `StatusPill`, hover lift.

### 4. Onboarding chat preview (reference only)
The prototype includes the client-facing chat as an operator preview. The live
`components/chat/ChatInterface.tsx` is already very close to the target and is
stateful (AI SDK). Rather than risk the streaming wiring, apply these targeted
class tweaks in place instead of replacing the file:
- Header: keep the white bar; the color logo (`/logo.png`) is correct here (light
  background). Progress bar stays `bg-brand-cyan` on a `bg-border-default` track.
- Agent bubble: `bg-surface-card border border-border-default shadow-subtle`,
  `rounded-2xl` (or `rounded-[4px_16px_16px_16px]` to match the prototype's
  asymmetric corner). User bubble: `bg-brand-navy text-text-inverse`.
- These already match `MessageBubble.tsx`; no functional change needed.

## Interactions & behavior
- **Nav / breadcrumb**: driven by `usePathname`; active row + top-bar title update
  on navigation. No client state beyond that.
- **Filters & search**: server-driven via URL params (existing behaviour kept).
- **Hover/press**: teal CTA → `bg-brand-cyan-dark` + `-translate-y-px` +
  `shadow-cyan-glow`; cards → `hover:border-brand-cyan hover:shadow-medium`
  (+ slight lift on home/jump-back-in); rows → `bg-surface-subtle`.
- **Focus**: inherits the global `:focus-visible` teal outline from `globals.css`.
- **Transitions**: `transition-all` / `transition-colors` (~150ms), matching the
  design system's "quick and functional" motion rule. No looping/decorative motion.
- **Responsive**: KPI grid `grid-cols-2 lg:grid-cols-4`; top-bar search hidden
  below `md`. The sidebar is fixed-width (add a mobile drawer later if needed).

## State management
No new global state. `AdminSidebar` and `AdminTopBar` are client components that
read `usePathname()` only. All list/filter/pagination state remains in URL search
params handled by the existing server components.

## Design tokens
All values come from the live `app/globals.css` `@theme` block — **do not
hardcode hex**. Utilities used:
- **Color**: `brand-navy` #231f20, `brand-navy-dark` #3A3436, `brand-navy-deeper`
  #1A1718, `brand-cyan` #098195, `brand-cyan-dark` #076B7C, `brand-purple`
  #6B2956; `surface-page` #F8FAFC, `surface-card` #fff, `surface-subtle` #F1F5F9;
  `border-default` #E2E8F0; `text-primary/secondary/muted/inverse`; `success`
  #076B7C, `warning-strong` #92400E, `error` #6B2956. Opacity tints via `/10`,
  `/15`. SVG stroke/fill via the matching `var(--color-*)` custom properties.
- **Radius**: `rounded-pill` (40px) for buttons/chips/inputs; `rounded-badge`
  (100px) for status pills; **`rounded-xl` (12px)** for cards. *Token note:* this
  is a deliberate, small refinement — the design system's card radius is 8px
  (`rounded-card`); the console uses 12px (`rounded-xl`) for a calmer, more modern
  feel. If you'd rather keep everything at 8px, swap `rounded-xl` → `rounded-card`
  in `StatCard`, `PipelineChart`, and the table/home cards.
- **Shadow**: `shadow-subtle` (cards), `shadow-medium` (hover/elevated),
  `shadow-cyan-base` / `shadow-cyan-glow` (primary CTA rest/hover).
- **Type**: `font-heading` (Inter) for headings/labels/UI; `font-body`
  (Open Sans) for body/table cells. Weights 600–700 for headings.
- **Client health** (`lib/admin/client-health.ts`): a **v1 heuristic**, 0–100,
  derived from `current_phase` (55%), recency of `last_activity_at` (45%), minus a
  small `reminder_count` penalty. It is **not persisted** and is not a real
  engagement metric yet — it exists so the dashboard can flag stalling clients.
  Replace the formula with a real signal when available, but keep the 0–100 range
  and the good/warn/risk bands (≥80 / ≥60 / <60 → teal / amber / plum) so
  `HealthRing` keeps working.

## Assets
- `public/logo-white.png` — reversed white wordmark for the dark sidebar
  (bundled; sourced from the Revaltus design system). Swap in an official
  reversed logo if one exists.
- `public/logo.png` — existing color wordmark, still used on the light chat header.
- All icons are inline SVG (no icon library), matching the existing
  Feather/Lucide-style monoline convention (`stroke-width:1.8`, round caps).

## Files in this bundle
- `Revaltus Console (visual reference).dc.html` — the interactive design prototype.
- `code/**` — production React/Tailwind, mirroring repo paths (see file map).
