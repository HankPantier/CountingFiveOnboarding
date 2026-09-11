// Pure helpers for the outline proofing UI. Kept out of the component so the
// "walk to the next outline that still needs a human" logic is unit-testable.

export type OutlineApprovalState = {
  id: string
  h1: string | null
  admin_approved: boolean
}

// An outline is "pending review" once it has generated (h1 present) but hasn't
// been approved. Still-generating outlines (h1 null) are not offered for review.
export function isPendingReview(o: OutlineApprovalState): boolean {
  return !!o.h1 && !o.admin_approved
}

// The next outline a reviewer should look at after acting on `currentId`:
// the first pending one AFTER it in list order, wrapping to the first pending
// one before it if none follow. Returns null when nothing else needs review.
export function nextPendingOutlineId<T extends OutlineApprovalState>(
  outlines: T[],
  currentId: string,
): string | null {
  const eligible = (o: T) => o.id !== currentId && isPendingReview(o)
  const idx = outlines.findIndex(o => o.id === currentId)
  const next =
    (idx >= 0 ? outlines.slice(idx + 1).find(eligible) : undefined) ??
    outlines.find(eligible)
  return next ? next.id : null
}
