'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DefaultChatTransport, type TextUIPart, type UIMessage } from 'ai'
import { useChat } from '@ai-sdk/react'
import type { ClientEntry, AuditEntry } from '@/lib/admin/command-index'
import AiIssueNotice from '@/components/ui/AiIssueNotice'

export interface CommandSection {
  label: string
  href: string
  keywords: string
}

type Row =
  | { kind: 'client'; key: string; label: string; sublabel: string; href: string; client: ClientEntry }
  | { kind: 'audit'; key: string; label: string; sublabel: string; href: string }
  | { kind: 'section'; key: string; label: string; sublabel: string; href: string }
  | { kind: 'ai'; key: string; label: string; sublabel: string; href: null }

interface NavLink {
  href: string
  label: string
}

const MAX_PER_GROUP = 4

function tokens(s: string): string[] {
  return s.toLowerCase().split(/\s+/).filter(Boolean)
}

function matches(haystack: string, qTokens: string[]): boolean {
  const h = haystack.toLowerCase()
  return qTokens.every(t => h.includes(t))
}

// Text of an assistant message: its text parts joined.
function messageText(m: UIMessage): string {
  return m.parts
    .filter((p): p is TextUIPart => p.type === 'text')
    .map(p => p.text)
    .join('')
}

// Navigate links emitted by the `navigate` tool this turn. Handles both the
// static tool part shape (`tool-navigate`) and the dynamic-tool fallback.
function navLinksFromMessage(m: UIMessage): NavLink[] {
  const out: NavLink[] = []
  for (const part of m.parts) {
    const p = part as unknown as {
      type?: string
      state?: string
      output?: unknown
      toolName?: string
    }
    const isNav = p.type === 'tool-navigate' || (p.type === 'dynamic-tool' && p.toolName === 'navigate')
    if (!isNav || p.state !== 'output-available') continue
    const output = p.output as { ok?: boolean; href?: unknown; label?: unknown } | undefined
    if (output?.ok && typeof output.href === 'string' && typeof output.label === 'string') {
      out.push({ href: output.href, label: output.label })
    }
  }
  return out
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.35-4.35" />
    </svg>
  )
}

