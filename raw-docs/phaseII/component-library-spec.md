# CountingFive Component Block Library Spec

**Version:** 1.0  
**Status:** Draft  
**Scope:** Defines the 21 reusable page blocks used to assemble client websites from generated `.md` content files. This spec covers block identity, purpose, content slots, and design token dependencies. CSS authoring is out of scope for this version.

---

## Philosophy

- **Minimal markup.** Each block is the leanest HTML structure that fulfills its purpose. Styling is applied per-client using tokens from `brand.md` and `design.md` — not hardcoded in the component.
- **Content-slot driven.** Every block has defined required and optional content slots. The assembler passes only what's available; blocks render gracefully without optional slots.
- **Variant over proliferation.** Where blocks differ only in layout or background treatment, that difference is a variant prop — not a separate block. This keeps the library at a manageable 21.
- **Token references, not values.** Where this spec mentions colors, fonts, or spacing, it names the token (e.g., `color.primary`, `font.heading`) as defined in the client's `brand.md` and `design.md`. No hex values or pixel values appear here.

---

## Design Token Sources

All blocks reference tokens from two client-generated files included in every content package:

- **`brand.md`** — brand voice, color palette (primary, secondary, complementary, action, nearBlack, nearWhite), logo assets
- **`design.md`** — typography pairings (heading font, body font), spacing scale, border radius, shadow style, button style

Blocks should be built to consume these tokens via a single client theme configuration — not duplicated per block.

---

## Block Index

| # | Block ID | Category | Variants |
|---|---|---|---|
| 1 | `hero` | Hero | `image`, `video`, `slider` |
| 2 | `page-header` | Hero | — |
| 3 | `hero-split` | Hero | `image-right`, `image-left` |
| 4 | `intro-text` | Content | `centered`, `left-aligned` |
| 5 | `content-split` | Content | `image-right`, `image-left` |
| 6 | `content-prose` | Content | — |
| 7 | `checklist-section` | Content | `with-image`, `with-image-right`, `with-image-left`, `standalone` |
| 8 | `process-steps` | Content | `horizontal`, `vertical` |
| 9 | `feature-grid` | Cards | `3-col`, `4-col` |
| 10 | `service-cards` | Cards | `2-col`, `3-col` |
| 11 | `content-cards` | Cards | `3-col`, `2-col` |
| 12 | `team-grid` | Cards | `2-col`, `3-col`, `4-col` |
| 13 | `industry-cards` | Cards | `3-col`, `4-col` |
| 14 | `testimonials` | Social Proof | `carousel`, `grid` |
| 15 | `stats-bar` | Social Proof | `3-up`, `4-up` |
| 16 | `logo-bar` | Social Proof | — |
| 17 | `cta-banner` | Conversion | `color-bg`, `image-bg` |
| 18 | `pricing` | Conversion | `2-tier`, `3-tier`, `4-tier` |
| 19 | `faq-accordion` | Conversion | — |
| 20 | `form` | Conversion | `contact`, `quote`, `newsletter` |
| 21 | `content-table` | Utility | — |

---

## Block Definitions

---

### 1. `hero`

**Category:** Hero  
**Purpose:** Full-bleed, above-the-fold page opener. The dominant visual element on any page that uses it. Occupies 100% viewport width, typically 70–100vh tall.

**Variants:**
- `image` — static background image with optional overlay
- `video` — looping background video (muted autoplay); image fallback required
- `slider` — auto-advancing carousel of 2–5 slides, each with its own background image, headline, and optional CTA

**Content Slots:**

| Slot | Required | Type | Notes |
|---|---|---|---|
| `headline` | ✅ | text | Renders as H1. Should contain primary keyword. |
| `subheadline` | ✅ | text | 1–2 sentences. Renders as paragraph. |
| `cta_primary` | ✅ | `{ label, url }` | Main action button. |
| `cta_secondary` | ☐ | `{ label, url }` | Ghost or outline style secondary action. |
| `background_asset` | ✅ | url or url[] | Single URL for `image`/`video`; array for `slider`. |
| `overlay_opacity` | ☐ | number (0–1) | Darkens background for text legibility. Default: 0.4 |
| `slide_content` | slider only | `{ headline, subheadline, cta_primary, background_asset }[]` | Per-slide content for slider variant. |

**Design Token References:** `color.primary`, `color.nearWhite`, `font.heading`, `font.body`, `button.primary`

**Notes:**
- Only one `hero` block per page. Always the first block.
- Video variant must include a poster image for browsers that block autoplay.
- Slider variant: auto-advance interval 5–7 seconds, manual controls required for accessibility.

---

### 2. `page-header`

