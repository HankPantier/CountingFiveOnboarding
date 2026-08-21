# Divi / WordPress export bridge (temporary)

A **throwaway stop-gap** that exports a client's generated page content into a
WordPress import bundle for the shared **Divi boilerplate** site
(`c5d5.flywheelsites.com`). It exists only to get sites live faster while the
custom Next.js theme pipeline is still the long-term destination. When the theme
pipeline is the norm, **delete this feature** — see removal below.

## What it produces

A downloadable zip (`<site>.wxr` + `<site>-divi-library.json` + `README.txt`):

- **WXR** — every `generation_status='complete'` page rendered to Divi Builder
  shortcode (`content:encoded`, flagged `_et_pb_use_builder=on`), plus the
  primary nav menu built from the confirmed sitemap. Pages import as drafts.
- **Divi Library JSON** — per-client branded Header (with Client Center portals)
  and Footer, for import into the Divi Library + assignment in Theme Builder.
- **README.txt** — operator import steps.

Images are **hot-linked** to stable Pexels CDN URLs (no Media Library upload).

## How it maps

`generated_pages.content_markdown` block annotations (`<!-- block: … -->`) →
Divi shortcode shells lifted from `raw-docs/Divi Builder Layouts.json`:

| Block | Divi output |
|---|---|
| `page-header` / hero frontmatter | `subPageHeader` / gradient `copyImageBlock` |
| `content-split`, `hero-split` | two-column `copyImageBlock` (+ hotlinked image) |
| `feature-grid`, `service-cards`, `industry-cards` | `cardGridBlock` (blurb cards) |
| `cta-banner` | `ctaBlock` |
| `faq-accordion` + `faq_block` column | `accordionBlock` |
| everything else | `basicContentBlock` (clean styled text — no content dropped) |

## Files

- `markdown.ts` — minimal markdown → Divi-safe HTML (no external dep)
- `blocks.ts` — section parser + Divi shortcode template shells + renderers
- `images.ts` — Pexels query → hotlink URL resolver (dedup, fail-soft)
- `page.ts` — assemble one page's full Divi shortcode (hero + sections + FAQ)
- `wxr.ts` — WordPress WXR (pages + nav menu)
- `library.ts` — per-client Header/Footer Divi Library JSON
- `readme.ts` — the README.txt shipped in the zip
- `index.ts` — `buildDiviExport()` orchestrator → zip Buffer

Consumed only by:
- `app/api/content-jobs/[id]/export-divi/route.ts`
- `components/content/DiviExportButton.tsx` (rendered in `app/admin/content/[id]/page.tsx`)

## Removal (one move)

This feature is fully additive and self-contained — no migrations, no schema
changes, no edits to the existing content pipeline. To remove:

1. `rm -rf lib/content/divi`
2. `rm -rf app/api/content-jobs/[id]/export-divi`
3. `rm components/content/DiviExportButton.tsx`
4. In `app/admin/content/[id]/page.tsx`, delete the `DiviExportButton` import and
   the "WordPress / Divi export" card block.

Then `npx tsc --noEmit` — a clean compile confirms nothing else depended on it.