export default function CommandBox({
  clients,
  audits,
  sections,
  clientLinkMode = 'onboarding',
}: {
  clients: ClientEntry[]
  audits: AuditEntry[]
  sections: CommandSection[]
  // Where a client result navigates: 'onboarding' → session detail (managers/
  // admins); 'content' → the content editor (editors, who can't reach onboarding).
  clientLinkMode?: 'onboarding' | 'content'
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const transport = useMemo(() => new DefaultChatTransport({ api: '/api/admin/assistant' }), [])
  const { messages, sendMessage, setMessages, status, error } = useChat({ transport })

  const isLoading = status === 'submitted' || status === 'streaming'
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
  const answer = lastAssistant ? messageText(lastAssistant) : ''
  const navLinks = lastAssistant ? navLinksFromMessage(lastAssistant) : []
  const hasAiResult = isLoading || messages.some(m => m.role === 'assistant') || messages.some(m => m.role === 'user')

  const rows = useMemo<Row[]>(() => {
    const q = query.trim()
    if (!q) return []
    const qt = tokens(q)
    const out: Row[] = []

    for (const c of clients.filter(c => matches(`${c.name} ${c.websiteUrl}`, qt)).slice(0, MAX_PER_GROUP)) {
      out.push({
        kind: 'client',
        key: `client-${c.id}`,
        label: c.name,
        sublabel: c.hasSite ? 'Client · site live' : 'Client · in onboarding',
        href: clientLinkMode === 'content' ? `/admin/content/${c.id}/edit` : `/admin/sessions/${c.id}`,
        client: c,
      })
    }
    for (const a of audits.filter(a => matches(a.name, qt)).slice(0, MAX_PER_GROUP)) {
      out.push({ kind: 'audit', key: `audit-${a.id}`, label: a.name, sublabel: `Audit · ${a.status}`, href: `/admin/audits/${a.id}` })
    }
    for (const s of sections.filter(s => matches(`${s.label} ${s.keywords}`, qt)).slice(0, MAX_PER_GROUP)) {
      out.push({ kind: 'section', key: `section-${s.href}`, label: s.label, sublabel: 'Go to page', href: s.href })
    }
    // Free-form assistant is always offered last so any phrase has a path.
    out.push({ kind: 'ai', key: 'ai', label: `Ask AI: “${q}”`, sublabel: 'Answer this or take me there', href: null })
    return out
  }, [query, clients, audits, sections, clientLinkMode])

  const clampedActive = Math.min(active, Math.max(0, rows.length - 1))

  function askAi(q: string) {
    if (!q) return
    setMessages([])
    sendMessage({ text: q })
  }

  function activate(row: Row | undefined) {
    if (!row) return
    if (row.kind === 'ai' || row.href === null) askAi(query.trim())
    else router.push(row.href)
  }

  function clear() {
    setQuery('')
    setMessages([])
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(a => Math.min(a + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(a => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!query.trim()) return
      activate(rows[clampedActive])
    } else if (e.key === 'Escape') {
      clear()
    }
  }

  const open = query.trim().length > 0

  return (
    <div className="relative w-full max-w-2xl">
      <div className="flex items-center gap-3 bg-surface-card border border-border-default rounded-pill shadow-subtle px-5 py-3.5 focus-within:border-brand-cyan focus-within:ring-2 focus-within:ring-brand-cyan/15 transition-colors">
        <span className="text-text-muted">{isLoading ? <span className="text-brand-cyan animate-pulse">•••</span> : <SearchIcon />}</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setActive(0) }}
          onKeyDown={onKeyDown}
          placeholder="Show me open audits, or edit content for a client…"
          aria-label="Command box"
          className="flex-1 bg-transparent text-text-primary font-body text-base placeholder:text-text-muted focus:outline-none"
        />
      </div>

      {open && (
        <div className="absolute z-20 mt-2 w-full bg-surface-card border border-border-default rounded-card shadow-medium overflow-hidden">
          {hasAiResult && (
            <div className="px-4 py-3 border-b border-border-default">
              {answer ? (
                <p className="text-sm font-body text-text-primary whitespace-pre-wrap">{answer}</p>
              ) : isLoading ? (
                <p className="text-sm font-body text-text-muted italic">Thinking…</p>
              ) : null}
              {error && <AiIssueNotice message={error.message} />}
              {navLinks.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2.5">
                  {navLinks.map((link, i) => (
                    <button
                      key={`${link.href}-${i}`}
                      type="button"
                      onClick={() => router.push(link.href)}
                      className="text-xs font-heading font-semibold text-brand-cyan hover:text-text-inverse hover:bg-brand-cyan border border-brand-cyan/40 px-3 py-1.5 rounded-pill transition-colors"
                    >
                      {link.label} · Take me there →
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <ul className="max-h-96 overflow-auto py-1">
            {rows.map((row, i) => (
              <li key={row.key}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => activate(row)}
                  className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors ${i === clampedActive ? 'bg-surface-subtle' : 'hover:bg-surface-subtle'}`}
                >
                  <span className="min-w-0">
                    <span className="block font-body text-sm text-text-primary truncate">{row.label}</span>
                    <span className="block text-xs text-text-muted font-body">{row.sublabel}</span>
                  </span>
                  {row.kind === 'client' ? (
                    <span className="flex items-center gap-1.5 shrink-0">
                      <ActionChip href={`/admin/content/${row.client.id}`} onNavigate={router.push}>Content</ActionChip>
                      <ActionChip href={`/admin/sessions/${row.client.id}/mbp`} onNavigate={router.push}>MBP</ActionChip>
                    </span>
                  ) : (
                    <span className="text-brand-cyan text-sm shrink-0">→</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function ActionChip({ href, onNavigate, children }: { href: string; onNavigate: (h: string) => void; children: React.ReactNode }) {
  return (
    <span
      role="link"
      tabIndex={0}
      onClick={e => { e.stopPropagation(); onNavigate(href) }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          onNavigate(href)
        }
      }}
      className="text-xs font-heading font-semibold text-brand-cyan hover:text-brand-navy px-2 py-1 rounded-pill hover:bg-brand-cyan/10 transition-colors"
    >
      {children}
    </span>
  )
}
