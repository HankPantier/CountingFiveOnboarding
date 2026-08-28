# Pricing Plans — cross-repo contract

The static plans/pricing page (`/pricing`) spans two repos. This document is the
shared contract; keep the two type definitions in sync. It is the tier-card
counterpart to the interactive pricing calculator (`/pricing-calculator`, see
`docs/pricing-calculator-contract.md`); a session may ship both.

- **Onboarding** (this repo) captures the config in the admin editor and emits it.
- **Template** (`counting-five-client-template`) renders the static component.

## Config shape

Canonical type: `types/pricing-plans.ts` (`PricingPlansConfig`).
Template mirror: `src/lib/content/pricing-plans-types.ts`.

```jsonc
{
  "version": 1,
  "currency": "USD",
  "intro": "…",
  "billing": {
    "showToggle": true,
    "defaultCadence": "monthly",   // or "annual"
    "annualDiscountPct": 15,        // drives the "Save X%" label; prices are stored pre-discounted
    "monthlyLabel": "Monthly",
    "annualLabel": "Annual"
  },
  "tiers": [ {
    "id": "growth", "name": "Growth", "description": "…",
    "monthlyPrice": 599,           // per-month at monthly cadence
    "annualPrice": 509,            // per-month when billed annually (already discounted)
    "priceSuffix": "/mo",          // or "Custom" for a quote-only tier (hides the number)
    "isMostPopular": true,          // at most ONE tier true (enforced server-side)
    "features": [ { "id": "bookkeeping", "label": "Monthly bookkeeping", "included": true } ],
    "cta": { "label": "Get started", "url": "/contact" }
  } ],
  "sharedFeatures": { "heading": "All plans include", "items": [ "…" ] },
  "addOns": [
    { "id": "payroll", "label": "Payroll", "type": "flat", "price": 99, "cadence": "month" },
    { "id": "extra", "label": "…", "type": "per-unit", "unitPrice": 8, "unitLabel": "employee" }
  ],
  "disclaimer": "…",
  "cta": { "label": "Book a consultation", "url": "/contact" }
}
```

## Behavior (rendered client-side in the template)

- The billing toggle swaps each tier's displayed price between `monthlyPrice` and
  `annualPrice` — there is no client-side math (prices are stored pre-discounted).
- The `isMostPopular` tier is visually highlighted with a "Most popular" badge.
- `features` with `included: false` render struck-through / greyed so a lower tier
  can show what it lacks versus higher tiers.

## Emission (onboarding → client repo)

The plans page ships when a session's `pricing_plans` row exists AND `enabled`,
OR — absent a row — when `business.pricingPagePreference` is `plans` or `both`.
An explicit editor row always overrides the preference.

When no editor row exists yet, the shipped config (and the config the admin
editor opens with) is built **from the pricing the initial audit captured on the
client's current site** — `_meta.audit_context.pricing` → tier cards, via
`buildPlansConfigFromAudit` in `lib/content/pricing-from-audit.ts` (deterministic,
no AI). It falls back to the generic `DEFAULT_PLANS_CONFIG` only when the audit
found no pricing. The operator can always override/edit, or run "Draft with AI"
for a richer draft (also anchored on the same captured pricing). The calculator
mirrors this via `buildCalculatorConfigFromAudit` (captured per-service rates →
service lines).

The package assembler emits:

- `content/pricing-plans.json` — the config above
- `content/pages/pricing.md` — a standalone page with a single
  `<!-- block: pricing-plans -->` section
- a `/pricing` entry appended to `content/nav.json`

The assembler skips the plans page if a generated page already owns `/pricing`.

For already-published clients, `lib/content/pricing-plans-repo-sync.ts`
(`syncPricingPlansToRepo`) pushes the same three artifacts to the draft branch on
save, and the operator publishes via the content editor.

### Adding a pricing page to a live client after the fact

There are two entry points from the content editor
(`/admin/content/[id]/edit`), both staff-only (hidden and 403'd for Site Owners):

- **New page dialog** → "Page type" → *Pricing plans page* / *Pricing calculator
  page*. This `POST`s `/api/edit/[id]/create-pricing-page` `{kind}`, which enables
  the config (reusing an existing DB row / repo file, else AI-seeding from the
  firm's pricing + audit-captured pricing), pushes it to the draft branch, and
  drops the operator into the pricing editor to refine the numbers.
- **••• overflow menu** → "Add / edit pricing plans →" / "Add / edit pricing
  calculator →" — opens the same editor directly.

The editor flow either way:

1. Open the editor from the menu — it loads pre-populated from the DB row, the
   repo file, or the audit-captured base (falling back to the default).
2. "Draft with AI" and/or edit the tiers/numbers, tick **enabled**, and **Save** —
   for a published client this pushes `pricing-plans.json` + `pricing.md` + the
   `/pricing` nav entry to the draft branch (`syncPricingPlansToRepo`).
3. Back in the editor, **Publish to live** deploys it.

Disabling + Save removes the three artifacts and the nav entry from the draft.

## Rendering (template)

- `src/lib/content/get-pricing-plans-config.ts` reads the JSON at build time.
- `pricing-plans` is registered in `src/components/assembly/block-registry.tsx`.
- `<PricingPlans>` (server) reads the config; `<PricingPlansClient>` ('use client')
  runs the billing toggle and renders the tier cards, "all plans include" list,
  and add-ons.
- The block is config-driven (like `pricing-calculator`/`booking`) and is
  intentionally NOT in the onboarding `block-annotation-validator` catalog, so
  Claude never auto-selects it during content generation.

## Divi export

`lib/content/divi/` reads `content/pricing-plans.json` and maps the tiers to a
native `et_pb_pricing_tables` module (`pricingTablesBlock`), with the shared
features + add-ons rendered as a styled prose block beneath.
