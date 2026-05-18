# `design.md` Deliverable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Google `design.md`-spec-compliant deliverable to the content-package zip, trim "Brand Voice" out of `brand.md`, and collect new design tokens (type pairing, roundness, density, visual feel) in admin pipeline Phase 1 via auto-suggest from brand inputs.

**Architecture:** A new `design_tokens` JSONB column on `content_jobs` is locked alongside `palette` in the renamed "Design System" Phase 1. At package time, a deterministic `buildDesignMd()` reads the locked palette + design tokens + brand schema and emits a spec-compliant markdown file with YAML front-matter and canonical sections. No new LLM calls.

**Tech Stack:** Next.js 15 App Router · Supabase (Postgres JSONB) · TypeScript strict · `chroma-js` for WCAG contrast · `tsx` for verification scripts. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-18-design-md-deliverable-design.md`

---

## File Structure

| Status | Path | Responsibility |
|---|---|---|
| NEW | `types/design-tokens.ts` | The `DesignTokens` shape persisted on `content_jobs.design_tokens`. |
| NEW | `supabase/007_design_tokens.sql` | Migration: add `design_tokens jsonb` column. |
| EDIT | `types/database.ts` | Regenerated after migration. |
| NEW | `lib/content/type-pairing-catalog.ts` | 15-entry curated catalog + `findPairing()` lookup. |
| NEW | `lib/content/suggest-design-tokens.ts` | Pure function: brand schema + palette → `DesignTokens` suggestion. |
| NEW | `lib/content/design-md-builder.ts` | Pure function: palette + design tokens + schema → `design.md` string. |
| EDIT | `lib/content/brand-doc-builder.ts` | Remove the Brand Voice section (compiled + LLM-prompted). |
| NEW | `scripts/test-suggest-design-tokens.ts` | Verification script for the auto-suggest mapping. |
| NEW | `scripts/test-design-md-builder.ts` | Verification script for the builder against the Korbey Lague fixture. |
| EDIT | `app/api/content-jobs/[id]/route.ts` | PATCH accepts `body.design_tokens`. |
| EDIT | `app/api/content-jobs/[id]/package/route.ts` | Call `buildDesignMd()`, add zip entry, update OG_IMAGES_README. |
| NEW | `components/content/TokenChipGroup.tsx` | Generic radio-chip group for roundness/density/visual-feel. |
| NEW | `components/content/TypePairingPicker.tsx` | Suggested pairing display + grouped-by-feel dropdown. |
| NEW | `components/content/DesignSystemPhase.tsx` | Rename + expansion of `PalettePhase.tsx`. Hosts 5 sub-steps. |
| DELETE | `components/content/PalettePhase.tsx` | Replaced by `DesignSystemPhase.tsx`. |
| EDIT | `app/admin/content/[id]/page.tsx` | Swap `<PalettePhase>` → `<DesignSystemPhase>`. |
| EDIT | `lib/agent/phase-instructions.ts` | Append two opportunistic-capture sentences to the Phase 4 brand block. |

---

## Conventions used in this plan

- **Verification scripts** are pure-Node `tsx` scripts under `scripts/`, run with `npx tsx scripts/<name>.ts`. They print `✓` / `✗` lines and exit non-zero on failure (mirroring `scripts/test-parser.ts`).
- **Type-check gate** after every code change: `npx tsc --noEmit`. Must pass before moving on.
- **Security grep** before committing changes that touch `app/`: `grep -r "SUPABASE_SERVICE_ROLE_KEY" ./app` — expected zero matches.
- **Commit cadence:** one commit per task. Use the commit message in the task's final step verbatim.

---

## Task 1: Migration — add `design_tokens` column

**Files:**
- Create: `supabase/007_design_tokens.sql`
- Modify: `types/database.ts` (regenerated)

- [ ] **Step 1: Write the migration**

Create `supabase/007_design_tokens.sql`:

```sql
ALTER TABLE content_jobs
  ADD COLUMN design_tokens jsonb DEFAULT NULL;

COMMENT ON COLUMN content_jobs.design_tokens IS
  'Locked Design System tokens (type pairing, roundness, density, visual feel). Set in admin Phase 1 alongside palette.';
```

- [ ] **Step 2: Apply migration in Supabase**

Open the Supabase Dashboard → SQL Editor for this project. Paste the contents of `supabase/007_design_tokens.sql` and run it. Verify success:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'content_jobs' AND column_name = 'design_tokens';
```

Expected output: one row, `design_tokens | jsonb`.

- [ ] **Step 3: Regenerate `types/database.ts`**

