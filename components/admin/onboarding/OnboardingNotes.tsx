'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Topic reminders shown beside the freeform field so the rep remembers what to
// probe on the call. Not a rigid template — just prompts.
const GUIDING_PROMPTS: { heading: string; hint: string }[] = [
  { heading: 'Contact', hint: 'Name, email, phone of the person we work with' },
  { heading: 'Firm background', hint: 'Founding year, history/origin, growth goals' },
  { heading: 'Services & niches', hint: 'What they offer; which industries/client types they serve' },
  { heading: 'Ideal clients', hint: 'Who they want more of; geography; how clients find them' },
  { heading: 'Differentiators', hint: 'What sets them apart, in their own words' },
  { heading: 'Team & locations', hint: 'Key people + titles; offices' },
  { heading: 'Brand & tone', hint: 'How they sound today vs. aspirational; colors; words to avoid' },
  { heading: 'Culture', hint: 'Mission, vision, values; what it feels like to work with them' },
]

const AUTOSAVE_MS = 1200

export default function OnboardingNotes({
  sessionId,
  initialNotes,
  alreadyExtracted,
}: {
  sessionId: string
  initialNotes: string
  alreadyExtracted: boolean
}) {
  const router = useRouter()
  const [notes, setNotes] = useState(initialNotes)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSaved = useRef(initialNotes)

  const save = useCallback(async (value: string) => {
    if (value === lastSaved.current) return
    setSaveState('saving')
    try {
      const res = await fetch(`/api/sessions/${sessionId}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callNotes: value }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      lastSaved.current = value
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }, [sessionId])

  // Debounced autosave. Flush any pending timer on unmount.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  function onChange(value: string) {
    setNotes(value)
    setSaveState('idle')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(value), AUTOSAVE_MS)
  }

  async function extract() {
    setExtractError(null)
    if (timer.current) clearTimeout(timer.current)
    await save(notes) // flush latest notes before extracting
    setExtracting(true)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/extract-notes`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { error?: string; appliedCount?: number }
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      router.refresh() // notes_extracted_at now set → server renders the review stage
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : 'Extraction failed')
      setExtracting(false)
    }
  }

  const saveLabel =
    saveState === 'saving' ? 'Saving…'
    : saveState === 'saved' ? 'Saved'
    : saveState === 'error' ? 'Save failed — retrying on next edit'
    : ''

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      <div className="lg:col-span-2">
        <label htmlFor="call-notes" className="block text-sm font-heading font-semibold text-text-primary mb-2">
          Call notes
        </label>
        <textarea
          id="call-notes"
          value={notes}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type or paste notes from the onboarding call here. The agent will pull structure out of this before the Q&A — write naturally."
          rows={20}
          className="w-full border border-border-default rounded-2xl px-4 py-3 text-sm font-body bg-surface-page focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 transition-all duration-150"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-text-muted text-xs font-body" aria-live="polite">{saveLabel}</span>
          <div className="flex items-center gap-3">
            {extractError && <span className="text-error text-xs font-body">{extractError}</span>}
            <button
              type="button"
              onClick={extract}
              disabled={extracting || !notes.trim()}
              className="bg-brand-cyan text-text-inverse font-heading font-semibold text-sm px-5 py-2 rounded-pill transition-all duration-150 hover:bg-brand-cyan-dark active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {extracting ? 'Analyzing…' : alreadyExtracted ? 'Re-analyze notes →' : 'Analyze & review →'}
            </button>
          </div>
        </div>
        {alreadyExtracted && (
          <p className="text-text-muted text-xs font-body mt-2">
            These notes were already analyzed. Re-analyzing only fills fields that are still blank — it won&apos;t overwrite anything you or the audit already set.
          </p>
        )}
      </div>

      <aside className="bg-surface-card border border-border-default rounded-lg p-4">
        <p className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wide mb-3">
          What to capture
        </p>
        <ul className="space-y-3">
          {GUIDING_PROMPTS.map((p) => (
            <li key={p.heading}>
              <p className="text-sm font-heading font-semibold text-text-primary">{p.heading}</p>
              <p className="text-xs font-body text-text-muted mt-0.5">{p.hint}</p>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}
