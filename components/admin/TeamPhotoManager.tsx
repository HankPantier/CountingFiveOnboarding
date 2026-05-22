'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Database } from '@/types/database'

type Asset = Database['public']['Tables']['assets']['Row']

type TeamMember = {
  name: string
  title?: string
  credentials?: string[]
}

type Props = {
  sessionId: string
  team: TeamMember[]
  assets: Asset[]
  signedUrls: Record<string, string>
}

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.gif', '.png']
const MAX_BYTES = 25 * 1024 * 1024  // 25MB per team photo is plenty

export default function TeamPhotoManager({ sessionId, team, assets, signedUrls }: Props) {
  const router = useRouter()
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [busyMember, setBusyMember] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

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

  return (
    <div className="bg-surface-card border border-border-default rounded-lg p-4 mb-6">
      <h2 className="text-sm font-heading font-semibold text-text-primary mb-3">
        Team Photos ({photoByMember.size}/{team.length})
      </h2>
      <div className="grid grid-cols-2 gap-3">
        {team.map(member => {
          const asset = photoByMember.get(member.name)
          const isBusy = busyMember === member.name
          const err = errors[member.name]
          return (
            <div key={member.name} className="flex items-center gap-3 p-2 border border-border-default rounded-md">
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
          )
        })}
      </div>
    </div>
  )
}
