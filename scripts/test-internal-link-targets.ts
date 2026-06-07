// Test the enriched internal-link target builder against a real linked repo.
// Run with:
//   npx tsx --env-file=.env.local scripts/test-internal-link-targets.ts <repoSlug>
import { buildInternalLinkTargets } from '../lib/content/internal-link-targets'

let passed = 0
let failed = 0
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log('✓ ' + label); passed++ }
  else { console.log('✗ ' + label + (detail ? ': ' + detail : '')); failed++ }
}

async function main() {
  const repoSlug = process.argv[2]
  if (!repoSlug) throw new Error('usage: test-internal-link-targets.ts <repoSlug>')

  const { targets, postSlugs } = await buildInternalLinkTargets(repoSlug)

  console.log(`\ntargets: ${targets.length}, posts: ${postSlugs.length}`)
  for (const t of targets) {
    console.log(
      `  ${t.isPost ? 'POST' : 'PAGE'} ${t.url} — "${t.title}"` +
        (t.keyword ? ` — keyword: ${t.keyword}` : '') +
        (t.about ? ` — about: ${t.about}` : '')
    )
  }

  assert('caps at 40 targets', targets.length <= 40, `got ${targets.length}`)
  assert('found at least one target', targets.length > 0)
  assert(
    'posts sorted before pages',
    targets.findIndex((t) => !t.isPost) === -1 ||
      targets.findIndex((t) => !t.isPost) >= targets.filter((t) => t.isPost).length
  )
  assert(
    'every post slug appears in postSlugs',
    targets.filter((t) => t.isPost).every((t) => postSlugs.includes(t.slug))
  )
  const enriched = targets.filter((t) => t.keyword || t.about)
  assert('at least one target enriched from frontmatter', enriched.length > 0)
  assert(
    'about lines are single-line and capped',
    targets.every((t) => !t.about || (!t.about.includes('\n') && t.about.length <= 120))
  )
  assert(
    'urls are site-relative',
    targets.every((t) => t.url.startsWith('/'))
  )

  // Degrade path: a nonexistent repo must return empty, never throw.
  const bogus = await buildInternalLinkTargets('definitely-not-a-real-repo-xyz')
  assert('bogus repo degrades to empty (no throw)', bogus.targets.length === 0 && bogus.postSlugs.length === 0)

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
