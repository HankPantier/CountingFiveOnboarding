import { parseNavJson, serializeNavJson } from './nav-config'
import { contentPathToUrl, stripNavUrl } from './content-paths'
import {
  DRAFT_BRANCH,
  FileNotFoundError,
  StaleShaError,
  readFile,
  writeFile,
} from '@/lib/github/repo-files'
import type { NavItem } from '@/types/nav-json'

const NAV_PATH = 'content/nav.json'

// Minimal shape shared by every nav mutation: the repo slug plus the commit
// author. EditContext is structurally compatible, so callers pass it directly.
export interface NavMutationCtx {
  githubRepo: string
  adminName?: string
  adminEmail?: string
}

function author(ctx: NavMutationCtx) {
  return {
    authorName: ctx.adminName ?? 'CountingFive Admin',
    authorEmail: ctx.adminEmail ?? 'admin@countingfive.com',
  }
}

// Does any nav item (top-level or nested) already point at this url?
function navHasUrl(items: NavItem[], url: string): boolean {
  return items.some((i) => i.url === url || (i.children ? navHasUrl(i.children, url) : false))
}

// Append a primary nav item for a new page. When parentUrl is given and a
// matching item exists (at any depth), the new item is nested under it;
// otherwise it is appended at the top level. Best-effort: a missing or
// unparseable nav.json is non-fatal (the page still exists; the operator can add
// the link in the Navigation editor). A stale sha is retried once.
export async function appendNavItem(
  ctx: NavMutationCtx,
  label: string,
  url: string,
  parentUrl?: string
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let nav
    try {
      nav = await readFile(ctx.githubRepo, NAV_PATH, DRAFT_BRANCH)
    } catch (err) {
      if (err instanceof FileNotFoundError) return
      throw err
    }
    try {
      const parsed = parseNavJson(nav.content)
      if (navHasUrl(parsed.primary, url)) return

      const parent = parentUrl ? findNavItem(parsed.primary, parentUrl) : null
      if (parent) {
        parent.children = [...(parent.children ?? []), { label, url }]
      } else {
        parsed.primary.push({ label, url })
      }

      await writeFile(
        ctx.githubRepo,
        NAV_PATH,
        serializeNavJson(parsed),
        DRAFT_BRANCH,
        parent ? `Nest ${url} under ${parentUrl} in navigation` : `Add ${url} to navigation`,
        { expectedSha: nav.sha, ...author(ctx) }
      )
      return
    } catch (err) {
      if (err instanceof StaleShaError && attempt === 0) continue
      console.warn(`[nav-mutations] nav append skipped for ${url}:`, err)
      return
    }
  }
}

// Locate a nav item by url at any depth (returns a live reference into the tree).
function findNavItem(items: NavItem[], url: string): NavItem | null {
  for (const item of items) {
    if (item.url === url) return item
    if (item.children) {
      const nested = findNavItem(item.children, url)
      if (nested) return nested
    }
  }
  return null
}

// Remove the page's nav.json link in a follow-up draft commit so the live nav
// never points at a missing page. Non-fatal: nav may be absent or unparseable.
export async function stripNavReference(ctx: NavMutationCtx, contentPath: string): Promise<void> {
  const url = contentPathToUrl(contentPath)
  if (!url) return
  try {
    const nav = await readFile(ctx.githubRepo, NAV_PATH, DRAFT_BRANCH)
    const parsed = parseNavJson(nav.content)
    const { nav: next, changed } = stripNavUrl(parsed, url)
    if (!changed) return
    await writeFile(
      ctx.githubRepo,
      NAV_PATH,
      serializeNavJson(next),
      DRAFT_BRANCH,
      `Remove ${url} from navigation`,
      { expectedSha: nav.sha, ...author(ctx) }
    )
  } catch (err) {
    if (err instanceof FileNotFoundError) return
    console.warn(`[nav-mutations] nav strip skipped for ${contentPath}:`, err)
  }
}