Run (replace `PROJECT_ID` with the value from `.env.local`'s `NEXT_PUBLIC_SUPABASE_URL`):

```bash
npx supabase gen types typescript --project-id PROJECT_ID > types/database.ts
```

- [ ] **Step 4: Verify the type appears**

Run:

```bash
grep -A2 "design_tokens" types/database.ts | head -20
```

Expected: at least one `design_tokens: Json | null` entry inside the `content_jobs` table type.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/007_design_tokens.sql types/database.ts
git commit -m "feat(db): add design_tokens column to content_jobs"
```

---

## Task 2: `DesignTokens` type

**Files:**
- Create: `types/design-tokens.ts`

- [ ] **Step 1: Write the type module**

Create `types/design-tokens.ts`:

```ts
export type Roundness = 'sharp' | 'soft' | 'pill'
export type Density = 'tight' | 'balanced' | 'airy'
export type VisualFeel = 'classic' | 'modern' | 'editorial'

export type DesignTokens = {
  typePairing: {
    id: string
    headingFont: string
    bodyFont: string
    label: string
  }
  roundness: Roundness
  density: Density
  visualFeel: VisualFeel
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add types/design-tokens.ts
git commit -m "feat(types): add DesignTokens type"
```

---

## Task 3: Type pairing catalog

**Files:**
- Create: `lib/content/type-pairing-catalog.ts`

- [ ] **Step 1: Write the catalog**

Create `lib/content/type-pairing-catalog.ts`:

```ts
export type TypePairingFeel = 'classic' | 'modern' | 'editorial' | 'warm'

export type TypePairing = {
  id: string
  label: string
  feel: TypePairingFeel
  headingFont: string
  bodyFont: string
  description: string
  googleFontsUrl: string
}

function gfUrl(families: string[]): string {
  // Each family: "Family Name:wght@400;700"
  const params = families
    .map(f => `family=${f.replace(/ /g, '+')}:wght@400;500;700`)
    .join('&')
  return `https://fonts.googleapis.com/css2?${params}&display=swap`
}

export const TYPE_PAIRINGS: readonly TypePairing[] = [
  // Modern
  { id: 'modern-sans', label: 'Modern Sans', feel: 'modern',
    headingFont: 'Inter', bodyFont: 'Inter',
    description: 'Clean, neutral, broadly applicable. The safe modern default.',
    googleFontsUrl: gfUrl(['Inter']) },
  { id: 'geometric-pro', label: 'Geometric Pro', feel: 'modern',
    headingFont: 'Manrope', bodyFont: 'Manrope',
    description: 'Geometric sans with a slightly warmer feel than Inter.',
    googleFontsUrl: gfUrl(['Manrope']) },
  { id: 'civic-modern', label: 'Civic Modern', feel: 'modern',
    headingFont: 'Public Sans', bodyFont: 'Public Sans',
    description: 'Trustworthy, government-grade legibility. Strong default for CPA firms.',
    googleFontsUrl: gfUrl(['Public Sans']) },
  { id: 'corporate-clean', label: 'Corporate Clean', feel: 'modern',
    headingFont: 'Plus Jakarta Sans', bodyFont: 'Plus Jakarta Sans',
    description: 'Confident corporate sans with a touch of personality.',
    googleFontsUrl: gfUrl(['Plus Jakarta Sans']) },

  // Editorial
  { id: 'classic-editorial', label: 'Classic Editorial', feel: 'editorial',
    headingFont: 'Source Serif 4', bodyFont: 'Source Sans 3',
    description: 'Serif headlines, sans body. Sophisticated and considered.',
    googleFontsUrl: gfUrl(['Source Serif 4', 'Source Sans 3']) },
  { id: 'civic-editorial', label: 'Civic Editorial', feel: 'editorial',
    headingFont: 'IBM Plex Serif', bodyFont: 'IBM Plex Sans',
    description: 'Technical-feeling editorial pair from IBM. Modernist serif.',
    googleFontsUrl: gfUrl(['IBM Plex Serif', 'IBM Plex Sans']) },
  { id: 'refined-modern', label: 'Refined Modern', feel: 'editorial',
    headingFont: 'Fraunces', bodyFont: 'Inter',
    description: 'Soft variable serif with crisp sans body. Modern editorial.',
    googleFontsUrl: gfUrl(['Fraunces', 'Inter']) },
  { id: 'journal', label: 'Journal', feel: 'editorial',
    headingFont: 'Lora', bodyFont: 'Inter',
    description: 'Reading-rooted serif with a clean sans body.',
    googleFontsUrl: gfUrl(['Lora', 'Inter']) },

  // Classic
  { id: 'heritage', label: 'Heritage', feel: 'classic',
    headingFont: 'Playfair Display', bodyFont: 'Source Sans 3',
    description: 'High-contrast classic serif with a workhorse sans body.',
    googleFontsUrl: gfUrl(['Playfair Display', 'Source Sans 3']) },
  { id: 'traditional-pro', label: 'Traditional Pro', feel: 'classic',
    headingFont: 'Merriweather', bodyFont: 'Open Sans',
    description: 'Sturdy reading serif with a familiar humanist sans.',
    googleFontsUrl: gfUrl(['Merriweather', 'Open Sans']) },
  { id: 'legal-pad', label: 'Legal Pad', feel: 'classic',
    headingFont: 'Libre Caslon Text', bodyFont: 'Libre Franklin',
    description: 'Caslon revival with grotesque sans body. Old-world authority.',
    googleFontsUrl: gfUrl(['Libre Caslon Text', 'Libre Franklin']) },

  // Warm
  { id: 'warm-approachable', label: 'Warm Approachable', feel: 'warm',
    headingFont: 'Nunito', bodyFont: 'Nunito',
    description: 'Rounded, friendly sans throughout.',
    googleFontsUrl: gfUrl(['Nunito']) },
  { id: 'friendly-rounded', label: 'Friendly Rounded', feel: 'warm',
    headingFont: 'DM Sans', bodyFont: 'DM Sans',
    description: 'Geometric sans with softened corners. Friendly but precise.',
    googleFontsUrl: gfUrl(['DM Sans']) },
  { id: 'warm-editorial', label: 'Warm Editorial', feel: 'warm',
    headingFont: 'DM Serif Display', bodyFont: 'Nunito Sans',
    description: 'High-contrast warm serif paired with a soft sans.',
    googleFontsUrl: gfUrl(['DM Serif Display', 'Nunito Sans']) },
  { id: 'humanist', label: 'Humanist', feel: 'warm',
    headingFont: 'Bitter', bodyFont: 'Karla',
    description: 'Slab-leaning warm serif with a balanced humanist sans.',
    googleFontsUrl: gfUrl(['Bitter', 'Karla']) },
] as const

export function findPairing(id: string): TypePairing | undefined {
  return TYPE_PAIRINGS.find(p => p.id === id)
}

export function pairingsByFeel(): Record<TypePairingFeel, TypePairing[]> {
  const groups: Record<TypePairingFeel, TypePairing[]> = {
    modern: [], editorial: [], classic: [], warm: [],
  }
  for (const p of TYPE_PAIRINGS) groups[p.feel].push(p)
  return groups
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/content/type-pairing-catalog.ts
git commit -m "feat(content): add curated type pairing catalog (15 pairings)"
```

---

## Task 4: Auto-suggest function

**Files:**
- Create: `lib/content/suggest-design-tokens.ts`
- Create: `scripts/test-suggest-design-tokens.ts`

- [ ] **Step 1: Write the suggest function**

Create `lib/content/suggest-design-tokens.ts`:

```ts
import chroma from 'chroma-js'
import type { DesignTokens, Roundness, Density, VisualFeel } from '@/types/design-tokens'
import type { PaletteData } from '@/types/palette'
import type { SessionSchema } from '@/types/session-schema'
import { TYPE_PAIRINGS, findPairing, type TypePairingFeel } from './type-pairing-catalog'

const FEEL_KEYWORDS: Record<TypePairingFeel, string[]> = {
  modern:    ['modern', 'clean', 'minimal', 'contemporary', 'fresh', 'sleek', 'simple'],
  classic:   ['traditional', 'established', 'trusted', 'heritage', 'conservative', 'professional', 'formal'],
  editorial: ['editorial', 'thoughtful', 'considered', 'refined', 'sophisticated', 'intelligent'],
  warm:      ['warm', 'approachable', 'friendly', 'personable', 'welcoming', 'human', 'caring'],
}

const TIE_PRIORITY: TypePairingFeel[] = ['modern', 'classic', 'editorial', 'warm']
const NO_SIGNAL_FALLBACK_ID = 'civic-modern'

function combineBrandText(brand: SessionSchema['brand'] | undefined): string {
  if (!brand) return ''
  const parts: string[] = []
  if (Array.isArray(brand.toneAdjectives)) parts.push(brand.toneAdjectives.join(' '))
  if (brand.brandPersonality) parts.push(brand.brandPersonality)
  if (brand.aspirationalTone) parts.push(brand.aspirationalTone)
  return parts.join(' ').toLowerCase()
}

function scoreFeel(text: string, keywords: string[]): number {
  let score = 0
  for (const kw of keywords) {
    const re = new RegExp(`\\b${kw}\\b`, 'i')
    if (re.test(text)) score++
  }
  return score
}

function pickFeel(text: string): { feel: TypePairingFeel; hasWarmSignal: boolean; anySignal: boolean } {
  const scores: Record<TypePairingFeel, number> = {
    modern: scoreFeel(text, FEEL_KEYWORDS.modern),
    classic: scoreFeel(text, FEEL_KEYWORDS.classic),
    editorial: scoreFeel(text, FEEL_KEYWORDS.editorial),
    warm: scoreFeel(text, FEEL_KEYWORDS.warm),
  }
  const anySignal = Object.values(scores).some(s => s > 0)
  const hasWarmSignal = scores.warm > 0

  let winner: TypePairingFeel = TIE_PRIORITY[0]
  let max = -1
  for (const feel of TIE_PRIORITY) {
    if (scores[feel] > max) {
      max = scores[feel]
      winner = feel
    }
  }
  return { feel: winner, hasWarmSignal, anySignal }
}

function pickRoundness(typographyFeel: TypePairingFeel, hasWarmSignal: boolean): Roundness {
  if (typographyFeel === 'classic') return 'sharp'
  if (hasWarmSignal) return 'soft'
  return 'soft'
}

function pickDensity(hasWarmSignal: boolean): Density {
  return hasWarmSignal ? 'airy' : 'balanced'
}

function pickVisualFeel(typographyFeel: TypePairingFeel): VisualFeel {
  if (typographyFeel === 'warm') return 'modern'
  return typographyFeel
}

export function suggestDesignTokens(
  brand: SessionSchema['brand'] | undefined,
  palette: PaletteData | null
): DesignTokens {
  void palette // reserved for future palette-derived heuristics; intentionally unused for now
  void chroma  // imported so future heuristics can use chroma; intentionally unused for now

  const text = combineBrandText(brand)
  const { feel, hasWarmSignal, anySignal } = pickFeel(text)

  const pairingId = anySignal
    ? (TYPE_PAIRINGS.find(p => p.feel === feel)?.id ?? NO_SIGNAL_FALLBACK_ID)
    : NO_SIGNAL_FALLBACK_ID
  const pairing = findPairing(pairingId)!

  return {
    typePairing: {
      id: pairing.id,
      headingFont: pairing.headingFont,
      bodyFont: pairing.bodyFont,
      label: pairing.label,
    },
    roundness: pickRoundness(feel, hasWarmSignal),
    density: pickDensity(hasWarmSignal),
    visualFeel: pickVisualFeel(feel),
  }
}
```

- [ ] **Step 2: Write the verification script**

Create `scripts/test-suggest-design-tokens.ts`:

```ts
import { suggestDesignTokens } from '../lib/content/suggest-design-tokens'
import type { SessionSchema } from '../types/session-schema'

let passed = 0
let failed = 0
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log('✓ ' + label); passed++ }
  else { console.log('✗ ' + label + (detail ? ': ' + detail : '')); failed++ }
}

const empty: SessionSchema['brand'] = {
  currentTone: '', aspirationalTone: '', toneAdjectives: [], toneToAvoid: [],
  voiceExample: '', brandPersonality: '',
  primaryColors: '', typography: '', logoStyle: '', hasBrandGuide: false,
}

// 1. No signal → civic-modern / soft / balanced / modern
const r1 = suggestDesignTokens(empty, null)
assert('no signal: pairing id is civic-modern', r1.typePairing.id === 'civic-modern', r1.typePairing.id)
assert('no signal: roundness=soft', r1.roundness === 'soft', r1.roundness)
assert('no signal: density=balanced', r1.density === 'balanced', r1.density)
assert('no signal: visualFeel=modern', r1.visualFeel === 'modern', r1.visualFeel)

// 2. Modern signal
const modernBrand = { ...empty, toneAdjectives: ['clean', 'modern'], aspirationalTone: 'minimal' }
const r2 = suggestDesignTokens(modernBrand, null)
assert('modern signal: pairing feel is modern', r2.typePairing.id === 'modern-sans', r2.typePairing.id)
assert('modern signal: visualFeel=modern', r2.visualFeel === 'modern', r2.visualFeel)

// 3. Classic signal
const classicBrand = { ...empty, toneAdjectives: ['traditional', 'established'], brandPersonality: 'trusted' }
const r3 = suggestDesignTokens(classicBrand, null)
assert('classic signal: pairing feel is classic', r3.typePairing.id === 'heritage', r3.typePairing.id)
assert('classic signal: roundness=sharp', r3.roundness === 'sharp', r3.roundness)
assert('classic signal: visualFeel=classic', r3.visualFeel === 'classic', r3.visualFeel)

// 4. Editorial signal
const editorialBrand = { ...empty, toneAdjectives: ['thoughtful', 'refined'] }
const r4 = suggestDesignTokens(editorialBrand, null)
assert('editorial signal: pairing feel is editorial', r4.typePairing.id === 'classic-editorial', r4.typePairing.id)
assert('editorial signal: visualFeel=editorial', r4.visualFeel === 'editorial', r4.visualFeel)

// 5. Warm signal
const warmBrand = { ...empty, toneAdjectives: ['warm', 'approachable'], brandPersonality: 'friendly' }
const r5 = suggestDesignTokens(warmBrand, null)
assert('warm signal: pairing feel is warm', r5.typePairing.id === 'warm-approachable', r5.typePairing.id)
assert('warm signal: roundness=soft', r5.roundness === 'soft', r5.roundness)
assert('warm signal: density=airy', r5.density === 'airy', r5.density)
assert('warm signal: visualFeel=modern (warm maps to modern)', r5.visualFeel === 'modern', r5.visualFeel)

// 6. Tie-break: modern beats classic when scores equal
const tieBrand = { ...empty, toneAdjectives: ['modern', 'traditional'] }
const r6 = suggestDesignTokens(tieBrand, null)
assert('tie: modern wins over classic', r6.typePairing.id === 'modern-sans', r6.typePairing.id)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
```

- [ ] **Step 3: Run verification**

```bash
npx tsx scripts/test-suggest-design-tokens.ts
```

Expected: `13 passed, 0 failed` and exit code 0.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/content/suggest-design-tokens.ts scripts/test-suggest-design-tokens.ts
git commit -m "feat(content): add design tokens auto-suggest from brand inputs"
```

---

## Task 5: `design.md` builder — YAML front-matter

**Files:**
- Create: `lib/content/design-md-builder.ts`

- [ ] **Step 1: Write the builder with YAML only**

Create `lib/content/design-md-builder.ts`:

```ts
import chroma from 'chroma-js'
import type { PaletteData } from '@/types/palette'
import type { DesignTokens, Roundness, Density } from '@/types/design-tokens'
import type { SessionSchema } from '@/types/session-schema'
import { findPairing } from './type-pairing-catalog'

type BuilderInput = {
  firmName: string
  palette: PaletteData
  tokens: DesignTokens
  brand: SessionSchema['brand'] | undefined
  business: SessionSchema['business'] | undefined
  location: { city: string; state: string } | null
}

function pillValue(r: Roundness): string {
  return r === 'sharp' ? '4px' : r === 'soft' ? '8px' : '9999px'
}

function densitySpacing(d: Density): { xl: string; '2xl': string } {
  if (d === 'tight') return { xl: '32px', '2xl': '64px' }
  if (d === 'airy') return { xl: '64px', '2xl': '128px' }
  return { xl: '48px', '2xl': '96px' }
}

function onColor(base: string, nearWhite: string, nearBlack: string): string {
  // WCAG AA threshold is 4.5. Prefer nearWhite, fall back to nearBlack.
  try {
    const cw = chroma.contrast(base, nearWhite)
    const cb = chroma.contrast(base, nearBlack)
    if (cw >= 4.5) return nearWhite
    if (cb >= 4.5) return nearBlack
    return cw >= cb ? nearWhite : nearBlack
  } catch {
    return nearWhite
  }
}

function buildYamlFrontMatter(input: BuilderInput, fontsUrl: string): string {
  const { firmName, palette, tokens } = input
  const heading = tokens.typePairing.headingFont
  const body = tokens.typePairing.bodyFont
  const onAction = onColor(palette.action.hex, palette.nearWhite.hex, palette.nearBlack.hex)
  const onPrimary = onColor(palette.primary.hex, palette.nearWhite.hex, palette.nearBlack.hex)
  const sp = densitySpacing(tokens.density)
  const pill = pillValue(tokens.roundness)

  return `<!-- Fonts: ${fontsUrl} -->
---
version: alpha
name: "${firmName}"
description: "Design system for the ${firmName} website rebuild."
colors:
  primary: "${palette.primary.hex}"
  secondary: "${palette.secondary.hex}"
  complementary: "${palette.complementary.hex}"
  action: "${palette.action.hex}"
  near-black: "${palette.nearBlack.hex}"
  near-white: "${palette.nearWhite.hex}"
  on-action: "${onAction}"
  on-primary: "${onPrimary}"
typography:
  h1:
    fontFamily: "${heading}"
    fontSize: "3rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  h2:
    fontFamily: "${heading}"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.2
  body-md:
    fontFamily: "${body}"
    fontSize: "1rem"
    lineHeight: 1.6
  body-sm:
    fontFamily: "${body}"
    fontSize: "0.875rem"
  label-caps:
    fontFamily: "${heading}"
    fontSize: "0.75rem"
    letterSpacing: "0.08em"
rounded:
  none: "0px"
  sm: "4px"
  md: "8px"
  lg: "16px"
  pill: "${pill}"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "${sp.xl}"
  2xl: "${sp['2xl']}"
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
---`
}

export function buildDesignMd(input: BuilderInput): string {
  const pairing = findPairing(input.tokens.typePairing.id)
  const fontsUrl = pairing?.googleFontsUrl ?? ''
  const front = buildYamlFrontMatter(input, fontsUrl)
  // Markdown body added in the next task.
  return front + '\n'
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/content/design-md-builder.ts
git commit -m "feat(content): design.md builder — YAML front-matter only"
```

---

## Task 6: `design.md` builder — markdown body (Overview through Components)

**Files:**
- Modify: `lib/content/design-md-builder.ts`

- [ ] **Step 1: Add the section builders**

Add these helpers above `buildDesignMd()` in `lib/content/design-md-builder.ts`:

```ts
function buildOverview(input: BuilderInput): string {
  const { firmName, brand, business, location, tokens } = input
  const locPart = location?.city
    ? ` in ${location.city}${location.state ? ', ' + location.state : ''}`
    : ''
  const foundedPart = business?.foundingYear ? ` founded ${business.foundingYear}` : ''
  const aspirational = brand?.aspirationalTone?.trim()
    ? `should feel **${brand.aspirationalTone.trim()}**`
    : 'should feel measured, trustworthy, and clear'
  const personality = brand?.brandPersonality?.trim()
    ? ` ${brand.brandPersonality.trim()}`
    : ''
  const feelLine: Record<typeof tokens.visualFeel, string> = {
    classic: 'Visual direction is classic: restrained typography, sturdy structure, considered detailing.',
    modern: 'Visual direction is modern: clean type, generous whitespace, confident accents.',
    editorial: 'Visual direction is editorial: serif headlines, considered hierarchy, room for long reads.',
  }
  return `## Overview

${firmName}${locPart}${foundedPart} ${aspirational}.${personality}

${feelLine[tokens.visualFeel]}`
}

function buildColorsSection(input: BuilderInput): string {
  const { palette } = input
  return `## Colors

The palette is rooted in **${palette.primary.name}** as the structural primary and **${palette.action.name}** as the action color used sparingly for CTAs. Near-black (${palette.nearBlack.hex}) and near-white (${palette.nearWhite.hex}) provide high-contrast surface pairings. The complementary accent (${palette.complementary.hex}) is reserved for badges and visual punctuation — never large fills.`
}

function buildTypographySection(input: BuilderInput): string {
  const pairing = findPairing(input.tokens.typePairing.id)
  const blurb: Record<string, string> = {
    modern: 'A clean, neutral sans throughout favors clarity over decoration. Tight letter-spacing on headlines keeps the typography editorial without feeling cold.',
    editorial: 'Serif headlines pair with a humanist sans body. The combination gives long-form pages (About, Services) a considered, journalistic weight.',
    classic: 'High-contrast classic typography signals authority and continuity. Use sparingly on headlines; let the sans body do the reading work.',
    warm: 'Rounded forms throughout give the typography an approachable, human feel. Body sizes step up to 1rem for comfortable long-form reading.',
  }
  return `## Typography

${pairing?.headingFont ?? 'Heading font'} for headlines, ${pairing?.bodyFont ?? 'body font'} for body copy. ${pairing ? blurb[pairing.feel] : ''}`
}

function buildLayoutSection(input: BuilderInput): string {
  const density: Record<typeof input.tokens.density, string> = {
    tight: 'Spacing scale is **tight**: 16px unit, 32px between sections at md+, 64px max. Suits dense, content-heavy pages.',
    balanced: 'Spacing scale is **balanced**: 16px unit, 48px section gutter, 96px between major sections. Default for marketing layouts.',
    airy: 'Spacing scale is **airy**: 16px unit, 64px section gutter, 128px between major sections. Generous whitespace; reads as confident.',
  }
  return `## Layout

${density[input.tokens.density]} Container max-width 1200px. Single-column on mobile, two-column at md+.`
}

function buildElevationSection(): string {
  return `## Elevation & Depth

Use navy-tinted shadows, not pure black. At rest: \`0 1px 2px rgba(0, 59, 113, 0.08)\` for cards. On hover or raised state: \`0 8px 24px rgba(0, 59, 113, 0.12)\`. Avoid deep drop shadows; the system reads as flat-with-lift, not skeuomorphic.`
}

