'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import type { DesignLockDto } from '@/lib/design/locks'
import { designApi, errorMessage } from './api'
import { FOCUS } from './styles'

// The session's design locks (migration 085): load / refresh / unlock one.
export function useDesignLocks(sessionId: string, onChange?: (locks: DesignLockDto[]) => void) {
  const [locks, setLocks] = useState<DesignLockDto[]>([])
  const [error, setError] = useState<string | null>(null)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const apply = useCallback((next: DesignLockDto[]) => {
    setLocks(next)
    onChangeRef.current?.(next)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const res = await designApi<{ locks: DesignLockDto[] }>(`/api/edit/${sessionId}/design/locks`)
      apply(res.locks)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t load the design locks.'))
    }
  }, [sessionId, apply])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  // Resolves true when the unlock committed.
  const unlock = useCallback(
    async (key: string): Promise<boolean> => {
      try {
        const res = await designApi<{ locks: DesignLockDto[] }>(`/api/edit/${sessionId}/design/locks?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
        apply(res.locks)
        setError(null)
        return true
      } catch (err) {
        setError(errorMessage(err, 'Couldn’t unlock it — try again.'))
        return false
      }
    },
    [sessionId, apply]
  )

  return { locks, error, refresh, unlock }
}

// Lock chips above the chat: what the admin has frozen. ✕ arms an inline
// confirm (unlocking a frozen area lets it follow the site's palette, fonts and
// spacing again), then commits the unlock.
export default function LockChips({
  locks,
  error,
  disabled,
  onUnlock,
}: {
  locks: DesignLockDto[]
  error: string | null
  disabled: boolean
  onUnlock: (key: string) => Promise<boolean>
}) {
  const [armed, setArmed] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  if (locks.length === 0 && !error) return null
  return (
    <div className="flex flex-col gap-1.5">
      {locks.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Locked parts of the design">
          {locks.map((l) => (
            <li
              key={`${l.kind}:${l.key}`}
              className="flex items-center gap-1 rounded-pill border border-brand-navy/30 bg-surface-subtle py-0.5 pl-2 pr-1 font-body text-[11px] text-brand-navy"
              title={l.kind === 'area' ? 'Frozen: this section keeps its current look on every page.' : 'Frozen: this site-wide setting can’t be changed until it is unlocked.'}
            >
              <Lock aria-hidden="true" className="h-3 w-3" />
              <span>{l.label || l.key}</span>
              {armed === l.key ? (
                <span className="flex items-center gap-1" role="group" aria-label={`Unlock ${l.label || l.key}?`}>
                  <span className="text-text-muted">{l.kind === 'area' ? 'Unlock? It will follow the site again.' : 'Unlock?'}</span>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={async () => {
                      setBusy(l.key)
                      const ok = await onUnlock(l.key)
                      setBusy(null)
                      if (ok) setArmed(null)
                    }}
                    className={`rounded-pill bg-brand-navy px-2 py-0.5 font-heading text-[11px] font-semibold text-text-inverse disabled:opacity-50 ${FOCUS}`}
                  >
                    {busy === l.key ? 'Unlocking…' : 'Unlock'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setArmed(null)}
                    aria-label="Keep it locked"
                    className={`rounded-pill px-1 font-heading text-[11px] font-semibold text-text-secondary hover:text-brand-navy ${FOCUS}`}
                  >
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={disabled || busy !== null}
                  onClick={() => setArmed(l.key)}
                  aria-label={`Unlock ${l.label || l.key}`}
                  className={`rounded-pill px-1 font-heading text-[11px] font-semibold text-text-secondary hover:text-error disabled:cursor-not-allowed disabled:text-text-muted ${FOCUS}`}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="font-body text-[11px] text-error">
          {error}
        </p>
      )}
    </div>
  )
}