**Category:** Hero  
**Purpose:** Slim inner-page header. Used on secondary and tertiary pages where a full hero would be visually too heavy. Provides clear page identity without a large asset.

**Variants:** None (height and background color are styling concerns, not structural variants)

**Content Slots:**

| Slot | Required | Type | Notes |
|---|---|---|---|
| `headline` | ✅ | text | Renders as H1. |
| `subheadline` | ☐ | text | Short descriptor or tagline. |
| `breadcrumb` | ☐ | `{ label, url }[]` | Path from home to current page. |

**Design Token References:** `color.primary` (background), `color.nearWhite` (text), `font.heading`

**Notes:**
- Default for all inner pages unless the page spec calls for `hero` or `hero-split`.
- Background typically uses `color.primary` (brand navy) or a tinted variant.

---

### 3. `hero-split`

**Category:** Hero  
**Purpose:** Split-layout hero — text one side, image the other. Less dominant than `hero` but more visually rich than `page-header`. Good for key landing pages, About pages, and primary service pages.

**Variants:**
- `image-right` — text left column, image right column
- `image-left` — image left column, text right column

**Content Slots:**

| Slot | Required | Type | Notes |
|---|---|---|---|
| `headline` | ✅ | text | Renders as H1 or H2 depending on page position. |
| `subheadline` | ✅ | text | 2–3 sentences. |
| `cta_primary` | ✅ | `{ label, url }` | — |
| `cta_secondary` | ☐ | `{ label, url }` | — |
| `image` | ✅ | url | Fills the image column. Should be portrait or square crop. |
| `image_alt` | ✅ | text | Alt text for accessibility and SEO. |

**Design Token References:** `color.nearWhite`, `color.surface`, `font.heading`, `font.body`, `button.primary`

---

### 4. `intro-text`

**Category:** Content  
**Purpose:** Section opener — a headline and short paragraph that introduces what follows. Used to create breathing room and context between denser blocks.

**Variants:**
- `centered` — headline and paragraph centered, max-width constrained
- `left-aligned` — headline and paragraph left-aligned (better for sections that continue into left-aligned content)

**Content Slots:**

| Slot | Required | Type | Notes |
|---|---|---|---|
| `headline` | ✅ | text | Renders as H2. |
| `body` | ✅ | markdown | 1–3 short paragraphs. |
| `cta` | ☐ | `{ label, url }` | Optional link below the paragraph. |

**Design Token References:** `font.heading`, `font.body`, `color.nearBlack`, `color.primary`

**Notes:** Should not immediately follow `hero` without at least one other block in between — creates visual monotony.

---

### 5. `content-split`

**Category:** Content  
**Purpose:** The most versatile content block. Two-column layout: rich text narrative on one side, supporting image on the other. Handles most mid-page body content.

**Variants:**
- `image-right` — text left, image right
- `image-left` — image left, text right

**Content Slots:**

| Slot | Required | Type | Notes |
|---|---|---|---|
| `headline` | ✅ | text | Renders as H2. |
| `body` | ✅ | markdown | Full rich text. Supports H3, lists, bold. |
| `image` | ✅ | url | Supporting photo or illustration. |
| `image_alt` | ✅ | text | — |
| `cta` | ☐ | `{ label, url }` | — |

**Design Token References:** `font.heading`, `font.body`, `color.nearBlack`, `color.surface`

**Notes:**
- When multiple `content-split` blocks appear in sequence, Claude should alternate variants (`image-right` then `image-left`) to create visual rhythm. The validator enforces this.
- Do not use for FAQ, stats, or testimonial content — dedicated blocks exist for those.

---

### 6. `content-prose`

**Category:** Content  
**Purpose:** Full-width rich text. For long-form narrative sections that don't need a supporting image: About page body copy, blog posts, policy pages, detailed service explanations.

**Variants:** None

**Content Slots:**

| Slot | Required | Type | Notes |
|---|---|---|---|
| `headline` | ☐ | text | Renders as H2 if present. |
| `body` | ✅ | markdown | Full markdown — supports all heading levels, lists, blockquotes, bold, links. |

**Design Token References:** `font.heading`, `font.body`, `color.nearBlack`

**Notes:** Max-width constrained for readability (~720px). Should not be used for content that is better served by cards or grids — if content has natural parallel structure, use `feature-grid` or `service-cards` instead.

---

### 7. `checklist-section`

**Category:** Content  
**Purpose:** A branded list of benefits, inclusions, or qualifications — each item marked with a checkmark icon. Highly effective for "what's included," eligibility criteria, or service feature lists.

