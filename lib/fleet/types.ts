// Shared types for the fleet tooling: scripts/fleet-sync.ts (template release
// rollout to client repos) and scripts/fleet-status.ts (read-only health).
// See lib/fleet/README.md.

export interface ClientEntry {
  /** owner/repo, e.g. "HankPantier/bblcpa". */
  slug: string
  displayName: string
  liveUrl: string | null
  /** Grouping tag. null = unassigned (never in a group/--all run). */
  themeGroup: string | null
  /** false = excluded from group/--all runs. Explicit --slugs can still name it. */
  managed: boolean
  /** true = excluded from group/--all runs; explicit --slugs includes it with a warning. */
  paused: boolean
  /**
   * true = the repo has no Vercel project (korbey), so "no deploy status" is
   * expected. For every other repo a missing status after the grace period is
   * a failure.
   */
  noDeploy: boolean
}

export interface ClientsConfig {
  _note?: string
  clients: ClientEntry[]
}

export interface TargetSelection {
  group?: string
  slugs?: string[]
  all?: boolean
}

/** Per-repo ruling for a path the gate classified as DRIFT. */
export type Ruling = 'overwrite' | '3way' | 'skip'

/**
 * A template release's migration, committed at config/fleet-releases/<templateVersion>.json.
 * Everything a release needs beyond "write the changed template files" is declared
 * here instead of being hand-coded in a one-off rollN.sh.
 */
export interface ReleaseManifest {
  templateVersion: string
  /** One paragraph for the client commit body. */
  notes?: string
  /** Regexes: diff paths never considered (default: e2e screenshot PNGs etc. — see DEFAULT_EXCLUDE). */
  exclude?: string[]
  /** package.json surgical edits (formatting preserved). Present = acknowledged, even if empty. */
  packageJson?: {
    addScripts?: Record<string, string>
    removeScripts?: string[]
    /** Existing script the new ones are inserted before (default "validate"). */
    anchorBefore?: string
    /** Surgical dependency pins, e.g. { optionalDependencies: { "@rolldown/binding-linux-x64-gnu": "1.0.0-beta.9" } }. */
    setDependencies?: Record<string, Record<string, string>>
  }
  /** Exact-line edits to .gitignore. Present = acknowledged. */
  gitignore?: { add?: string[]; remove?: string[] }
  /** 'merge-lines' appends template lines the client lacks. Required when .gitattributes changed. */
  gitattributes?: 'merge-lines'
  /**
   * How src/styles/theme.css is handled when it changed in the release. Never a
   * wholesale copy/regen (that would change a live palette). 'additive-helper'
   * runs lib/content/add-action-text-vars.ts (added / refreshed lines only);
   * 'none' leaves the client's file alone. Required when theme.css changed.
   */
  themeCss?: 'additive-helper' | 'none'
  /**
   * package-lock.json changed in the template. 'ignore' acknowledges (no dependency
   * change for clients); 'regenerate' runs `npm install --package-lock-only` in the
   * clone after package.json edits (apply only). Unset + changed = blocker.
   */
  lockfile?: 'ignore' | 'regenerate'
  /** Template paths written only when the client lacks them (never overwritten). */
  seedIfAbsent?: string[]
  /** Tracked client paths/dirs removed if present (e.g. retired design-kit/). */
  deleteTracked?: string[]
  /** repo name (bare, e.g. "Slachta-Accounting") → path → ruling. */
  rulings?: Record<string, Record<string, Ruling>>
}

/** One changed template path between OLD and NEW. */
export interface DiffEntry {
  status: 'A' | 'M' | 'D'
  path: string
}

export type PathAction =
  | 'WRITE' // client gets template@NEW
  | 'WRITE-BEHIND' // client matched an OLDER template version of the file — safe overwrite
  | 'DELETE'
  | 'MERGE3' // 3-way merge (ruling or --three-way)
  | 'SAME' // client already equals template@NEW
  | 'SKIP-M-absent' // modified in template, client never had it (opt-in module, platform-seeded repo)
  | 'SKIP-sibling' // new test/sibling of a module the client lacks
  | 'SKIP-D-absent'
  | 'SKIP-ruling'
  | 'DRIFT-A'
  | 'DRIFT-M'
  | 'DRIFT-D'

export interface PathDecision {
  path: string
  status: DiffEntry['status']
  action: PathAction
  /** Template commit whose blob the client matched (WRITE-BEHIND / behind DELETE). */
  behindCommit?: string
  note?: string
}

/** Blob lookups the classifier needs — injected so it stays pure and testable. */
export interface BlobView {
  client: string | null
  old: string | null
  next: string | null
  /** Template commit (newest first) whose blob of this path equals the client's, if any. */
  historicalMatch?: string | null
}

export type SpecialOp =
  | { kind: 'package-json' }
  | { kind: 'gitignore' }
  | { kind: 'gitattributes' }
  | { kind: 'theme-css' }
  | { kind: 'seed'; path: string }
  | { kind: 'delete-tracked'; path: string }
  | { kind: 'delete-template-default' }
  | { kind: 'lockfile-regenerate' }
  | { kind: 'marker' }

export interface RepoPlan {
  repo: string
  slug: string
  from: string
  to: string
  decisions: PathDecision[]
  specials: SpecialOp[]
  /** Anything here stops the repo: never applied, never pushed. */
  blockers: string[]
  warnings: string[]
}
