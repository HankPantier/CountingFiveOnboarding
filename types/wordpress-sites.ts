// Request/response contracts for the admin WordPress-sites registry
// (Admin → WordPress Sites). The bearer `secret` is returned ONLY on create and
// regenerate (shown once) — never in the list, so it isn't rendered into page
// HTML for every row.

export interface WordpressSiteSummary {
  id: string
  site_key: string
  github_repo: string
  enabled: boolean
  created_at: string
}

export interface ListWordpressSitesResponse {
  sites: WordpressSiteSummary[]
}

export interface CreateWordpressSiteRequest {
  site_key: string
  github_repo: string
}

export interface CreateWordpressSiteResponse {
  site: WordpressSiteSummary
  secret: string // shown once
  feedUrl: string
}

export interface UpdateWordpressSiteRequest {
  enabled?: boolean
  github_repo?: string
}

export interface RegenerateSecretResponse {
  secret: string // shown once
}
