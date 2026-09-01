import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { generateSiteSecret } from '@/lib/wordpress/sites'
import type { RegenerateSecretResponse } from '@/types/wordpress-sites'

export const runtime = 'nodejs'

// Rotate a site's bearer secret. The new secret is returned once so the operator
// can paste it into the WordPress plugin; the old secret stops working
// immediately (the plugin fails closed and no-ops until updated).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminUser()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const secret = generateSiteSecret()
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('wordpress_sites')
    .update({ secret, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  return NextResponse.json<RegenerateSecretResponse>({ secret })
}
