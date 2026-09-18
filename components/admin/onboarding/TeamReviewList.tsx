'use client'
import { useEffect, useState } from 'react'

export type TeamSuggestion = { decision: 'keep' | 'remove'; rationale: string; confidence?: 'high' | 'medium' | 'low' }
export type ReviewTeamMember = { name: string; title?: string; suggestion?: TeamSuggestion }
export type TeamReviewPayload = { keep: string[]; remove: string[]; add: { name: string; title?: string }[] }

// Team keep/remove + add. No page-vs-block dimension — a member is either on the
// new site or not. Self-contained; reports the current decision up via onChange so
// AuditReview can fold it into the consolidated submit.
export default function TeamReviewList({
  members,
  onChange,
}: {
  members: ReviewTeamMember[]
  onChange: (payload: TeamReviewPayload) => void
}) {
  const [decisions, setDecisions] = useState<Record<string, 'keep' | 'remove'>>(
    () => Object.fromEntries(members.map((m) => [m.name, m.suggestion?.decision ?? 'keep'])),
  )
  const [added, setAdded] = useState<{ name: string; title?: string }[]>([])
  const [newName, setNewName] = useState('')
  const [newTitle, setNewTitle] = useState('')

  useEffect(() => {
    const keep = members.filter((m) => decisions[m.name] !== 'remove').map((m) => m.name)
    const remove = members.filter((m) => decisions[m.name] === 'remove').map((m) => m.name)
    onChange({ keep, remove, add: added })
  }, [decisions, added, members, onChange])

  const addMember = () => {
    const name = newName.trim()
    if (!name) return
    if (added.some((m) => m.name.toLowerCase() === name.toLowerCase())) return
    if (members.some((m) => m.name.toLowerCase() === name.toLowerCase())) return
    setAdded((prev) => [...prev, { name, ...(newTitle.trim() ? { title: newTitle.trim() } : {}) }])
    setNewName('')
    setNewTitle('')
  }

  return (
    <div className="flex flex-col gap-2">
      {members.length === 0 && added.length === 0 && (
        <p className="text-text-muted text-xs font-body">No team members detected on the site — add anyone who should appear.</p>
      )}
      {members.map((m) => {
        const removed = decisions[m.name] === 'remove'
        return (
          <div key={m.name} className="rounded-lg border border-border-default bg-surface-page px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className={`text-sm font-heading font-semibold ${removed ? 'text-text-muted line-through' : 'text-text-primary'}`}>{m.name}</span>
              {m.title && <span className="text-text-secondary text-xs font-body ml-2">{m.title}</span>}
            </div>
            <div className="flex shrink-0 rounded-pill border border-border-default overflow-hidden">
              <button
                type="button"
                onClick={() => setDecisions((p) => ({ ...p, [m.name]: 'keep' }))}
                className={`px-3 py-1 text-xs font-heading font-semibold transition-colors ${!removed ? 'bg-brand-cyan text-text-inverse' : 'bg-surface-card text-text-secondary hover:text-brand-cyan'}`}
              >
                Keep
              </button>
              <button
                type="button"
                onClick={() => setDecisions((p) => ({ ...p, [m.name]: 'remove' }))}
                className={`px-3 py-1 text-xs font-heading font-semibold transition-colors ${removed ? 'bg-error/10 text-error' : 'bg-surface-card text-text-secondary hover:text-error'}`}
              >
                Remove
              </button>
            </div>
            </div>
            {m.suggestion && (
              <p className="mt-1.5 text-xs font-body text-text-muted flex flex-wrap items-baseline gap-x-1.5">
                <span className="text-brand-cyan-dark font-heading font-semibold">✦ AI</span>
                {(decisions[m.name] ?? 'keep') === m.suggestion.decision ? (
                  <span className="text-text-secondary font-heading font-semibold">suggests {m.suggestion.decision}:</span>
                ) : (
                  <span className="text-text-secondary">suggested <span className="font-heading font-semibold">{m.suggestion.decision}</span> (you chose {decisions[m.name] ?? 'keep'}):</span>
                )}
                <span>{m.suggestion.rationale}</span>
                {m.suggestion.confidence === 'low' && (
                  <span className="inline-flex items-center rounded-pill border border-warning/40 bg-warning/10 text-warning px-1.5 py-0.5 text-[10px] font-heading font-semibold uppercase">double-check</span>
                )}
              </p>
            )}
          </div>
        )
      })}

      {added.map((m) => (
        <div key={`added-${m.name}`} className="flex items-center justify-between gap-3 rounded-lg border border-brand-cyan/30 bg-brand-cyan/5 px-3 py-2.5">
          <div className="min-w-0">
            <span className="text-sm font-heading font-semibold text-text-primary">{m.name}</span>
            {m.title && <span className="text-text-secondary text-xs font-body ml-2">{m.title}</span>}
            <span className="text-brand-cyan-dark text-[11px] font-heading font-semibold uppercase ml-2">added</span>
          </div>
          <button
            type="button"
            onClick={() => setAdded((prev) => prev.filter((x) => x.name !== m.name))}
            className="text-text-muted hover:text-error text-xs font-heading font-semibold"
          >
            Undo
          </button>
        </div>
      ))}

      <div className="mt-1 flex items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMember() } }}
          placeholder="Add a team member…"
          className="flex-1 border border-border-default rounded-lg px-3 py-1.5 text-sm font-body bg-surface-card focus:outline-none focus:border-brand-cyan"
        />
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMember() } }}
          placeholder="Title (optional)"
          className="w-40 border border-border-default rounded-lg px-3 py-1.5 text-sm font-body bg-surface-card focus:outline-none focus:border-brand-cyan"
        />
        <button
          type="button"
          onClick={addMember}
          disabled={!newName.trim()}
          className="text-brand-cyan-dark hover:text-brand-cyan text-sm font-heading font-semibold disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  )
}
