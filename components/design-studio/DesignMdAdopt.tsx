'use client'

import { useState } from 'react'
import { DESIGN_MD_STATE_COPY, designMdReplaceIsDestructive, diffHunks, type DesignMdPreviewDto } from '@/lib/design/design-md-ui'
import InlineConfirm from './InlineConfirm'
import { designApi, errorMessage } from './api'
import { SECONDARY_BTN_SM } from './styles'

// "Regenerate design.md": fleet design.md files predate the edit-detection
// hash, so Studio commits treat them as hand-written and never refresh them.
// This is the explicit, admin-only adoption: review exactly what would change,
// then confirm. Nothing here ever runs on its own.
export default function DesignMdAdopt({ sessionId, onChanged }: { sessionId: string; onChanged: () => void }) {
  const [preview, setPreview] = useState<DesignMdPreviewDto | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const review = async () => {
    setLoading(true)
    setMessage(null)
    try {
      setPreview(await designApi<DesignMdPreviewDto>(`/api/edit/${sessionId}/design/design-md`))
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err, 'Couldn’t build design.md') })
    } finally {
      setLoading(false)
    }
  }

  const adopt = async () => {
    if (!preview) return
    setBusy(true)
    setMessage(null)
    try {
      await designApi(`/api/edit/${sessionId}/design/design-md`, {
        method: 'POST',
        json: { expectedSha: preview.currentSha, nextHash: preview.nextHash },
      })
      setPreview(null)
      setMessage({ tone: 'success', text: 'design.md regenerated on the draft. Studio commits now keep it up to date; it goes live when you publish.' })
      onChanged()
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err, 'Couldn’t regenerate design.md') })
    } finally {
      setBusy(false)
    }
  }

  const hunks = preview ? diffHunks(preview.diff) : null
  const destructive = preview ? designMdReplaceIsDestructive(preview.state) : false

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-default px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-heading text-xs font-semibold text-text-primary">design.md</span>
        <span className="font-body text-[11px] text-text-muted">The brand notes every Studio run is briefed with.</span>
        {!preview && (
          <button type="button" onClick={() => void review()} disabled={loading} className={`ml-auto ${SECONDARY_BTN_SM}`}>
            {loading ? 'Building…' : 'Regenerate design.md…'}
          </button>
        )}
      </div>

      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`font-body text-xs ${message.tone === 'error' ? 'text-error' : 'text-success'}`}>
          {message.text}
        </p>
      )}

      {preview && hunks && (
        <div className="flex flex-col gap-2">
          <p className={`font-body text-xs ${destructive ? 'text-warning-strong' : 'text-text-secondary'}`}>
            {DESIGN_MD_STATE_COPY[preview.state]}
          </p>
          {preview.unchanged ? (
            <p role="status" className="font-body text-xs text-text-secondary">
              design.md already matches the generated file — nothing to change.
            </p>
          ) : (
            <>
              <p className="font-body text-[11px] text-text-muted">
                {preview.path}: {preview.added} line{preview.added === 1 ? '' : 's'} added, {preview.removed} removed.
              </p>
              <pre
                aria-label="Changes to design.md"
                tabIndex={0}
                className="max-h-72 overflow-auto rounded-lg border border-border-default bg-surface-subtle p-2 font-mono text-[11px] leading-snug"
              >
                {hunks.rows.map((r, i) =>
                  r.op === 'gap' ? (
                    <div key={i} className="text-text-muted">
                      {`  … ${r.skipped} unchanged line${r.skipped === 1 ? '' : 's'}`}
                    </div>
                  ) : (
                    <div key={i} className={r.op === 'add' ? 'bg-success/10 text-success' : r.op === 'del' ? 'bg-error/10 text-error' : 'text-text-secondary'}>
                      <span aria-hidden="true">{r.op === 'add' ? '+ ' : r.op === 'del' ? '- ' : '  '}</span>
                      <span className="sr-only">{r.op === 'add' ? 'Added: ' : r.op === 'del' ? 'Removed: ' : ''}</span>
                      {r.text || ' '}
                    </div>
                  )
                )}
                {hunks.truncated && <div className="text-text-muted">… more changes not shown</div>}
              </pre>
            </>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {!preview.unchanged && (
              <InlineConfirm
                label={preview.state === 'absent' ? 'Create design.md' : 'Replace design.md'}
                prompt={
                  preview.state === 'legacy'
                    ? 'Replace this older design.md with the generated one? Any hand edits in it are lost (git history keeps them).'
                    : destructive
                      ? 'Replace the hand-written design.md on the draft with the generated one? The removed lines above are lost (git history keeps them).'
                      : 'Write the generated design.md to the draft?'
                }
                confirmLabel={preview.state === 'absent' ? 'Create' : 'Replace'}
                busy={busy}
                onConfirm={adopt}
                tone={destructive ? 'destructive' : 'neutral'}
              />
            )}
            <button type="button" onClick={() => setPreview(null)} disabled={busy} className={SECONDARY_BTN_SM}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
