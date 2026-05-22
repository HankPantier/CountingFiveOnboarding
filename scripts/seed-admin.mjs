import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing env vars')
  process.exit(1)
}

const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

const targetEmail = 'webhank@gmail.com'

// Paginate auth.users to find the matching email.
let foundUser = null
let page = 1
while (true) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 })
  if (error) { console.error('listUsers error:', error.message); process.exit(2) }
  foundUser = data.users.find((u) => (u.email ?? '').toLowerCase() === targetEmail.toLowerCase())
  if (foundUser) break
  if (data.users.length < 200) break
  page += 1
}

if (!foundUser) {
  console.error(`No auth.users row with email=${targetEmail}`)
  process.exit(3)
}

console.log(`auth.users match: id=${foundUser.id} email=${foundUser.email} created=${foundUser.created_at}`)

// Check if an admins row already exists.
const { data: existing, error: selErr } = await sb
  .from('admins')
  .select('id, email, name')
  .eq('id', foundUser.id)
  .maybeSingle()
if (selErr) { console.error('admins select error:', selErr.message); process.exit(4) }

if (existing) {
  console.log(`admins row already exists: ${JSON.stringify(existing)} — no-op.`)
  process.exit(0)
}

const { data: inserted, error: insErr } = await sb
  .from('admins')
  .insert({ id: foundUser.id, email: foundUser.email, name: 'Hank Pantier' })
  .select()
  .single()
if (insErr) { console.error('admins insert error:', insErr.message); process.exit(5) }

console.log('admins row inserted:', JSON.stringify(inserted))
