import { NextRequest, NextResponse } from 'next/server'
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { getCurrentUser, hasCapability, type CurrentUser } from '@/lib/auth/access'
import { getCommandIndex } from '@/lib/admin/command-index'

// Lightweight nav classifier — never send `effort`/adaptive thinking to Haiku
// (it errors), and this is a cheap intent lookup, so plain generateText is right.
const COMMAND_MODEL = 'claude-haiku-4-5-20251001'

interface CommandResult {
  href: string | null
  label: string
  message?: string
}

// Section destinations, each gated by the capability that reveals it in the nav.
// Only sections the caller can actually reach are offered to the model.
const SECTIONS: Array<{ key: string; href: string; label: string; requires: 'manager' | 'auditor' | 'admin' }> = [
  { key: 'onboarding', href: '/admin/dashboard', label: 'Onboarding (client sessions)', requires: 'manager' },
  { key: 'content', href: '/admin/content', label: 'Content generation', requires: 'manager' },
  { key: 'batch', href: '/admin/blog-batch', label: 'Batch content', requires: 'manager' },
  { key: 'audits', href: '/admin/audits', label: 'Site audits', requires: 'auditor' },
  { key: 'token-usage', href: '/admin/token-usage', label: 'Token usage / AI spend', requires: 'admin' },
  { key: 'users', href: '/admin/settings/users', label: 'User management', requires: 'admin' },
]

function clientHref(id: string, action: string): string {
  if (action === 'content') return `/admin/content/${id}`
  if (action === 'mbp') return `/admin/sessions/${id}/mbp`
  return `/admin/sessions/${id}`
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function resolve(query: string, user: CurrentUser): Promise<CommandResult> {
  const sections = SECTIONS.filter(s =>
    s.requires === 'admin' ? user.isAdmin : hasCapability(user, s.requires)
  )
  const { clients, audits } = await getCommandIndex(user)

  const clientList = clients.map(c => `- id:${c.id} — ${c.name} (${c.status})`).join('\n') || '(none)'
  const auditList = audits.map(a => `- id:${a.id} — ${a.name} (${a.status})`).join('\n') || '(none)'
  const sectionList = sections.map(s => `- ${s.key}: ${s.label}`).join('\n')

  const prompt = `An admin typed a command into a navigation box. Resolve it to ONE destination.

SECTIONS (top-level pages):
${sectionList}

CLIENTS:
${clientList}

AUDITS:
${auditList}

For a client you may choose an action: "session" (open the client), "content" (generate/edit their website content), or "mbp" (their Master Business Profile).

Return ONLY JSON:
{
  "type": "section" | "client" | "audit" | "none",
  "section": "<one of the section keys>" | null,
  "id": "<the exact client or audit id>" | null,
  "action": "session" | "content" | "mbp" | null,
  "label": "<short human label for what you picked>"
}

Rules: match a client/audit only when the command clearly names one from the lists above (fuzzy names are fine, e.g. "korbey" → "Korbey Lague"). If nothing matches, use type "none". Never invent an id.`

  const { text } = await generateText({
    model: anthropic(COMMAND_MODEL),
    system: 'You are a precise navigation router. Return JSON only, no prose.',
    prompt,
    maxOutputTokens: 200,
  })

  const parsed = parseJson(text)
  const notFound: CommandResult = { href: null, label: '', message: "Couldn't find that — try a client name, an audit, or a section." }
  if (!parsed) return notFound

  const type = parsed.type
  if (type === 'section') {
    const section = sections.find(s => s.key === parsed.section)
    return section ? { href: section.href, label: section.label } : notFound
  }
  if (type === 'client') {
    const client = clients.find(c => c.id === parsed.id)
    if (!client) return notFound
    const action = typeof parsed.action === 'string' ? parsed.action : 'session'
    return { href: clientHref(client.id, action), label: `${client.name}` }
  }
  if (type === 'audit') {
    const audit = audits.find(a => a.id === parsed.id)
    return audit ? { href: `/admin/audits/${audit.id}`, label: audit.name } : notFound
  }
  return notFound
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { query?: unknown } | null
  const query = typeof body?.query === 'string' ? body.query.trim() : ''
  if (!query) return NextResponse.json({ error: 'Missing query' }, { status: 400 })

  try {
    const result = await resolve(query, user)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[admin-command] resolve failed:', err)
    return NextResponse.json({ href: null, label: '', message: 'Something went wrong interpreting that.' })
  }
}
