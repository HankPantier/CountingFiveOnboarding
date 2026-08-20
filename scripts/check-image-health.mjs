import dotenv from 'dotenv'

// Next.js keeps secrets in .env.local; fall back to .env if present.
dotenv.config({ path: '.env' })
dotenv.config({ path: '.env.local', override: true })

// Usage: node scripts/check-image-health.mjs
//
// Preflight for the stock-photo path. Every generated page references hero and
// inline images that are fetched from Pexels at package-assembly time. If
// PEXELS_API_KEY is missing or invalid, resolveStockPhotos() returns [] and the
// assembler ships the page text with NO image files — the live site then renders
// "Image not found" on every page, silently. This check surfaces that state:
//   - exits non-zero if PEXELS_API_KEY is unset
//   - does one live search and prints the result count or the API error verbatim
const apiKey = process.env.PEXELS_API_KEY
if (!apiKey) {
  console.error('FAIL: PEXELS_API_KEY is not set. Stock-photo resolution will be skipped and every site ships with "Image not found" placeholders.')
  console.error('Set PEXELS_API_KEY in this environment (and in Vercel prod) before packaging any site.')
  process.exit(1)
}

console.log(`Key:    ${apiKey.slice(0, 6)}… (${apiKey.length} chars)`)

const res = await fetch('https://api.pexels.com/v1/search?query=office&per_page=1&orientation=landscape', {
  headers: { Authorization: apiKey },
})
if (res.status === 401) {
  console.error('FAIL: Pexels rejected the key (HTTP 401). PEXELS_API_KEY is invalid.')
  process.exit(2)
}
if (!res.ok) {
  console.error(`FAIL: Pexels /search returned HTTP ${res.status}. Rate limit? Try again shortly.`)
  process.exit(3)
}
const body = await res.json().catch(() => ({}))
const count = Array.isArray(body?.photos) ? body.photos.length : 0
if (count === 0) {
  console.error('FAIL: Pexels returned 0 photos for a trivial query — the key works but something is off.')
  process.exit(4)
}
console.log(`OK: Pexels reachable and authorized — sample query returned ${count} photo(s). Stock-photo resolution will work.`)