function buildShapesSection(input: BuilderInput): string {
  const r: Record<typeof input.tokens.roundness, string> = {
    sharp: 'Sharp 4px corners throughout signal precision and tradition. Buttons share the same 4px radius — no pill shapes.',
    soft: 'Soft 8px corners give the system a current, approachable feel without going soft. Cards and inputs use 8px; buttons use the pill scale.',
    pill: 'Full pill buttons (9999px) anchor the interactive language. Cards and inputs at 8px keep the rest of the system grounded.',
  }
  return `## Shapes

${r[input.tokens.roundness]} Badges always use the smallest scale (4px) for typographic anchoring.`
}

function buildComponentsSection(): string {
  return `## Components

Button-primary is the action color with on-action text and pill (or roundness-scaled) corners. On hover it shifts to the primary color. Button-secondary inverts: white surface, primary text, same shape. Cards sit on near-white with a soft navy-tinted shadow. Links use the action color and are always underlined within body copy. Badge uses the complementary accent at the smallest radius. Hero blocks fill with the primary color and use the largest spacing scale.`
}
```

Now extend `buildDesignMd()` to stitch the sections:

```ts
export function buildDesignMd(input: BuilderInput): string {
  const pairing = findPairing(input.tokens.typePairing.id)
  const fontsUrl = pairing?.googleFontsUrl ?? ''
  const front = buildYamlFrontMatter(input, fontsUrl)

  const sections = [
    front,
    '',
    buildOverview(input),
    '',
    buildColorsSection(input),
    '',
    buildTypographySection(input),
    '',
    buildLayoutSection(input),
    '',
    buildElevationSection(),
    '',
    buildShapesSection(input),
    '',
    buildComponentsSection(),
    // Do's and Don'ts added in Task 7
  ]
  return sections.join('\n') + '\n'
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/content/design-md-builder.ts
git commit -m "feat(content): design.md builder — markdown sections (Overview through Components)"
```

---

## Task 7: `design.md` builder — Do's and Don'ts + verification script

**Files:**
- Modify: `lib/content/design-md-builder.ts`
- Create: `scripts/test-design-md-builder.ts`

- [ ] **Step 1: Add the Do's/Don'ts section builder**

Append this helper above `buildDesignMd()` in `lib/content/design-md-builder.ts`:

```ts
function buildDosDontsSection(input: BuilderInput): string {
  const { tokens, brand } = input
  const feelDo: Record<typeof tokens.visualFeel, string> = {
    classic: 'Keep typography restrained — let structural choices carry the brand',
    modern: 'Keep hero copy short — let typography and whitespace carry the weight',
    editorial: 'Use serif headlines for long-form pages; reserve sans for UI chrome',
  }
  const avoidWords = (brand?.toneToAvoid ?? [])
    .map(w => (typeof w === 'string' ? w.trim() : ''))
    .filter(w => w.length > 0)
  const avoidLine = avoidWords.length > 0
    ? `\n- Don't use words from the firm's avoid list: ${avoidWords.map(w => `"${w}"`).join(', ')}`
    : ''

  return `## Do's and Don'ts

**Do**
- Use the action color for one CTA per screen
- ${feelDo[tokens.visualFeel]}
- Pair CTAs against high-contrast backgrounds

**Don't**
- Don't put the action color on the primary background
- Don't use generic black shadows
- Don't introduce a third heading font${avoidLine}`
}
```

Update the `sections` array in `buildDesignMd()` to include the new section as the last entry:

```ts
    buildComponentsSection(),
    '',
    buildDosDontsSection(input),
  ]