**Variants:**
- `with-image` — checklist items with a supporting image on the right (legacy default)
- `with-image-right` — explicit: checklist on the left, image on the right
- `with-image-left` — checklist on the right, image on the left
- `standalone` — full-width checklist, centered or 2-column layout

**Content Slots:**

| Slot | Required | Type | Notes |
|---|---|---|---|
| `headline` | ✅ | text | Renders as H2. |
| `intro` | ☐ | text | 1–2 sentences before the list. |
| `items` | ✅ | string[] | Each item is one checklist entry. |
| `image` | ☐ | url | Required for `with-image` variant. |
| `image_alt` | ☐ | text | Required if image present. |
| `cta` | ☐ | `{ label, url }` | — |

**Design Token References:** `color.action` (checkmark icon), `font.body`, `color.nearBlack`, `color.surface`

---

### 8. `process-steps`

**Category:** Content  
**Purpose:** Numbered or icon-driven sequence of steps. Used for "how we work," onboarding flows, service delivery process, tax preparation timeline.

**Variants:**
- `horizontal` — steps displayed left to right with connecting line (best for 3–5 steps)
- `vertical` — steps stacked vertically (better for 5+ steps or longer descriptions)

**Content Slots:**

| Slot | Required | Type | Notes |
|---|---|---|---|
| `headline` | ✅ | text | Renders as H2. |
| `intro` | ☐ | text | — |
| `steps` | ✅ | `{ number, title, description }[]` | 3–7 steps. Number is display text ("01", "1", or icon name). |
| `cta` | ☐ | `{ label, url }` | — |

**Design Token References:** `color.primary` (step number/icon bg), `color.nearWhite` (step number text), `font.heading`, `font.body`

---

### 9. `feature-grid`

**Category:** Cards  
**Purpose:** Grid of equal-weight feature cards. Each card has an icon, short headline, and brief description. Used for services overview, benefits, differentiators, or "why us" sections.

**Variants:**
- `3-col` — 3 cards per row (default)
- `4-col` — 4 cards per row (better for 8+ items)

**Content Slots:**

| Slot | Required | Type | Notes |
|---|---|---|---|
| `headline` | ✅ | text | Section H2. |
| `intro` | ☐ | text | — |
| `items` | ✅ | `{ icon, title, description }[]` | 3–8 items. Icon is a name string (maps to icon library). |

**Design Token References:** `color.primary`, `color.surface`, `font.heading`, `font.body`, `border.radius`, `shadow.subtle`

**Notes:** Not appropriate for content with more than 2–3 sentences per item — use `service-cards` instead.

---

### 10. `service-cards`

**Category:** Cards  
**Purpose:** Larger, richer cards for primary service or industry listings. Each card has a title, paragraph description, and a link. More visual weight than `feature-grid`.

**Variants:**
- `2-col` — 2 cards per row
- `3-col` — 3 cards per row (default)

**Content Slots:**

| Slot | Required | Type | Notes |
|---|---|---|---|
| `headline` | ✅ | text | Section H2. |
| `intro` | ☐ | text | — |
| `cards` | ✅ | `{ title, description, url, image? }[]` | 2–9 cards. Image is optional. |

**Design Token References:** `color.surface`, `color.primary`, `color.action`, `font.heading`, `font.body`, `border.radius`, `shadow.card`

---

### 11. `content-cards`

**Category:** Cards  
**Purpose:** Generic card grid for blog posts, resources, case studies, or news items. Image-forward with title, excerpt, and link.

**Variants:**
- `3-col` — default
- `2-col` — better for longer excerpts

**Content Slots:**

| Slot | Required | Type | Notes |
|---|---|---|---|
| `headline` | ✅ | text | Section H2. |
| `cards` | ✅ | `{ title, excerpt, url, image, date? }[]` | 2–6 cards. |
| `cta` | ☐ | `{ label, url }` | "View all" link below grid. |

**Design Token References:** `color.surface`, `color.nearBlack`, `font.heading`, `font.body`, `border.radius`, `shadow.card`

---

### 12. `team-grid`

**Category:** Cards  
**Purpose:** Staff and partner cards. Photo, name, title, credentials, short bio. The primary block for /about/our-team pages.

**Variants:**
- `2-col` — for 2–4 people with longer bios
- `3-col` — default (most teams)
- `4-col` — for larger teams with shorter bios

**Content Slots:**

| Slot | Required | Type | Notes |
|---|---|---|---|
| `headline` | ✅ | text | Section H2. |
| `intro` | ☐ | text | — |
| `members` | ✅ | `{ name, title, credentials?, bio, photo, photo_alt }[]` | — |

**Design Token References:** `color.surface`, `color.nearBlack`, `font.heading`, `font.body`, `border.radius`

