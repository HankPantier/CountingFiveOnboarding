// Trim a LIVE client site's header logo so it renders at full size in the
// template's 32px-tall header (NavBar: h-8 w-auto). New sites get this at
// package time (lib/content/logo-preflight.ts, WS-A); this is the same logic
// for repos that shipped before it.
//
//  - transparent padding: preflightLogo() (fully transparent borders)
//  - an opaque light plate (white box baked in): trimLogoPlate(), ink + margin
//
// The original file is kept. The trimmed copy is written next to it as
// "<name>-trimmed.<ext>" and brand.json logo.primary is pointed at it (only
// that one value changes; the file's formatting is preserved).
//
// DRY RUN by default (like fleet-sync / add-action-text-vars):
//
//   npx tsx scripts/trim-client-logo.ts <client-repo>            # report before/after
//   npx tsx scripts/trim-client-logo.ts <client-repo> --apply    # write the copy + brand.json
//   ... --no-plate          # transparent padding only
//   ... --threshold 25      # plate: per-channel distance that counts as ink
//
// Nothing is committed or pushed. Exit code: 1 when a trim is available but
// was not written, else 0 (2 on error).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { preflightLogo, trimLogoPlate } from '../lib/content/logo-preflight'

const HEADER_HEIGHT = 32 // NavBar's <Image className="h-8 w-auto">

const args = process.argv.slice(2)
const repo = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--threshold')
const apply = args.includes('--apply')
const plateOk = !args.includes('--no-plate')
const tIdx = args.indexOf('--threshold')
const threshold = tIdx >= 0 ? Number(args[tIdx + 1]) : 25
if (!repo || !Number.isFinite(threshold)) {
  console.error('usage: npx tsx scripts/trim-client-logo.ts <client-repo> [--apply] [--no-plate] [--threshold N]')
  process.exit(2)
}

/** Replace logo.primary's value in brand.json text without touching anything else (palette.primary too). */
function setLogoPrimary(text: string, from: string, to: string): string {
  const logoAt = text.search(/"logo"\s*:\s*\{/)
  if (logoAt < 0) throw new Error('brand.json has no "logo" object')
  const re = /"primary"\s*:\s*"((?:[^"\\]|\\.)*)"/g
  re.lastIndex = logoAt
  const m = re.exec(text)
  if (!m || JSON.parse(`"${m[1]}"`) !== from) throw new Error(`logo.primary is not ${JSON.stringify(from)}`)
  const out = text.slice(0, m.index) + `"primary": ${JSON.stringify(to)}` + text.slice(m.index + m[0].length)
  if ((JSON.parse(out) as { logo: { primary: string } }).logo.primary !== to) throw new Error('brand.json rewrite failed')
  return out
}

async function dims(buf: Buffer): Promise<{ w: number; h: number }> {
  const m = await sharp(buf).metadata()
  return { w: m.width ?? 0, h: m.height ?? 0 }
}

const renderedWidth = ({ w, h }: { w: number; h: number }) => (h ? Math.round((HEADER_HEIGHT * w) / h) : 0)

async function main() {
  const brandPath = path.join(repo!, 'content', 'brand.json')
  const brandText = readFileSync(brandPath, 'utf-8')
  const brand = JSON.parse(brandText) as { logo?: { primary?: string } }
  const primary = brand.logo?.primary
  if (!primary) throw new Error('brand.json logo.primary is empty (text wordmark) — nothing to trim')
  if (/^https?:\/\//i.test(primary) || primary.startsWith('/')) throw new Error(`logo.primary ${primary} is not a content asset`)
  if (/-trimmed\.[a-z0-9]+$/i.test(primary)) {
    console.log(`${repo}: logo.primary is already a trimmed copy (${primary}) — nothing to do`)
    return 0
  }
  const file = path.join(repo!, 'public', 'content-assets', primary)
  const input = readFileSync(file)
  const before = await dims(input)

  let out: Buffer | null = null
  let how = ''
  const pre = await preflightLogo(input, primary)
  if (pre.trimmed) {
    out = pre.buffer
    how = 'transparent padding'
  } else if (plateOk) {
    const plate = await trimLogoPlate(input, { threshold })
    if (plate) {
      out = plate.buffer
      how = `opaque ${plate.plateHex} plate (kept as a margin; ask the client for a transparent PNG or SVG)`
    }
  }

  console.log(`${repo}`)
  console.log(`  logo      ${primary}`)
  console.log(`  before    ${before.w}×${before.h}px → ${renderedWidth(before)}px wide in the ${HEADER_HEIGHT}px header`)
  if (!out) {
    console.log('  after     no trim needed (padding under 10% on both sides)')
    for (const n of pre.notes) console.log(`  note      ${n}`)
    return 0
  }
  const after = await dims(out)
  const ext = path.extname(primary)
  const trimmedName = `${primary.slice(0, primary.length - ext.length)}-trimmed${ext}`
  const pct = Math.round((renderedWidth(after) / renderedWidth(before) - 1) * 100)
  console.log(`  after     ${after.w}×${after.h}px → ${renderedWidth(after)}px wide (+${pct}%) — ${how}`)
  console.log(`  copy      public/content-assets/${trimmedName}`)
  console.log(`  brand     logo.primary "${primary}" → "${trimmedName}"`)
  if (!apply) {
    console.log('  DRY RUN — re-run with --apply to write the copy and brand.json (original file kept)')
    return 1
  }
  const outFile = path.join(repo!, 'public', 'content-assets', trimmedName)
  if (existsSync(outFile)) throw new Error(`${outFile} already exists`)
  writeFileSync(outFile, out)
  writeFileSync(brandPath, setLogoPrimary(brandText, primary, trimmedName))
  console.log('  written (not committed)')
  return 0
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`${repo}: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
  },
)
