# Divi / WordPress export bridge (temporary)

A **throwaway stop-gap** that exports a client's generated page content into a
WordPress import bundle for the shared **Divi boilerplate** site
(`c5d5.flywheelsites.com`). It exists only to get sites live faster while the
custom Next.js theme pipeline is still the long-term destination. When the theme
pipeline is the norm, **delete this feature** — see removal below.

## What it produces

A downloadable zip (`<site>.wxr` + `<site>-divi-library.json` + `README.txt`):

- **WXR** — every live `content/pages/*.md` rendered to Divi Builder shortcode
  (`content:encoded`, flagged `_et_pb_use_builder=on`), plus the primary nav menu
  (from the repo `nav.json`). Pages import as drafts.
- **Divi Library JSON** — per-client branded Header (with Client Center portals)
  and Footer, for import into the Divi Library + assignment in Theme Builder.
- **README.txt** — operator import steps.

Images are **hot-linked** to stable Pexels CDN URLs (no Media Library upload).

## Source of truth: the live GitHub repo

The export reads the client's **live `draft` branch** (`content/pages/*.md`,
`content/nav.json`, `content/client-center.json`) — the same source as the
editor's "Download doc" — so it always matches what's live, including
post-generation edits. It does **not** read the original `generated_pages` rows.
Blog posts (`content/posts/*`) are excluded (Divi blog template is out of scope).

## How it maps

Page `.md` block annotations (`<!-- block: … -->`) → Divi shortcode shells lifted
from `raw-docs/Divi Builder Layouts.json`:

| Block | Divi output |
|---|---|
| `page-header` / hero frontmatter | `subPageHeader` / gradient `copyImageBlock` |
| `content-split`, `hero-split` | two-column `copyImageBlock` (+ hotlinked image) |
| `feature-grid`, `service-cards`, `industry-cards` | `cardGridBlock` (blurb cards) |
| `cta-banner` | `ctaBlock` |
| `faq-accordion` + `faq_block` column | `accordionBlock` |
| `pricing-plans` + `content/pricing-plans.json` | `pricingTablesBlock` (native `et_pb_pricing_tables` + shared-features/add-ons prose) |
| everything else | `basicContentBlock` (clean styled text — no content dropped) |

## Files

- `markdown.ts` — minimal markdown → Divi-safe HTML (no external dep)
- `sanitize.ts` — URL scheme allowlist + HTML-attribute escaping (XSS guard)
- `blocks.ts` — section parser + Divi shortcode template shells + renderers
- `images.ts` — Pexels query → hotlink URL resolver (dedup, fail-soft)
- `page.ts` — assemble one page's full Divi shortcode (hero + sections + FAQ)
- `from-frontmatter.ts` — live-repo `.md` (frontmatter + body) → `DiviPageInput`
- `wxr.ts` — WordPress WXR (pages + nav menu)
- `library.ts` — per-client Header/Footer Divi Library JSON
- `readme.ts` — the README.txt shipped in the zip
- `index.ts` — `buildDiviExport()` orchestrator (source-neutral) → zip Buffer

Consumed only by:
- `app/api/edit/[id]/export-divi/route.ts` (reads the live repo, sessionId-keyed)
- the "Export to Divi ↓" item in the editor ••• menu
  (`components/editor/EditorTopBar.tsx`)

## Removal (one move)

This feature is fully additive and self-contained — no migrations, no schema
changes, no edits to the existing content pipeline. To remove:

1. `rm -rf lib/content/divi`
2. `rm -rf app/api/edit/[id]/export-divi`
3. In `components/editor/EditorTopBar.tsx`, delete the "Export to Divi ↓" anchor
   in `OverflowMenu`.

Then `npx tsc --noEmit` — a clean compile confirms nothing else depended on it.
