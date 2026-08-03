# Pricing Calculator — cross-repo contract

The interactive pricing calculator spans two repos. This document is the shared
contract; keep the two type definitions in sync.

- **Onboarding** (this repo) captures the config in the admin editor and emits it.
- **Template** (`counting-five-client-template`) renders the interactive component.

## Config shape

Canonical type: `types/pricing-calculator.ts` (`PricingCalculatorConfig`).
Template mirror: `src/lib/content/pricing-calculator-types.ts`.

```jsonc
{
  "version": 1,
  "currency": "USD",
  "billingPeriod": "month",
  "intro": "…",
  "implementationFee": { "amount": 2499, "label": "One-time setup", "weeks": "4-6" }, // or null
  "serviceLines": [ {
    "id": "bookkeeping", "label": "…", "baseRate": 199, "enabledByDefault": false, "description": "…",
    // Optional per-service options — the site shows these when the service is
    // toggled on (accordion). Each selected choice adds `addMonthly` to that
    // service. kind: 'select' (radios, ≤1 chosen) | 'multi' (checkboxes).
    "options": [ { "id": "frequency", "label": "Frequency", "kind": "select",
      "choices": [ { "id": "monthly", "label": "Monthly", "addMonthly": 0 }, { "id": "weekly", "label": "Weekly", "addMonthly": 80 } ] } ]
  } ],
  "sizeTiers":        [ { "id": "solo", "label": "…", "multiplier": 1.0 } ],
  "complexityLevels": [ { "id": "basic", "label": "…", "multiplier": 1.0 } ],
  "addOns": [
    { "id": "multistate", "label": "…", "type": "flat", "flatRate": 75 },
    { "id": "payroll-emp", "label": "…", "type": "per-unit", "unitRate": 8, "unitLabel": "employee" }
  ],
  "estimateBandPct": 15,
  "disclaimer": "…",
  "cta": { "label": "Book a consultation", "url": "/contact" }
}
```

## Formula (computed client-side in the template)

```
serviceMonthly(line) = line.baseRate + Σ(selected option choice.addMonthly)   // options only when the service is on
monthly = Σ(serviceMonthly for selected services) × sizeTier.multiplier × complexity.multiplier
        + Σ(flat addOns) + Σ(per-unit addOn.unitRate × qty)
oneTime = implementationFee.amount   (if implementationFee !== null)
display = monthly shown as a ±estimateBandPct band → "~$X–$Y / month"
```

## Emission (onboarding → client repo)

When a session's `pricing_calculators` row exists AND `enabled`, the package
assembler ships:

- `content/pricing-calculator.json` — the config above
- `content/pages/pricing-calculator.md` — a standalone page with a single
  `<!-- block: pricing-calculator -->` section
- a `/pricing-calculator` entry appended to `content/nav.json`

## Rendering (template)

- `src/lib/content/get-pricing-calculator-config.ts` reads the JSON at build time.
- `pricing-calculator` is registered in `src/components/assembly/block-registry.tsx`.
- `<PricingCalculator>` (server) reads the config; `<PricingCalculatorClient>`
  ('use client') runs the inputs + formula and renders the estimate + CTA.
- The block is config-driven (like `booking`/`contact-info`) and is intentionally
  NOT in the onboarding `block-annotation-validator` catalog, so Claude never
  auto-selects it during content generation.
