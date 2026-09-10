'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Database } from '@/types/database'
import { rankCandidatesForMember, type HeadshotCandidate } from '@/lib/team-photos/match'

type Asset = Database['public']['Tables']['assets']['Row']

type TeamMember = {
  name: string
  title?: string
  credentials?: string[]
}

type MatchConfidence = 'high' | 'low' | 'none'

type MemberMatch = {
  name: string
  imageUrl: string | null
  confidence: MatchConfidence
}

// Snapshot the audit → session-start auto-pull leaves in _meta.teamPhotoDiscovery
// so this UI can suggest the not-yet-pulled photos without re-scraping.
type TeamPhotoDiscovery = {
  scannedPages: string[]
  suggestions: MemberMatch[]
  candidates: Candidate[]
  at: string
}

type Props = {
  sessionId: string
  team: TeamMember[]
  assets: Asset[]
  signedUrls: Record<string, string>
  discovery?: TeamPhotoDiscovery | null
}

// Candidate headshot discovered on the client's live site.
type Candidate = HeadshotCandidate

type DiscoverResponse = {
  candidates: Candidate[]
  suggestions: Record<string, string | null>
  matches: MemberMatch[]
  scannedPages: string[]
  warnings: string[]
  error?: string
}

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.gif', '.png', '.webp']
const MAX_BYTES = 25 * 1024 * 1024  // 25MB per team photo is plenty

