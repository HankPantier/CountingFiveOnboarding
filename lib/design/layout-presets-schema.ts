// Pure + client-safe. The zod input schema for a bundle's `layout` — split from
// layout-presets.ts so the zod-free vocabulary can ship in client chunks without zod.
import { z } from 'zod'
import { LAYOUT_PRESETS } from './layout-presets'

export const LayoutPresetsInputSchema = z
  .object({
    cards: z.enum(LAYOUT_PRESETS.cards.values).optional(),
    ctaBanner: z.enum(LAYOUT_PRESETS.ctaBanner.values).optional(),
    faq: z.enum(LAYOUT_PRESETS.faq.values).optional(),
    team: z.enum(LAYOUT_PRESETS.team.values).optional(),
    testimonials: z.enum(LAYOUT_PRESETS.testimonials.values).optional(),
  })
  .strict()
