// Regenerates the scoring golden fixture: runs the real engine against a stable
// target, freezes the exact ComputeScoresInput + the resulting scores/findings.
// The golden test (lib/audit/scoring-golden.test.ts) re-runs computeScores on
// the frozen input and asserts the frozen output — a deterministic regression
// guard with no network. Re-run after an intentional scoring change:
//   set -a; . ./.env.local; set +a; npx tsx scripts/capture-audit-fixture.mts
import { mkdirSync, writeFileSync } from 'node:fs'
import { analyzePage } from '../lib/audit/analyze-page'
import { crawlSite, safeGet } from '../lib/audit/crawl'
import { fetchLlmsTxt, fetchRobots, fetchSitemap } from '../lib/audit/fetch-meta'
import { checkGoogleIndex } from '../lib/audit/index-check'
import { checkPageSpeed } from '../lib/audit/pagespeed'
import { computeOverall, computeScores, getGrade, type ComputeScoresInput } from '../lib/audit/scoring'
import { checkSsl } from '../lib/audit/ssl'

const TARGET = 'https://books.toscrape.com/'
const MAX_PAGES = 8

const { pages, errors } = await crawlSite(TARGET, MAX_PAGES)
const robots = await fetchRobots(TARGET)
const [sitemap, ssl, llms, psiMobile, psiDesktop, indexCheck] = await Promise.all([
  fetchSitemap(TARGET, robots.sitemaps),
  checkSsl(TARGET),
  fetchLlmsTxt(TARGET),
  checkPageSpeed(TARGET, 'mobile'),
  checkPageSpeed(TARGET, 'desktop'),
  checkGoogleIndex('books.toscrape.com'),
])
const probe = await safeGet(`${pages[0].url.replace(/\/+$/, '')}/this-page-does-not-exist-audit-check`)
const has404 = probe !== null && probe.status === 404 && probe.body.length > 500
const analyzed = pages.map((p) => analyzePage(p))
const googleIndexCount =
  indexCheck.google_index_count === 'unverified' ? null : indexCheck.google_index_count

const input: ComputeScoresInput = {
  // Strip per-page html/headers — computeScores doesn't read them, keeps the
  // fixture small.
  pages: pages.map((p) => ({ ...p, html: '', response_headers: {} })),
  analyzed,
  robots,
  sitemap,
  ssl,
  psiMobile,
  psiDesktop,
  llms,
  errors,
  has404,
  googleIndexCount,
}

const { scores, findings } = computeScores(input)
const overall = computeOverall(scores)
const fixture = {
  capturedFrom: TARGET,
  input,
  expected: { scores, overall_score: overall, overall_grade: getGrade(overall), findings },
}

mkdirSync('lib/audit/__fixtures__', { recursive: true })
writeFileSync('lib/audit/__fixtures__/scoring-golden.json', JSON.stringify(fixture, null, 2))
console.log(
  `captured: ${pages.length} pages, overall ${overall} (${getGrade(overall)}), PSI ${psiMobile.score ?? 'n/a'}`,
)
