import { createAuthClient, createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { Json } from '@/types/database'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await createAuthClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { fieldPath, value, isAdminOverride } = await req.json() as {
    fieldPath: string
    value: unknown
    isAdminOverride?: boolean
  }

  if (!fieldPath) return NextResponse.json({ error: 'fieldPath required' }, { status: 400 })

  const supabase = createServerClient()

  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', id)
    .single()

  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const schema = (session.schema_data as Record<string, unknown>) ?? {}
  let updated = deepSetPath(schema, fieldPath, value)

  if (isAdminOverride) {
    const meta = (updated._meta as Record<string, unknown>) ?? {}
    const overrides = (meta.admin_overrides as Record<string, boolean>) ?? {}
    updated = {
      ...updated,
      _meta: { ...meta, admin_overrides: { ...overrides, [fieldPath]: true } },
    }
  }

  await supabase
    .from('sessions')
    .update({ schema_data: updated as Json })
    .eq('id', id)

  return NextResponse.json({ success: true })
}

function deepSetPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): Record<string, unknown> {
  const keys = path.split('.')
  const result = { ...obj }
  let current = result
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    current[key] = { ...(typeof current[key] === 'object' && current[key] !== null && !Array.isArray(current[key]) ? current[key] as Record<string, unknown> : {}) }
    current = current[key] as Record<string, unknown>
  }
  current[keys[keys.length - 1]] = value
  return result
}
