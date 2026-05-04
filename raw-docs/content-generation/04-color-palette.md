# Step 04 — Color Palette Generation (Phase 1)

Build the color palette extraction and admin review UI. The palette is generated from the uploaded logo, presented for admin tweaking, then locked before Phase 2 begins.

---

## What We're Building

A server-side palette generation API route, a client-side palette review component with color swatch editors, and the logic to lock the palette into `content_jobs.palette`.

---

## Dependencies to Install

```bash
npm install node-vibrant chroma-js
npm install --save-dev @types/chroma-js
```

---

## Logo Detection

The logo is uploaded during Phase 5 of the onboarding chat and stored in the `assets` table with `asset_category = 'logo'`. Query:

```typescript
const { data: logoAsset } = await supabase
  .from('assets')
  .select('storage_path, file_name, mime_type')
  .eq('session_id', sessionId)
  .eq('asset_category', 'logo')
  .order('uploaded_at', { ascending: false })
  .limit(1)
  .single()
```

If no logo is found, Phase 1 presents a manual color picker instead of extraction.

---

## API Route: `/api/palette/generate`

```
POST /api/palette/generate
Body: { sessionId: string }
```

Server route (nodejs runtime). Steps:

1. Fetch logo from Supabase Storage using service role client
2. Convert to Buffer, pass to `Vibrant.from(buffer).getPalette()`
3. Extract swatches: Vibrant, DarkVibrant, Muted, LightMuted
4. Build palette using chroma.js:

```typescript
import Vibrant from 'node-vibrant'
import chroma from 'chroma-js'

const palette = await Vibrant.from(buffer).getPalette()

const primary   = palette.Vibrant?.hex ?? '#003B71'
const secondary = palette.DarkVibrant?.hex ?? palette.Muted?.hex ?? '#00C1DE'

// Complementary: rotate 180° on color wheel
const complementary = chroma(primary).set('hsl.h', (chroma(primary).get('hsl.h') + 180) % 360).hex()

// Action: high-contrast, attention-getting — use LightVibrant or boost saturation
const action = chroma(complementary).saturate(1).brighten(0.5).hex()

// Near-black: brand-tinted dark (not pure black)
const nearBlack = chroma(primary).darken(2.5).desaturate(0.3).hex()

// Near-white: brand-tinted light (not pure white)
const nearWhite = chroma(secondary).brighten(3).desaturate(1.5).hex()
```

5. Return palette object:
```typescript
{
  primary:       { hex, name: 'Primary' },
  secondary:     { hex, name: 'Secondary' },
  complementary: { hex, name: 'Complementary' },
  action:        { hex, name: 'Action' },
  nearBlack:     { hex, name: 'Text / Dark' },
  nearWhite:     { hex, name: 'Background / Light' },
}
```

6. Run WCAG contrast check: `nearBlack` on `nearWhite` must be ≥ 4.5:1. If not, darken `nearBlack` or lighten `nearWhite` until it passes.

---

## Palette Review UI (Phase 1 Card)

Client component. Displays six swatches in a 2×3 grid. Each swatch shows:
- Color preview square (64×64px)
- Swatch name label
- Hex value (editable text input)
- Small color picker trigger (native `<input type="color">`)

When admin edits a swatch, the contrast check re-runs live for nearBlack/nearWhite pair and shows a ✓ or ✗ indicator.

"Lock Palette & Continue" button:
- Saves palette to `content_jobs.palette` via PATCH `/api/content-jobs/[id]`
- Advances `content_jobs.phase` to `2`
- Reloads the phase stepper

---

## Files to Create/Modify

```
app/
  api/
    palette/
      generate/
        route.ts          — palette extraction endpoint (nodejs runtime)
    content-jobs/
      [id]/
        route.ts          — PATCH endpoint for updating job phase/data
components/
  content/
    PalettePhase.tsx      — Phase 1 card content (client component)
    SwatchEditor.tsx      — individual editable swatch
```

---

## Test Process

1. With an approved session that has a logo uploaded, hit `POST /api/palette/generate` — confirm a 6-color palette returns with valid hex values
2. Load `/admin/content/[id]` — confirm Phase 1 card shows the palette swatches
3. Edit a swatch hex value — confirm the preview updates and contrast check re-runs
4. Click "Lock Palette" — confirm `content_jobs.palette` is populated in Supabase and phase advances to 2
5. Test with a session that has no logo — confirm manual picker fallback appears
6. Run `npx tsc --noEmit` — zero errors