```

- [ ] **Step 2: Write the verification script**

Create `scripts/test-design-md-builder.ts`:

```ts
import { buildDesignMd } from '../lib/content/design-md-builder'
import type { PaletteData } from '../types/palette'
import type { DesignTokens } from '../types/design-tokens'
import type { SessionSchema } from '../types/session-schema'

let passed = 0
let failed = 0
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log('✓ ' + label); passed++ }
  else { console.log('✗ ' + label + (detail ? ': ' + detail : '')); failed++ }
}

const palette: PaletteData = {
  primary:        { hex: '#003B71', name: 'Navy' },
  secondary:      { hex: '#6C7278', name: 'Slate' },
  complementary:  { hex: '#B8422E', name: 'Terracotta' },
  action:         { hex: '#00C1DE', name: 'Cyan' },
  nearBlack:      { hex: '#1A1C1E', name: 'Near Black' },
  nearWhite:      { hex: '#F7F5F2', name: 'Near White' },
}

const tokens: DesignTokens = {
  typePairing: { id: 'civic-modern', headingFont: 'Public Sans', bodyFont: 'Public Sans', label: 'Civic Modern' },
  roundness: 'pill',
  density: 'balanced',
  visualFeel: 'modern',
}

const brand: SessionSchema['brand'] = {
  currentTone: '', aspirationalTone: 'measured and trustworthy',
  toneAdjectives: ['clean', 'modern'],
  toneToAvoid: ['leverage', 'synergy', 'world-class'],
  voiceExample: '', brandPersonality: 'plain-spoken',
  primaryColors: '', typography: '', logoStyle: '', hasBrandGuide: false,
}

