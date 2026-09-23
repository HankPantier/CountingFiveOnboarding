import { describe, it, expect } from 'vitest'
import { fetchAllPages } from './paginate'

function source(total: number) {
  const all = Array.from({ length: total }, (_, i) => i)
  const calls: Array<[number, number]> = []
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to])
    return { data: all.slice(from, to + 1), error: null }
  }
  return { fetchPage, calls }
}

describe('fetchAllPages', () => {
  it('reads past the 1000-row cap', async () => {
    const { fetchPage, calls } = source(2500)
    const rows = await fetchAllPages(fetchPage)
    expect(rows).toHaveLength(2500)
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })
  it('makes one extra call when total is an exact multiple', async () => {
    const { fetchPage, calls } = source(2000)
    expect(await fetchAllPages(fetchPage)).toHaveLength(2000)
    expect(calls).toHaveLength(3)
  })
  it('respects maxRows', async () => {
    const { fetchPage } = source(5000)
    expect(await fetchAllPages(fetchPage, { maxRows: 1500 })).toHaveLength(1500)
  })
  it('throws on error', async () => {
    await expect(
      fetchAllPages(async () => ({ data: null, error: { message: 'boom' } }))
    ).rejects.toThrow('boom')
  })
})
