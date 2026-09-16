'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Downstream {
  canPatch: boolean
  oldHost: string
  newHost: string
  pages: number
  sitemapEntries: number
  repo: string | null
}

export default function RenameSessionButton({
  sessionId,
  currentName,
  currentDomain,
}: {
  sessionId: string
  currentName: string
  currentDomain: string
}) {
  const [open, setOpen] = useState(false)
  const [firmName, setFirmName] = useState(currentName)
  const [websiteUrl, setWebsiteUrl] = useState(currentDomain)
  const [rerunWhois, setRerunWhois] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ warnings: string[]; downstream: Downstream | null } | null>(null)
  const [patchBusy, setPatchBusy] = useState(false)
  const [patchNote, setPatchNote] = useState('')
  const router = useRouter()

  const domainChanged = websiteUrl.trim() !== currentDomain.trim()

  function close() {
    setOpen(false)
    setResult(null)
    setError('')
    setPatchNote('')
    if (result) router.refresh()
  }

  async function submit() {
    if (!firmName.trim() && !websiteUrl.trim()) {
      setError('Enter a firm name or website.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/sessions/${sessionId}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firmName: firmName.trim(),
          websiteUrl: websiteUrl.trim(),
          rerunWhois: domainChanged && rerunWhois,
        }),
      })
      const data = (await res.json()) as { warnings?: string[]; downstream?: Downstream | null; error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? 'Failed to rename.')
        return
      }
      setResult({ warnings: data.warnings ?? [], downstream: data.downstream ?? null })
    } catch {
      setError('Failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function patchContent() {
    if (!result?.downstream) return
    setPatchBusy(true)
    setPatchNote('')
    try {
      const res = await fetch(`/api/sessions/${sessionId}/patch-content-domain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldHost: result.downstream.oldHost }),
      })
      const data = (await res.json()) as { sitemapUpdated?: number; pagesUpdated?: number; error?: string }
      if (!res.ok || data.error) {
        setPatchNote(data.error ?? 'Patch failed.')
        return
      }
      setPatchNote(
        `Updated ${data.pagesUpdated ?? 0} page(s) and ${data.sitemapUpdated ?? 0} sitemap entr(y/ies). Re-publish for changes to reach the live site.`,
      )
    } catch {
      setPatchNote('Patch failed. Please try again.')
    } finally {
      setPatchBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mt-4 w-full border border-border-default text-text-secondary font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:border-brand-cyan hover:text-brand-navy"
      >
        Rename / change domain
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-navy/40 p-4">
          <div className="w-full max-w-md rounded-card border border-border-default bg-surface-card shadow-cyan-base max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-3 border-b border-border-default flex items-center justify-between">
              <h2 className="text-sm font-heading font-semibold text-text-primary">Rename firm / change domain</h2>
              <button onClick={close} className="text-text-muted hover:text-text-primary text-lg leading-none">×</button>
            </div>

            {!result ? (
              <div className="px-5 py-4 space-y-3">
                <label className="block">
                  <span className="text-xs font-heading font-semibold text-text-secondary">Firm name</span>
                  <input
                    value={firmName}
                    onChange={e => setFirmName(e.target.value)}
                    className="mt-1 w-full rounded-card border border-border-default px-3 py-2 font-body text-sm text-text-primary focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/15"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-heading font-semibold text-text-secondary">Website / domain</span>
                  <input
                    value={websiteUrl}
                    onChange={e => setWebsiteUrl(e.target.value)}
                    placeholder="accordadvisors.com"
                    className="mt-1 w-full rounded-card border border-border-default px-3 py-2 font-body text-sm text-text-primary focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/15"
                  />
                </label>
                {domainChanged && (
                  <label className="flex items-center gap-2 text-xs font-body text-text-secondary">
                    <input type="checkbox" checked={rerunWhois} onChange={e => setRerunWhois(e.target.checked)} />
                    Refresh WHOIS for the new domain (overwrites registrar/nameserver fields)
                  </label>
                )}
                <p className="text-xs font-body text-text-muted">
                  Updates the profile, domain, and MBP. The GitHub repo, live site/DNS, and already-generated pages are not changed automatically.
                </p>
                {error && <p className="text-xs font-body text-error">{error}</p>}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={submit}
                    disabled={busy}
                    className="bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50"
                  >
                    {busy ? 'Saving…' : 'Save changes'}
                  </button>
                  <button onClick={close} className="border border-border-default text-text-secondary font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-surface-subtle">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-5 py-4 space-y-3">
                <p className="text-sm font-body text-success font-semibold">✓ Saved.</p>
                {result.warnings.length > 0 && (
                  <ul className="space-y-1">
                    {result.warnings.map((w, i) => (
                      <li key={i} className="flex gap-1.5 text-xs font-body text-warning-strong">
                        <span>•</span>
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {result.downstream?.canPatch && (
                  <div className="rounded-card border border-border-default bg-surface-subtle p-3 space-y-2">
                    <p className="text-xs font-body text-text-secondary">
                      Also rewrite <span className="font-semibold">{result.downstream.oldHost}</span> → <span className="font-semibold">{result.downstream.newHost}</span> in {result.downstream.pages} generated page(s) and {result.downstream.sitemapEntries} sitemap entr(y/ies)?
                    </p>
                    <button
                      onClick={patchContent}
                      disabled={patchBusy || !!patchNote}
                      className="bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50"
                    >
                      {patchBusy ? 'Patching…' : 'Patch generated content'}
                    </button>
                    {patchNote && <p className="text-xs font-body text-text-muted">{patchNote}</p>}
                  </div>
                )}
                <div className="pt-1">
                  <button onClick={close} className="border border-border-default text-text-secondary font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-surface-subtle">
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
