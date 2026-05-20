# Phase II — Visual Polish Notes

A working log of per-client visual refinement patterns. This document is **descriptive, not prescriptive** — it records what we learn from real client sites so the next pass can move faster.

The Phase II template ships with sensible defaults driven by `brand.json`, `design.json`, and `nav.json`. Most clients are 90% done by `npm run unpack <zip>` + `npx tsx scripts/generate-theme.ts`. The remaining 10% is per-client polish: spacing nudges, shadow depth, type rhythm, photography treatment. That work lives in `content/design-overrides.css`.

---

## The override seam

There is exactly one place to add per-client visual tweaks: `content/design-overrides.css`. It is imported by `src/app/globals.css` AFTER `src/styles/theme.css`, so anything written here wins the cascade without `!important`.

Target blocks via the `data-block` attribute that `Section.tsx` already emits on every block wrapper:

```css
[data-block="hero"] { /* hero-specific tweaks */ }
[data-block="feature-grid"] h2 { /* heading inside one block */ }
[data-block="cta-banner"] [class*="rounded-pill"] { /* CTA buttons */ }
```

Cascade order (rightmost wins): `tailwindcss` → `theme.css` → `design-overrides.css`.

**Workflow:** `npm run export-brief` → paste into Claude.ai Design → save returned CSS as `content/design-overrides.css` → `npm run dev`. The export-brief script captures the brand JSON + currently-rendered block markup so Claude can produce overrides that match the page.

---

## What NOT to undo (validated patterns from the template audit)

These are easy to "polish away" without realizing they're load-bearing. Don't remove without a replacement.

### Theme generation
- **HSL values inside `@theme {}` MUST be wrapped in `hsl()`.** Tailwind v4 won't read them as colors otherwise. The generator (`scripts/generate-theme.ts`) wraps them; don't strip the wrapping in overrides.
- **Chroma palette manipulation uses `.set('hsl.l', l/100)`, not bare `[h,s,l]` arrays.** Bare arrays default to RGB and produce silently wrong tints (e.g. muted/border colors became `358 100% 7%` instead of intended light grays).

### Hero / CtaBanner backgrounds
- Hero and CtaBanner full-bleed backgrounds use `<Image priority fill />` with a navy-tinted overlay div, **not** inline `style.backgroundImage`. This keeps LCP scoring intact and lets Next.js serve responsive AVIF/WebP. Don't switch back to inline backgrounds in overrides — adjust the overlay opacity instead.

### Hydration safety
- `NavCurationPhase` (admin) and any other `@dnd-kit` consumer is mount-gated: `useState(false)` + `useEffect(() => setMounted(true), [])`. dnd-kit assigns sequential accessibility-announcement IDs that diverge between SSR and client mount. Don't remove the gate to "clean up" the loading flash — the alternative is a hydration error.

### Module-level config caches
- `lib/brand/`, `lib/nav/`, `lib/theme/` cache parsed config at module level, **gated on `NODE_ENV === 'production'`.** In dev, every request re-reads the file so HMR + content edits feel live. In prod, the file is read once. Don't unify the two paths.

### Semantic markup we shipped intentionally
| Block | Markup detail | Why |
|---|---|---|
| `stats-bar` | `<dl>/<dt>/<dd>` not `<div>` triplets | Better SEO + screen-reader semantics |
| `faq-accordion` | trigger wrapped in `<h3 className="m-0">` | Required for FAQ rich-result eligibility |
| `testimonials` | `<cite>` for attribution; ARIA on carousel controls | Quote provenance + a11y |
| `team-grid` | `<h3>` for names; `Person` microdata | Knowledge-panel signals |
| `content-cards` | `<article>` + `<time dateTime>` | Article schema fallback when no JSON-LD |

If you "simplify" any of these in overrides, you cost search visibility.

### Icons
- `Icon.tsx` is an explicit allowlist of ~45 lucide icons, not a barrel import. Adding a new icon to overrides requires extending `ICON_MAP`. The allowlist exists for bundle size; don't replace it with `import * as Icons from 'lucide-react'`.
- Branded social icons (Facebook, LinkedIn, etc.) are inline SVG in `SocialIcon.tsx` because lucide-react v1.16 dropped branded icons.

### Form handling
- `Form.tsx` uses `<ReactMarkdown>` for any markdown body, never `dangerouslySetInnerHTML`. Frontmatter is user-supplied; treat it as untrusted.

---

## Per-client patterns log

> Append entries as real client sites get polished. Keep them tight: what the client asked for, the override that delivered it, and the principle worth reusing.

_(no entries yet — the first 3 client sites will fill this in)_

### Suggested entry format

```markdown
### Client codename · YYYY-MM-DD

**Brief:** One sentence on what felt off in the default rendering.

**Override:**
\`\`\`css
[data-block="..."] { ... }
\`\`\`

**Principle:** Generalized takeaway — when does this pattern apply elsewhere?
```

---

## When to back-port to the template

If the same override appears in 3+ client sites, it's no longer per-client polish — it's a template default that didn't ship. Lift it into:

- `scripts/generate-theme.ts` if it's a theme variable
- The relevant block component if it's structural
- `src/app/globals.css` if it's site-wide typography or spacing

Then delete the override from each client's `design-overrides.css` and verify nothing visually regresses.