export default function TeamPhotoManager({ sessionId, team, assets, signedUrls, discovery }: Props) {
  const router = useRouter()
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [busyMember, setBusyMember] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Live-site pull state — seeded from the auto-pull discovery snapshot so
  // per-member suggestions show without the rep re-scanning.
  const [candidates, setCandidates] = useState<Candidate[] | null>(discovery?.candidates ?? null)
  const [selected, setSelected] = useState<Record<string, string>>(() => {
    const pre: Record<string, string> = {}
    for (const m of discovery?.suggestions ?? []) if (m.imageUrl) pre[m.name] = m.imageUrl
    return pre
  })
  const [matches, setMatches] = useState<MemberMatch[]>(discovery?.suggestions ?? [])
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanInfo, setScanInfo] = useState<{ scannedPages: string[]; warnings: string[] } | null>(
    discovery ? { scannedPages: discovery.scannedPages, warnings: [] } : null,
  )
  const [assigning, setAssigning] = useState<string | null>(null)

  const confidenceByMember = new Map<string, MatchConfidence>()
  for (const m of matches) confidenceByMember.set(m.name, m.confidence)

  // Build a map: memberName → asset (the most recent team-photo upload for them)
  const photoByMember = new Map<string, Asset>()
  for (const a of assets) {
    if (a.asset_category !== 'team-photo') continue
    const meta = a.metadata as { team_member_name?: string } | null
    const name = meta?.team_member_name
    if (!name) continue
    // Last upload wins
    const existing = photoByMember.get(name)
    if (!existing || (a.uploaded_at && existing.uploaded_at && a.uploaded_at > existing.uploaded_at)) {
      photoByMember.set(name, a)
    }
  }

  if (team.length === 0) {
    return null  // No team captured yet — nothing to manage
  }

  async function handleFile(memberName: string, file: File) {
    setErrors(prev => ({ ...prev, [memberName]: '' }))
    const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '')
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setErrors(prev => ({ ...prev, [memberName]: `Type not allowed: ${ALLOWED_EXTENSIONS.join(', ')}` }))
      return
    }
    if (file.size > MAX_BYTES) {
      setErrors(prev => ({ ...prev, [memberName]: 'Max 25MB per photo' }))
      return
    }

    setBusyMember(memberName)
    try {
      const presignRes = await fetch('/api/upload/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          assetCategory: 'team-photo',
        }),
      })
      const presign = await presignRes.json() as { signedUrl?: string; storagePath?: string; error?: string }
      if (presign.error || !presign.signedUrl || !presign.storagePath) {
        throw new Error(presign.error ?? 'Presign failed')
      }

      const putRes = await fetch(presign.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!putRes.ok) throw new Error('Storage upload failed')

      const confirmRes = await fetch('/api/upload/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          storagePath: presign.storagePath,
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          assetCategory: 'team-photo',
          metadata: { team_member_name: memberName },
        }),
      })
      const confirm = await confirmRes.json() as { assetId?: string; error?: string }
      if (confirm.error) throw new Error(confirm.error)

      router.refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setErrors(prev => ({ ...prev, [memberName]: msg }))
    } finally {
      setBusyMember(null)
      const input = inputRefs.current[memberName]
      if (input) input.value = ''
    }
  }

  async function discover() {
    setScanning(true)
    setScanError(null)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/team-photos/discover`)
      const data = await res.json() as DiscoverResponse
      if (!res.ok) throw new Error(data.error ?? 'Scan failed')
      setCandidates(data.candidates)
      setMatches(data.matches ?? [])
      setScanInfo({ scannedPages: data.scannedPages, warnings: data.warnings })
      const pre: Record<string, string> = {}
      for (const [name, url] of Object.entries(data.suggestions)) {
        if (url) pre[name] = url
      }
      setSelected(pre)
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  async function pull(memberName: string) {
    const imageUrl = selected[memberName]
    if (!imageUrl) return
    setAssigning(memberName)
    setErrors(prev => ({ ...prev, [memberName]: '' }))
    try {
      const res = await fetch(`/api/sessions/${sessionId}/team-photos/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberName, imageUrl }),
      })
      const data = await res.json() as { assetId?: string; error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Pull failed')
      router.refresh()
    } catch (err) {
      setErrors(prev => ({ ...prev, [memberName]: err instanceof Error ? err.message : 'Pull failed' }))
    } finally {
      setAssigning(null)
    }
  }

  return (
    <div className="bg-surface-card border border-border-default rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-3 gap-3">
        <h2 className="text-sm font-heading font-semibold text-text-primary">
          Team Photos ({photoByMember.size}/{team.length})
        </h2>
        <button
          type="button"
          onClick={() => void discover()}
          disabled={scanning}
          className="bg-brand-cyan text-text-inverse font-heading font-semibold text-[11px] px-3 py-1 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50"
        >
          {scanning ? 'Scanning…' : candidates ? 'Rescan live site' : 'Pull from live site'}
        </button>
      </div>

      {scanError && <p className="text-xs text-error font-body mb-2">{scanError}</p>}
      {scanInfo && (
        <p className="text-xs text-text-muted font-body mb-3">
          Scanned {scanInfo.scannedPages.length} page{scanInfo.scannedPages.length === 1 ? '' : 's'}
          {candidates ? ` · ${candidates.length} candidate photo${candidates.length === 1 ? '' : 's'} found` : ''}
          {scanInfo.warnings.length > 0 ? ` · ${scanInfo.warnings.join('; ')}` : ''}
        </p>
      )}

      {discovery && (
        <div className="mb-3 rounded-md border border-info/40 bg-info/10 px-3 py-2 text-xs font-body text-text-primary">
          Pulled <span className="font-heading font-semibold">{photoByMember.size}</span> of{' '}
          <span className="font-heading font-semibold">{team.length}</span> headshots automatically from
          the current site.
          {team.length - photoByMember.size > 0
            ? ` Confirm the suggestions below or upload the ${team.length - photoByMember.size} remaining.`
            : ''}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {team.map(member => {
          const asset = photoByMember.get(member.name)
          const isBusy = busyMember === member.name
          const isAssigning = assigning === member.name
          const err = errors[member.name]
          // Headshots only, this member's likely face first (defensively
          // re-filters older, unfiltered discovery snapshots too).
          const memberCandidates = rankCandidatesForMember(member, candidates ?? [])
          const sel = selected[member.name]
          const conf = confidenceByMember.get(member.name)
          return (
            <div key={member.name} className="flex flex-col gap-2 p-2 border border-border-default rounded-md">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded bg-surface-subtle flex-shrink-0 overflow-hidden">
                  {asset && signedUrls[asset.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={signedUrls[asset.id]} alt={member.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-text-muted font-heading font-semibold">
                      {member.name.split(' ').map(t => t[0] || '').join('').slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-body text-text-primary truncate">{member.name}</p>
                  <p className="text-xs text-text-muted font-body truncate">
                    {asset ? asset.file_name : 'No photo — will use initials avatar'}
                  </p>
                  {!asset && conf === 'high' && (
                    <span className="inline-block mt-0.5 text-[10px] font-heading font-semibold text-brand-cyan">
                      Suggested match from site
                    </span>
                  )}
                  {!asset && conf === 'low' && (
                    <span className="inline-block mt-0.5 text-[10px] font-heading font-semibold text-warning-strong">
                      Possible match — confirm
                    </span>
                  )}
                  {err && <p className="text-xs text-error font-body mt-0.5">{err}</p>}
                </div>
                <input
                  ref={el => { inputRefs.current[member.name] = el }}
                  type="file"
                  accept={ALLOWED_EXTENSIONS.join(',')}
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) handleFile(member.name, f)
                  }}
                  disabled={isBusy}
                />
                <button
                  type="button"
                  onClick={() => inputRefs.current[member.name]?.click()}
                  disabled={isBusy}
                  className="text-xs font-heading font-semibold text-brand-cyan hover:text-brand-navy transition-colors disabled:opacity-50 flex-shrink-0"
                >
                  {isBusy ? 'Uploading…' : asset ? 'Swap' : 'Upload'}
                </button>
              </div>

              {memberCandidates.length > 0 && (
                <div className="border-t border-border-default pt-2">
                  <CandidateStrip
                    candidates={memberCandidates}
                    selectedUrl={sel}
                    onSelect={url => setSelected(prev => ({ ...prev, [member.name]: url }))}
                  />
                  <button
                    type="button"
                    onClick={() => void pull(member.name)}
                    disabled={!sel || isAssigning}
                    className="mt-1 border border-brand-navy text-brand-navy font-heading font-semibold text-[11px] px-3 py-1 rounded-pill transition-all hover:bg-brand-navy/5 disabled:border-border-default disabled:text-text-muted"
                  >
                    {isAssigning ? 'Saving…' : sel ? 'Use selected photo' : 'Select a photo'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Horizontal thumbnail picker for one member's candidate headshots. Native
// overflow scroll was unpredictable on trackpads, so this adds explicit
// prev/next arrows, CSS scroll-snap, and auto-scrolls the selected tile into
// view. Owns its own scroll state so members' strips don't collide.
function CandidateStrip({
  candidates,
  selectedUrl,
  onSelect,
}: {
  candidates: Candidate[]
  selectedUrl: string | undefined
  onSelect: (url: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)

  const updateEdges = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setOverflowing(max > 1)
    setAtStart(el.scrollLeft <= 1)
    setAtEnd(el.scrollLeft >= max - 1)
  }, [])

  useEffect(() => {
    updateEdges()
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(updateEdges)
    ro.observe(el)
    return () => ro.disconnect()
  }, [updateEdges, candidates.length])

  // Bring the selected (or pre-suggested) tile into view when it changes.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !selectedUrl) return
    const tile = el.querySelector<HTMLElement>(`[data-url="${CSS.escape(selectedUrl)}"]`)
    tile?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [selectedUrl])

  const step = (dir: 1 | -1) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.8, 120), behavior: 'smooth' })
  }

  return (
    <div className="relative">
      {overflowing && (
        <button
          type="button"
          aria-label="Previous photos"
          onClick={() => step(-1)}
          disabled={atStart}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full bg-surface-card border border-border-default text-brand-navy flex items-center justify-center transition-colors hover:border-brand-cyan disabled:opacity-40 disabled:hover:border-border-default"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      )}
      <div
        ref={scrollRef}
        onScroll={updateEdges}
        className={`flex items-center gap-1.5 overflow-x-auto pb-1 snap-x snap-mandatory scroll-smooth ${
          overflowing ? 'px-7' : ''
        }`}
      >
        {candidates.map(c => (
          <button
            key={c.imageUrl}
            data-url={c.imageUrl}
            type="button"
            title={c.nearbyName ?? c.altText ?? c.filename}
            onClick={() => onSelect(c.imageUrl)}
            className={`w-11 h-11 rounded overflow-hidden border-2 flex-shrink-0 snap-start transition-colors ${
              selectedUrl === c.imageUrl ? 'border-brand-cyan' : 'border-transparent hover:border-border-default'
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- public live-site preview URL */}
            <img src={c.imageUrl} alt={c.altText ?? c.filename} className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
      {overflowing && (
        <button
          type="button"
          aria-label="More photos"
          onClick={() => step(1)}
          disabled={atEnd}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full bg-surface-card border border-border-default text-brand-navy flex items-center justify-center transition-colors hover:border-brand-cyan disabled:opacity-40 disabled:hover:border-border-default"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
