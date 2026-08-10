import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

// Next.js keeps secrets in .env.local; fall back to .env if present.
dotenv.config({ path: '.env' })
dotenv.config({ path: '.env.local', override: true })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing env vars')
  process.exit(1)
}

// Usage: node scripts/confirm-email.mjs <email>
// Force-confirms a user's email (sets auth.users.email_confirmed_at) via the
// admin API. Rescue for accounts whose invite email never arrived: without a
// confirmed email, signInWithPassword returns "Email not confirmed". Does NOT
// touch the password. Also reports whether the app-level admins row exists —
// a confirmed user with no admins row is authenticated but not authorized.
const targetEmail = (process.argv[2] || '').toLowerCase()
if (!targetEmail) {
  console.error('Usage: node scripts/confirm-email.mjs <email>')
  process.exit(1)
}

const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

// Paginate auth.users to find the matching email.
let foundUser = null
let page = 1
while (true) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 })
  if (error) { console.error('listUsers error:', error.message); process.exit(2) }
  foundUser = data.users.find((u) => (u.email ?? '').toLowerCase() === targetEmail)
  if (foundUser) break
  if (data.users.length < 200) break
  page += 1
}

if (!foundUser) {
  console.error(`No auth.users row with email=${targetEmail}`)
  process.exit(3)
}

console.log(`auth.users match: id=${foundUser.id} email=${foundUser.email}`)
console.log(`email_confirmed_at (before): ${foundUser.email_confirmed_at ?? 'null'}`)

if (foundUser.email_confirmed_at) {
  console.log('Already confirmed — no change needed.')
} else {
  const { error: updErr } = await sb.auth.admin.updateUserById(foundUser.id, { email_confirm: true })
  if (updErr) { console.error('updateUserById error:', updErr.message); process.exit(4) }
  const { data: after, error: getErr } = await sb.auth.admin.getUserById(foundUser.id)
  if (getErr) { console.error('getUserById error:', getErr.message); process.exit(5) }
  console.log(`email_confirmed_at (after):  ${after.user.email_confirmed_at ?? 'still null (!)'}`)
}

// Authorization check: the app keys identity off the admins table.
const { data: admin, error: selErr } = await sb
  .from('admins')
  .select('id, email, role, capabilities')
  .eq('id', foundUser.id)
  .maybeSingle()
if (selErr) { console.error('admins select error:', selErr.message); process.exit(6) }

if (admin) {
  console.log(`admins row: ${JSON.stringify(admin)}`)
  console.log('Done. They can sign in at /admin/login with their existing password.')
} else {
  console.warn('WARNING: no admins row for this user — they will be logged in but NOT authorized.')
  console.warn('Seed one with: node scripts/seed-admin.mjs ' + foundUser.email + ' "<name>" <admin|manager>')
}
