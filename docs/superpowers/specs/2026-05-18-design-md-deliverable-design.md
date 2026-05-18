# Design Spec — Add `design.md` to the Deliverable Package

**Date:** 2026-05-18
**Author:** brainstorming session with Hank Pantier
**Status:** Approved by user, ready for implementation plan
**Implements against:** [google-labs-code/design.md](https://github.com/google-labs-code/design.md) spec (alpha)

---

## Background

The content generation pipeline currently produces a `brand.md` deliverable: a
narrative brand brief (Identity, Positioning, Industries, Brand Voice) generated
by `lib/content/brand-doc-builder.ts`. It is consumed by LLM crawlers — its
summary feeds `llms.txt` and the full doc feeds `llms-full.txt`.

The pipeline already extracts a 6-swatch palette from the client's logo in admin
Phase 1, but no other design-system data is captured. A coding agent picking up
the deliverable has no machine-readable understanding of the visual identity:
no fonts, no rounding, no spacing, no component tokens.

## Goal

Add a spec-compliant `design.md` file to the deliverable package so a coding
agent can build the actual website. Keep `brand.md` for crawler/identity content,
trim the overlap, and collect the additional design-system data in the existing
admin pipeline (not in the 5–7 minute client onboarding session).

---

## Non-Goals

- Not extending the client onboarding session with new visual-design questions
  (would push past the 5–7 minute target).
- Not replacing `brand.md`.
- Not collecting commercial fonts — Google Fonts only.
- Not building a runtime preview of the generated design.md.
- Not adding a deliverable-edit UI.

---

## Decisions

| # | Decision | Reasoning |
|---|---|---|
| 1 | Consumer of `design.md` is a coding agent | Target full spec fidelity: valid YAML, canonical sections, token references. |
| 2 | Strict split: `brand.md` = narrative, `design.md` = visual system | Zero overlap. Move "Brand Voice" out of brand.md. |
| 3 | New design tokens collected in admin pipeline Phase 1 | Zero client-session impact. Admin already locks the palette there; extending that step is natural. |
| 4 | Components scope = core marketing-site set | button-primary/-secondary, card, link, badge, hero, footer. Enough for the agent to build a CPA marketing site, not so much it bloats the file. |
| 5 | Type pairing = curated catalog of 15, auto-suggested from brand inputs, admin can override | Big enough that sites don't look identical; small enough to be vetted. Auto-suggest gives every job a defensible starting point. |
| 6 | `design.md` builder is fully deterministic — no LLM call | Output is structured data, not creative prose. Mirrors `robots.txt` / `sitemap.xml` / `llms.txt`. Cheaper, faster, fully testable. |
| 7 | One small onboarding tweak: opportunistic capture of `brand.brandPersonality` and `brand.voiceExample` | Both fields already exist in the schema. Tweak is a prompt-instruction line — no new questions, zero session-time impact. |

---

## Architecture

### Data flow at package time

```
palette          ─┐
design_tokens    ─┼─→  buildDesignMd()  ─→  design.md  ─→  zip
schema.brand            ─┤
schema.business.name    ─┘
```

`buildDesignMd()` is invoked from `app/api/content-jobs/[id]/package/route.ts`
alongside the existing builders. Output is written to the zip as
`{folderName}/design.md`.

### `brand.md` continues to feed crawlers

No change to `llms.txt` / `llms-full.txt` plumbing. `brand-doc-builder.ts` is
edited to drop the Brand Voice section but its outputs (`summary`, `fullDoc`)
still feed the existing llms-builder calls.

---

## Data model changes

### New TypeScript type — `types/design-tokens.ts`

```ts
export type DesignTokens = {
  typePairing: {
    id: string         // matches a TypePairing.id in the catalog
    headingFont: string
    bodyFont: string
    label: string
  }
  roundness: 'sharp' | 'soft' | 'pill'
  density: 'tight' | 'balanced' | 'airy'
  visualFeel: 'classic' | 'modern' | 'editorial'
}
```

### Migration — `supabase/007_design_tokens.sql`

```sql
ALTER TABLE content_jobs
  ADD COLUMN design_tokens JSONB;
```

No backfill. Phase-1 admin UI computes defaults on first visit; the column
stays null until the admin clicks "Lock Design System."

### Schema additions

None. `brand.brandPersonality` and `brand.voiceExample` already exist on
`SessionSchema`.

---

## `design.md` output template

The builder produces the following structure. Every value is derived
deterministically (see Derivation Rules below).

````md
<!-- Fonts: <googleFontsUrl from selected TypePairing> -->
---
version: alpha
name: "<business.name>"
description: "Design system for the <business.name> website rebuild."
colors:
  primary: "<palette.primary.hex>"
  secondary: "<palette.secondary.hex>"
  complementary: "<palette.complementary.hex>"
  action: "<palette.action.hex>"
  near-black: "<palette.nearBlack.hex>"
  near-white: "<palette.nearWhite.hex>"
  on-action: "<wcag-computed contrast color>"
  on-primary: "<wcag-computed contrast color>"
typography:
  h1:    { fontFamily: <headingFont>, fontSize: 3rem,     fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.02em" }
  h2:    { fontFamily: <headingFont>, fontSize: 2rem,     fontWeight: 700, lineHeight: 1.2 }
  body-md: { fontFamily: <bodyFont>,  fontSize: 1rem,     lineHeight: 1.6 }
  body-sm: { fontFamily: <bodyFont>,  fontSize: 0.875rem }
  label-caps: { fontFamily: <headingFont>, fontSize: 0.75rem, letterSpacing: "0.08em" }
rounded:
  none: 0px
  sm:   4px
  md:   8px
  lg:   16px
  pill: <4px | 8px | 9999px>   # swapped by roundness choice
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: <density-swapped>        # 32 | 48 | 64
  2xl: <density-swapped>       # 64 | 96 | 128
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
    typography: "{typography.label-caps}"
    rounded: "{rounded.pill}"
    padding: "12px 24px"
  button-primary-hover:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.near-white}"
  button-secondary:
    backgroundColor: "{colors.near-white}"
    textColor: "{colors.primary}"
    rounded: "{rounded.pill}"
    padding: "12px 24px"
  card:
    backgroundColor: "{colors.near-white}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"
  link:
    textColor: "{colors.action}"
  badge:
    backgroundColor: "{colors.complementary}"
    textColor: "{colors.near-white}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  hero:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.near-white}"
    padding: "{spacing.2xl} {spacing.lg}"
  footer:
    backgroundColor: "{colors.near-black}"
    textColor: "{colors.near-white}"
---

## Overview
<templated narrative — see Derivation Rules below>

## Colors
<templated rationale referencing primary/action/complementary roles>

## Typography
<templated rationale referencing the chosen pairing's feel>

## Layout
<templated rationale referencing density choice>

## Elevation & Depth
<navy-tinted shadow rule, deterministic — no client variability>

## Shapes
<templated rationale referencing roundness choice>

## Components
<templated paragraph summarizing the component token block above>

## Do's and Don'ts
**Do**
- Use the action color for one CTA per screen
- <feel-specific do rule>
- Pair CTAs against high-contrast backgrounds

**Don't**
- Don't put the action color on the primary background
- Don't use generic black shadows
- Don't introduce a third heading font
- <if brand.toneToAvoid is non-empty>
  Don't use words from the firm's avoid list: <quoted comma-separated list>
````

### Derivation rules

**Colors block**
- `primary`/`secondary`/`complementary`/`action`/`near-black`/`near-white` → copied from `content_jobs.palette` (already 6 swatches with hex + name).
- `on-action`, `on-primary` → computed using `chroma-js`. Pick whichever of `near-white` or `near-black` yields WCAG AA contrast (≥ 4.5) against the base. Fallback `near-white` if both pass.

**Typography block**
- `fontFamily` → looked up via `TypePairing.id` from `lib/content/type-pairing-catalog.ts`.
- Sizes, weights, line-heights, letter-spacing → fixed scale (no variability across jobs).
- Top-of-file `<!-- Fonts: ... -->` comment uses the pairing's `googleFontsUrl`.

**Rounded block**
- `none`/`sm`/`md`/`lg` → fixed scale.
- `pill` value → `4px` (sharp), `8px` (soft), `9999px` (pill).
- Components always reference `{rounded.pill}` regardless of the choice — only the *value* of `rounded.pill` changes. Coding agent sees consistent token references; visual outcome differs by token value.

**Spacing block**
- `xs`/`sm`/`md`/`lg` → fixed scale.
- `xl` → `32px` (tight), `48px` (balanced), `64px` (airy).
- `2xl` → `64px` (tight), `96px` (balanced), `128px` (airy).

**Components block** → entirely static. The 8 component tokens reference upstream
tokens, so visual outcomes vary with palette/rounded/spacing without any
component-level branching.

**Overview narrative** → templated string interpolating:
- `business.name`, first `locations[0].city/state` if present, `business.foundingYear` if present
- `brand.aspirationalTone` ("should feel **<aspirationalTone>**") with fallback if empty
- `brand.brandPersonality` woven in if present
- One sentence describing the visual direction based on `visualFeel`

**Colors rationale** → templated, references `palette.primary.name` and
`palette.action.name`, mentions the complementary as a reserved accent.

**Typography rationale** → templated, picks one of four feel-specific blurbs
keyed off the catalog entry's `feel`.

**Layout rationale** → templated, references the chosen `density`. Container
max-width fixed at `1200px`.

**Elevation & Depth** → fully static. Always navy-tinted shadows
(`rgba(0, 59, 113, ...)`). No client variability.

**Shapes rationale** → templated paragraph keyed off `roundness` choice.

**Components rationale** → static descriptive paragraph summarizing the token
block.

**Do's and Don'ts** → mostly static. The dynamic Don'ts entry appends the
`brand.toneToAvoid` array as a comma-separated quoted list, only when non-empty.

---

## `brand-doc-builder.ts` changes

### `compileBrandDoc()` (deterministic fallback)
- Remove the `voiceParts` block (lines 58–65 in the current file).
- Remove the `## Brand Voice` section assembly (line 72).

### `generateBrandDoc()` (LLM call)
- Update prompt's section list to: `## Identity, ## Positioning & Differentiation, ## Industries Served (one H3 per niche)`.
- Drop the "Mirror the firm's own tone in voice" rule.
- Target length: 600–1000 words (down from 800–1500).

### No changes
- `brand.summary` (feeds `llms.txt`) — already positioning-focused, doesn't mention voice.
- `llms-builder.ts` — embeds the trimmed `brand.fullDoc` unchanged.

---

## Type-pairing catalog — `lib/content/type-pairing-catalog.ts`

```ts
export type TypePairing = {
  id: string
  label: string
  feel: 'classic' | 'modern' | 'editorial' | 'warm'
  headingFont: string
  bodyFont: string
  description: string
  googleFontsUrl: string
}
```

Weights/sizes are not stored on the pairing — they're part of the fixed
typography scale applied uniformly in `buildDesignMd()`. Only font family
varies per pairing.

15 pairings across 4 feels:

| ID | Label | Feel | Heading | Body |
|---|---|---|---|---|
| modern-sans | Modern Sans | modern | Inter | Inter |
| geometric-pro | Geometric Pro | modern | Manrope | Manrope |
| civic-modern | Civic Modern | modern | Public Sans | Public Sans |
| corporate-clean | Corporate Clean | modern | Plus Jakarta Sans | Plus Jakarta Sans |
| classic-editorial | Classic Editorial | editorial | Source Serif 4 | Source Sans 3 |
| civic-editorial | Civic Editorial | editorial | IBM Plex Serif | IBM Plex Sans |
| refined-modern | Refined Modern | editorial | Fraunces | Inter |
| journal | Journal | editorial | Lora | Inter |
| heritage | Heritage | classic | Playfair Display | Source Sans 3 |
| traditional-pro | Traditional Pro | classic | Merriweather | Open Sans |
| legal-pad | Legal Pad | classic | Libre Caslon Text | Libre Franklin |
| warm-approachable | Warm Approachable | warm | Nunito | Nunito |
| friendly-rounded | Friendly Rounded | warm | DM Sans | DM Sans |
| warm-editorial | Warm Editorial | warm | DM Serif Display | Nunito Sans |
| humanist | Humanist | warm | Bitter | Karla |

All Google Fonts. Catalog is data, not code — adding a pairing later is a single
PR appending one object.

---

## Auto-suggest — `lib/content/suggest-design-tokens.ts`

```ts
export function suggestDesignTokens(
  brand: SessionSchema['brand'] | undefined,
  palette: PaletteData | null
): DesignTokens
```

### Signal scoring (shared by all four suggestions below)

Combine `brand.toneAdjectives` (joined), `brand.brandPersonality`, and
`brand.aspirationalTone` into a single lowercase string. For each feel, count
the number of distinct keywords from its set that appear as whole words.

- `modern`: modern, clean, minimal, contemporary, fresh, sleek, simple
- `classic`: traditional, established, trusted, heritage, conservative, professional, formal
- `editorial`: editorial, thoughtful, considered, refined, sophisticated, intelligent
- `warm`: warm, approachable, friendly, personable, welcoming, human, caring

`hasWarmSignal` = `warm-feel-score > 0`. This is independent of which typography
feel ends up winning, and is referenced separately in roundness / density.

### Type pairing selection
1. Pick the top-scoring feel. Tie-break priority: `modern > classic > editorial > warm`.
2. Within that feel, take the first pairing in catalog order.
3. No signal at all → suggest `civic-modern` (Public Sans / Public Sans).

### Visual feel selection
`visualFeel` only has three options: `classic | modern | editorial`. Map the
typography feel winner:
- typography winner `warm` → `visualFeel = modern` (with `warm-approachable`
  pairing carrying the warmth)
- otherwise → typography feel winner is the visualFeel

### Roundness selection
- typography feel = `classic` → `sharp`
- `hasWarmSignal` true → `soft`
- otherwise → `soft` (safest default)

### Density selection
- `hasWarmSignal` true → `airy`
- otherwise → `balanced`

Suggestion is pre-selected in the UI; admin can change any of the four before
locking.

---

## Admin Phase 1 UI changes — `components/content/DesignSystemPhase.tsx`

Rename the phase from "Color Palette" to "Design System." Existing palette UI
becomes sub-step 1. Add four sub-steps:

```
Phase 1: Design System

  1. Color Palette         [existing 6 swatches + WCAG checker]
  2. Type Pairing          [suggested + dropdown of 15, grouped by feel]
  3. Roundness             [Sharp · Soft · Pill]
  4. Density               [Tight · Balanced · Airy]
  5. Visual Feel           [Classic · Modern · Editorial]

  [ Lock Design System ]
```

### Files
| File | Change |
|---|---|
| `components/content/PalettePhase.tsx` | Rename → `DesignSystemPhase.tsx`. Wrap existing palette as sub-step 1. |
| `components/content/SwatchEditor.tsx` | No change. |
| **NEW** `components/content/TypePairingPicker.tsx` | Shows suggestion + grouped-by-feel dropdown. |
| **NEW** `components/content/TokenChipGroup.tsx` | Generic radio-chip group for roundness/density/visualFeel. |
| `app/admin/content/[id]/page.tsx` | Swap `<PalettePhase />` import → `<DesignSystemPhase />`. |
| `app/api/content-jobs/[id]/route.ts` (PATCH handler) | Accept `design_tokens` in the body and persist it alongside `palette`. The existing endpoint already accepts `palette` + `phase` — add one line to map `body.design_tokens` → `updates.design_tokens`. |

### Behavior on partial state
If admin lands on Phase 1 with `palette` set but `design_tokens`
null (returning admin from before this feature shipped, or mid-flow navigation):
show palette filled-in, render sub-steps 2–5 with auto-suggested defaults
pre-selected. The "Lock Design System" button enables once all 5 sub-steps
have a value.

### Persisted on lock

`DesignSystemPhase.tsx` PATCHes `/api/content-jobs/[id]` with the combined body:

```ts
await fetch(`/api/content-jobs/${contentJobId}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    palette,
    design_tokens: {
      typePairing: { id, headingFont, bodyFont, label },
      roundness, density, visualFeel,
    },
    phase: 2,   // only on the initial lock; subsequent edits omit phase
  }),
})
```

The route handler maps `body.design_tokens` → `updates.design_tokens` next to
its existing handling of `body.palette`. No new endpoint.

### Button transition

The existing button label cycles `Lock Palette & Continue` / `Save changes` in
`PalettePhase.tsx` line 168. In the renamed `DesignSystemPhase.tsx` this becomes
`Lock Design System & Continue` / `Save changes`. The first-lock-vs-edit gating
logic is unchanged — `phase: 2` is only sent on initial lock.

---

## Onboarding tweak — `lib/agent/phase-instructions.ts`

In `phase4Instructions()`, extend the "Save responses to" instruction in the
BRAND & TONE BLOCK:

```diff
- Save responses to brand.currentTone, brand.aspirationalTone, brand.toneAdjectives,
  brand.toneToAvoid, brand.primaryColors, brand.hasBrandGuide.
