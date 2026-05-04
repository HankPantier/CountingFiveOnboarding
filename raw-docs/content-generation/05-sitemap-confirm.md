# Step 05 — Sitemap Confirmation (Phase 2)

Build the admin sitemap review and confirmation UI. The proposed sitemap parsed from Section 10B is loaded, the admin edits it, and the confirmed list locks in as the source of truth for all subsequent phases.

---

## What We're Building

A drag-reorderable page list UI where the admin can add, remove, rename, and reorder pages from the proposed sitemap before content generation begins. The confirmed list is saved to `content_jobs.confirmed_sitemap`.

---

## Data Source

The proposed sitemap comes from `session.schema_data.proposed_sitemap` — populated by the Section 10B parser built in Step 01. Load it server-side when Phase 2 card renders.

Each page in the list:
```typescript
{
  url: string       // e.g. /services/virtual-cfo-advisory
  title: string     // e.g. Advisory & Virtual CFO
  status: 'new' | 'update' | 'existing'
  parent?: string
  notes?: string
}
```

---

## Sitemap Confirm UI (Phase 2 Card)

Client component. Displays pages in a grouped list by parent section (About, Services, Industries, etc.).

Per page row:
- Status badge (🆕 New / 📈 Update / ✅ Existing) — read-only, derived from MFP
- Page title (editable inline text input)
- URL slug (editable inline text input)
- Remove button (× icon)
- Drag handle for reordering within section

Section headers are collapsible. An "Add Page" button at the bottom of each section adds a blank row.

**Page count summary** at top: "23 pages — 8 new · 12 updates · 3 existing"

**Estimated generation cost note** (informational): "Approximately X API calls · Est. $Y at current rates" — rough calculation based on page count × average tokens. This is advisory only.

"Confirm Sitemap & Continue" button:
- Validates: at least 1 page in the list, all pages have a title and URL
- Saves confirmed list to `content_jobs.confirmed_sitemap`
- Inserts a `research_results` row for each page with `research_status = 'pending'`
- Inserts a `page_outlines` row for each page
- Inserts a `generated_pages` row for each page
- Advances `content_jobs.phase` to `3`
- Triggers the research pipeline (Step 06) as a background job

---

## API Routes

```
GET  /api/content-jobs/[id]/sitemap   — load confirmed or proposed sitemap
POST /api/content-jobs/[id]/sitemap   — save confirmed sitemap, seed child tables, trigger research
```

---

## Files to Create

```
app/
  api/
    content-jobs/
      [id]/
        sitemap/
          route.ts          — GET + POST sitemap endpoint
components/
  content/
    SitemapPhase.tsx        — Phase 2 card content (client component)
    SitemapPageRow.tsx      — individual editable page row
    SitemapSection.tsx      — collapsible section group
```

---

## Design Notes

- Status badges: 🆕 `bg-blue-50 text-blue-700` / 📈 `bg-amber-50 text-amber-700` / ✅ `bg-green-50 text-green-700`
- Drag-and-drop: use `@dnd-kit/core` (lightweight, accessible) — add to dependencies
- URL slug inputs should auto-format on blur: lowercase, hyphens, leading slash

---

## Test Process

1. Load Phase 2 card — confirm all pages from `proposed_sitemap` appear grouped by section
2. Edit a page title inline — confirm it updates without a full reload
3. Remove a page — confirm it disappears from the list
4. Add a new page — confirm it appears as a blank row ready to edit
5. Click "Confirm Sitemap" — confirm `content_jobs.confirmed_sitemap` is saved, `research_results` rows are created for each page, phase advances to 3
6. Run `npx tsc --noEmit` — zero errors
