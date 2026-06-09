import { after } from 'next/server'
import { splitFile } from '@/lib/editor/frontmatter'
import { reviewContentForMbpImpact } from '@/lib/mbp/impact-review'

// Derive a readable page/post reference from a content file path.
//   content/pages/services--tax.md   → /services/tax
//   content/pages/home.md            → /
//   content/posts/year-end-tips.md   → /resources/year-end-tips
function sourceRefForPath(path: string): string | null {
  if (path.startsWith('content/pages/')) {
    const slug = path.slice('content/pages/'.length, -3)
    return slug === 'home' ? '/' : `/${slug.replace(/--/g, '/')}`
  }
  if (path.startsWith('content/posts/')) {
    return `/resources/${path.slice('content/posts/'.length, -3)}`
  }
  return null
}

// Fire the MBP impact review for a content-editor file write (manual save or
// AI agent). No-op for non-content files (nav.json, social, assets). Runs in
// the background via after() — never blocks the edit.
export function reviewContentEdit(sessionId: string, path: string, fullContent: string): void {
  const sourceRef = sourceRefForPath(path)
  if (!sourceRef) return
  const body = splitFile(fullContent).body
  if (!body.trim()) return

  after(() =>
    reviewContentForMbpImpact({
      sessionId,
      origin: 'content_edit',
      sourceRef,
      changedText: body,
    }).catch(err => console.error('[mbp-impact] content_edit review failed:', err))
  )
}
