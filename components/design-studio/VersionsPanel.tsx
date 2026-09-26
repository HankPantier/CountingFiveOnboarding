'use client'

import { useState } from 'react'
import type { BaselineStatus, DesignVersionDto, DriftResult } from '@/lib/design/studio-types'
import InlineConfirm from './InlineConfirm'
import { designApi, errorMessage } from './api'
import { FOCUS, PANEL, PRIMARY_BTN_SM } from './styles'

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

// Theme versions (v0 = baseline import of the draft), the drift banner with
// "Capture as version", the stale-theme.css notice, and Restore: re-apply an
// older version to the draft as a NEW forward version (P5).
export default function VersionsPanel({
  sessionId,
  versions,
  drift,
  baseline,
  themeCssStale,
  onChanged,
}: {
  sessionId: string
  versions: DesignVersionDto[]
  drift: DriftResult
  baseline: BaselineStatus
  themeCssStale: boolean | null
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const run = async (action: () => Promise<string>, fallback: string) => {
    setBusy(true)
    setMessage(null)
    try {
      setMessage({ tone: 'success', text: await action() })
      onChanged()
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err, fallback) })
    } finally {
      setBusy(false)
    }
  }
  const restore = (v: DesignVersionDto) =>
    run(async () => {
      const res = await designApi<{ versionNo: number; warnings?: string[] }>(`/api/edit/${sessionId}/design/versions/${v.id}/restore`, {
        method: 'POST',
        json: {},
      })
      const warnings = (res.warnings ?? []).join(' ')
      return `Restored v${v.versionNo} to the draft as v${res.versionNo}.${warnings ? ` ${warnings}` : ''}`
    }, 'Failed to restore the version')
  const syncMbp = () =>
    run(async () => {
      await designApi(`/api/edit/${sessionId}/design/sync-mbp`, { method: 'POST', json: {} })
      return 'The MBP now lists the draft’s palette and fonts.'
    }, 'Failed to sync the MBP')
  const capture = () =>
    run(async () => {
      const res = await designApi<{ versionNo: number }>(`/api/edit/${sessionId}/design/versions/import`, { method: 'POST', json: {} })
      return `Captured the draft as v${res.versionNo}.`
    }, 'Failed to capture the draft')

  return (
    <section aria-labelledby="design-versions-heading" className={PANEL}>
      <div>
        <h2 id="design-versions-heading" className="font-heading text-sm font-semibold text-text-primary">
          Versions
        </h2>
        <p className="font-body text-xs text-text-muted">
          Every design applied from the Studio becomes a version. v0 is the draft as it was when the Studio first opened. Restoring re-applies an older
          version as a new one.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <InlineConfirm
            label="Sync palette & fonts to MBP"
            prompt="Copy the draft’s palette and fonts into the MBP?"
            confirmLabel="Sync"
            busy={busy}
            onConfirm={syncMbp}
            tone="neutral"
          />
          <span className="font-body text-[11px] text-text-muted">Chat revisions don’t update the MBP on their own.</span>
        </div>
      </div>

      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`font-body text-xs ${message.tone === 'error' ? 'text-error' : 'text-success'}`}>
          {message.text}
        </p>
      )}

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
          <button type="button" onClick={() => void capture()} disabled={busy} className={`mt-2 ${PRIMARY_BTN_SM}`}>
            Capture as version
          </button>
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
                <span className="min-w-0 flex-1 truncate font-heading text-xs font-semibold text-text-primary">{v.name}</span>
                {i === 0 ? (
                  <span className="rounded-pill bg-brand-cyan/10 px-2 py-0.5 font-heading text-[10px] font-semibold text-brand-navy">Latest</span>
                ) : (
                  <InlineConfirm
                    label="Restore"
                    prompt={
                      v.source === 'baseline' || v.source === 'import'
                        ? `Restore v${v.versionNo}, including its design-overrides.css exactly as recorded?`
                        : `Restore v${v.versionNo} to the draft? Hand-written CSS outside the Studio region stays as it is now.`
                    }
                    confirmLabel="Restore"
                    busy={busy}
                    onConfirm={() => restore(v)}
                  />
                )}
              </div>
              <p className="mt-1 font-body text-[11px] text-text-muted">
                {SOURCE_LABELS[v.source]} · {formatWhen(v.createdAt)}
                {v.appliedCommitSha ? ` · ${v.appliedCommitSha.slice(0, 7)}` : ''}
              </p>
              {v.summary && <p className="mt-1 font-body text-xs text-text-secondary">{v.summary}</p>}
              {/* PF7: the version's own screenshots (short-lived signed URLs), so a
                  chat version stays recognisable after the chat is cleared. */}
              {v.screenshotUrls.length > 0 && (
                <div className="mt-2 flex gap-1.5">
                  {v.screenshotUrls.slice(0, 2).map((url, n) => (
                    <a key={url} href={url} target="_blank" rel="noopener noreferrer" className={`block rounded-lg ${FOCUS}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`v${v.versionNo} screenshot ${n + 1}`}
                        loading="lazy"
                        className="h-16 w-auto rounded-lg border border-border-default object-cover object-top"
                      />
                    </a>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