+ Save responses to brand.currentTone, brand.aspirationalTone, brand.toneAdjectives,
+ brand.toneToAvoid, brand.primaryColors, brand.hasBrandGuide. If the client
+ volunteers personality language ("we're more like a..."), capture it in
+ brand.brandPersonality. If they offer a memorable phrase that captures their
+ voice, capture it verbatim in brand.voiceExample.
```

No new exchange. No new gap. No phase-advancement-gate change.

---

## Package-route changes — `app/api/content-jobs/[id]/package/route.ts`

1. Load `palette` and `design_tokens` alongside the existing
   `confirmed_sitemap` from `content_jobs`.
2. Add `buildDesignMd()` to the parallel work alongside `generateBrandDoc()` and
   `buildDocx()`. It's synchronous-fast (no LLM, no I/O), so it could also live
   after the `Promise.all`, but co-locating keeps related work in one spot.
3. Add the new entry to the zip:
   ```ts
   { path: `${folderName}/design.md`, content: designMd },
   ```
4. Update the static `OG_IMAGES_README` constant's last line to reference
   `design.md` (currently references `brand.md`):
   ```
   Brand palette colors (see design.md)
   ```

---

## File summary

| Status | Path |
|---|---|
| NEW | `types/design-tokens.ts` |
| NEW | `supabase/007_design_tokens.sql` |
| NEW | `lib/content/type-pairing-catalog.ts` |
| NEW | `lib/content/suggest-design-tokens.ts` |
| NEW | `lib/content/design-md-builder.ts` |
| NEW | `components/content/DesignSystemPhase.tsx` (rename of PalettePhase) |
| NEW | `components/content/TypePairingPicker.tsx` |
| NEW | `components/content/TokenChipGroup.tsx` |
| EDIT | `lib/content/brand-doc-builder.ts` (trim Brand Voice) |
| EDIT | `lib/agent/phase-instructions.ts` (opportunistic personality/voice capture) |
| EDIT | `app/admin/content/[id]/page.tsx` (swap Phase 1 component) |
| EDIT | `app/api/content-jobs/[id]/package/route.ts` (call builder, add zip entry, update OG_IMAGES_README) |
| EDIT | `app/api/content-jobs/[id]/route.ts` (accept `design_tokens` in PATCH body) |

---

## Testing

- Run the existing Korbey Lague fixture through the parser, then exercise the
  pipeline end-to-end and inspect the generated `design.md` for YAML validity
  and canonical section order.
- Snapshot-test `buildDesignMd()` with three fixture inputs:
  - All-fields-populated brand schema
  - Minimal brand schema (no `toneAdjectives`, no `brandPersonality`)
  - `brand.toneToAvoid` populated → verify Don'ts list appears
- Snapshot-test `suggestDesignTokens()` with the same three inputs.
- Manual UI walkthrough of Phase 1 with a returning content_job missing
  `design_tokens`.
- Verify `brand.md` no longer contains "## Brand Voice" by grepping the
  Korbey Lague output.

---

## Out of scope (explicit non-goals, re-stated)

- No client onboarding session expansion beyond the one-line opportunistic
  capture tweak.
- No commercial fonts.
- No design.md preview in the admin UI.
- No deliverable-edit UI for design.md.
- No automated typography pairing generator — the catalog is hand-curated.
