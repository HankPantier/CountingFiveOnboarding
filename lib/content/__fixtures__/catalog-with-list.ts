// Test-only: a block-catalog module mock that adds a future `service-cards |
// list` layout (since 2026.09.9, the Phase 3 shape), with every catalog helper
// rebuilt on top of it so validators, the codec and prompt hints all see the
// same vocabulary. Use inside vi.mock('@/lib/content/block-catalog', …).
import type * as Catalog from '../block-catalog'

export const FUTURE_SINCE = '2026.09.9'

export async function catalogWithListLayout(importOriginal: () => Promise<typeof Catalog>) {
  const orig = await importOriginal()
  const serviceCards = orig.BLOCK_CATALOG['service-cards']
  const CAT = {
    ...orig.BLOCK_CATALOG,
    'service-cards': {
      ...serviceCards,
      variants: [...serviceCards.variants, { value: 'list', since: FUTURE_SINCE, layout: true as const }],
    },
  }
  const blockSpec = (id: string): Catalog.BlockSpec | undefined =>
    Object.prototype.hasOwnProperty.call(CAT, id) ? (CAT as Record<string, Catalog.BlockSpec>)[id] : undefined
  return {
    ...orig,
    BLOCK_CATALOG: CAT,
    blockSpec,
    blockVariantValues: (id: string) => blockSpec(id)?.variants.map((v) => v.value) ?? [],
    blockVariantValuesAt: (id: string, version: string | null | undefined) =>
      orig.variantValuesAt(blockSpec(id)?.variants ?? [], version),
    blockLabel: (id: string) => blockSpec(id)?.label ?? id,
  }
}
