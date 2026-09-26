// Pure + client-safe. The zod input schema for a bundle's `style` — split from
// style-axes.ts so the zod-free vocabulary can ship in client chunks without zod.
import { z } from 'zod'
import { STYLE_AXES } from './style-axes'

export const StyleAxesInputSchema = z
  .object({
    sectionRhythm: z.enum(STYLE_AXES.sectionRhythm.values).optional(),
    cards: z.enum(STYLE_AXES.cards.values).optional(),
    buttons: z.enum(STYLE_AXES.buttons.values).optional(),
    heroScale: z.enum(STYLE_AXES.heroScale.values).optional(),
    imageTreatment: z.enum(STYLE_AXES.imageTreatment.values).optional(),
    nav: z.enum(STYLE_AXES.nav.values).optional(),
    footer: z.enum(STYLE_AXES.footer.values).optional(),
    accentUsage: z.enum(STYLE_AXES.accentUsage.values).optional(),
  })
  .strict()