const out = buildDesignMd({
  firmName: 'Acme PLLP',
  palette, tokens, brand,
  business: { name: 'Acme PLLP', foundingYear: '1972' } as SessionSchema['business'],
  location: { city: 'Boston', state: 'MA' },
})

// YAML structure
assert('front-matter delimiters present', out.startsWith('<!-- Fonts:') && out.includes('\n---\n'), 'first 200 chars: ' + out.slice(0, 200))
assert('name field correct', out.includes('name: "Acme PLLP"'))
assert('primary color from palette', out.includes('primary: "#003B71"'))
assert('action color from palette', out.includes('action: "#00C1DE"'))
assert('pill value = 9999px when roundness=pill', /pill:\s*"9999px"/.test(out))
assert('xl spacing = 48px when density=balanced', /xl:\s*"48px"/.test(out))
assert('on-action present', /on-action:\s*"#/.test(out))
assert('heading font is Public Sans', out.includes('fontFamily: "Public Sans"'))

// Canonical section order
const sectionIdx = (h: string) => out.indexOf('## ' + h)
const order = ['Overview', 'Colors', 'Typography', 'Layout', 'Elevation & Depth', 'Shapes', 'Components', "Do's and Don'ts"]
for (let i = 0; i < order.length; i++) {
  assert(`section "${order[i]}" present`, sectionIdx(order[i]) > -1, 'idx=' + sectionIdx(order[i]))
}
for (let i = 1; i < order.length; i++) {
  assert(`"${order[i]}" appears after "${order[i-1]}"`, sectionIdx(order[i]) > sectionIdx(order[i-1]))
}

// Body interpolation
assert('Overview mentions firm + city', out.includes('Acme PLLP in Boston, MA'))
assert('Overview mentions aspirational tone', out.includes('measured and trustworthy'))
assert('Overview mentions personality', out.includes('plain-spoken'))

// Do's/Don'ts
assert("avoid list present in Don't section", out.includes('avoid list:') && out.includes('"leverage"'))

// Pill-value variants
const sharp = buildDesignMd({
  firmName: 'X', palette,
  tokens: { ...tokens, roundness: 'sharp' },
  brand, business: undefined, location: null,
})
assert('roundness=sharp → pill: "4px"', /pill:\s*"4px"/.test(sharp))

const soft = buildDesignMd({
  firmName: 'X', palette,
  tokens: { ...tokens, roundness: 'soft' },
  brand, business: undefined, location: null,
})
assert('roundness=soft → pill: "8px"', /pill:\s*"8px"/.test(soft))

// Density variants
const tight = buildDesignMd({
  firmName: 'X', palette,
  tokens: { ...tokens, density: 'tight' },
  brand, business: undefined, location: null,
})
assert('density=tight → xl: "32px"', /xl:\s*"32px"/.test(tight))

const airy = buildDesignMd({
  firmName: 'X', palette,
  tokens: { ...tokens, density: 'airy' },
  brand, business: undefined, location: null,
})
assert('density=airy → 2xl: "128px"', /2xl:\s*"128px"/.test(airy))

// Empty brand → no avoid line
const emptyBrand = buildDesignMd({
  firmName: 'X', palette, tokens,
  brand: undefined, business: undefined, location: null,
})
assert('no avoid list when brand undefined', !emptyBrand.includes('avoid list:'))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
```

- [ ] **Step 3: Run verification**

```bash
npx tsx scripts/test-design-md-builder.ts
```

Expected: all assertions pass (`X passed, 0 failed`).

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/content/design-md-builder.ts scripts/test-design-md-builder.ts
git commit -m "feat(content): design.md builder — Do's/Don'ts + verification script"
```

---

## Task 8: Trim Brand Voice from `brand-doc-builder.ts`

**Files:**
- Modify: `lib/content/brand-doc-builder.ts`

- [ ] **Step 1: Remove the Voice block in `compileBrandDoc()`**

Open `lib/content/brand-doc-builder.ts`. Find the `// ---- Voice ----` block (around lines 58–65) and the assembly of `## Brand Voice` (around line 72). Delete both.

The result should be: `compileBrandDoc()` builds only Identity / Positioning / Industries.

Replace the section from `// ---- Voice ----` through `if (voiceParts.length) sections.push(...)`. The remaining `## Brand Voice` line in the assembly block must also be removed. After editing, the assembly should look like:

```ts
  // ---- Assemble fullDoc ----
  const sections: string[] = [`# About ${firmName}`]
  if (identityParts.length) sections.push(`## Identity\n${identityParts.join('\n')}`)
  if (positioningParts.length) sections.push(`## Positioning & Differentiation\n${positioningParts.join('\n\n')}`)
  if (nicheBlocks.length) sections.push(`## Industries Served\n${nicheBlocks.join('\n\n')}`)
  const fullDoc = sections.join('\n\n')
```

- [ ] **Step 2: Update the LLM prompt in `generateBrandDoc()`**

Find the prompt assignment in `generateBrandDoc()`. Replace the existing `prompt` constant with:

```ts
  const prompt = `You are writing a brand brief that LLM crawlers will ingest to understand this CPA firm. Use the firm's own positioning and audience — do not invent details.

FIRM SCHEMA (JSON):
${JSON.stringify(trimmed, null, 2)}

Return JSON only — no prose, no code fences:
{
  "summary": "1–2 short paragraphs, ~400–600 characters. Reads as a blockquote: who they are, who they serve, what's distinctive. No headings.",
  "fullDoc": "Full markdown brand brief, 600–1000 words, with these H2 sections in order: ## Identity, ## Positioning & Differentiation, ## Industries Served (one H3 per niche). Skip a section entirely if its source fields are empty. Start with '# About <Firm Name>'."
}

RULES:
- For each niche, include pain points and value proposition if present.
- No marketing fluff or invented credentials.`
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Grep verification**

```bash
grep -n "Brand Voice\|## Brand Voice\|voiceParts\|## Brand Voice" lib/content/brand-doc-builder.ts
```

Expected: no matches.

```bash
grep -n "Mirror the firm's own tone" lib/content/brand-doc-builder.ts
```

Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add lib/content/brand-doc-builder.ts
git commit -m "feat(content): trim Brand Voice section from brand.md"
```

---

## Task 9: PATCH route accepts `design_tokens`

**Files:**
- Modify: `app/api/content-jobs/[id]/route.ts`

- [ ] **Step 1: Add the new body field handling**

Open `app/api/content-jobs/[id]/route.ts`. Find the block that reads:

```ts
  if (body.palette !== undefined) updates.palette = body.palette
  if (body.confirmed_sitemap !== undefined) updates.confirmed_sitemap = body.confirmed_sitemap
```

Add a line for `design_tokens` immediately after the `palette` line:

```ts
  if (body.palette !== undefined) updates.palette = body.palette
  if (body.design_tokens !== undefined) updates.design_tokens = body.design_tokens
  if (body.confirmed_sitemap !== undefined) updates.confirmed_sitemap = body.confirmed_sitemap
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. The `design_tokens` column was added to `types/database.ts` in Task 1, so the assignment is type-safe.

- [ ] **Step 3: Security grep**

```bash
grep -r "SUPABASE_SERVICE_ROLE_KEY" ./app
```

Expected: zero matches.

- [ ] **Step 4: Commit**

```bash
git add app/api/content-jobs/[id]/route.ts
git commit -m "feat(api): content-jobs PATCH accepts design_tokens"
```

---

## Task 10: `TokenChipGroup` UI component

**Files:**
- Create: `components/content/TokenChipGroup.tsx`

- [ ] **Step 1: Write the component**

Create `components/content/TokenChipGroup.tsx`:

```tsx
'use client'

export type ChipOption<T extends string> = {
  value: T
  label: string
  hint?: string
}

export default function TokenChipGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string
  value: T
  options: ChipOption<T>[]
  onChange: (next: T) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-text-strong font-heading">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map(opt => {
          const selected = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              className={[
                'px-4 py-2 rounded-full text-sm font-body border transition',
                selected
                  ? 'bg-brand-navy text-white border-brand-navy'
                  : 'bg-white text-text-strong border-border hover:border-brand-navy',
                disabled ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
              aria-pressed={selected}
            >
              <span>{opt.label}</span>
              {opt.hint && <span className="ml-1 opacity-70">({opt.hint})</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/content/TokenChipGroup.tsx
git commit -m "feat(content): TokenChipGroup component for design-token choices"
```

---

## Task 11: `TypePairingPicker` UI component

**Files:**
- Create: `components/content/TypePairingPicker.tsx`

- [ ] **Step 1: Write the component**

Create `components/content/TypePairingPicker.tsx`:

```tsx
'use client'

import { useMemo } from 'react'
import { pairingsByFeel, findPairing, type TypePairing } from '@/lib/content/type-pairing-catalog'

const FEEL_ORDER: TypePairing['feel'][] = ['modern', 'editorial', 'classic', 'warm']
const FEEL_LABEL: Record<TypePairing['feel'], string> = {
  modern: 'Modern', editorial: 'Editorial', classic: 'Classic', warm: 'Warm',
}

export default function TypePairingPicker({
  selectedId,
  suggestedId,
  onChange,
  disabled = false,
}: {
  selectedId: string
  suggestedId: string
  onChange: (id: string) => void
  disabled?: boolean
}) {
  const groups = useMemo(() => pairingsByFeel(), [])
  const selected = findPairing(selectedId)
  const isSuggested = selectedId === suggestedId

  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-text-strong font-heading">Type Pairing</div>

      {selected && (
        <div className="border border-border rounded-lg p-4 bg-surface-soft">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-base font-semibold" style={{ fontFamily: selected.headingFont }}>
                {selected.label}
              </div>
              <div className="text-sm text-text-muted font-body" style={{ fontFamily: selected.bodyFont }}>
                {selected.headingFont} + {selected.bodyFont}
              </div>
            </div>
            {isSuggested && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-brand-navy text-white">
                Suggested
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-text-muted font-body">{selected.description}</p>
        </div>
      )}

      <select
        value={selectedId}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="w-full border border-border rounded-md px-3 py-2 text-sm font-body bg-white"
      >
        {FEEL_ORDER.map(feel => (
          <optgroup key={feel} label={FEEL_LABEL[feel]}>
            {groups[feel].map(p => (
              <option key={p.id} value={p.id}>
                {p.label} — {p.headingFont}
                {p.headingFont !== p.bodyFont ? ` + ${p.bodyFont}` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/content/TypePairingPicker.tsx
git commit -m "feat(content): TypePairingPicker — suggested + grouped dropdown"
```

---

## Task 12: Rename `PalettePhase.tsx` → `DesignSystemPhase.tsx` with sub-steps

**Files:**
- Create: `components/content/DesignSystemPhase.tsx`
- Delete: `components/content/PalettePhase.tsx`

This task replaces the existing palette UI wholesale. The new component embeds the palette as sub-step 1 and adds four more sub-steps before the lock button.

- [ ] **Step 1: Read the current PalettePhase**

```bash
cat components/content/PalettePhase.tsx | head -200
```

Take note of the existing palette generation, contrast checks, SwatchEditor interaction, and PATCH-save logic. The new component reuses all of that as sub-step 1.

- [ ] **Step 2: Create the new component**

Create `components/content/DesignSystemPhase.tsx`:

```tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import SwatchEditor from './SwatchEditor'
import TokenChipGroup from './TokenChipGroup'
import TypePairingPicker from './TypePairingPicker'
import type { PaletteData } from '@/types/palette'
import type { DesignTokens, Roundness, Density, VisualFeel } from '@/types/design-tokens'
import { findPairing } from '@/lib/content/type-pairing-catalog'
import { suggestDesignTokens } from '@/lib/content/suggest-design-tokens'
import type { SessionSchema } from '@/types/session-schema'

function luminance(hex: string): number {
  const rgb = hex.replace('#', '').match(/.{2}/g)?.map(c => {
    const v = parseInt(c, 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }) ?? [0, 0, 0]
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = luminance(hex1)
  const l2 = luminance(hex2)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

const SWATCH_KEYS: (keyof PaletteData)[] = [
  'primary', 'secondary', 'complementary', 'action', 'nearBlack', 'nearWhite',
]

export default function DesignSystemPhase({
  sessionId,
  contentJobId,
  existingPalette,
  existingTokens,
  brand,
  isLocked = false,
}: {
  sessionId: string
  contentJobId: string
  existingPalette: PaletteData | null
  existingTokens: DesignTokens | null
  brand: SessionSchema['brand'] | undefined
  isLocked?: boolean
}) {
  const [palette, setPalette] = useState<PaletteData | null>(existingPalette)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fromLogo, setFromLogo] = useState<boolean | null>(null)

  // Computed suggestion (changes if palette changes).
  const suggested = suggestDesignTokens(brand, palette)
  const [tokens, setTokens] = useState<DesignTokens>(existingTokens ?? suggested)

  const setPairing = useCallback((id: string) => {
    const p = findPairing(id)
    if (!p) return
    setTokens(prev => ({
      ...prev,
      typePairing: { id: p.id, headingFont: p.headingFont, bodyFont: p.bodyFont, label: p.label },
    }))
  }, [])

  const generatePalette = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/palette/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Palette generation failed')
      }
      const data = await res.json()
      setPalette(data.palette)
      setFromLogo(data.fromLogo)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate palette')
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    if (!palette) generatePalette()
  }, [palette, generatePalette])

  async function saveAll() {
    if (!palette) return
    setSaving(true); setError(null)
    try {
      const body: Record<string, unknown> = { palette, design_tokens: tokens }
      if (!isLocked) body.phase = 2
      const res = await fetch(`/api/content-jobs/${contentJobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to save')
      }
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="py-6 text-center">
        <div className="text-sm text-text-muted font-body">Extracting palette from logo...</div>
      </div>
    )
  }

  if (!palette) return null

  const minContrast = contrastRatio(palette.nearBlack.hex, palette.nearWhite.hex)
  const passesContrast = minContrast >= 4.5

  return (
    <div className="space-y-8">
      {/* Sub-step 1: Palette */}
      <section className="space-y-3">
        <h3 className="text-lg font-semibold font-heading">1. Color Palette</h3>
        {fromLogo === false && (
          <div className="text-sm text-text-muted font-body">
            No logo found — using neutral defaults. Edit any swatch below.
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {SWATCH_KEYS.map(key => (
            <SwatchEditor
              key={key}
              role={key}
              swatch={palette[key]}
              onChange={(next) => setPalette(prev => (prev ? { ...prev, [key]: next } : prev))}
            />
          ))}
        </div>
        <div className={`text-sm font-body ${passesContrast ? 'text-emerald-700' : 'text-red-700'}`}>
          Near-black / near-white contrast: {minContrast.toFixed(2)} {passesContrast ? '(WCAG AA)' : '(below WCAG AA — pick higher-contrast neutrals)'}
        </div>
      </section>

      {/* Sub-step 2: Type pairing */}
      <section className="space-y-3">
        <h3 className="text-lg font-semibold font-heading">2. Type Pairing</h3>
        <TypePairingPicker
          selectedId={tokens.typePairing.id}
          suggestedId={suggested.typePairing.id}
          onChange={setPairing}
          disabled={saving}
        />
      </section>

      {/* Sub-step 3: Roundness */}
      <section className="space-y-3">
        <h3 className="text-lg font-semibold font-heading">3. Roundness</h3>
        <TokenChipGroup<Roundness>
          label=""
          value={tokens.roundness}
          options={[
            { value: 'sharp', label: 'Sharp', hint: '4px' },
            { value: 'soft',  label: 'Soft',  hint: '8px' },
            { value: 'pill',  label: 'Pill',  hint: '9999px' },
          ]}
          onChange={(r) => setTokens(prev => ({ ...prev, roundness: r }))}
          disabled={saving}
        />
      </section>

      {/* Sub-step 4: Density */}
      <section className="space-y-3">
        <h3 className="text-lg font-semibold font-heading">4. Density</h3>
        <TokenChipGroup<Density>
          label=""
          value={tokens.density}
          options={[
            { value: 'tight',    label: 'Tight' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'airy',     label: 'Airy' },
          ]}
          onChange={(d) => setTokens(prev => ({ ...prev, density: d }))}
          disabled={saving}
        />
      </section>

      {/* Sub-step 5: Visual feel */}
      <section className="space-y-3">
        <h3 className="text-lg font-semibold font-heading">5. Visual Feel</h3>
        <TokenChipGroup<VisualFeel>
          label=""
          value={tokens.visualFeel}
          options={[
            { value: 'classic',   label: 'Classic' },
            { value: 'modern',    label: 'Modern' },
            { value: 'editorial', label: 'Editorial' },
          ]}
          onChange={(v) => setTokens(prev => ({ ...prev, visualFeel: v }))}
          disabled={saving}
        />
      </section>

      {error && <div className="text-sm text-red-700 font-body">{error}</div>}

      <button
        type="button"
        disabled={saving || !passesContrast}
        onClick={saveAll}
        className="px-6 py-3 rounded-full bg-brand-cyan text-white font-body disabled:opacity-50"
      >
        {saving ? 'Saving...' : isLocked ? 'Save changes' : 'Lock Design System & Continue'}
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Delete the old file**

```bash
git rm components/content/PalettePhase.tsx
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: one error — `app/admin/content/[id]/page.tsx` still imports `PalettePhase`. This is fixed in Task 13. Confirm the only error mentions `PalettePhase.tsx`.

- [ ] **Step 5: Commit**

```bash
git add components/content/DesignSystemPhase.tsx
git commit -m "feat(content): rename PalettePhase → DesignSystemPhase with sub-steps"
```

---

## Task 13: Swap the import in the admin page

**Files:**
- Modify: `app/admin/content/[id]/page.tsx`

- [ ] **Step 1: Inspect existing imports**

```bash
grep -n "PalettePhase\|design_tokens" app/admin/content/[id]/page.tsx
```

Note the line numbers for the import statement and the JSX usage. Note also whether the page already loads `design_tokens` from the content job (it doesn't yet).

- [ ] **Step 2: Update the import**

In `app/admin/content/[id]/page.tsx`, replace:

```ts
import PalettePhase from '@/components/content/PalettePhase'
```

with:

```ts
import DesignSystemPhase from '@/components/content/DesignSystemPhase'
```

- [ ] **Step 3: Update the JSX usage**

Find the existing `<PalettePhase ... />` element. Replace it with `<DesignSystemPhase ... />` and add the two new required props. The page's data-loading section also needs to read `design_tokens` and `schema_data.brand` from the existing queries — both should already be selected as part of the full row / schema load (verify by searching the file). If not, add them.

Example shape of the JSX:

```tsx
<DesignSystemPhase
  sessionId={contentJob.session_id}
  contentJobId={contentJob.id}
  existingPalette={contentJob.palette as PaletteData | null}
  existingTokens={contentJob.design_tokens as DesignTokens | null}
  brand={(session.schema_data as SessionSchema)?.brand}
  isLocked={contentJob.phase >= 2}
/>
```

Add the imports needed for `DesignTokens` and `SessionSchema` if not already present:

```ts
import type { DesignTokens } from '@/types/design-tokens'
import type { SessionSchema } from '@/types/session-schema'
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Security grep**

```bash
grep -r "SUPABASE_SERVICE_ROLE_KEY" ./app
```

Expected: zero matches.

- [ ] **Step 6: Commit**

```bash
git add app/admin/content/[id]/page.tsx
git commit -m "feat(content): wire DesignSystemPhase into admin page"
```

---

## Task 14: Package route emits `design.md`

**Files:**
- Modify: `app/api/content-jobs/[id]/package/route.ts`

- [ ] **Step 1: Update the content_jobs select**

In `app/api/content-jobs/[id]/package/route.ts`, find the existing `supabase.from('content_jobs').select(...)` (around line 56). Add `design_tokens` and `palette` to the select list:

```ts
  const { data: job } = await supabase
    .from('content_jobs')
    .select('session_id, confirmed_sitemap, palette, design_tokens')
    .eq('id', id)
    .single()
```

- [ ] **Step 2: Add the builder import**

Near the other `lib/content/*` imports at the top of the file, add:

```ts
import { buildDesignMd } from '@/lib/content/design-md-builder'
import type { PaletteData } from '@/types/palette'
import type { DesignTokens } from '@/types/design-tokens'
```

- [ ] **Step 3: Build `design.md`**

Find the existing `Promise.all([generateBrandDoc(schema), buildDocx(pages, firmName)])` line. After that block (the deterministic stitches section), insert:

```ts
  const palette = job.palette as PaletteData | null
  const designTokens = job.design_tokens as DesignTokens | null

  let designMd: string | null = null
  if (palette && designTokens) {
    designMd = buildDesignMd({
      firmName,
      palette,
      tokens: designTokens,
      brand: schema.brand,
      business: schema.business,
      location: schema.locations?.[0]
        ? { city: schema.locations[0].city, state: schema.locations[0].state }
        : null,
    })
  } else {
    console.warn(`[package] Skipping design.md — palette=${!!palette}, design_tokens=${!!designTokens}`)
  }
```

- [ ] **Step 4: Add the zip entry**

Find the existing `entries` array. Add a conditional entry for `design.md` right after the `brand.md` entry:

```ts
  const entries = [
    ...pageFiles.map(f => ({ path: `${folderName}/pages/${f.filename}`, content: f.content })),
    { path: `${folderName}/${folderName}.docx`, content: docxBuffer },
    { path: `${folderName}/brand.md`, content: brandDoc.fullDoc },
    ...(designMd ? [{ path: `${folderName}/design.md`, content: designMd }] : []),
    { path: `${folderName}/llms.txt`, content: llmsTxt },
    // ...rest unchanged
```

- [ ] **Step 5: Update OG_IMAGES_README**

Change the last line of the `OG_IMAGES_README` constant from:

```
- Brand palette colors (see brand.md)
```

to:

```
- Brand palette colors (see design.md)
```

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Security grep**

```bash
grep -r "SUPABASE_SERVICE_ROLE_KEY" ./app
```

Expected: zero matches.

- [ ] **Step 8: Commit**

```bash
git add app/api/content-jobs/[id]/package/route.ts
git commit -m "feat(content): emit design.md as part of deliverable zip"
```

---

## Task 15: Onboarding tweak — opportunistic personality/voice capture

**Files:**
- Modify: `lib/agent/phase-instructions.ts`

- [ ] **Step 1: Update the Phase 4 brand-block save instruction**

In `lib/agent/phase-instructions.ts`, find the line in `phase4Instructions()` that reads:

```
Save responses to brand.currentTone, brand.aspirationalTone, brand.toneAdjectives, brand.toneToAvoid, brand.primaryColors, brand.hasBrandGuide.
```

Replace it with:

```
Save responses to brand.currentTone, brand.aspirationalTone, brand.toneAdjectives, brand.toneToAvoid, brand.primaryColors, brand.hasBrandGuide. If the client volunteers personality language ("we're more like a..."), capture it in brand.brandPersonality. If they offer a memorable phrase that captures their voice, capture it verbatim in brand.voiceExample.
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors (it's a string change inside a function body).

- [ ] **Step 3: Verify the change**

```bash
grep -A1 "Save responses to brand" lib/agent/phase-instructions.ts
```

Expected: matches the new two-sentence ending.

- [ ] **Step 4: Commit**

```bash
git add lib/agent/phase-instructions.ts
git commit -m "feat(agent): opportunistic capture of brandPersonality and voiceExample"
```

---

## Task 16: End-to-end verification

**Files:**
- (none — manual checks against a real job)

This task verifies the full pipeline emits a spec-compliant `design.md` with all the right interpolations from a real content job. Pick an existing in-progress content job (or create a fresh one from a session that has been through the onboarding chat) and walk through the admin UI.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Open a second terminal for grep checks.

- [ ] **Step 2: Walk through admin Phase 1**

In the browser, navigate to `/admin/content/<jobId>` for a content job whose session has completed onboarding. Verify:

1. The page header reads "Design System" (or whatever wording you used in the page-level breadcrumb — check `app/admin/content/[id]/page.tsx`).
2. The component shows five numbered sub-steps: Color Palette · Type Pairing · Roundness · Density · Visual Feel.
3. The suggested type pairing has a "Suggested" badge.
4. Changing the dropdown updates the preview card.
5. Each chip group accepts a selection.
6. The button reads "Lock Design System & Continue" (or "Save changes" if `phase >= 2`).

- [ ] **Step 3: Lock the design system**

Click the lock button. Verify:

1. The page reloads.
2. In Supabase SQL Editor, run:
   ```sql
   SELECT phase, palette, design_tokens
   FROM content_jobs WHERE id = '<jobId>';
   ```
   Expected: `phase` is 2 (or higher if it was already past), `design_tokens` is a JSON object with `typePairing`, `roundness`, `density`, `visualFeel`.

- [ ] **Step 4: Run the package step**

If the job hasn't reached Phase 6 yet, advance through sitemap confirm → research → outline approval → content generation as needed. Then click "Assemble Package" (or whatever triggers the package route — check `DeliverablesPhase.tsx`).

- [ ] **Step 5: Download and inspect the zip**

Download the assembled package. Unzip it. Verify:

```bash
unzip -l <downloaded>.zip | grep -E "design\.md|brand\.md"
```

Expected: both `design.md` and `brand.md` are listed.

```bash
unzip -p <downloaded>.zip '*/design.md' | head -80
```

Expected:
- Starts with `<!-- Fonts: https://fonts.googleapis.com/...`
- Followed by `---\n` YAML block
- `name:` matches the firm name
- `colors.primary` matches the firm's locked palette primary
- After `---\n`, the markdown body has `## Overview`, `## Colors`, `## Typography`, `## Layout`, `## Elevation & Depth`, `## Shapes`, `## Components`, `## Do's and Don'ts` in that order

```bash
unzip -p <downloaded>.zip '*/brand.md' | grep -E "^##"
```

Expected: exactly `## Identity`, `## Positioning & Differentiation`, `## Industries Served` (in that order). **No `## Brand Voice`.**

- [ ] **Step 6: Verify OG_IMAGES_README update**

```bash
unzip -p <downloaded>.zip '*/og-images/README.md' | grep "design.md\|brand.md"
```

Expected: the line references `design.md`, not `brand.md`.

- [ ] **Step 7: Final type-check + commit any cleanups**

```bash
npx tsc --noEmit
```

Expected: no errors.

If the manual walkthrough revealed any rough edges that warrant fixes (copy tweaks, missing border colors, dropdown styling), make them as small follow-up commits.

- [ ] **Step 8: Final commit (only if there were cleanups)**

```bash
git add -A
git commit -m "chore(content): cleanup from design.md e2e walkthrough"
```

(Skip this step if nothing changed in Step 7.)

---

## Done criteria

- `design.md` appears in every newly-assembled content package.
- `brand.md` contains only Identity / Positioning / Industries Served — no Brand Voice.
- Admin Phase 1 collects palette + 4 design tokens; locking persists both `palette` and `design_tokens` to `content_jobs`.
- Auto-suggest produces a defensible starting point for every brand inputs combination (including empty).
- Both verification scripts (`test-suggest-design-tokens.ts`, `test-design-md-builder.ts`) pass with exit code 0.
- `npx tsc --noEmit` is clean.
- `grep -r "SUPABASE_SERVICE_ROLE_KEY" ./app` returns zero matches.
