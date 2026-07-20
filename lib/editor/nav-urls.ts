import type { NavItem, NavJson } from '@/types/nav-json'

// Editor-side nav item. Carries two fields that are NOT part of the public
// nav.json contract and are stripped before writing:
//  - `slug`: the item's own path segment; a nested item's url is parent + slug.
//  - `originalUrl`: the url the item had when the editor loaded, used to detect
//    that a page needs to move. Undefined for items created this session.
export type EditNavItem = {
  label: string
  url: string
  slug: string
  originalUrl?: string
  children?: EditNavItem[]
}

export type Move = { from: string; to: string }

export function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// Last path segment of a root-relative url (`/a/b/c` → `c`, `/` → '').
export function lastSegment(url: string): string {
  const stripped = url.replace(/^\/+|\/+$/g, '')
  if (!stripped) return ''
  return stripped.split('/').pop() ?? ''
}

function joinUrl(parentUrl: string, slug: string): string {
  return `${parentUrl.replace(/\/+$/, '')}/${slug}`
}

// Root-relative pathname of a nav url. Nav items may carry an absolute,
// host-prefixed url (e.g. `https://www.firm.com/who-we-are`) or an already
// root-relative one (`/services`); both map to `/who-we-are` / `/services`.
// Returns null for anything that isn't a resolvable page path (external hosts
// still parse, but callers compare pathnames, so a cross-host move collapses to
// the same path and is skipped). This is why page-move + redirect logic must
// normalize first — a raw `startsWith('/')` check silently drops absolute urls.
export function toPathname(url: string): string | null {
  let pathname: string
  if (/^https?:\/\//i.test(url)) {
    try {
      pathname = new URL(url).pathname
    } catch {
      return null
    }
  } else if (url.startsWith('/')) {
    pathname = url
  } else {
    return null
  }
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

// Seed editor items from a loaded nav: originalUrl = url, slug = last segment.
export function toEditItems(items: NavItem[]): EditNavItem[] {
  return items.map((it) => ({
    label: it.label,
    url: it.url,
    slug: lastSegment(it.url),
    originalUrl: it.url,
    children: it.children ? toEditItems(it.children) : undefined,
  }))
}

// Recompute every descendant's url from its parent's url + its slug. Top-level
// items keep their explicit url (they may be root-relative like `/services`, the
// homepage `/`, or an absolute external link) — only children are derived, which
// is exactly the "nesting drives the URL" behavior.
export function deriveNavUrls(
  items: EditNavItem[],
  parentUrl: string | null = null
): EditNavItem[] {
  return items.map((it) => {
    const url = parentUrl === null ? it.url : joinUrl(parentUrl, it.slug)
    return {
      ...it,
      url,
      children: it.children ? deriveNavUrls(it.children, url) : undefined,
    }
  })
}

// Strip editor-only fields, producing the public nav.json shape.
export function toNavItems(items: EditNavItem[]): NavItem[] {
  return items.map((it) => ({
    label: it.label,
    url: it.url,
    ...(it.children && it.children.length > 0
      ? { children: toNavItems(it.children) }
      : {}),
  }))
}

export function toNavJson(items: EditNavItem[], cta?: NavJson['cta']): NavJson {
  return { primary: toNavItems(items), ...(cta ? { cta } : {}) }
}

// Items whose original url differs from their current (derived) url — each one
// is a page that should move from `from` to `to`. New items (no originalUrl) and
// unchanged items produce nothing. Emits root-relative paths (host stripped) so
// downstream page-move and redirect logic works uniformly whether nav urls are
// absolute or relative; a change that only differs by host produces no move.
export function computeMoves(items: EditNavItem[]): Move[] {
  const moves: Move[] = []
  const walk = (list: EditNavItem[]) => {
    for (const it of list) {
      if (it.originalUrl) {
        const from = toPathname(it.originalUrl)
        const to = toPathname(it.url)
        if (from && to && from !== to) moves.push({ from, to })
      }
      if (it.children) walk(it.children)
    }
  }
  walk(items)
  return moves
}

// ---------------------------------------------------------------------------
// Reparenting — moving an item to become a child of another node.
// A path is an index array: [0, 1] = primary[0].children[1].
// ---------------------------------------------------------------------------

function nodeAtPath(root: EditNavItem[], path: number[]): EditNavItem | null {
  if (path.length === 0) return null
  let node: EditNavItem | undefined = root[path[0]]
  for (let k = 1; k < path.length && node; k++) node = node.children?.[path[k]]
  return node ?? null
}

function listAtPath(root: EditNavItem[], parent: number[]): EditNavItem[] | null {
  if (parent.length === 0) return root
  return nodeAtPath(root, parent)?.children ?? null
}

// Height of a node's subtree: 0 for a leaf, 1 for a node with only leaf children, etc.
function subtreeHeight(node: EditNavItem): number {
  if (!node.children || node.children.length === 0) return 0
  let max = 0
  for (const c of node.children) max = Math.max(max, subtreeHeight(c))
  return 1 + max
}

// True when `prefix` is an ancestor-or-self path of `path`.
function isPrefix(prefix: number[], path: number[]): boolean {
  if (prefix.length > path.length) return false
  for (let i = 0; i < prefix.length; i++) if (path[i] !== prefix[i]) return false
  return true
}

function samePath(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

// Move the item at `from` to become the last child of the node at `newParent`.
// Returns a NEW tree; the input is never mutated. Returns an unchanged clone if
// the move is invalid: newParent is empty, newParent is `from` itself or a
// descendant of it, either path doesn't resolve, or nesting would push the moved
// subtree past `maxDepth`. The moved item keeps its `originalUrl`, so a later
// deriveNavUrls + computeMoves emits the right {from,to} and redirects still fire.
export function reparentItems(
  items: EditNavItem[],
  from: number[],
  newParent: number[],
  maxDepth: number
): EditNavItem[] {
  const clone = structuredClone(items)
  if (from.length === 0 || newParent.length === 0) return clone
  if (isPrefix(from, newParent)) return clone // self or descendant

  const moving = nodeAtPath(clone, from)
  const dest = nodeAtPath(clone, newParent)
  if (!moving || !dest) return clone
  // dest's children live at depth `newParent.length` (0-based: path length − 1
  // for the child), so the moved subtree's deepest node sits at that + its height.
  if (newParent.length + subtreeHeight(moving) > maxDepth) return clone

  const ownerPath = from.slice(0, -1)
  const srcList = listAtPath(clone, ownerPath)
  if (!srcList) return clone
  const [removed] = srcList.splice(from[from.length - 1], 1)
  if (!removed) return clone
  if (ownerPath.length > 0) {
    const owner = nodeAtPath(clone, ownerPath)
    if (owner?.children && owner.children.length === 0) delete owner.children
  }
  // `dest` was captured before the splice, so its object identity is intact even
  // if the removal shifted sibling indices.
  dest.children = [...(dest.children ?? []), removed]
  return clone
}

// Nodes that `from` can legally nest under: every node except `from` itself, its
// descendants, and its current parent (a no-op), and only where the moved subtree
// fits within maxDepth. Used to build the "Move under…" picker and drag targets.
export function validReparentTargets(
  items: EditNavItem[],
  from: number[],
  maxDepth: number
): Array<{ path: number[]; label: string; url: string }> {
  const moving = nodeAtPath(items, from)
  if (!moving) return []
  const h = subtreeHeight(moving)
  const currentParent = from.slice(0, -1)
  const out: Array<{ path: number[]; label: string; url: string }> = []
  const walk = (list: EditNavItem[], path: number[]) => {
    list.forEach((node, i) => {
      const p = [...path, i]
      if (
        !isPrefix(from, p) &&
        !samePath(p, currentParent) &&
        p.length + h <= maxDepth
      ) {
        out.push({ path: p, label: node.label, url: node.url })
      }
      if (node.children) walk(node.children, p)
    })
  }
  walk(items, [])
  return out
}

// Order moves so a move whose target another move vacates runs AFTER that move —
// i.e. for a chain A→B, B→C, emit B→C before A→B so B is free when A→B runs.
// Falls back to input order for any residual cycle (which real nav edits can't form).
export function orderMoves(moves: Move[]): Move[] {
  const remaining = [...moves]
  const result: Move[] = []
  while (remaining.length > 0) {
    const i = remaining.findIndex(
      (m, idx) => !remaining.some((n, j) => j !== idx && n.from === m.to)
    )
    if (i === -1) {
      result.push(...remaining)
      break
    }
    result.push(remaining.splice(i, 1)[0])
  }
  return result
}
