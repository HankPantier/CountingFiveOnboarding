import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { readJsonBody } from '@/app/api/_json'
import { createServerClient } from '@/lib/supabase/server'
import { isCssTarget, type CssTarget } from '@/lib/design/css-targets'
import { listLockRows, lockDto } from '@/lib/design/lock-store'
import { isLeverKey, type DesignLockDto, type LeverKey, type LockChange, type LockKind } from '@/lib/design/locks'
import type { EditContext } from '../../_helpers'
import { requireDesignAdmin } from '../_design'
import { ensureDesignBaseline } from '../_baseline'

export const runtime = 'nodejs'
export const maxDuration = 60

type Params = { params: Promise<{ id: string }> }

interface LocksResponse {
  locks: DesignLockDto[]
}
interface LockChangeResponse extends LocksResponse {
  changed: string[]
  versionNo: number | null
}
interface LockRequestBody {
  areas?: unknown
  levers?: unknown
  label?: unknown
}

const MAX_KEYS = 12

function stringList(v: unknown): string[] | null {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.length > MAX_KEYS || !v.every((x) => typeof x === 'string')) return null
  return v as string[]
}

// Design locks (migration 085). Admin-only.
//   GET    — the session's locks.
//   POST   — { areas?: CssTarget[], levers?: LeverKey[], label? } lock what is on
//            the draft now (one commit: the pins).
//   DELETE — ?key=<area id | lever key> unlock one (one commit: pins removed).
// The design chat locks through its own tools (lock-ops.ts, same path).
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  try {
    const rows = await listLockRows(createServerClient(), ctx.sessionId)
    const response: LocksResponse = { locks: rows.map(lockDto) }
    return NextResponse.json(response)
  } catch (err) {
    return internalError('design:locks:list', err, 'Couldn’t load the design locks.')
  }
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  const body = await readJsonBody<LockRequestBody>(req)
  if (body instanceof NextResponse) return body
  const areas = stringList(body.areas)
  const levers = stringList(body.levers)
  if (!areas || !levers || !areas.every(isCssTarget) || !levers.every(isLeverKey)) {
    return NextResponse.json({ error: 'Unknown area or lever.' }, { status: 400 })
  }
  const label = typeof body.label === 'string' ? body.label.slice(0, 80) : undefined
  return change(ctx, { op: 'lock', areas: areas as CssTarget[], levers: levers as LeverKey[], ...(label ? { label } : {}) })
}

export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  const key = new URL(req.url).searchParams.get('key') ?? ''
  const kind: LockKind | null = isCssTarget(key) ? 'area' : isLeverKey(key) ? 'lever' : null
  if (!kind) return NextResponse.json({ error: 'Unknown lock.' }, { status: 400 })
  return change(ctx, { op: 'unlock', keys: [{ kind, key }] })
}

async function change(ctx: EditContext, lockChange: LockChange): Promise<NextResponse> {
  try {
    const db = createServerClient()
    // The lock commit needs a v0 to build on (commitDesignVersion 409s without one).
    await ensureDesignBaseline(db, ctx)
    // lightningcss (bundle-files) — lazy, like every design engine route.
    const [{ changeLocks }, { commitDesignVersion }, { bundleFromRepoFiles }, { readDraftThemeTexts }] = await Promise.all([
      import('@/lib/design/lock-ops'),
      import('@/lib/design/commit-version'),
      import('@/lib/design/bundle-files'),
      import('@/lib/design/theme-snapshot'),
    ])
    const theme = await readDraftThemeTexts(ctx.githubRepo)
    if (!theme.ok) return NextResponse.json({ error: theme.error }, { status: 409 })
    const files = { brandText: theme.files.brandText, designText: theme.files.designText, overridesCss: theme.files.overridesCss }
    const current = bundleFromRepoFiles(files, { name: 'Current design', source: 'chat' })
    if (!current.ok) return NextResponse.json({ error: `The current design can’t be read: ${current.errors.join(' ')}`.slice(0, 500) }, { status: 409 })
    const r = await changeLocks(db, {
      target: { sessionId: ctx.sessionId, jobId: ctx.jobId, githubRepo: ctx.githubRepo, adminId: ctx.adminId, adminEmail: ctx.adminEmail, adminName: ctx.adminName },
      base: { bundle: current.bundle, files },
      change: lockChange,
      commitVersion: (args) => commitDesignVersion(db, args),
    })
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    const rows = await listLockRows(db, ctx.sessionId)
    const response: LockChangeResponse = { locks: rows.map(lockDto), changed: r.changed, versionNo: r.versionNo }
    return NextResponse.json(response)
  } catch (err) {
    return internalError('design:locks:change', err, 'Couldn’t change the design locks — try again.')
  }
}