---

### 13. `industry-cards`

**Category:** Cards  
**Purpose:** Industry or niche specialty cards. Icon-forward (no photo), with title and short description. Distinct from `service-cards` in that industries are verticals, not deliverables.

**Variants:**
- `3-col` — default
- `4-col` — for 8+ industries

**Content Slots:**

| Slot | Required | Type | Notes |
|---|---|---|---|
| `headline` | ✅ | text | Section H2. |
| `intro` | ☐ | text | — |
| `industries` | ✅ | `{ icon, title, description, url? }[]` | — |

**Design Token References:** `color.primary`, `color.surface`, `font.heading`, `font.body`, `border.radius`

---

### 14. `testimonials`

**Category:** Social Proof  
**Purpose:** Client quotes presented as testimonial cards. Builds credibility and social proof. Used on homepage, service pages, and About pages.

**Variants:**
- `carousel` — single testimonial at a time, auto-advances, manual controls
- `grid` — 2–3 testimonials visible simultaneously

**Content Slots:**

| Slot | Required | Type | Notes |
|---|---|---|---|
| `headline` | ☐ | text | Section H2. Optional — testimonials often appear without a heading. |
| `testimonials` | ✅ | `{ quote, name, title, company?, rating? }[]` | 2–6 items. Rating is 1–5. |

**Design Token References:** `color.surface`, `color.primary`, `font.body`, `font.heading`, `color.action` (star rating)

---

### 15. `stats-bar`

**Category:** Social Proof  
**Purpose:** Horizontal band of 3–4 large numeric figures. High visual impact, low word count. Communicates scale and credibility quickly ("25+ years · 400+ clients · 3 CPAs on staff").

**Variants:**
- `3-up` — 3 stats
- `4-up` — 4 stats

**Content Slots:**

| Slot | Required | Type | Notes |
|---|---|---|---|
| `stats` | ✅ | `{ value, label }[]` | 3 or 4 items. Value is the large number ("25+"). Label is the descriptor. |

**Design Token References:** `color.primary` (background), `color.nearWhite` (text), `font.heading` (large number), `font.body` (label)

**Notes:** Background is typically `color.primary` or `color.secondary`. All text should pass WCAG AA contrast against the background.

---

### 16. `logo-bar`

**Category:** Social Proof  
**Purpose:** A horizontal strip of certification badges, association logos, or partner marks. Purely visual trust signal. Often appears near the bottom of a homepage or About page.

**Variants:** None

**Content Slots:**

| Slot | Required | Type | Notes |
|---|---|---|---|
| `headline` | ☐ | text | Short label like "Memberships & Certifications." |
| `logos` | ✅ | `{ src, alt, url? }[]` | 3–8 logos. URL makes logo a link. |

**Design Token References:** `color.surface`, `color.nearBlack`

**Notes:** Logos should be displayed at consistent height (~48px) regardless of aspect ratio. Grayscale display with color on hover is a common pattern but a styling decision.

---

### 17. `cta-banner`

**Category:** Conversion  
**Purpose:** A full-width call-to-action section. Headline, short supporting copy, and a primary button. The most direct conversion prompt on a page.

**Variants:**
- `color-bg` — solid brand color background (typically `color.primary` or `color.action`)
- `image-bg` — background image with text overlay

**Content Slots:**

| Slot | Required | Type | Notes |
|---|---|---|---|
| `headline` | ✅ | text | 1 sentence, action-oriented. |
| `body` | ☐ | text | 1–2 sentences of supporting copy. |
| `cta_primary` | ✅ | `{ label, url }` | — |
| `cta_secondary` | ☐ | `{ label, url }` | — |
| `background_asset` | ☐ | url | Required for `image-bg` variant. |

**Design Token References:** `color.primary` or `color.action` (bg), `color.nearWhite` (text), `button.primary`, `button.secondary`, `font.heading`

---

### 18. `pricing`

**Category:** Conversion  
**Purpose:** Service tier pricing display. Presents 2–4 pricing tiers in a card layout, each with a name, price, feature list, and CTA. Used for bookkeeping packages, retainer services, or any tiered offering.

**Variants:**
- `2-tier` — 2 pricing cards
- `3-tier` — 3 pricing cards (default; center card is typically "recommended")
- `4-tier` — 4 pricing cards

**Content Slots:**

| Slot | Required | Type | Notes |
|---|---|---|---|
| `headline` | ✅ | text | Section H2. |
| `intro` | ☐ | text | — |
| `tiers` | ✅ | `{ name, price, price_period?, description, features: string[], cta: { label, url }, highlighted?: boolean }[]` | `highlighted: true` marks the recommended tier. |
| `disclaimer` | ☐ | text | Small print below cards ("Prices starting from..."). |

