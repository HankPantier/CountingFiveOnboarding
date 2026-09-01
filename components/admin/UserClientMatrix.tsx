'use client'

import { Fragment, useState } from 'react'
import type { UserClientUsage, Totals } from '@/lib/tokens/aggregate'

function money(v: number): string {
  return `$${v.toFixed(2)}`
}

function tokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`
  return String(v)
}

function totalTokens(t: Totals): number {
  return t.inputTokens + t.outputTokens
}

function ClientBreakdown({ user }: { user: UserClientUsage }) {
  return (
    <div className="px-4 py-4 bg-surface-subtle">
      <h4 className="text-xs font-heading font-semibold text-text-muted uppercase tracking-wide mb-2">By client</h4>
      <ul className="space-y-1">
        {user.clients.map((c) => (
          <li
            key={c.clientId ?? '__unassigned__'}
            className="flex justify-between text-sm font-body text-text-secondary"
          >
            <span className="truncate mr-3 inline-flex items-center gap-2">
              {c.clientLabel}
              {c.clientKind === 'audit-site' && (
                <span className="inline-flex items-center rounded-badge px-2 py-0.5 font-heading text-[10px] font-semibold uppercase tracking-[0.04em] bg-brand-cyan/10 text-brand-cyan-dark">
                  Audit only
                </span>
              )}
            </span>
            <span className="tabular-nums whitespace-nowrap">
              {money(c.total.cost)} · {tokens(totalTokens(c.total))} tok · {c.total.calls} calls
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function UserClientMatrix({ users }: { users: UserClientUsage[] }) {
  const [open, setOpen] = useState<string | null>(null)

  if (users.length === 0) {
    return <p className="text-sm font-body text-text-muted py-8 text-center">No usage recorded yet.</p>
  }

  return (
    <div className="bg-surface-card border border-border-default rounded-xl shadow-subtle overflow-hidden">
      <table className="w-full text-left">
        <thead className="bg-surface-header">
          <tr className="border-b border-border-default">
            <th className="px-4 py-3 text-xs font-heading font-semibold text-text-secondary uppercase tracking-wide">User</th>
            <th className="px-4 py-3 text-xs font-heading font-semibold text-text-secondary uppercase tracking-wide text-right">Clients</th>
            <th className="px-4 py-3 text-xs font-heading font-semibold text-text-secondary uppercase tracking-wide text-right">Cost</th>
            <th className="px-4 py-3 text-xs font-heading font-semibold text-text-secondary uppercase tracking-wide text-right">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const key = u.userId ?? '__unattributed__'
            const isOpen = open === key
            return (
              <Fragment key={key}>
                <tr
                  onClick={() => setOpen(isOpen ? null : key)}
                  className="border-b border-border-default cursor-pointer hover:bg-surface-subtle transition-colors"
                >
                  <td className="px-4 py-3 font-body text-text-primary">
                    <span className="inline-flex items-center gap-2">
                      <span className={`text-text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
                      <span className="truncate">{u.label}</span>
                      {u.userId === null && (
                        <span className="inline-flex items-center rounded-badge px-2.5 py-1 font-heading text-[10.5px] font-semibold uppercase tracking-[0.04em] bg-surface-subtle text-text-muted">
                          Unattributed
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-body text-text-secondary text-right tabular-nums">{u.clients.length}</td>
                  <td className="px-4 py-3 font-body text-text-primary text-right tabular-nums">{money(u.total.cost)}</td>
                  <td className="px-4 py-3 font-body text-text-secondary text-right tabular-nums">{tokens(totalTokens(u.total))}</td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={4} className="p-0">
                      <ClientBreakdown user={u} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
