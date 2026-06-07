// Test the reverse-linker. Offline guard tests always run; pass a repo slug
// and a drafted post slug to also run candidate scoring + the live Haiku
// find-passage pass (read-only — nothing is committed).
// Run with:
//   npx tsx --env-file=.env.local scripts/test-reverse-linker.ts [repoSlug] [newPostSlug]
import {
  applyReverseLink,
  loadCandidates,
  insertReverseLinks,
  type FindPassageResponse,
} from '../lib/content/reverse-linker'
import { splitFile } from '../lib/editor/frontmatter'
import { DRAFT_BRANCH, readFile } from '../lib/github/repo-files'

let passed = 0
let failed = 0
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log('✓ ' + label); passed++ }
  else { console.log('✗ ' + label + (detail ? ': ' + detail : '')); failed++ }
}

const FIXTURE = `---
title: Quarterly Taxes for Freelancers
tags: [taxes, freelancers]
target_keyword: quarterly estimated taxes
---
Paying quarterly estimated taxes trips up most new freelancers. The IRS expects four payments a year. Many freelancers also struggle with retirement planning once income becomes irregular. See [our guide](/resources/old-guide) for the basics.
`

function offlineTests() {
  const file = splitFile(FIXTURE)
  const newSlug = 'retirement-plans-for-freelancers'
  const base = { file, slug: 'quarterly-taxes', path: 'content/posts/quarterly-taxes.md', newSlug }
  const good: FindPassageResponse = {
    match: true,
    original_sentence: 'Many freelancers also struggle with retirement planning once income becomes irregular.',
    rewritten_sentence: `Many freelancers also struggle with [retirement planning](/resources/${newSlug}) once income becomes irregular.`,
    anchor_text: 'retirement planning',
  }

  const applied = applyReverseLink({ ...base, response: good })
  assert('valid response applies', applied !== null)
  assert(
    'rewritten sentence lands in body',
    !!applied && applied.entry.content.includes(good.rewritten_sentence ?? '')
  )
  assert(
    'frontmatter round-trips intact',
    !!applied && applied.entry.content.startsWith('---\ntitle: Quarterly Taxes for Freelancers')
  )
  assert(
    'original sentence replaced exactly once',
    !!applied && !applied.entry.content.includes(good.original_sentence ?? '')
  )

  assert('match=false skips', applyReverseLink({ ...base, response: { match: false } }) === null)
  assert(
    'paraphrased original skips (no verbatim match)',
    applyReverseLink({
      ...base,
      response: { ...good, original_sentence: 'Many freelancers struggle with retirement planning when income is irregular.' },
    }) === null
  )
  assert(
    'rewrite missing link marker skips',
    applyReverseLink({
      ...base,
      response: { ...good, rewritten_sentence: 'Many freelancers also struggle with retirement planning once income becomes irregular!' },
    }) === null
  )
  assert(
    'sentence that already has a link skips',
    applyReverseLink({
      ...base,
      response: {
        match: true,
        original_sentence: 'See [our guide](/resources/old-guide) for the basics.',
        rewritten_sentence: `See [our guide](/resources/old-guide) and [retirement plans](/resources/${newSlug}) for the basics.`,
        anchor_text: 'retirement plans',
      },
    }) === null
  )
  assert(
    'unchanged rewrite skips',
    applyReverseLink({ ...base, response: { ...good, rewritten_sentence: good.original_sentence } }) === null
  )
  assert(
    'extra (external) link in rewrite skips',
    applyReverseLink({
      ...base,
      response: {
        ...good,
        rewritten_sentence: `Many freelancers also struggle with [retirement planning](/resources/${newSlug}), see [more](https://evil.example) here.`,
      },
    }) === null
  )

  // Ambiguous: same sentence appears twice → skip rather than link wrong one.
  const dupFixture = `---
title: Dup
tags: [taxes]
---
Plan ahead for retirement. Some filler. Plan ahead for retirement.
`
  const dupFile = splitFile(dupFixture)
  assert(
    'duplicate sentence skips (ambiguous)',
    applyReverseLink({
      file: dupFile,
      slug: 'dup',
      path: 'content/posts/dup.md',
      newSlug,
      response: {
        match: true,
        original_sentence: 'Plan ahead for retirement.',
        rewritten_sentence: `Plan ahead for [retirement](/resources/${newSlug}).`,
        anchor_text: 'retirement',
      },
    }) === null
  )
}

async function liveTests(repoSlug: string, newPostSlug: string) {
  const blob = await readFile(repoSlug, `content/posts/${newPostSlug}.md`, DRAFT_BRANCH)
  const { frontmatter } = splitFile(blob.content)
  const fields = frontmatter?.fields ?? {}
  const newPost = {
    slug: newPostSlug,
    title: fields.title ?? newPostSlug,
    keyword: fields.target_keyword ?? null,
    tags: frontmatter?.arrayFields.tags ?? [],
    excerpt: fields.excerpt ?? '',
    answerBlock: fields.answer_block ?? '',
  }

  console.log(`\nnew post: "${newPost.title}" (${newPost.keyword ?? 'no keyword'})`)
  const candidates = await loadCandidates(repoSlug, newPost)
  console.log(`candidates (${candidates.length}):`)
  for (const c of candidates) console.log(`  score=${c.score} ${c.slug}`)
  assert('candidates capped at 5', candidates.length <= 5)
  assert(
    'no candidate already links to new post',
    candidates.every((c) => !c.file.body.includes(`](/resources/${newPostSlug})`))
  )

  const { results, entries } = await insertReverseLinks({
    githubRepo: repoSlug,
    newPost,
    contentJobId: 'test-script',
    sessionId: 'test-script',
  })
  console.log(`\ninsertions (${results.length}):`)
  for (const r of results) console.log(`  ${r.slug}: [${r.anchorText}] → ${r.insertedInto}`)
  assert('insertions capped at 3', entries.length <= 3)
  assert(
    'each edited file links to new post exactly once',
    entries.every(
      (e) => e.content.split(`](/resources/${newPostSlug})`).length === 2
    )
  )
  assert('one result per entry', results.length === entries.length)
  console.log('\n(nothing committed — read-only test)')
}

async function main() {
  offlineTests()
  const [repoSlug, newPostSlug] = [process.argv[2], process.argv[3]]
  if (repoSlug && newPostSlug) {
    await liveTests(repoSlug, newPostSlug)
  } else {
    console.log('\n(skipping live tests — pass <repoSlug> <newPostSlug> to run them)')
  }
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
