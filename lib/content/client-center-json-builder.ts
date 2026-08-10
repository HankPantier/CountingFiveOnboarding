import type { SessionSchema } from '@/types/session-schema'
import type { ClientCenterJson, ClientCenterGroup, ClientPortalLink } from '@/types/client-center'

// Group with no category falls here so ungrouped portals still render.
const DEFAULT_GROUP = 'Client Resources'
const DEFAULT_LABEL = 'Client Center'

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Project the flat, agent-gathered `schema.clientPortals` into the grouped
 * `content/client-center.json` contract the client-site template reads.
 *
 * - Entries without a usable URL are dropped (a portal link is nothing without
 *   its destination).
 * - Entries are grouped by `category` (trimmed); uncategorized ones fall into a
 *   single "Client Resources" group. Group order follows first appearance so the
 *   rep's ordering is preserved.
 * - `enabled` is derived from "has at least one link" so a firm with no portals
 *   ships a valid-but-off config and the template hides the nav button.
 */
export function buildClientCenterJson(schema: SessionSchema): ClientCenterJson {
  const portals = Array.isArray(schema.clientPortals) ? schema.clientPortals : []

  const groupsByTitle = new Map<string, ClientCenterGroup>()
  const order: string[] = []

  for (const portal of portals) {
    if (!portal || !nonEmpty(portal.url) || !nonEmpty(portal.label)) continue

    const title = nonEmpty(portal.category) ? portal.category.trim() : DEFAULT_GROUP
    let group = groupsByTitle.get(title)
    if (!group) {
      group = { title, links: [] }
      groupsByTitle.set(title, group)
      order.push(title)
    }

    const link: ClientPortalLink = { label: portal.label.trim(), url: portal.url.trim() }
    if (nonEmpty(portal.description)) link.description = portal.description.trim()
    group.links.push(link)
  }

  const groups = order
    .map((title) => groupsByTitle.get(title)!)
    .filter((group) => group.links.length > 0)

  return {
    enabled: groups.length > 0,
    label: DEFAULT_LABEL,
    groups,
  }
}
