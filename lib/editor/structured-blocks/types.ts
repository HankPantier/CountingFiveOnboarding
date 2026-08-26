// Shared models for the inline structured-block editors. These describe the
// editable *fields* of a block for rendering; every mutation is a byte-surgical
// in-place line rewrite (see card-blocks.ts / team-grid.ts), never a
// re-serialization of the whole block — the same discipline team-photos.ts and
// icon-items.ts follow, so intros, spacing, images, links, and the annotation
// itself survive untouched.

/** The five block families that get an inline field editor. */
export type StructuredBlockId =
  | 'feature-grid'
  | 'service-cards'
  | 'industry-cards'
  | 'team-grid'
  | 'faq-accordion'

/** feature-grid / industry-cards use icon bullets or ### chunks; service-cards uses ### chunks. */
export type CardKind = 'bullet' | 'chunk'

export type CardModel = {
  /** 0-based position within its block — the rewrite target. */
  index: number
  kind: CardKind
  title: string
  description: string
  /** Explicit icon name, or null (site renders CheckCircle). */
  icon: string | null
  /** service-cards trailing `[label](url)` CTA, when present. */
  link: { label: string; url: string } | null
}

export type CardBlockModel = {
  blockId: 'feature-grid' | 'service-cards' | 'industry-cards'
  heading: string
  cards: CardModel[]
}

export type TeamMemberModel = {
  index: number
  /** Full heading text after `### ` (name + any comma-separated credentials). */
  name: string
  /** Optional short job-title line under the heading. */
  title: string | null
  photo: string | null
  bio: string
}

export type TeamGridModel = {
  heading: string
  members: TeamMemberModel[]
}
