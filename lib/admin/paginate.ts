// PostgREST caps every response at the project's max-rows (1000 by default),
// so a plain `.select()` / `.range(0, 49999)` silently truncates. Loop in
// fixed-size pages until a short page comes back.
//
// `fetchPage(from, to)` must apply a STABLE order (e.g. created_at + id) so
// pages don't overlap or skip rows. `maxRows` is a safety valve against an
// unbounded read; the default is generous for admin reporting.

export interface PageResult<T> {
  data: T[] | null
  error: { message: string } | null
}

export const DEFAULT_PAGE_SIZE = 1000

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  opts: { pageSize?: number; maxRows?: number } = {}
): Promise<T[]> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE
  const maxRows = opts.maxRows ?? 500_000
  const out: T[] = []
  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize, maxRows) - 1
    const { data, error } = await fetchPage(from, to)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < to - from + 1) break
  }
  return out
}
