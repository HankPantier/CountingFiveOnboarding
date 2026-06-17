'use client'

import { Fragment, useState } from 'react'
import type { ClientUsage, Totals } from '@/lib/tokens/aggregate'
import { TASKS } from '@/lib/tokens/aggregate'

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

const TASK_LABEL: Record<string, string> = {
  onboarding: 'Onboarding',
  audit: 'Audit',
  content: 'Content',
}

function Breakdown({ client }: { client: ClientUsage }) {
  const models = Object.entries(client.byModel).sort((a, b) => b[1].cost - a[1].cost)
  return (
    <div className="grid gap-6 md:grid-cols-2 px-4 py-4 bg-surface-subtle">
      <div>
        <h4 className="text-xs font-heading font-semibold text-text-muted uppercase tracking-wide mb-2">By task</h4>
        <ul className="space-y-1">
          {TASKS.map((task) => {
            const t = client.byTask[task]
            if (!t.calls) return null
            return (
              <li key={task} className="flex justify-between text-sm font-body text-text-secondary">
                <span>{TASK_LABEL[task]}</span>
                <span className="tabular-nums">
                  {money(t.cost)} · {tokens(totalTokens(t))} tok · {t.calls} calls
                </span>
              </li>
            )
          })}
        </ul>
      </div>
      <div>
        <h4 className="text-xs font-heading font-semibold text-text-muted uppercase tracking-wide mb-2">By model</h4>
        <ul className="space-y-1">
          {models.map(([model, t]) => (
            <li key={model} className="flex justify-between text-sm font-body text-text-secondary">
              <span className="truncate mr-3">{model}</span>
              <span className="tabular-nums whitespace-nowrap">
                {money(t.cost)} · {tokens(totalTokens(t))} tok
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default function ClientUsageTable({ clients }: { clients: ClientUsage[] }) {
  const [open, setOpen] = useState<string | null>(null)

  if (clients.length === 0) {
    return <p className="text-sm font-body text-text-muted py-8 text-center">No usage recorded yet.</p>
  }

  return (
    <div className="bg-surface-card border border-border-default rounded-lg shadow-subtle overflow-hidden">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border-default">
            <th className="px-4 py-3 text-xs font-heading font-semibold text-text-muted uppercase tracking-wide">Client</th>
            <th className="px-4 py-3 text-xs font-heading font-semibold text-text-muted uppercase tracking-wide text-right">Cost</th>
            <th className="px-4 py-3 text-xs font-heading font-semibold text-text-muted uppercase tracking-wide text-right">Tokens</th>
            <th className="px-4 py-3 text-xs font-heading font-semibold text-text-muted uppercase tracking-wide text-right">Calls</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => {
            const key = c.clientId ?? '__unassigned__'
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
                      <span className="truncate">{c.label}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 font-body text-text-primary text-right tabular-nums">{money(c.total.cost)}</td>
                  <td className="px-4 py-3 font-body text-text-secondary text-right tabular-nums">{tokens(totalTokens(c.total))}</td>
                  <td className="px-4 py-3 font-body text-text-secondary text-right tabular-nums">{c.total.calls}</td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={4} className="p-0">
                      <Breakdown client={c} />
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