**Design Token References:** `color.surface`, `color.primary` (highlighted card), `color.nearWhite` (highlighted card text), `color.action` (feature checkmarks), `font.heading`, `font.body`, `border.radius`, `shadow.card`

---

### 19. `faq-accordion`

**Category:** Conversion  
**Purpose:** Expandable question-and-answer pairs. Optimized for People Also Ask / featured snippet capture and LLM citation. Always the last content block before `cta-banner` or `form`.

**Variants:** None

**Content Slots:**

| Slot | Required | Type | Notes |
|---|---|---|---|
| `headline` | ✅ | text | Default: "Frequently Asked Questions." Can be keyword-specific: "Common Questions About Virtual CFO Services." |
| `items` | ✅ | `{ question, answer }[]` | 3–8 items. Source: `faq_block` from generated metadata. |

**Design Token References:** `color.surface`, `color.nearBlack`, `color.primary` (expand icon / active state), `font.heading`, `font.body`, `border.default`

**Notes:**
- This block is **auto-appended** by the deliverable builder — it is not chosen by Claude during content generation.
- Source data: `generated_pages.faq_block` (structured Q&A generated in Phase 5).
- The annotation `<!-- block: faq-accordion -->` is added programmatically in `deliverable-builder.ts`, not via Claude's inline annotation.

---

### 20. `form`

**Category:** Conversion  
**Purpose:** Generic form block for any lead capture, contact, or quote request. The variant determines the field set; all variants share the same structural component.

**Variants:**
- `contact` — name, email, phone, message, submit
- `quote` — name, email, phone, service (dropdown), message, submit
- `newsletter` — email only, inline layout

**Content Slots:**

| Slot | Required | Type | Notes |
|---|---|---|---|
| `headline` | ✅ | text | Section H2 or form header. |
| `intro` | ☐ | text | Short copy above the form. |
| `sidebar_content` | ☐ | markdown | Optional right-column content: office address, phone, hours. |
| `success_message` | ☐ | text | Message shown after successful submission. |

**Design Token References:** `color.surface`, `color.primary`, `color.action`, `font.body`, `border.radius`, `button.primary`

**Notes:** Form submission handling (API endpoint, email routing) is outside this spec. The block provides the markup structure only.

---

### 21. `content-table`

**Category:** Utility  
**Purpose:** Comparison or data table. Used for service comparisons, pricing tiers (alternative to `pricing`), tax deadline calendars, or redirect mapping references in developer-facing content.

**Variants:** None (responsive behavior is a styling concern)

**Content Slots:**

| Slot | Required | Type | Notes |
|---|---|---|---|
| `headline` | ☐ | text | Section H2. |
| `intro` | ☐ | text | — |
| `headers` | ✅ | string[] | Column headers. |
| `rows` | ✅ | string[][] | Table rows as 2D array. |
| `caption` | ☐ | text | Table caption (appears below). |

**Design Token References:** `color.surface`, `color.primary` (header row), `color.nearWhite` (header text), `font.body`, `border.default`

---

## Appendix: Block Selection Quick Reference

This condensed table is intended for the Phase 5 content generation prompt — a compact catalog Claude uses when selecting block annotations.

| Block ID | Use when the section contains... |
|---|---|
| `hero` | Page opener with background image, video, or slides |
| `page-header` | Inner page title with no large visual |
| `hero-split` | Page opener with side-by-side text + image |
| `intro-text` | Short headline + paragraph transition between sections |
| `content-split` | A narrative paragraph + supporting image |
| `content-prose` | Long-form copy with no supporting image |
| `checklist-section` | A list of benefits, inclusions, or qualifying criteria |
| `process-steps` | A numbered or sequential how-it-works explanation |
| `feature-grid` | 3–8 equal-weight features, each with icon + short description |
| `service-cards` | 2–9 named services or offerings with descriptions + links |
| `content-cards` | Blog posts, articles, or resources with images |
| `team-grid` | Staff or partner profiles with photos |
| `industry-cards` | Industry or niche verticals with icons |
| `testimonials` | Client quotes or reviews |
| `stats-bar` | 3–4 numeric proof points (years, clients, staff) |
| `logo-bar` | Certification badges or association logos |
| `cta-banner` | A direct call to action with a single button |
| `pricing` | Tiered service packages with feature lists and prices |
| `faq-accordion` | Q&A pairs — auto-appended, not Claude-selected |
| `form` | A lead capture, contact, or newsletter signup form |
| `content-table` | Comparison data, calendars, or structured reference info |
