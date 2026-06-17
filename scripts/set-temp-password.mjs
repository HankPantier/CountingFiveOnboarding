import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
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

// Usage: node scripts/set-temp-password.mjs <email> [password]
// Admin-sets a user's password. If no password is given, a strong temporary
// one is generated and printed. The user should change it at /admin/account.
const targetEmail = (process.argv[2] || '').toLowerCase()
if (!targetEmail) {
  console.error('Usage: node scripts/set-temp-password.mjs <email> [password]')
  process.exit(1)
}
const password = process.argv[3] || randomBytes(9).toString('base64url') + 'A9'

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

const { error: updErr } = await sb.auth.admin.updateUserById(foundUser.id, { password })
if (updErr) { console.error('updateUserById error:', updErr.message); process.exit(4) }

console.log(`Password set for ${foundUser.email} (id=${foundUser.id})`)
console.log(`Temporary password: ${password}`)
console.log('Have them sign in at /admin/login, then change it at /admin/account.')
