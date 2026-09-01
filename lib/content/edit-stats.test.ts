import { describe, it, expect } from 'vitest'
import { aggregateEditStats, type EditCommit } from './edit-stats'

function commit(over: Partial<EditCommit>): EditCommit {
  return {
    message: 'Edit x.md via admin (a@b.com)',
    authorName: 'Alice',
    date: '2026-06-15T00:00:00Z',
    parentCount: 1,
    files: [{ path: 'content/pages/services.md', additions: 3, deletions: 1 }],
    ...over,
  }
}

describe('aggregateEditStats', () => {
  it('counts edits and sums churn per content file', () => {
    const agg = aggregateEditStats([
      commit({ files: [{ path: 'content/pages/services.md', additions: 5, deletions: 2 }] }),
      commit({ files: [{ path: 'content/pages/services.md', additions: 1, deletions: 4 }] }),
    ])
    const r = agg['content/pages/services.md']
    expect(r.editCount).toBe(2)
    expect(r.additions).toBe(6)
    expect(r.deletions).toBe(6)
  })

  it('splits AI vs manual by commit message', () => {
    const agg = aggregateEditStats([
      commit({ message: 'Edit services.md via AI (a@b.com)' }),
      commit({ message: 'Edit services.md via admin (a@b.com)' }),
      commit({ message: 'Edit FAQ on services.md via AI (a@b.com)' }),
    ])
    const r = agg['content/pages/services.md']
    expect(r.editCount).toBe(3)
    expect(r.aiCount).toBe(2)
    expect(r.manualCount).toBe(1)
  })

  it('ignores bulk deploy/publish and merge commits', () => {
    const agg = aggregateEditStats([
      commit({ message: 'Deploy packaged content via admin (a@b.com)' }),
      commit({ message: 'Publish draft to live' }),
      commit({ parentCount: 2, message: 'Merge draft' }),
      commit({ message: 'Edit services.md via admin (a@b.com)' }),
    ])
    expect(agg['content/pages/services.md'].editCount).toBe(1)
  })

  it('skips non-content files (nav.json, assets, configs)', () => {
    const agg = aggregateEditStats([
      commit({ files: [
        { path: 'content/nav.json', additions: 2, deletions: 0 },
        { path: 'content/brand.json', additions: 1, deletions: 0 },
        { path: 'public/content-assets/hero.jpg', additions: 0, deletions: 0 },
        { path: 'content/posts/s-corp.md', additions: 9, deletions: 0 },
      ] }),
    ])
    expect(Object.keys(agg)).toEqual(['content/posts/s-corp.md'])
    expect(agg['content/posts/s-corp.md'].editCount).toBe(1)
  })

  it('attributes last-edit to the newest commit regardless of input order', () => {
    const agg = aggregateEditStats([
      commit({ date: '2026-06-10T00:00:00Z', authorName: 'Old', message: 'Edit services.md via admin' }),
      commit({ date: '2026-06-20T00:00:00Z', authorName: 'New', message: 'Edit services.md via admin' }),
      commit({ date: '2026-06-14T00:00:00Z', authorName: 'Mid', message: 'Edit services.md via admin' }),
    ])
    const r = agg['content/pages/services.md']
    expect(r.editCount).toBe(3)
    expect(r.lastEditAt).toBe('2026-06-20T00:00:00Z')
    expect(r.lastAuthorName).toBe('New')
  })

  // The incremental edit-stats cache folds only NEW commits into the previously
  // computed aggregate. This must equal a full walk over all commits.
  describe('incremental fold (base aggregate)', () => {
    const older: EditCommit[] = [
      commit({ date: '2026-06-10T00:00:00Z', authorName: 'Alice', message: 'Edit services.md via admin', files: [{ path: 'content/pages/services.md', additions: 5, deletions: 2 }] }),
      commit({ date: '2026-06-11T00:00:00Z', authorName: 'Alice', message: 'Edit team.md via AI', files: [{ path: 'content/pages/team.md', additions: 4, deletions: 0 }] }),
    ]
    const newer: EditCommit[] = [
      commit({ date: '2026-06-20T00:00:00Z', authorName: 'Bob', message: 'Edit services.md via AI', files: [{ path: 'content/pages/services.md', additions: 1, deletions: 3 }] }),
      commit({ date: '2026-06-21T00:00:00Z', authorName: 'Bob', message: 'Edit about.md via admin', files: [{ path: 'content/pages/about.md', additions: 2, deletions: 2 }] }),
    ]

    it('fold(base, delta) equals a full walk over base + delta', () => {
      const base = aggregateEditStats(older)
      const incremental = aggregateEditStats(newer, base)
      const full = aggregateEditStats([...older, ...newer])
      expect(incremental).toEqual(full)
    })

    it('does not mutate the base aggregate', () => {
      const base = aggregateEditStats(older)
      const before = JSON.parse(JSON.stringify(base))
      aggregateEditStats(newer, base)
      expect(base).toEqual(before)
    })

    it('folds counts, churn, and last-edit across the two passes', () => {
      const base = aggregateEditStats(older)
      const agg = aggregateEditStats(newer, base)
      const svc = agg['content/pages/services.md']
      expect(svc.editCount).toBe(2)
      expect(svc.aiCount).toBe(1)
      expect(svc.manualCount).toBe(1)
      expect(svc.additions).toBe(6)
      expect(svc.deletions).toBe(5)
      expect(svc.lastEditAt).toBe('2026-06-20T00:00:00Z')
      expect(svc.lastAuthorName).toBe('Bob')
      expect(agg['content/pages/about.md'].editCount).toBe(1)
    })
  })
})
