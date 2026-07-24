import { z } from 'zod'
import { createServerClient } from '@/lib/supabase/server'
import {
  getAccessibleSessionIds,
  getAccessibleAuditScope,
  type CurrentUser,
} from '@/lib/auth/access'
import { clientName } from '@/lib/admin/command-index'
import { TERMINAL_AUDIT_STATUSES } from '@/lib/admin/home-stats'
import { summarize, byClient, type UsageRow, type AuditMeta } from '@/lib/tokens/aggregate'
import type { SessionSchema } from '@/types/session-schema'

// Mirrors the badge labels on /admin/content — kept local so the tools file
// doesn't import from a page component.
const CONTENT_PHASE_LABELS: Record<number, string> = {
  1: 'Palette',
  2: 'Sitemap',
  3: 'Research',
  4: 'Outlines',
  5: 'Generating',
  6: 'Complete',
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Every query token must appear somewhere in the haystack (order-independent).
// Same matching rule the client-side command palette uses, so AI and instant
// search resolve names consistently.
export function fuzzyIncludes(haystack: string, query: string): boolean {
  const h = haystack.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(t => h.includes(t))
}

// ── find_person: pure matcher ────────────────────────────────────────────────

export interface PersonSessionRow {
  id: string
  website_url: string
  schema_data: SessionSchema | null
}

export interface PersonMatch {
  sessionId: string
  teamIndex: number
  displayName: string
  clientName: string
  bioEmpty: boolean
}

// Best team-member match across every accessible client. Scored so an exact
// name beats a substring beats a scattered all-tokens hit; the first-seen best
// wins ties. Returns null when nothing matches.
export function pickBestPerson(sessions: PersonSessionRow[], name: string): PersonMatch | null {
  const q = name.trim().toLowerCase()
  if (!q) return null
  const qTokens = q.split(/\s+/).filter(Boolean)

  let best: PersonMatch | null = null
  let bestScore = 0

  for (const s of sessions) {
    const team = s.schema_data?.team ?? []
    for (let i = 0; i < team.length; i++) {
      const memberName = (team[i]?.name ?? '').trim()
      if (!memberName) continue
      const lower = memberName.toLowerCase()

      let score = 0
      if (lower === q) score = 3
      else if (lower.includes(q)) score = 2
      else if (qTokens.every(t => lower.includes(t))) score = 1
      if (score === 0) continue

      if (score > bestScore) {
        bestScore = score
        best = {
          sessionId: s.id,
          teamIndex: i,
          displayName: memberName,
          clientName: clientName(s.schema_data, s.website_url),
          bioEmpty: (team[i]?.bio ?? '').trim().length === 0,
        }
      }
    }
  }

  return best
}

// ── get_content_status: pure rollup ──────────────────────────────────────────

export interface PageStatusRow {
  page_title: string
  generation_status: string
  admin_approved_content: boolean
  client_approved_content: boolean
  needs_client_review: boolean
}

export interface ContentRollup {
  totalPages: number
  generated: number
  adminApproved: number
  clientApproved: number
  unpublished: number
  unpublishedTitles: string[]
}

// A page is "published/live-eligible" once the client has approved it; anything
// short of that is unpublished. Titles are capped so tool output stays compact.
export function summarizePages(pages: PageStatusRow[]): ContentRollup {
  const unpublishedPages = pages.filter(p => !p.client_approved_content)
  return {
    totalPages: pages.length,
    generated: pages.filter(p => p.generation_status === 'complete').length,
    adminApproved: pages.filter(p => p.admin_approved_content).length,
    clientApproved: pages.filter(p => p.client_approved_content).length,
    unpublished: unpublishedPages.length,
    unpublishedTitles: unpublishedPages.slice(0, 8).map(p => p.page_title),
  }
}

// ── tool factory ─────────────────────────────────────────────────────────────

// Read-only, access-scoped tools for the home assistant. Scope is derived once
// per request from the trusted `user` (never from tool arguments): admins see
// everything, managers only their assigned sessions, auditors only their own
// audits. Out-of-scope names simply resolve to `found: false`.
export async function buildAssistantTools(user: CurrentUser) {
  const allowedSessionIds = await getAccessibleSessionIds(user)
  const auditScope = getAccessibleAuditScope(user)

  return {
    find_person: {
      description:
        "Locate a team member by name across the operator's accessible clients and return a deep link to edit their bio in the MBP. Use for requests like \"take me to <person>'s bio\".",
      inputSchema: z.object({
        name: z.string().describe('Person name to find; fuzzy match is fine'),
      }),
      execute: async ({ name }: { name: string }) => {
        const supabase = createServerClient()
        let q = supabase
          .from('sessions')
          .select('id, website_url, schema_data')
          .neq('status', 'archived')
        if (allowedSessionIds !== null) q = q.in('id', allowedSessionIds)
        const { data } = await q

        const rows: PersonSessionRow[] = (data ?? []).map(s => ({
          id: s.id,
          website_url: s.website_url,
          schema_data: s.schema_data as SessionSchema | null,
        }))
        const match = pickBestPerson(rows, name)
        if (!match) return { found: false as const }
        return {
          found: true as const,
          displayName: match.displayName,
          clientName: match.clientName,
          bioEmpty: match.bioEmpty,
          href: `/admin/sessions/${match.sessionId}/mbp#mbp-field-team.${match.teamIndex}.bio`,
        }
      },
    },

    get_audit_status: {
      description:
        'Look up the status, score and grade of a single audit by client or domain name.',
      inputSchema: z.object({
        name: z.string().describe('Audit site name or domain; fuzzy match is fine'),
      }),
      execute: async ({ name }: { name: string }) => {
        const supabase = createServerClient()
        let q = supabase
          .from('audit_runs')
          .select('id, site_name, domain, audit_status, overall_score, overall_grade')
          .order('created_at', { ascending: false })
        if (auditScope) q = q.eq('created_by', auditScope.createdBy)
        const { data } = await q

        const match = (data ?? []).find(a =>
          fuzzyIncludes(`${a.site_name ?? ''} ${a.domain}`, name)
        )
        if (!match) return { found: false as const }
        return {
          found: true as const,
          name: match.site_name ?? match.domain,
          status: match.audit_status,
          score: match.overall_score,
          grade: match.overall_grade,
          href: `/admin/audits/${match.id}`,
        }
      },
    },

    count_audits: {
      description:
        'Count audits by status. "active" means not complete and not errored. Use for "how many audits are open/complete/failed".',
      inputSchema: z.object({
        status: z.enum(['active', 'complete', 'error', 'all']).optional(),
      }),
      execute: async () => {
        const supabase = createServerClient()
        let q = supabase.from('audit_runs').select('audit_status')
        if (auditScope) q = q.eq('created_by', auditScope.createdBy)
        const { data } = await q

        const rows = data ?? []
        const complete = rows.filter(r => TERMINAL_AUDIT_STATUSES[0] === r.audit_status).length
        const error = rows.filter(r => TERMINAL_AUDIT_STATUSES[1] === r.audit_status).length
        return { active: rows.length - complete - error, complete, error, total: rows.length }
      },
    },

    get_content_status: {
      description:
        "Report a client's website content status: phase, page counts, and which pages are still unpublished. Use for \"status of X's content\" or \"which of X's pages are unpublished\".",
      inputSchema: z.object({
        clientName: z.string().describe('Client / business name; fuzzy match is fine'),
      }),
      execute: async ({ clientName: name }: { clientName: string }) => {
        const supabase = createServerClient()
        let sq = supabase
          .from('sessions')
          .select('id, website_url, schema_data')
          .neq('status', 'archived')
        if (allowedSessionIds !== null) sq = sq.in('id', allowedSessionIds)
        const { data: sessions } = await sq

        const resolved = (sessions ?? [])
          .map(s => ({
            id: s.id,
            label: clientName(s.schema_data as SessionSchema | null, s.website_url),
          }))
          .find(s => fuzzyIncludes(s.label, name))
        if (!resolved) return { found: false as const }

        const href = `/admin/content/${resolved.id}`
        const { data: job } = await supabase
          .from('content_jobs')
          .select('id, phase, github_repo')
          .eq('session_id', resolved.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (!job) {
          return { found: true as const, clientName: resolved.label, started: false as const, href }
        }

        const { data: pages } = await supabase
          .from('generated_pages')
          .select(
            'page_title, generation_status, admin_approved_content, client_approved_content, needs_client_review'
          )
          .eq('content_job_id', job.id)

        return {
          found: true as const,
          clientName: resolved.label,
          started: true as const,
          phase: job.phase,
          phaseLabel: CONTENT_PHASE_LABELS[job.phase] ?? `Phase ${job.phase}`,
          hasRepo: Boolean(job.github_repo),
          ...summarizePages(pages ?? []),
          href,
        }
      },
    },

    get_spend_summary: {
      description:
        'Total AI/token spend for a window (thisMonth, last30, allTime), optionally narrowed to one client. Admin only.',
      inputSchema: z.object({
        window: z.enum(['thisMonth', 'last30', 'allTime']).optional(),
        clientName: z.string().optional().describe('Optional client to narrow spend to'),
      }),
      execute: async ({
        window,
        clientName: name,
      }: {
        window?: 'thisMonth' | 'last30' | 'allTime'
        clientName?: string
      }) => {
        if (!user.isAdmin) return { error: 'not_authorized' as const }
        const supabase = createServerClient()
        const [{ data: usage }, { data: sessions }, { data: auditRuns }] = await Promise.all([
          supabase
            .from('token_usage')
            .select(
              'task, stage, model, input_tokens, output_tokens, session_id, audit_id, created_at'
            )
            .order('created_at', { ascending: false })
            .range(0, 49999),
          supabase.from('sessions').select('id, website_url'),
          supabase.from('audit_runs').select('id, session_id, site_name, domain'),
        ])

        const rows = (usage ?? []) as UsageRow[]
        const labels: Record<string, string> = {}
        for (const s of sessions ?? []) labels[s.id] = s.website_url ?? s.id
        const audits: Record<string, AuditMeta> = {}
        for (const a of auditRuns ?? []) {
          audits[a.id] = { sessionId: a.session_id, siteName: a.site_name, domain: a.domain }
        }

        const win = window ?? 'thisMonth'
        const summary = summarize(rows, Date.now())
        const totals =
          win === 'allTime' ? summary.allTime : win === 'last30' ? summary.last30 : summary.thisMonth
        const base = {
          window: win,
          cost: round2(totals.cost),
          tokens: totals.inputTokens + totals.outputTokens,
          calls: totals.calls,
          href: '/admin/token-usage',
        }
        if (!name) return base

        // Per-client figures are all-time (byClient is not windowed) — noted so
        // the model phrases it as lifetime spend for that client.
        const client = byClient(rows, labels, audits).find(c => fuzzyIncludes(c.label, name))
        return {
          ...base,
          client: client
            ? { label: client.label, allTimeCost: round2(client.total.cost), calls: client.total.calls }
            : null,
        }
      },
    },

    list_pending_suggestions: {
      description:
        'List MBP suggestions awaiting review (status pending), optionally narrowed to one client.',
      inputSchema: z.object({
        clientName: z.string().optional().describe('Optional client to narrow to'),
      }),
      execute: async ({ clientName: name }: { clientName?: string }) => {
        const supabase = createServerClient()
        let q = supabase
          .from('mbp_suggestions')
          .select('id, session_id, summary, origin')
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
        if (allowedSessionIds !== null) q = q.in('session_id', allowedSessionIds)
        const { data } = await q

        let items = data ?? []
        const sessionIds = [...new Set(items.map(i => i.session_id))]
        const labelMap = new Map<string, string>()
        if (sessionIds.length) {
          const { data: sess } = await supabase
            .from('sessions')
            .select('id, website_url, schema_data')
            .in('id', sessionIds)
          for (const s of sess ?? []) {
            labelMap.set(s.id, clientName(s.schema_data as SessionSchema | null, s.website_url))
          }
        }

        if (name) items = items.filter(i => fuzzyIncludes(labelMap.get(i.session_id) ?? '', name))

        return {
          count: items.length,
          items: items.slice(0, 8).map(i => ({
            clientName: labelMap.get(i.session_id) ?? '',
            summary: i.summary,
            origin: i.origin,
            href: `/admin/sessions/${i.session_id}/mbp`,
          })),
        }
      },
    },

    navigate: {
      description:
        'Offer the user a navigation link to an admin page. Only call with internal paths starting with /admin. The user sees a "Take me there" link — this does NOT redirect automatically.',
      inputSchema: z.object({
        href: z.string().describe('Internal admin path, must start with /admin'),
        label: z.string().describe('Short human label, e.g. "David Lattimore\'s bio"'),
      }),
      execute: async ({ href, label }: { href: string; label: string }) => {
        if (!href.startsWith('/admin/')) return { ok: false as const, error: 'invalid_href' }
        return { ok: true as const, href, label }
      },
    },
  }
}
