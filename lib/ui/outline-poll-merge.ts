/**
 * Merge a freshly polled list of outlines into the local (possibly edited) list.
 *
 * The outline review screen polls the server every few seconds while outlines
 * generate. Replacing local state wholesale would wipe an operator's unsaved
 * edits (typed H1, reordered sections, notes) on the next tick. Rule:
 *   - Server order and membership are authoritative (new rows appear, deleted
 *     rows disappear).
 *   - A row the operator has edited locally (id in `dirtyIds`) keeps its local
 *     copy, so in-progress edits survive the poll.
 *   - Every other row adopts the server version (status, generated H1, etc.).
 *   - `serverOwnedKeys` are always taken from the server even on a dirty row —
 *     status fields (e.g. `admin_approved` flipped by "Approve all") must not be
 *     masked by a local edit.
 */
export function mergePolledOutlines<T extends { id: string }, K extends keyof T = never>(
  local: readonly T[],
  server: readonly T[],
  dirtyIds: ReadonlySet<string>,
  serverOwnedKeys: readonly K[] = [],
): T[] {
  if (dirtyIds.size === 0) return [...server]
  const localById = new Map(local.map((o) => [o.id, o]))
  return server.map((row) => {
    if (!dirtyIds.has(row.id)) return row
    const mine = localById.get(row.id)
    if (!mine) return row
    const merged: T = { ...mine }
    for (const key of serverOwnedKeys) merged[key] = row[key]
    return merged
  })
}
