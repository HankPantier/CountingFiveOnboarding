/**
 * After a save round-trip completes, clear the file's dirty buffer ONLY if it
 * still holds exactly the content that was sent. If the operator kept typing
 * while the save was in flight, the newer text must stay dirty (it has not been
 * saved yet) — deleting it would silently drop those keystrokes.
 *
 * Returns the same Map instance when nothing changes so React can bail out.
 */
export function reconcileDirtyAfterSave(
  dirty: ReadonlyMap<string, string>,
  path: string,
  sent: string,
): Map<string, string> {
  const current = dirty.get(path)
  if (current === undefined || current !== sent) return dirty as Map<string, string>
  const next = new Map(dirty)
  next.delete(path)
  return next
}
