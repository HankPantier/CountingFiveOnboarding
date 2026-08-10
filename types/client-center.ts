// The JSON contract emitted to the deliverable zip as `content/client-center.json`.
// Consumed by the Phase II client-site template's Client Center modal and edited
// git-natively by the admin content editor. A single external portal link, its
// group, and the whole config.

export type ClientPortalLink = {
  label: string
  url: string
  description?: string
  icon?: string
}

export type ClientCenterGroup = {
  title: string
  links: ClientPortalLink[]
}

export type ClientCenterJson = {
  enabled: boolean
  label: string // nav button label, e.g. "Client Center"
  groups: ClientCenterGroup[]
}
