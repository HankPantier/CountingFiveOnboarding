// Shared types for the fleet-rollout tooling — the mechanism that propagates a
// template/theme update (shared, template-owned files) across the selected
// client site repos, safely. See scripts/fleet-rollout.ts for the CLI entry.

/** Structural subset of an octokit git tree entry — lets pure helpers accept
 *  a real TreeEntry or a test fixture without importing the github module. */
export interface TreeEntryLike {
  path: string
  type: 'blob' | 'tree'
  sha: string
}

export interface ClientEntry {
  /** owner/repo, e.g. "HankPantier/bblcpa". */
  slug: string
  displayName: string
  liveUrl: string | null
  /** Grouping tag — a rollout targets a group. null = unassigned (never in a group/--all run). */
  themeGroup: string | null
  /** false = excluded from group/--all runs (opt-in gate). Explicit --slugs can still name it. */
  managed: boolean
  /** true = always skipped. */
  paused: boolean
}

export interface ClientsConfig {
  _note?: string
  clients: ClientEntry[]
}

export interface Manifest {
  _note?: string
  /** Path prefixes (trailing '/') or exact files considered template-owned. */
  include: string[]
  /** Prefixes/exact files never synced — wins over include. */
  exclude: string[]
  /** Not synced, but `plan` warns when template's copy differs from the client's. */
  flagIfChanged: string[]
}

export interface TargetSelection {
  group?: string
  slugs?: string[]
  all?: boolean
}

/** Result of diffing the managed file set of the template against one client. */
export interface RolloutPlan {
  slug: string
  displayName: string
  /** Managed paths present in template but absent on the client. */
  adds: string[]
  /** Managed paths whose template blob sha differs from the client's. */
  updates: string[]
  /** Managed paths identical on both sides. */
  unchanged: string[]
  /** flagIfChanged paths that differ (not auto-synced — needs operator attention). */
  flagged: string[]
  /** True when the client repo does not look like a template site (no src/components/). */
  notATemplateSite: boolean
}
