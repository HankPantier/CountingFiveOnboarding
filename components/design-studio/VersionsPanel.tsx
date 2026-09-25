import type { BaselineStatus, DesignVersionDto, DriftResult } from '@/lib/design/studio-types'
import { PANEL } from './styles'

const SOURCE_LABELS: Record<DesignVersionDto['source'], string> = {
  baseline: 'Baseline',
  concept: 'Concept',
  chat: 'Chat revision',
  revert: 'Restore',
  import: 'Captured',
}

const FILE_LABELS: Record<string, string> = {
  'content/brand.json': 'brand.json (palette)',
  'content/design.json': 'design.json (fonts, tokens, treatments)',
  'src/styles/theme.css': 'theme.css',
  'content/design-overrides.css': 'design-overrides.css',
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// Theme versions (v0 = baseline import of the draft), with the drift banner
// and the stale-theme.css notice. Read-only in P2; restore arrives in P5.
export default function VersionsPanel({
  versions,
  drift,
  baseline,
  themeCssStale,
}: {
  versions: DesignVersionDto[]
  drift: DriftResult
  baseline: BaselineStatus
  themeCssStale: boolean | null
}) {
  return (
    <section aria-labelledby="design-versions-heading" className={PANEL}>
      <div>
        <h2 id="design-versions-heading" className="font-heading text-sm font-semibold text-text-primary">
          Versions
        </h2>
        <p className="font-body text-xs text-text-muted">Every design applied from the Studio becomes a version. v0 is the draft as it was when the Studio first opened.</p>
      </div>

      {baseline.status === 'error' && (
        <div role="alert" className="rounded-lg border border-error/20 bg-error/10 px-3 py-2 font-body text-xs text-error">
          <p className="font-heading font-semibold">Couldn’t import the current design as v0</p>
          <p className="mt-0.5">{baseline.error}</p>
          <p className="mt-1 text-text-secondary">Fix the draft theme files (Controls tab or the file editor), then Refresh.</p>
        </div>
      )}

      {drift.status === 'drifted' && (
        <div role="status" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 font-body text-xs text-warning-strong">
          <p className="font-heading font-semibold">Changed outside the Studio since v{drift.sinceVersion}</p>
          <ul className="mt-1 list-disc pl-4">
            {drift.changedPaths.map((p) => (
              <li key={p}>{FILE_LABELS[p] ?? p}</li>
            ))}
          </ul>
          <p className="mt-1">The draft no longer matches the latest version — for example after a Controls change or a hand edit.</p>
        </div>
      )}

      {themeCssStale === true && (
        <div role="status" className="rounded-lg border border-border-default bg-surface-subtle px-3 py-2 font-body text-xs text-text-secondary">
          <p className="font-heading font-semibold text-text-primary">theme.css is out of date</p>
          <p className="mt-0.5">
            The committed theme.css doesn’t match brand.json + design.json, so the live site may not show the saved palette. Any Controls change or
            Studio apply regenerates it.
          </p>
        </div>
      )}

      {versions.length === 0 ? (
        <p className="font-body text-xs italic text-text-muted">No versions yet.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {versions.map((v, i) => (
            <li key={v.id} className="rounded-lg border border-border-default px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="rounded-pill bg-brand-navy px-2 py-0.5 font-heading text-[11px] font-semibold text-text-inverse">v{v.versionNo}</span>
                <span className="min-w-0 truncate font-heading text-xs font-semibold text-text-primary">{v.name}</span>
                {i === 0 && (
                  <span className="rounded-pill bg-brand-cyan/10 px-2 py-0.5 font-heading text-[10px] font-semibold text-brand-navy">Latest</span>
                )}
              </div>
              <p className="mt-1 font-body text-[11px] text-text-muted">
                {SOURCE_LABELS[v.source]} · {formatWhen(v.createdAt)}
                {v.appliedCommitSha ? ` · ${v.appliedCommitSha.slice(0, 7)}` : ''}
              </p>
              {v.summary && <p className="mt-1 font-body text-xs text-text-secondary">{v.summary}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
