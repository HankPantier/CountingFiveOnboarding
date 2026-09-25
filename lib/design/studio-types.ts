// Client-safe constants + DTO types for the Design Studio. The CHECK lists in
// supabase/078_design_studio.sql must match these arrays exactly — enforced by
// lib/design/migration-078.test.ts. Import freely from client components.
import { BUNDLE_SOURCES } from './bundle'
import type { DesignRunDto } from './run-types'

export const DESIGN_INPUT_KINDS = ['inspiration_url', 'inspiration_image', 'competitor_url', 'current_site'] as const
export type DesignInputKind = (typeof DESIGN_INPUT_KINDS)[number]

// The kinds an admin adds by URL (inspiration_image arrives by upload only).
export const URL_INPUT_KINDS = ['inspiration_url', 'competitor_url', 'current_site'] as const satisfies readonly DesignInputKind[]
export type UrlInputKind = (typeof URL_INPUT_KINDS)[number]

export const CAPTURE_STATUSES = ['none', 'pending', 'ok', 'error'] as const
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number]

export const RUN_STATUSES = ['queued', 'capturing', 'generating', 'refining', 'ready', 'applied', 'cancelled', 'error'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]
// A run in one of these holds the session's single "active run" slot (partial
// unique index) and is swept to 'error' after 15 minutes without an update.
export const RUN_ACTIVE_STATUSES = ['queued', 'capturing', 'generating', 'refining'] as const satisfies readonly RunStatus[]

export const CONCEPT_STATUSES = ['pending', 'generating', 'refining', 'ready', 'rejected', 'error'] as const
export type ConceptStatus = (typeof CONCEPT_STATUSES)[number]
export const CONCEPT_ACTIVE_STATUSES = ['generating', 'refining'] as const satisfies readonly ConceptStatus[]

export const PALETTE_FREEDOMS = ['keep', 'evolve', 'free'] as const
export const CHAT_ROLES = ['user', 'assistant'] as const

export const VERSION_SOURCES = BUNDLE_SOURCES
export type VersionSource = (typeof VERSION_SOURCES)[number]

export const MAX_INPUT_URL_LENGTH = 300
export const INPUT_LABEL_MAX = 120
export const INPUT_NOTES_MAX = 2000

export const INPUT_KIND_LABELS: Record<DesignInputKind, string> = {
  inspiration_url: 'Inspiration site',
  inspiration_image: 'Inspiration image',
  competitor_url: 'Competitor',
  current_site: 'Client’s current site',
}

// Repo path → git blob sha for the theme files that exist on a branch. A path
// that is absent from the map is absent from the branch.
export type ThemeBlobShas = Record<string, string>

export type DesignInputDto = {
  id: string
  kind: DesignInputKind
  url: string | null
  label: string | null
  notes: string | null
  captureStatus: CaptureStatus
  captureError: string | null
  capturedAt: string | null
  archived: boolean
  // Short-lived signed URL of the stored screenshot/image, or null.
  thumbnailUrl: string | null
  createdAt: string
}

export type DesignVersionDto = {
  id: string
  versionNo: number
  source: VersionSource
  name: string
  summary: string | null
  appliedCommitSha: string | null
  createdAt: string
  screenshotUrls: string[]
}

export type DriftStatus = 'in-sync' | 'drifted' | 'no-baseline'
export type DriftResult = { status: DriftStatus; changedPaths: string[]; sinceVersion: number | null }

export type BaselineStatus = { status: 'ok'; created: boolean } | { status: 'error'; error: string }

export type InputSuggestions = { currentSite: string | null; competitors: { name: string }[] }

export type DesignStudioState = {
  versions: DesignVersionDto[] // newest first
  latest: DesignVersionDto | null
  drift: DriftResult
  baseline: BaselineStatus
  // true = committed theme.css ≠ generateThemeCss(brand, design); null = can't tell.
  themeCssStale: boolean | null
  inputs: DesignInputDto[]
  suggestions: InputSuggestions
  run: DesignRunDto | null // the latest design run (P3)
}
